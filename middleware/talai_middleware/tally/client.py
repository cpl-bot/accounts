"""``TallyClient`` — the only place that turns XML into typed objects.

Services and routes call methods here; no raw XML crosses this boundary. Every
call is timed and handed to an :class:`~talai_middleware.audit.AuditSink`.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from decimal import Decimal

from ..audit import AuditEntry, AuditSink, LoggingAuditSink, request_hash
from . import envelopes as env
from . import parsers as P
from .errors import TallyError
from .transport import TallyTransport

logger = logging.getLogger(__name__)

LEDGER_FETCH = [
    "NAME",
    "PARENT",
    "OPENINGBALANCE",
    "CLOSINGBALANCE",
    "PARTYGSTIN",
    "MAILINGNAME",
    "LEDSTATENAME",
    "GSTREGISTRATIONTYPE",
    "ISBILLWISEON",
    "MASTERID",
    "ALTERID",
    "GUID",
]
GROUP_FETCH = [
    "NAME",
    "PARENT",
    "PRIMARYGROUP",
    "ISREVENUE",
    "ISDEEMEDPOSITIVE",
    "AFFECTSGROSSPROFIT",
    "MASTERID",
    "ALTERID",
    "GUID",
]
STOCK_FETCH = [
    "NAME",
    "PARENT",
    "BASEUNITS",
    "HSNCODE",
    "GSTRATE",
    "CLOSINGBALANCE",
    "CLOSINGVALUE",
    "MASTERID",
    "ALTERID",
    "GUID",
]
NAME_FETCH = ["NAME", "PARENT", "MASTERID", "ALTERID", "GUID"]


@dataclass
class TallyStatusResult:
    """What ``GET /tally/status`` needs to know (plan §3.2)."""

    reachable: bool
    latency_ms: int
    checked_at: datetime
    companies: list[P.Company] = field(default_factory=list)
    active_company: str | None = None
    expected_company: str | None = None
    company_match: bool = False
    error: str | None = None


class TallyClient:
    """High-level, typed operations against one TallyPrime instance."""

    def __init__(
        self,
        transport: TallyTransport,
        company: str | None = None,
        audit: AuditSink | None = None,
        store_xml: bool = False,
        timeout: float | None = None,
    ) -> None:
        self.transport = transport
        self.company = company or None
        self.audit = audit or LoggingAuditSink()
        self.store_xml = store_xml
        self.timeout = timeout

    def with_audit(self, audit: AuditSink) -> TallyClient:
        """A copy of this client that reports to a different audit sink.

        Each request and each sync run binds the sink to its own DB session.
        """
        return TallyClient(
            self.transport,
            company=self.company,
            audit=audit,
            store_xml=self.store_xml,
            timeout=self.timeout,
        )

    # -- plumbing ----------------------------------------------------------

    def _send(
        self,
        xml: str,
        operation: str,
        parse: Callable,
        direction: str = "out",
        timeout: float | None = None,
    ):
        started = time.perf_counter()
        try:
            response = self.transport.send(xml, timeout if timeout is not None else self.timeout)
        except TallyError as exc:
            self._audit(direction, operation, xml, None, "error", started, str(exc))
            raise
        try:
            result = parse(response)
        except TallyError as exc:
            self._audit(direction, operation, xml, response, "error", started, str(exc))
            raise
        self._audit(direction, operation, xml, response, "ok", started, None)
        return result

    def _audit(
        self,
        direction: str,
        operation: str,
        xml: str,
        response: str | None,
        status: str,
        started: float,
        error: str | None,
    ) -> None:
        self.audit.record(
            AuditEntry(
                direction=direction,
                operation=operation,
                request_hash=request_hash(xml),
                status=status,
                duration_ms=int((time.perf_counter() - started) * 1000),
                request_xml=xml if self.store_xml else None,
                response_xml=response if self.store_xml else None,
                error=error,
            )
        )

    def _collection(
        self,
        name: str,
        fetch: list[str],
        parse: Callable,
        since_alter_id: int | None = None,
        from_date: date | None = None,
        to_date: date | None = None,
    ):
        filters = (
            [("TalaiAlterId", f"$AlterID > {since_alter_id}")]
            if since_alter_id is not None
            else None
        )
        xml = env.collection(
            name,
            fetch=fetch,
            company=self.company,
            from_date=from_date,
            to_date=to_date,
            filters=filters,
        )
        return self._send(xml, f"collection:{name}", parse)

    # -- reads -------------------------------------------------------------

    def list_companies(self, timeout: float | None = None) -> list[P.Company]:
        return self._send(
            env.list_companies(), "list_companies", P.parse_companies, timeout=timeout
        )

    def ledgers(self, since_alter_id: int | None = None) -> list[P.LedgerRow]:
        return self._collection("Ledger", LEDGER_FETCH, P.parse_ledgers, since_alter_id)

    def groups(self, since_alter_id: int | None = None) -> list[P.GroupRow]:
        return self._collection("Group", GROUP_FETCH, P.parse_groups, since_alter_id)

    def stock_items(self, since_alter_id: int | None = None) -> list[P.StockItemRow]:
        return self._collection(
            "StockItem", STOCK_FETCH, P.parse_stock_items, since_alter_id
        )

    def cost_centres(self, since_alter_id: int | None = None) -> list[P.MasterRow]:
        return self._collection(
            "CostCentre",
            NAME_FETCH,
            lambda r: P.parse_named(r, "COSTCENTRE"),
            since_alter_id,
        )

    def godowns(self, since_alter_id: int | None = None) -> list[P.MasterRow]:
        return self._collection(
            "Godown",
            NAME_FETCH,
            lambda r: P.parse_named(r, "GODOWN"),
            since_alter_id,
        )

    def voucher_types(self, since_alter_id: int | None = None) -> list[P.MasterRow]:
        return self._collection(
            "VoucherType",
            NAME_FETCH,
            lambda r: P.parse_named(r, "VOUCHERTYPE"),
            since_alter_id,
        )

    def day_book(self, from_date: date, to_date: date) -> list[P.VoucherRow]:
        """Vouchers for a date range from a TDL-filtered collection."""
        xml = env.voucher_collection(from_date, to_date, company=self.company)
        return self._send(xml, "collection:Voucher", P.parse_vouchers)

    def stock_valuation(self, as_on: date) -> Decimal | None:
        """Total closing stock value as on a date, from the Stock Summary report."""
        xml = env.stock_summary_report(as_on, company=self.company)
        return self._send(xml, "report:Stock Summary", P.parse_stock_valuation)

    def bills(self, direction: str) -> list[P.BillRow]:
        report_name = "Bills Payable" if direction == "payable" else "Bills Receivable"
        xml = env.report(report_name, company=self.company)
        return self._send(
            xml, f"report:{report_name}", lambda r: P.parse_bills(r, direction=direction)
        )

    def find_voucher_by_remote_id(self, remote_id: str) -> P.VoucherRow | None:
        """Read-back after a push, to confirm what Tally actually created."""
        today = date.today()
        fiscal_start = date(today.year, 4, 1) if today.month >= 4 else date(today.year - 1, 4, 1)
        vouchers = self.day_book(fiscal_start, today)
        return next((v for v in vouchers if v.remote_id == remote_id), None)

    # -- writes ------------------------------------------------------------

    def import_voucher(self, voucher: env.VoucherImport) -> P.ImportResult:
        xml = env.import_voucher(voucher, company=self.company)
        return self._send(xml, "import:voucher", P.parse_import_result, direction="in")

    def import_ledger(self, **kwargs) -> P.ImportResult:
        xml = env.import_ledger(company=self.company, **kwargs)
        return self._send(xml, "import:ledger", P.parse_import_result, direction="in")

    # -- connection hygiene ------------------------------------------------

    def ping(self, timeout: float | None = None) -> TallyStatusResult:
        """Cheap reachability probe used by ``/tally/status`` (plan §3.2).

        ``timeout`` overrides the client's request timeout so a status check
        never waits the full import timeout when Tally is down.
        """
        started = time.perf_counter()
        checked_at = datetime.now(UTC)
        try:
            companies = self.list_companies(timeout=timeout)
        except TallyError as exc:
            return TallyStatusResult(
                reachable=False,
                latency_ms=int((time.perf_counter() - started) * 1000),
                checked_at=checked_at,
                expected_company=self.company,
                error=exc.message,
            )
        names = [c.name for c in companies]
        active = names[0] if names else None
        return TallyStatusResult(
            reachable=True,
            latency_ms=int((time.perf_counter() - started) * 1000),
            checked_at=checked_at,
            companies=companies,
            active_company=active,
            expected_company=self.company,
            company_match=bool(self.company) and self.company in names,
        )
