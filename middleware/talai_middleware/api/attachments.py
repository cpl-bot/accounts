"""Uploaded bill files and their OCR (plan §3.10).

Upload stores the file under ``UPLOAD_DIR`` with a random name and, unless
``OCR_PROVIDER=none``, reads it in a background task so the request returns
immediately with ``ocr_status="pending"``. The client polls
``GET /attachments/{id}`` until the status settles.
"""

from __future__ import annotations

import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, Form, Query, UploadFile

from ..db import models, repo
from ..db.base import Database
from ..ocr.provider import OcrError
from ..services import ocr_service
from .deps import DatabaseDep, SessionDep, SettingsDep
from .errors import ApiError
from .schemas import AttachmentList, AttachmentOut, DraftOut

logger = logging.getLogger(__name__)

router = APIRouter(tags=["attachments"])

ALLOWED_UPLOAD_TYPES = {"application/pdf", "image/png", "image/jpeg"}


def to_out(attachment: models.Attachment) -> AttachmentOut:
    return AttachmentOut(
        id=attachment.id,
        draft_id=attachment.draft_id,
        file_name=attachment.file_name,
        mime=attachment.mime,
        size_bytes=attachment.size_bytes,
        ocr_status=attachment.ocr_status,
        ocr_model=attachment.ocr_model,
        ocr_duration_ms=attachment.ocr_duration_ms,
        ocr_error=attachment.ocr_error,
        ocr_result=ocr_service.ocr_result_of(attachment),
        created_at=attachment.created_at,
    )


def _load(session, attachment_id: str) -> models.Attachment:
    attachment = repo.get_attachment(session, attachment_id)
    if attachment is None:
        raise ApiError(404, "NOT_FOUND", f"Attachment {attachment_id} does not exist")
    return attachment


def _ocr_in_background(database: Database, settings, attachment_id: str) -> None:
    """Run OCR on its own session: the request's session is long gone."""
    session = database.new_session()
    try:
        attachment = repo.get_attachment(session, attachment_id)
        if attachment is None:  # pragma: no cover - deleted mid-flight
            return
        ocr_service.run_ocr(session, settings, attachment)
        session.commit()
    except Exception:  # noqa: BLE001 - a background task must never crash the app
        session.rollback()
        logger.exception("background OCR for attachment %s failed", attachment_id)
    finally:
        session.close()


@router.post(
    "/attachments", response_model=AttachmentOut, status_code=201, summary="Upload a bill file"
)
def upload_attachment(
    session: SessionDep,
    settings: SettingsDep,
    database: DatabaseDep,
    background: BackgroundTasks,
    file: UploadFile = File(...),
    draft_id: str | None = Form(None),
) -> AttachmentOut:
    """Store the file (random name, plan §6) and queue OCR for it."""
    if file.content_type not in ALLOWED_UPLOAD_TYPES:
        raise ApiError(
            400, "UNSUPPORTED_MEDIA_TYPE",
            f"'{file.content_type}' is not accepted; upload a PDF, PNG or JPEG",
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
        ocr_status="pending" if settings.ocr_enabled else "skipped",
    )
    session.add(attachment)
    # Commit before queueing: the background task opens its own session and
    # must be able to see the row (FastAPI runs the task before this request's
    # session-scoped dependency commits).
    session.commit()
    if settings.ocr_enabled:
        logger.info("queued OCR for attachment %s", attachment.id)
        background.add_task(_ocr_in_background, database, settings, attachment.id)
    return to_out(attachment)


@router.get("/attachments", response_model=AttachmentList, summary="List attachments")
def list_attachments(
    session: SessionDep,
    draft_id: str | None = None,
    limit: int = Query(100, ge=1, le=500),
) -> AttachmentList:
    rows = repo.list_attachments(session, draft_id=draft_id, limit=limit)
    return AttachmentList(items=[to_out(row) for row in rows], total=len(rows))


@router.get("/attachments/{attachment_id}", response_model=AttachmentOut, summary="One attachment")
def get_attachment(attachment_id: str, session: SessionDep) -> AttachmentOut:
    return to_out(_load(session, attachment_id))


@router.post(
    "/attachments/{attachment_id}/ocr", response_model=AttachmentOut, summary="Re-run OCR"
)
def rerun_ocr(
    attachment_id: str, session: SessionDep, settings: SettingsDep
) -> AttachmentOut:
    """Read the file again, synchronously, and replace the stored result."""
    attachment = _load(session, attachment_id)
    if not settings.ocr_enabled:
        raise ApiError(
            409, "OCR_DISABLED", "OCR is switched off; set OCR_PROVIDER to mock or ollama"
        )
    ocr_service.run_ocr(session, settings, attachment)
    session.flush()
    return to_out(attachment)


@router.post(
    "/attachments/{attachment_id}/draft",
    response_model=DraftOut,
    status_code=201,
    summary="Create a draft from the OCR result",
)
def draft_from_attachment(
    attachment_id: str, session: SessionDep, settings: SettingsDep
) -> DraftOut:
    from .drafts import to_out as draft_out

    attachment = _load(session, attachment_id)
    try:
        draft = ocr_service.create_draft_from_attachment(session, settings, attachment)
    except OcrError as exc:
        raise ApiError(409, exc.code, exc.message) from exc
    session.flush()
    return draft_out(session, draft)
