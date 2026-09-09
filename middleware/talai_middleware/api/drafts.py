"""The outbox: draft purchase bills and their attachments (plan §3.6)."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Query

from ..api.schemas import (
    DraftList,
    DraftOut,
    DraftPurchaseBill,
    ValidationIssue,
    ValidationResult,
)
from ..db import models, repo
from ..services import validation
from .deps import SessionDep
from .errors import ApiError

logger = logging.getLogger(__name__)

router = APIRouter(tags=["drafts"])


def to_out(session, draft: models.VoucherDraft) -> DraftOut:
    """A draft as the API exposes it, including its OCR review state (§3.10)."""
    payload = repo.draft_payload(draft)
    return DraftOut(
        id=draft.id,
        status=draft.status,
        payload=DraftPurchaseBill.model_validate(payload) if payload else None,
        errors=[ValidationIssue.model_validate(e) for e in repo.draft_errors(draft)],
        generated_xml=draft.generated_xml,
        generated_ledger_xml=draft.generated_ledger_xml,
        dry_run=draft.dry_run,
        tally_voucher_number=draft.tally_voucher_number,
        tally_guid=draft.tally_guid,
        attempts=draft.attempts,
        needs_review=draft.needs_review,
        review_reasons=repo.review_reasons(draft),
        attachment_id=repo.attachment_id_for_draft(session, draft.id),
        created_at=draft.created_at,
        updated_at=draft.updated_at,
    )


def _load(session, draft_id: str) -> models.VoucherDraft:
    draft = repo.get_draft(session, draft_id)
    if draft is None:
        raise ApiError(404, "NOT_FOUND", f"Draft {draft_id} does not exist")
    return draft


def _revalidate(session, draft: models.VoucherDraft) -> list[ValidationIssue]:
    payload = DraftPurchaseBill.model_validate(repo.draft_payload(draft))
    issues = validation.validate_draft(session, payload)
    repo.set_draft_errors(draft, [i.model_dump() for i in issues])
    draft.status = "draft" if validation.has_errors(issues) else "validated"
    return issues


@router.post("/drafts", response_model=DraftOut, status_code=201, summary="Create a draft")
def create_draft(payload: DraftPurchaseBill, session: SessionDep) -> DraftOut:
    draft = repo.create_draft(session, payload.model_dump(mode="json"))
    draft.allow_duplicate = payload.allow_duplicate
    _revalidate(session, draft)
    session.flush()
    return to_out(session, draft)


@router.get("/drafts", response_model=DraftList, summary="List drafts")
def list_drafts(
    session: SessionDep,
    status: str | None = None,
    limit: int = Query(100, ge=1, le=500),
) -> DraftList:
    rows = repo.list_drafts(session, status=status, limit=limit)
    return DraftList(items=[to_out(session, r) for r in rows], total=len(rows))


@router.get("/drafts/{draft_id}", response_model=DraftOut, summary="One draft")
def get_draft(draft_id: str, session: SessionDep) -> DraftOut:
    return to_out(session, _load(session, draft_id))


@router.put("/drafts/{draft_id}", response_model=DraftOut, summary="Replace a draft")
def update_draft(
    draft_id: str, payload: DraftPurchaseBill, session: SessionDep
) -> DraftOut:
    draft = _load(session, draft_id)
    if draft.status in {"committed", "committing"}:
        raise ApiError(409, "DRAFT_LOCKED", f"Draft {draft_id} is {draft.status}")
    repo.set_draft_payload(draft, payload.model_dump(mode="json"))
    draft.allow_duplicate = payload.allow_duplicate
    _revalidate(session, draft)
    session.flush()
    return to_out(session, draft)


@router.delete("/drafts/{draft_id}", status_code=204, summary="Delete a draft")
def delete_draft(draft_id: str, session: SessionDep) -> None:
    draft = _load(session, draft_id)
    if draft.status == "committed":
        raise ApiError(409, "DRAFT_LOCKED", "A committed draft cannot be deleted")
    repo.delete_draft(session, draft)


@router.post(
    "/drafts/{draft_id}/validate", response_model=ValidationResult, summary="Run the rules"
)
def validate_draft(draft_id: str, session: SessionDep) -> ValidationResult:
    draft = _load(session, draft_id)
    issues = _revalidate(session, draft)
    session.flush()
    return ValidationResult(status=draft.status, errors=issues)


@router.post("/drafts/{draft_id}/queue", response_model=DraftOut, summary="Queue for sync")
def queue_draft(draft_id: str, session: SessionDep) -> DraftOut:
    draft = _load(session, draft_id)
    issues = _revalidate(session, draft)
    if validation.has_errors(issues):
        raise ApiError(
            409, "DRAFT_INVALID", "Fix the validation errors before queueing",
            {"errors": [i.model_dump() for i in issues]},
        )
    draft.status = "queued"
    session.flush()
    return to_out(session, draft)
