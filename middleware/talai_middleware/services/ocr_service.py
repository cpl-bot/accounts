"""Running OCR over an attachment and turning the result into a draft (§3.10).

The route layer stays thin: it stores the file and calls in here, either
inline (``POST /attachments/{id}/ocr``) or from a FastAPI background task.
Every path records ``ocr_status``, the model that answered, how long it took
and — on failure — why, so an attachment is never silently blank.
"""

from __future__ import annotations

import json
import logging
import time
from datetime import date
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..api.schemas import DraftPurchaseBill, ValidationIssue
from ..config import Settings
from ..db import models, repo
from ..ocr import build_provider
from ..ocr.postprocess import postprocess
from ..ocr.provider import OcrError, OcrProvider
from ..ocr.schema import OcrResult
from . import validation

logger = logging.getLogger(__name__)

TAX_GROUP_NAMES = ("Duties & Taxes", "Duties and Taxes")
PURCHASE_GROUP = "Purchase Accounts"


# --------------------------------------------------------------------------
# Running OCR
# --------------------------------------------------------------------------


def run_ocr(
    session: Session,
    settings: Settings,
    attachment: models.Attachment,
    provider: OcrProvider | None = None,
) -> models.Attachment:
    """Read one attachment and store the outcome on its row.

    With ``OCR_PROVIDER=none`` the file is left alone and marked ``skipped``.
    """
    provider = provider or build_provider(settings)
    if provider is None:
        attachment.ocr_status = "skipped"
        attachment.ocr_model = None
        attachment.ocr_error = None
        return attachment

    attachment.ocr_status = "running"
    attachment.ocr_error = None
    session.flush()

    started = time.perf_counter()
    try:
        data = _read_file(attachment)
        result = provider.extract(data, attachment.mime)
        result = postprocess(session, result)
    except (OcrError, OSError) as exc:
        attachment.ocr_status = "failed"
        attachment.ocr_error = str(exc)
        attachment.ocr_duration_ms = int((time.perf_counter() - started) * 1000)
        attachment.ocr_model = getattr(provider, "name", None)
        logger.warning("OCR failed for attachment %s: %s", attachment.id, exc)
        return attachment

    attachment.ocr_status = "done"
    attachment.ocr_result_json = result.model_dump_json()
    attachment.ocr_model = result.model or getattr(provider, "name", None)
    attachment.ocr_duration_ms = (
        result.duration_ms
        if result.duration_ms is not None
        else int((time.perf_counter() - started) * 1000)
    )
    logger.info("OCR done for attachment %s in %s ms", attachment.id, attachment.ocr_duration_ms)
    return attachment


def _read_file(attachment: models.Attachment) -> bytes:
    from pathlib import Path

    return Path(attachment.path).read_bytes()


def ocr_result_of(attachment: models.Attachment) -> OcrResult | None:
    """The stored result, or ``None`` when there is none (or it no longer parses)."""
    if not attachment.ocr_result_json:
        return None
    try:
        return OcrResult.model_validate(json.loads(attachment.ocr_result_json))
    except (ValueError, TypeError) as exc:
        logger.warning("attachment %s has an unreadable OCR result: %s", attachment.id, exc)
        return None


# --------------------------------------------------------------------------
# OCR result → draft purchase bill
# --------------------------------------------------------------------------


def _money(value: float | int | None) -> Decimal:
    """A model's number as two-decimal money; half-up, like an invoice."""
    if value is None:
        return Decimal("0.00")
    try:
        return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError):
        return Decimal("0.00")


def _iso_date(value: str | None) -> date | None:
    from datetime import datetime

    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None


def _ledgers_under(session: Session, groups: tuple[str, ...]) -> list[models.Ledger]:
    stmt = select(models.Ledger).where(
        models.Ledger.is_deleted.is_(False), models.Ledger.parent_group.in_(groups)
    )
    return list(session.scalars(stmt.order_by(models.Ledger.name)))


def guess_tax_ledger(session: Session, token: str) -> str:
    """The Duties & Taxes ledger whose name mentions CGST / SGST / IGST.

    Returns ``""`` when the replica has no obvious candidate — the draft is
    then explicitly incomplete rather than pointing at the wrong ledger.
    """
    candidates = [
        row.name
        for row in _ledgers_under(session, TAX_GROUP_NAMES)
        if token.lower() in row.name.lower()
    ]
    return candidates[0] if candidates else ""


