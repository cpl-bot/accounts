"""Push sync: the outbox → TallyPrime (plan §3.4).

Rules this module exists to enforce:

* one ``Import Data`` envelope **per draft**, so a failure is attributable;
* every draft is re-validated against the *current* replica immediately before
  it is sent;
* the draft's UUID travels as ``REMOTEID``, which makes a re-push a no-op;
* with ``TALLY_WRITE_ENABLED=false`` (the default) nothing is sent at all: the
  generated XML is stored on the draft and it is marked ``validated``/dry-run.
"""

from __future__ import annotations

import logging
import time
from datetime import date
from decimal import Decimal

from sqlalchemy.orm import Session

from ..api.schemas import DraftPurchaseBill, PushResultItem, ValidationIssue
from ..config import Settings
from ..db import models, repo
from ..tally import envelopes as env
from ..tally.client import TallyClient
from ..tally.errors import TallyError
from . import validation

logger = logging.getLogger(__name__)


def build_voucher(
    draft_id: str, payload: DraftPurchaseBill, voucher_date: date | None = None
) -> env.VoucherImport:
    """Map a draft payload onto the Tally voucher structure.

    The party line is the credit; the purchase ledger, tax lines and any other
    ledger lines are the debits. Positive magnitudes only — ``envelopes`` applies
    Tally's sign convention.
    """
    totals = payload.totals
    grand_total = totals.grand_total
    items_total = sum((item.amount for item in payload.items), Decimal("0"))
    purchase_amount = items_total or totals.taxable_value

    ledger_entries = [
        env.LedgerEntry(
            ledger_name=payload.party.ledger_name,
            amount=grand_total,
            is_debit=False,
            bill_allocations=[
                env.BillAllocation(
                    name=payload.supplier_invoice_no,
                    bill_type="New Ref",
                    amount=grand_total,
                    due_date=payload.due_date,
                )
            ],
        ),
        env.LedgerEntry(
            ledger_name=payload.purchase_ledger,
            amount=purchase_amount,
            is_debit=True,
            cost_centre=payload.cost_centre,
        ),
    ]
    for line in payload.ledger_lines:
        ledger_entries.append(
            env.LedgerEntry(
                ledger_name=line.ledger_name,
                amount=abs(line.amount),
                is_debit=line.amount > 0,
                cost_centre=line.cost_centre or payload.cost_centre,
            )
        )
    for line in payload.tax_lines:
        ledger_entries.append(
            env.LedgerEntry(
                ledger_name=line.ledger_name,
                amount=abs(line.amount),
                is_debit=line.amount > 0,
                cost_centre=line.cost_centre or payload.cost_centre,
            )
        )
    return env.VoucherImport(
        remote_id=draft_id,
        voucher_type=payload.voucher_type,
        voucher_date=voucher_date or payload.voucher_date,
        party_ledger=payload.party.ledger_name,
        purchase_ledger=payload.purchase_ledger,
        narration=payload.narration,
        reference=payload.supplier_invoice_no,
        reference_date=payload.bill_date,
        ledger_entries=ledger_entries,
        inventory_entries=[
            env.InventoryEntry(
                stock_item=item.stock_item,
                quantity=item.quantity,
                rate=item.rate,
                amount=item.amount,
                godown=item.godown,
                hsn=item.hsn,
            )
            for item in payload.items
        ],
    )


def _select_drafts(
    session: Session, settings: Settings, draft_ids: list[str] | None
) -> list[models.VoucherDraft]:
    if draft_ids:
        drafts = [repo.get_draft(session, draft_id) for draft_id in draft_ids]
        return [d for d in drafts if d is not None]
    return repo.list_drafts(session, status="queued", limit=settings.push_batch_size)


def push(
    session: Session,
    client: TallyClient,
    settings: Settings,
    draft_ids: list[str] | None = None,
) -> tuple[models.SyncRun, list[PushResultItem]]:
    """Commit queued drafts (or the given ones) one envelope at a time."""
    drafts = _select_drafts(session, settings, draft_ids)
    run = repo.start_sync_run(session, kind="push", scope=f"{len(drafts)} drafts")
    session.commit()
    results: list[PushResultItem] = []
    committed = 0
    for index, draft in enumerate(drafts):
        if index and settings.tally_write_enabled:
            time.sleep(settings.push_inter_request_delay_ms / 1000)
        results.append(_push_one(session, client, settings, draft))
        committed += 1 if results[-1].status == "committed" else 0
        session.commit()
    repo.finish_sync_run(
        session, run, status="success", records_seen=len(drafts), records_changed=committed
    )
    session.commit()
    return run, results


def _push_one(
    session: Session, client: TallyClient, settings: Settings, draft: models.VoucherDraft
) -> PushResultItem:
    payload = DraftPurchaseBill.model_validate(repo.draft_payload(draft))
    issues = validation.validate_draft(session, payload)
    repo.set_draft_errors(draft, [i.model_dump() for i in issues])
    if validation.has_errors(issues):
        draft.status = "failed"
        return PushResultItem(draft_id=draft.id, status="failed", errors=issues)

    try:
        voucher = build_voucher(draft.id, payload)
        xml = env.import_voucher(voucher, company=client.company)
    except ValueError as exc:
        issue = ValidationIssue(code="UNBALANCED_VOUCHER", field="totals", message=str(exc))
        repo.set_draft_errors(draft, [issue.model_dump()])
        draft.status = "failed"
        return PushResultItem(draft_id=draft.id, status="failed", errors=[issue])

    draft.generated_xml = xml
    if not settings.tally_write_enabled:
        draft.status = "validated"
        draft.dry_run = True
        logger.info("dry run: draft %s validated, XML stored, nothing sent", draft.id)
        return PushResultItem(draft_id=draft.id, status="validated", dry_run=True, errors=issues)

    return _send(session, client, draft, voucher, issues)


def _send(
    session: Session,
    client: TallyClient,
    draft: models.VoucherDraft,
    voucher: env.VoucherImport,
    warnings: list[ValidationIssue],
) -> PushResultItem:
    draft.status = "committing"
    draft.dry_run = False
    draft.attempts += 1
    session.flush()
    try:
        result = client.import_voucher(voucher)
    except TallyError as exc:
        issue = ValidationIssue(code=exc.code, field="", message=exc.message)
        repo.set_draft_errors(draft, [issue.model_dump()])
        draft.status = "failed"
        return PushResultItem(draft_id=draft.id, status="failed", errors=[issue])

    if not result.ok:
        issues = [
            ValidationIssue(code="TALLY_IMPORT_FAILED", field="", message=message)
            for message in (result.line_errors or ["Tally rejected the voucher"])
        ]
        repo.set_draft_errors(draft, [i.model_dump() for i in issues])
        draft.status = "failed"
        return PushResultItem(draft_id=draft.id, status="failed", errors=issues)

    draft.status = "committed"
    _read_back(client, draft)
    return PushResultItem(
        draft_id=draft.id,
        status="committed",
        voucher_number=draft.tally_voucher_number,
        errors=warnings,
    )


def _read_back(client: TallyClient, draft: models.VoucherDraft) -> None:
    """Confirm with Tally what it actually created, by REMOTEID."""
    try:
        created = client.find_voucher_by_remote_id(draft.id)
    except TallyError as exc:  # pragma: no cover - read-back is best effort
        logger.warning("read-back for draft %s failed: %s", draft.id, exc)
        return
    if created is None:
        logger.warning("draft %s was accepted but could not be read back", draft.id)
        return
    draft.tally_voucher_number = created.voucher_number
    draft.tally_guid = created.guid
