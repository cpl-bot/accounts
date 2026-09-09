"""Pull sync: TallyPrime → replica (plan §3.4).

* masters are upserted by GUID (falling back to name) and, from the second run
  on, fetched as a delta with ``$AlterID > <max seen>``;
* vouchers come from the Day Book for ``[last success − overlap_days, today]``
  and are **re-filtered by date in Python**, because TallyPrime is known to
  ignore ``SVFROMDATE``/``SVTODATE`` on that export;
* bills are a snapshot: each run replaces the table for one direction.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta

from sqlalchemy.orm import Session

from ..config import Settings
from ..db import models, repo
from ..tally.client import TallyClient
from ..tally.errors import TallyError

logger = logging.getLogger(__name__)

SCOPES = ("masters", "vouchers", "bills")


class SyncPuller:
    """One pull run against one Tally company."""

    def __init__(self, session: Session, client: TallyClient, settings: Settings) -> None:
        self.session = session
        self.client = client
        self.settings = settings
        self.company = client.company

    # -- orchestration -----------------------------------------------------

    def run(
        self,
        scopes: list[str] | None = None,
        from_date: date | None = None,
        to_date: date | None = None,
    ) -> models.SyncRun:
        """Run the requested scopes, recording a ``sync_runs`` row either way."""
        selected = [s for s in (scopes or list(SCOPES)) if s in SCOPES]
        run = repo.start_sync_run(self.session, kind="pull", scope=",".join(selected))
        self.session.commit()
        seen = changed = 0
        try:
            if "masters" in selected:
                changed += self.pull_masters()
                seen += self._last_seen
            if "vouchers" in selected:
                window_from, window_to = self.voucher_window(from_date, to_date)
                changed += self.pull_vouchers(window_from, window_to)
                seen += self._last_seen
            if "bills" in selected:
                changed += self.pull_bills()
                seen += self._last_seen
        except TallyError as exc:
            logger.warning("pull failed: %s", exc)
            repo.finish_sync_run(self.session, run, status="failed", error=str(exc))
            self.session.commit()
            return run
        repo.finish_sync_run(
            self.session, run, status="success", records_seen=seen, records_changed=changed
        )
        self.session.commit()
        return run

    _last_seen: int = 0

    # -- masters -----------------------------------------------------------

    def pull_masters(self) -> int:
        """Upsert groups, ledgers, stock items and the simple lookups."""
        seen = changed = 0
        for row in self.client.groups(self._since(models.Group)):
            repo.upsert_group(
                self.session,
                name=row.name,
                parent=row.parent,
                primary_group=row.primary_group,
                is_revenue=row.is_revenue,
                is_deemed_positive=row.is_deemed_positive,
                affects_gross_profit=row.affects_gross_profit,
                **self._sync_columns(row),
            )
            seen += 1
            changed += 1
        for row in self.client.ledgers(self._since(models.Ledger)):
            repo.upsert_ledger(
                self.session,
                name=row.name,
                parent_group=row.parent_group,
                opening_balance=row.opening_balance,
                closing_balance=row.closing_balance,
                gstin=row.gstin,
                mailing_name=row.mailing_name,
                address=row.address,
                state=row.state,
                gst_registration_type=row.gst_registration_type,
                is_bill_wise=row.is_bill_wise,
                **self._sync_columns(row),
            )
            seen += 1
            changed += 1
        for row in self.client.stock_items(self._since(models.StockItem)):
            repo.upsert_stock_item(
                self.session,
                name=row.name,
                parent=row.parent,
                unit=row.unit,
                hsn=row.hsn,
                gst_rate=row.gst_rate,
                closing_qty=row.closing_qty,
                closing_value=row.closing_value,
                **self._sync_columns(row),
            )
            seen += 1
            changed += 1
        for model, fetch in (
            (models.CostCentre, self.client.cost_centres),
            (models.Godown, self.client.godowns),
            (models.VoucherType, self.client.voucher_types),
        ):
            for row in fetch(self._since(model)):
                repo.upsert_lookup(
                    self.session, model, name=row.name, parent=row.parent,
                    **self._sync_columns(row),
                )
                seen += 1
                changed += 1
        self._last_seen = seen
        return changed

    def _since(self, model: type) -> int | None:
        """Delta floor for a collection: the highest ALTERID already stored."""
        return repo.max_alter_id(self.session, model)

    def _sync_columns(self, row) -> dict:
        return {
            "tally_guid": row.guid,
            "tally_master_id": row.master_id,
            "tally_alter_id": row.alter_id,
            "company_name": self.company,
        }

    # -- vouchers ----------------------------------------------------------

    def voucher_window(
        self, from_date: date | None = None, to_date: date | None = None
    ) -> tuple[date, date]:
        """``[last successful pull − overlap_days, today]`` unless overridden."""
        if from_date and to_date:
            return from_date, to_date
        last = repo.last_successful_pull(self.session, "vouchers")
        overlap = timedelta(days=self.settings.sync_overlap_days)
        start = (last.started_at.date() - overlap) if last else date(date.today().year, 1, 1)
        return from_date or start, to_date or date.today()

    def pull_vouchers(self, from_date: date, to_date: date) -> int:
        rows = self.client.day_book(from_date, to_date)
        self._last_seen = len(rows)
        changed = 0
        for row in rows:
            # Client-side date filter: the Day Book export may ignore the
            # SVFROMDATE/SVTODATE static variables entirely.
            if row.date is None or not (from_date <= row.date <= to_date):
                continue
            repo.upsert_voucher(
                self.session,
                voucher_number=row.voucher_number,
                voucher_type=row.voucher_type,
                voucher_date=row.date,
                party_ledger=row.party_ledger,
                narration=row.narration,
                reference=row.reference,
                amount=row.amount,
                remote_id=row.remote_id,
                is_cancelled=row.is_cancelled,
                tally_guid=row.guid,
                tally_master_id=row.master_id,
                tally_alter_id=row.alter_id,
                company_name=self.company,
                ledger_entries=[
                    {
                        "ledger_name": e.ledger_name,
                        "amount": e.amount,
                        "is_deemed_positive": e.is_deemed_positive,
                        "cost_centre": e.cost_centre,
                    }
                    for e in row.ledger_entries
                ],
                inventory_entries=[
                    {
                        "stock_item": e.stock_item,
                        "godown": e.godown,
                        "qty": e.quantity,
                        "rate": e.rate,
                        "amount": e.amount,
                        "hsn": e.hsn,
                    }
                    for e in row.inventory_entries
                ],
            )
            changed += 1
        return changed

    # -- bills -------------------------------------------------------------

    def pull_bills(self) -> int:
        seen = changed = 0
        for direction in ("payable", "receivable"):
            rows = self.client.bills(direction)
            seen += len(rows)
            changed += repo.replace_bills(
                self.session,
                direction,
                [
                    {
                        "party_ledger": row.party_ledger,
                        "bill_name": row.bill_name,
                        "bill_date": row.bill_date,
                        "due_date": row.due_date,
                        "opening_amount": row.opening_amount,
                        "pending_amount": row.pending_amount,
                        "company_name": self.company,
                    }
                    for row in rows
                ],
            )
        self._last_seen = seen
        return changed
