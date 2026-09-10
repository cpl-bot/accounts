"""Pull sync: TallyPrime → replica (plan §3.4, docs/SYNC_RELIABILITY_PLAN.md).

* masters are upserted by GUID (falling back to name) and are **always fetched
  in full**: the old ``$AlterID > <max seen>`` delta could silently miss
  closing-balance drift on ledgers Tally never marked as altered;
* vouchers come from the Day Book for ``[last success − overlap_days, today]``
  and are **re-filtered by date in Python**, because TallyPrime is known to
  ignore ``SVFROMDATE``/``SVTODATE`` on that export;
* bills are a snapshot: each run replaces the table for one direction.

Every scope runs in its own transaction and records its own ``sync_runs`` row,
so one unreachable scope neither rolls back nor blocks the others.
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

SCOPES = ("masters", "vouchers", "bills", "stock")

#: Indian financial year: 1 April to 31 March.
FY_START_MONTH = 4


def financial_year_start(today: date) -> date:
    """1 April of the financial year ``today`` falls in."""
    year = today.year if today.month >= FY_START_MONTH else today.year - 1
    return date(year, FY_START_MONTH, 1)


def stock_boundaries(today: date | None = None) -> list[date]:
    """Dates the dashboard needs a stock valuation for (plan §3.9).

    The financial-year start, the first of every month since, and today —
    de-duplicated and in order.
    """
    today = today or date.today()
    start = financial_year_start(today)
    dates: list[date] = []
    cursor = start
    while cursor <= today:
        dates.append(cursor)
        cursor = (
            date(cursor.year + 1, 1, 1)
            if cursor.month == 12
            else date(cursor.year, cursor.month + 1, 1)
        )
    if today not in dates:
        dates.append(today)
    return dates


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
    ) -> list[models.SyncRun]:
        """Pull each requested scope independently, one ``sync_runs`` row each.

        Scopes are always attempted in :data:`SCOPES` order, whatever order the
        caller listed them in, and the returned list follows that same order.
        A scope that fails with a :class:`TallyError` is recorded as ``failed``
        and the remaining scopes are still attempted.
        """
        requested = set(scopes) if scopes is not None else set(SCOPES)
        selected = [s for s in SCOPES if s in requested]
        return [self._run_scope(scope, from_date, to_date) for scope in selected]

    def _run_scope(
        self, scope: str, from_date: date | None, to_date: date | None
    ) -> models.SyncRun:
        """One scope: its own run row, its own transaction."""
        run = repo.start_sync_run(self.session, kind="pull", scope=scope)
        self.session.commit()
        run_id = run.id
        self._audit_checkpoint()
        self._last_seen = 0
        try:
            changed = self._pull_scope(scope, from_date, to_date)
        except TallyError as exc:
            logger.warning("pull of %s failed: %s", scope, exc)
            return self._fail_scope(run_id, exc)
        except Exception as exc:  # noqa: BLE001 - re-raised below
            # Never leave a zombie ``running`` row behind on an unexpected error.
            logger.exception("pull of %s raised", scope)
            self._fail_scope(run_id, exc)
            raise
        repo.finish_sync_run(
            self.session,
            run,
            status="success",
            records_seen=self._last_seen,
            records_changed=changed,
        )
        self.session.commit()
        self._audit_checkpoint()
        return run

    def _pull_scope(self, scope: str, from_date: date | None, to_date: date | None) -> int:
        if scope == "masters":
            return self.pull_masters()
        if scope == "vouchers":
            window_from, window_to = self.voucher_window(from_date, to_date)
            return self.pull_vouchers(window_from, window_to)
        if scope == "bills":
            return self.pull_bills()
        return self.pull_stock_valuations()

    def _fail_scope(self, run_id: int, exc: BaseException) -> models.SyncRun:
        """Discard this scope's partial upserts and mark its run failed.

        ``rollback()`` throws away everything written since the run row was
        committed — including the ``audit_log`` rows this scope's Tally calls
        produced, which is why the sink's buffer is replayed straight after.
        The run row itself was committed by :meth:`_run_scope` before the pull
        started, so it survives; it is re-fetched because ``rollback()``
        expires every ORM object bound to the session.
        """
        self.session.rollback()
        self._audit_replay()
        run = self.session.get(models.SyncRun, run_id)
        repo.finish_sync_run(self.session, run, status="failed", error=str(exc) or repr(exc))
        self.session.commit()
        self._audit_checkpoint()
        return run

    # -- audit sink co-operation -------------------------------------------
    #
    # The sink writes ``audit_log`` rows into *this* session (SQLite is a
    # single-writer database, so it must not open a second connection). It
    # buffers what it wrote so a scope-level rollback does not lose the record
    # of the very Tally call that failed.

    def _audit_checkpoint(self) -> None:
        """Tell the sink its buffered rows are now committed."""
        checkpoint = getattr(getattr(self.client, "audit", None), "checkpoint", None)
        if callable(checkpoint):
            checkpoint()

    def _audit_replay(self) -> None:
        """Re-write the audit rows a rollback just threw away."""
        replay = getattr(getattr(self.client, "audit", None), "replay", None)
        if callable(replay):
            replay()

    _last_seen: int = 0

    # -- masters -----------------------------------------------------------

    def pull_masters(self) -> int:
        """Upsert groups, ledgers, stock items and the simple lookups.

        Always a full refresh: ``None`` is passed as the ALTERID floor so Tally
        returns every master, not just the ones it considers altered.
        """
        seen = changed = 0
        for row in self.client.groups(None):
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
        for row in self.client.ledgers(None):
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
                # A ledger Tally knows about is no longer 'talai'-only (§3.8.5).
                source="tally",
                **self._sync_columns(row),
            )
            seen += 1
            changed += 1
        for row in self.client.stock_items(None):
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
            for row in fetch(None):
                repo.upsert_lookup(
                    self.session, model, name=row.name, parent=row.parent,
                    **self._sync_columns(row),
                )
                seen += 1
                changed += 1
        self._last_seen = seen
        return changed

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

    # -- stock valuations --------------------------------------------------

    def pull_stock_valuations(self, boundaries: list[date] | None = None) -> int:
        """Ask Tally for the closing stock value at each boundary (plan §3.9).

        A boundary Tally has no value for is skipped rather than stored as
        zero: the dashboard would rather report ``unavailable`` than a wrong
        opening stock.
        """
        dates = boundaries if boundaries is not None else stock_boundaries()
        self._last_seen = len(dates)
        changed = 0
        for as_on in dates:
            value = self.client.stock_valuation(as_on)
            if value is None:
                logger.warning("Tally reported no stock value as on %s", as_on)
                continue
            repo.upsert_stock_valuation(self.session, as_on, value, source="tally")
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
