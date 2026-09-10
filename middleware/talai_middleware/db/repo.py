"""Typed repository functions used by services and routes.

Routes never build queries inline; everything the app reads or writes goes
through a named function here so the query surface stays small and testable.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any, TypeVar

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from ..audit import AuditEntry
from . import models

T = TypeVar("T")
DRAFT_STATUSES = (
    "draft", "validated", "queued", "committing", "committed", "failed", "cancelled",
)


def _utcnow() -> datetime:
    return datetime.now(UTC)


# --------------------------------------------------------------------------
# Settings
# --------------------------------------------------------------------------


def get_setting(session: Session, key: str, default: str | None = None) -> str | None:
    row = session.get(models.Setting, key)
    return row.value if row else default


def set_setting(session: Session, key: str, value: str) -> models.Setting:
    row = session.get(models.Setting, key)
    if row is None:
        row = models.Setting(key=key, value=value)
        session.add(row)
    else:
        row.value = value
    return row


def all_settings(session: Session) -> dict[str, str]:
    return {row.key: row.value for row in session.scalars(select(models.Setting))}


# --------------------------------------------------------------------------
# Sync runs
# --------------------------------------------------------------------------


def start_sync_run(session: Session, kind: str, scope: str = "") -> models.SyncRun:
    run = models.SyncRun(kind=kind, scope=scope, status="running")
    session.add(run)
    session.flush()
    return run


def finish_sync_run(
    session: Session,
    run: models.SyncRun,
    status: str,
    records_seen: int = 0,
    records_changed: int = 0,
    error: str | None = None,
) -> models.SyncRun:
    run.status = status
    run.finished_at = _utcnow()
    run.records_seen = records_seen
    run.records_changed = records_changed
    run.error = error
    return run


def latest_sync_runs(session: Session, limit: int = 20) -> list[models.SyncRun]:
    stmt = select(models.SyncRun).order_by(models.SyncRun.id.desc()).limit(limit)
    return list(session.scalars(stmt))


def get_sync_run(session: Session, run_id: int) -> models.SyncRun | None:
    return session.get(models.SyncRun, run_id)


def last_successful_pull(session: Session, scope: str) -> models.SyncRun | None:
    stmt = (
        select(models.SyncRun)
        .where(
            models.SyncRun.kind == "pull",
            models.SyncRun.scope == scope,
            models.SyncRun.status == "success",
        )
        .order_by(models.SyncRun.id.desc())
        .limit(1)
    )
    return session.scalars(stmt).first()


def latest_pull_run_per_scope(session: Session) -> dict[str, models.SyncRun]:
    """The most recent ``kind="pull"`` run for each literal scope name.

    Since each scope records its own row (docs/SYNC_RELIABILITY_PLAN.md §4), the
    ``scope`` column is a single scope name and grouping on it is meaningful.
    """
    newest = (
        select(func.max(models.SyncRun.id))
        .where(models.SyncRun.kind == "pull")
        .group_by(models.SyncRun.scope)
    )
    stmt = select(models.SyncRun).where(models.SyncRun.id.in_(newest))
    return {run.scope: run for run in session.scalars(stmt)}


#: Only used by tests now that masters always do a full refresh; kept as the
#: single place that knows how to read a collection's ALTERID high-water mark.
def max_alter_id(session: Session, model: type) -> int | None:
    return session.scalar(select(func.max(model.tally_alter_id)))


# --------------------------------------------------------------------------
# Masters
# --------------------------------------------------------------------------


def _upsert(
    session: Session,
    model: type,
    name: str,
    tally_guid: str | None,
    fields: dict[str, Any],
) -> tuple[Any, bool]:
    """Upsert by GUID, falling back to name when Tally gave us no GUID."""
    row = None
    if tally_guid:
        row = session.scalars(select(model).where(model.tally_guid == tally_guid)).first()
    if row is None:
        row = session.scalars(select(model).where(model.name == name)).first()
    created = row is None
    if row is None:
        row = model(name=name)
        session.add(row)
    for key, value in fields.items():
        setattr(row, key, value)
    row.name = name
    row.tally_guid = tally_guid or row.tally_guid
    row.synced_at = _utcnow()
    row.is_deleted = False
    session.flush()
    return row, created


def upsert_ledger(session: Session, name: str, **fields: Any) -> models.Ledger:
    row, _ = _upsert(session, models.Ledger, name, fields.pop("tally_guid", None), fields)
    return row


def upsert_group(session: Session, name: str, **fields: Any) -> models.Group:
    row, _ = _upsert(session, models.Group, name, fields.pop("tally_guid", None), fields)
    return row


def upsert_stock_item(session: Session, name: str, **fields: Any) -> models.StockItem:
    row, _ = _upsert(session, models.StockItem, name, fields.pop("tally_guid", None), fields)
    return row


def upsert_lookup(session: Session, model: type, name: str, **fields: Any) -> Any:
    row, _ = _upsert(session, model, name, fields.pop("tally_guid", None), fields)
    return row


def _paged(session: Session, stmt: Select, limit: int | None, offset: int) -> list:
    if limit is not None:
        stmt = stmt.limit(limit).offset(offset)
    return list(session.scalars(stmt))


def list_ledgers(
    session: Session,
    group: str | None = None,
    q: str | None = None,
    limit: int | None = None,
    offset: int = 0,
) -> list[models.Ledger]:
    stmt = select(models.Ledger).where(models.Ledger.is_deleted.is_(False))
    if group:
        stmt = stmt.where(models.Ledger.parent_group == group)
    if q:
        stmt = stmt.where(models.Ledger.name.ilike(f"%{q}%"))
    return _paged(session, stmt.order_by(models.Ledger.name), limit, offset)


def count_ledgers(session: Session, group: str | None = None, q: str | None = None) -> int:
    stmt = select(func.count()).select_from(models.Ledger).where(
        models.Ledger.is_deleted.is_(False)
    )
    if group:
        stmt = stmt.where(models.Ledger.parent_group == group)
    if q:
        stmt = stmt.where(models.Ledger.name.ilike(f"%{q}%"))
    return session.scalar(stmt) or 0


def list_simple(session: Session, model: type) -> list:
    stmt = select(model).where(model.is_deleted.is_(False)).order_by(model.name)
    return list(session.scalars(stmt))


def ledger_names(session: Session) -> set[str]:
    return set(session.scalars(select(models.Ledger.name)))


def ledger_by_name(session: Session, name: str) -> models.Ledger | None:
    return session.scalars(select(models.Ledger).where(models.Ledger.name == name)).first()


def group_by_name(session: Session, name: str) -> models.Group | None:
    return session.scalars(select(models.Group).where(models.Group.name == name)).first()


def upsert_stock_valuation(
    session: Session, as_on: date, closing_value: Decimal, source: str = "tally"
) -> models.StockValuation:
    """One closing stock value per date (plan §3.9)."""
    row = session.scalars(
        select(models.StockValuation).where(models.StockValuation.as_on == as_on)
    ).first()
    if row is None:
        row = models.StockValuation(as_on=as_on)
        session.add(row)
    row.closing_value = closing_value
    row.source = source
    row.synced_at = _utcnow()
    session.flush()
    return row


def stock_valuation(session: Session, as_on: date) -> models.StockValuation | None:
    return session.scalars(
        select(models.StockValuation).where(models.StockValuation.as_on == as_on)
    ).first()


def list_stock_valuations(session: Session) -> list[models.StockValuation]:
    stmt = select(models.StockValuation).order_by(models.StockValuation.as_on)
    return list(session.scalars(stmt))


# --------------------------------------------------------------------------
# Vouchers
# --------------------------------------------------------------------------


def upsert_voucher(
    session: Session,
    voucher_number: str,
    voucher_type: str,
    voucher_date: date | None,
    ledger_entries: Sequence[dict] = (),
    inventory_entries: Sequence[dict] = (),
    **fields: Any,
) -> models.Voucher:
    """Upsert a voucher header and *replace* its child lines."""
    guid = fields.pop("tally_guid", None)
    row: models.Voucher | None = None
    if guid:
        row = session.scalars(
            select(models.Voucher).where(models.Voucher.tally_guid == guid)
        ).first()
    if row is None:
        # No GUID to match on, so fall back to the natural key. ``date`` is
        # part of that key: TallyPrime restarts voucher numbering every
        # financial year, so Sales #1 of 2025-26 and Sales #1 of 2026-27 are
        # different vouchers and must not collapse into one row.
        row = session.scalars(
            select(models.Voucher).where(
                models.Voucher.voucher_number == voucher_number,
                models.Voucher.voucher_type == voucher_type,
                models.Voucher.date == voucher_date,
            )
        ).first()
    if row is None:
        row = models.Voucher()
        session.add(row)
    row.voucher_number = voucher_number
    row.voucher_type = voucher_type
    row.date = voucher_date
    row.tally_guid = guid or row.tally_guid
    for key, value in fields.items():
        setattr(row, key, value)
    row.synced_at = _utcnow()
    row.is_deleted = False
    row.ledger_entries = [models.VoucherLedgerEntry(**e) for e in ledger_entries]
    row.inventory_entries = [models.VoucherInventoryEntry(**e) for e in inventory_entries]
    session.flush()
    return row


def _voucher_query(
    voucher_type: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    party: str | None = None,
) -> Select:
    stmt = select(models.Voucher).where(models.Voucher.is_deleted.is_(False))
    if voucher_type:
        stmt = stmt.where(models.Voucher.voucher_type == voucher_type)
    if date_from:
        stmt = stmt.where(models.Voucher.date >= date_from)
    if date_to:
        stmt = stmt.where(models.Voucher.date <= date_to)
    if party:
        stmt = stmt.where(models.Voucher.party_ledger.ilike(f"%{party}%"))
    return stmt


def list_vouchers(
    session: Session,
    voucher_type: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    party: str | None = None,
    limit: int | None = None,
    offset: int = 0,
) -> list[models.Voucher]:
    stmt = _voucher_query(voucher_type, date_from, date_to, party).order_by(
        models.Voucher.date.desc(), models.Voucher.id.desc()
    )
    return _paged(session, stmt, limit, offset)


def count_vouchers(
    session: Session,
    voucher_type: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    party: str | None = None,
) -> int:
    inner = _voucher_query(voucher_type, date_from, date_to, party).subquery()
    return session.scalar(select(func.count()).select_from(inner)) or 0


def get_voucher(session: Session, voucher_id: int) -> models.Voucher | None:
    return session.get(models.Voucher, voucher_id)


def voucher_by_reference(
    session: Session, party_ledger: str, reference: str
) -> models.Voucher | None:
    stmt = select(models.Voucher).where(
        models.Voucher.party_ledger == party_ledger,
        models.Voucher.reference == reference,
        models.Voucher.is_deleted.is_(False),
    )
    return session.scalars(stmt).first()


def voucher_by_remote_id(session: Session, remote_id: str) -> models.Voucher | None:
    stmt = select(models.Voucher).where(models.Voucher.remote_id == remote_id)
    return session.scalars(stmt).first()


# --------------------------------------------------------------------------
# Bills
# --------------------------------------------------------------------------


def replace_bills(session: Session, direction: str, rows: Sequence[dict]) -> int:
    """Bills are a snapshot, so each pull replaces the table for one direction."""
    for existing in session.scalars(
        select(models.Bill).where(models.Bill.direction == direction)
    ):
        session.delete(existing)
    session.flush()
    for row in rows:
        session.add(models.Bill(direction=direction, synced_at=_utcnow(), **row))
    session.flush()
    return len(rows)


def _open_bills_filter(
    stmt: Select, direction: str | None = None, as_on: date | None = None
) -> Select:
    """The one definition of "an open bill" — shared by the list and the sum."""
    stmt = stmt.where(models.Bill.pending_amount != 0)
    if direction:
        stmt = stmt.where(models.Bill.direction == direction)
    if as_on:
        stmt = stmt.where(
            (models.Bill.bill_date.is_(None)) | (models.Bill.bill_date <= as_on)
        )
    return stmt


def list_bills(
    session: Session, direction: str | None = None, as_on: date | None = None
) -> list[models.Bill]:
    stmt = _open_bills_filter(select(models.Bill), direction, as_on)
    return list(session.scalars(stmt.order_by(models.Bill.due_date)))


# --------------------------------------------------------------------------
# Drafts
# --------------------------------------------------------------------------


def create_draft(
    session: Session, payload: dict, created_by: str | None = None
) -> models.VoucherDraft:
    draft = models.VoucherDraft(
        payload_json=json.dumps(payload, default=str), created_by=created_by
    )
    session.add(draft)
    session.flush()
    return draft


def get_draft(session: Session, draft_id: str) -> models.VoucherDraft | None:
    return session.get(models.VoucherDraft, draft_id)


def list_drafts(
    session: Session, status: str | None = None, limit: int | None = None
) -> list[models.VoucherDraft]:
    stmt = select(models.VoucherDraft)
    if status:
        stmt = stmt.where(models.VoucherDraft.status == status)
    stmt = stmt.order_by(models.VoucherDraft.created_at)
    if limit:
        stmt = stmt.limit(limit)
    return list(session.scalars(stmt))


def delete_draft(session: Session, draft: models.VoucherDraft) -> None:
    session.delete(draft)


def draft_payload(draft: models.VoucherDraft) -> dict:
    return json.loads(draft.payload_json or "{}")


def set_draft_payload(draft: models.VoucherDraft, payload: dict) -> None:
    draft.payload_json = json.dumps(payload, default=str)


def draft_errors(draft: models.VoucherDraft) -> list[dict]:
    return json.loads(draft.validation_errors_json or "[]")


def set_draft_errors(draft: models.VoucherDraft, errors: Sequence[dict]) -> None:
    draft.validation_errors_json = json.dumps(list(errors), default=str)


def review_reasons(draft: models.VoucherDraft) -> list[str]:
    try:
        return json.loads(draft.review_reasons_json or "[]")
    except ValueError:
        return []


def set_review_reasons(draft: models.VoucherDraft, reasons: Sequence[str]) -> None:
    draft.review_reasons_json = json.dumps(list(reasons))


# --------------------------------------------------------------------------
# Attachments
# --------------------------------------------------------------------------


def get_attachment(session: Session, attachment_id: str) -> models.Attachment | None:
    return session.get(models.Attachment, attachment_id)


def list_attachments(
    session: Session, draft_id: str | None = None, limit: int | None = None
) -> list[models.Attachment]:
    stmt = select(models.Attachment)
    if draft_id:
        stmt = stmt.where(models.Attachment.draft_id == draft_id)
    stmt = stmt.order_by(models.Attachment.created_at.desc())
    if limit:
        stmt = stmt.limit(limit)
    return list(session.scalars(stmt))


def attachment_id_for_draft(session: Session, draft_id: str) -> str | None:
    stmt = (
        select(models.Attachment.id)
        .where(models.Attachment.draft_id == draft_id)
        .order_by(models.Attachment.created_at)
        .limit(1)
    )
    return session.scalars(stmt).first()


# --------------------------------------------------------------------------
# Audit
# --------------------------------------------------------------------------


def write_audit(session: Session, entry: AuditEntry) -> models.AuditLog:
    row = models.AuditLog(
        direction=entry.direction,
        operation=entry.operation,
        request_hash=entry.request_hash,
        request_xml=entry.request_xml,
        response_xml=entry.response_xml,
        status=entry.status,
        duration_ms=entry.duration_ms,
        error=entry.error,
    )
    session.add(row)
    return row


def table_counts(session: Session) -> dict[str, int]:
    """Row counts per table, used by ``scripts/validate_db_sync.py``."""
    counts: dict[str, int] = {}
    for name, table in models.Base.metadata.tables.items():
        counts[name] = session.scalar(select(func.count()).select_from(table)) or 0
    return counts


def sum_pending_bills(
    session: Session, direction: str, as_on: date | None = None
) -> Decimal:
    """Total pending over exactly the bills ``list_bills`` would return."""
    stmt = _open_bills_filter(
        select(func.sum(models.Bill.pending_amount)), direction, as_on
    )
    return Decimal(session.scalar(stmt) or 0)
