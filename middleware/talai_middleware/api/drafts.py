"""The outbox: draft purchase bills and their attachments (plan §3.6)."""

from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, Query, UploadFile

from ..api.schemas import (
    AttachmentOut,
    DraftList,
    DraftOut,
    DraftPurchaseBill,
    ValidationIssue,
    ValidationResult,
)
from ..db import models, repo
from ..services import validation
from .deps import SessionDep, SettingsDep
from .errors import ApiError

logger = logging.getLogger(__name__)

router = APIRouter(tags=["drafts"])

ALLOWED_UPLOAD_TYPES = {"application/pdf", "image/png", "image/jpeg"}


def _to_out(draft: models.VoucherDraft) -> DraftOut:
    payload = repo.draft_payload(draft)
    return DraftOut(
        id=draft.id,
        status=draft.status,
        payload=DraftPurchaseBill.model_validate(payload) if payload else None,
        errors=[ValidationIssue.model_validate(e) for e in repo.draft_errors(draft)],
        generated_xml=draft.generated_xml,
        dry_run=draft.dry_run,
        tally_voucher_number=draft.tally_voucher_number,
        tally_guid=draft.tally_guid,
        attempts=draft.attempts,
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
    return _to_out(draft)


@router.get("/drafts", response_model=DraftList, summary="List drafts")
def list_drafts(
    session: SessionDep,
    status: str | None = None,
    limit: int = Query(100, ge=1, le=500),
) -> DraftList:
    rows = repo.list_drafts(session, status=status, limit=limit)
    return DraftList(items=[_to_out(r) for r in rows], total=len(rows))


@router.get("/drafts/{draft_id}", response_model=DraftOut, summary="One draft")
def get_draft(draft_id: str, session: SessionDep) -> DraftOut:
    return _to_out(_load(session, draft_id))


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
    return _to_out(draft)


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
    return _to_out(draft)


@router.post(
    "/attachments", response_model=AttachmentOut, status_code=201, summary="Upload a bill file"
)
def upload_attachment(
    session: SessionDep,
    settings: SettingsDep,
    file: UploadFile = File(...),
    draft_id: str | None = Form(None),
) -> AttachmentOut:
    """Stores the file under ``UPLOAD_DIR`` with a random name (plan §6).

    OCR is mocked in v1: the attachment is recorded with ``ocr_status='skipped'``.
    """
    if file.content_type not in ALLOWED_UPLOAD_TYPES:
        raise ApiError(
            400, "UNSUPPORTED_MEDIA_TYPE", f"'{file.content_type}' is not accepted; "
            "upload a PDF, PNG or JPEG",
        )
    content = file.file.read()
    limit = settings.max_upload_mb * 1024 * 1024
    if len(content) > limit:
        raise ApiError(400, "FILE_TOO_LARGE", f"Files must be under {settings.max_upload_mb} MB")

    directory = Path(settings.upload_dir)
    directory.mkdir(parents=True, exist_ok=True)
    suffix = Path(file.filename or "").suffix[:10]
    stored_name = f"{uuid.uuid4()}{suffix}"
    (directory / stored_name).write_bytes(content)

    attachment = models.Attachment(
        draft_id=draft_id,
        file_name=file.filename or stored_name,
        mime=file.content_type or "",
        path=str(directory / stored_name),
        size_bytes=len(content),
        ocr_status="skipped",
        ocr_json=json.dumps({"provider": "none", "note": "OCR is out of scope for v1"}),
    )
    session.add(attachment)
    session.flush()
    return AttachmentOut.model_validate(attachment)