def guess_purchase_ledger(session: Session) -> str:
    rows = _ledgers_under(session, (PURCHASE_GROUP,))
    exact = next((row.name for row in rows if row.name.lower() == "purchase"), None)
    return exact or (rows[0].name if rows else "")


def _known_stock_items(session: Session) -> dict[str, str]:
    return {row.name.lower(): row.name for row in repo.list_simple(session, models.StockItem)}


def draft_payload_from_ocr(session: Session, result: OcrResult) -> DraftPurchaseBill:
    """Pre-fill a purchase bill from an OCR result (plan §3.10).

    Unmatched stock items become an empty ``stock_item``: validation will then
    say ``STOCK_ITEM_NOT_FOUND`` and the reviewer picks the right one, which is
    far safer than guessing an item and posting the wrong inventory movement.
    """
    fields = result.fields
    items_by_name = _known_stock_items(session)
    invoice_date = _iso_date(fields.invoice_date)

    items = []
    for line in fields.line_items:
        description = (line.description or "").strip()
        quantity = _money(line.quantity) or Decimal("0.00")
        amount = _money(line.amount)
        rate = _money(line.rate)
        if not rate and quantity:
            rate = (amount / quantity).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        items.append(
            {
                "description": description or None,
                "stock_item": items_by_name.get(description.lower(), ""),
                "quantity": quantity,
                "rate": rate,
                "hsn": (line.hsn or None),
            }
        )

    tax_lines = []
    for token, value in (("CGST", fields.cgst), ("SGST", fields.sgst), ("IGST", fields.igst)):
        amount = _money(value)
        if amount:
            tax_lines.append(
                {"ledger_name": guess_tax_ledger(session, token), "amount": amount}
            )

    taxable = _money(fields.taxable_value) or sum(
        (Decimal(str(i["quantity"])) * Decimal(str(i["rate"])) for i in items), Decimal("0.00")
    )
    gst = sum((line["amount"] for line in tax_lines), Decimal("0.00"))
    other = _money(fields.other_charges)
    tds = _money(fields.tds)
    grand_total = _money(fields.grand_total) or (taxable + gst + other + tds)

    return DraftPurchaseBill.model_validate(
        {
            "voucher_type": "Purchase",
            "voucher_date": invoice_date or date.today(),
            "bill_date": invoice_date,
            "due_date": _iso_date(fields.due_date),
            "supplier_invoice_no": (fields.invoice_number or "").strip(),
            "party": {
                "ledger_name": (fields.party_ledger_name or fields.supplier_name or "").strip(),
                "gstin": fields.supplier_gstin,
                "source_of_supply": fields.place_of_supply,
                "destination_of_supply": fields.place_of_supply,
            },
            "purchase_ledger": guess_purchase_ledger(session),
            "items": items,
            "tax_lines": tax_lines,
            "narration": fields.narration or "",
            "totals": {
                "taxable_value": taxable,
                "sub_total": taxable,
                "gst": gst,
                "tds": tds,
                "other_taxes": other,
                "grand_total": grand_total,
            },
        }
    )


def review_reasons(
    result: OcrResult, issues: list[ValidationIssue], min_confidence: float
) -> list[str]:
    """Why a human should look at this draft: unsure fields, then rule failures."""
    reasons = [
        f"Low OCR confidence for {name} ({result.confidence_of(name):.2f})"
        for name in result.low_confidence_fields(min_confidence)
    ]
    reasons += [f"{issue.code}: {issue.message}" for issue in issues if issue.severity == "error"]
    return reasons


def create_draft_from_attachment(
    session: Session, settings: Settings, attachment: models.Attachment
) -> models.VoucherDraft:
    """Build, validate and store a draft pre-filled from an attachment's OCR."""
    result = ocr_result_of(attachment)
    if result is None:
        raise OcrError(
            f"Attachment {attachment.id} has no OCR result to build a draft from",
            code="OCR_NOT_AVAILABLE",
        )
    payload = draft_payload_from_ocr(session, result)
    draft = repo.create_draft(session, payload.model_dump(mode="json"), created_by="ocr")
    issues = validation.validate_draft(session, payload)
    repo.set_draft_errors(draft, [i.model_dump() for i in issues])
    draft.status = "draft" if validation.has_errors(issues) else "validated"
    reasons = review_reasons(result, issues, settings.ocr_min_confidence)
    repo.set_review_reasons(draft, reasons)
    draft.needs_review = bool(reasons)
    attachment.draft_id = draft.id
    session.flush()
    logger.info("draft %s pre-filled from attachment %s", draft.id, attachment.id)
    return draft
