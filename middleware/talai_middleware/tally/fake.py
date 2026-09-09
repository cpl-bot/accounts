"""An in-process TallyPrime simulator.

``FakeTallyTransport`` routes on ``TALLYREQUEST``/``TYPE``/``ID`` and answers
with XML shaped like the real thing, so the whole stack — parsers, client,
services, routes and the support scripts — can be exercised without a Tally on
the network. It also enforces the v1 safety rule: any ``ACTION="Alter"`` or
``ACTION="Delete"`` in a request raises, because no code path may emit one.

Known quirk it reproduces deliberately: a Day Book export ignores
``SVFROMDATE``/``SVTODATE`` (see ``docs/TALLY_INTEGRATION_NOTES.md`` §11), so
callers must re-filter by date themselves.
"""

from __future__ import annotations

import logging
import re
from datetime import date
from decimal import Decimal
from xml.etree.ElementTree import Element  # noqa: S405 - element type only
from xml.sax.saxutils import escape

from .errors import TallyUnreachable
from .fake_seed import (
    FakeInventoryEntry,
    FakeLedger,
    FakeLedgerEntry,
    FakeState,
    FakeVoucher,
    default_state,
)
from .parsers import decode_response, parse_xml, to_bool, to_decimal

logger = logging.getLogger(__name__)

BALANCE_TOLERANCE = Decimal("0.01")
_ALTER_ID_FILTER = re.compile(r"\$AlterID\s*>\s*(\d+)", re.IGNORECASE)


class ForbiddenTallyAction(AssertionError):
    """Raised when a request contains an Alter/Delete action, which v1 forbids."""


def _tag(name: str, value: object) -> str:
    return f"<{name}>{escape(str(value))}</{name}>"


def _fmt_date(value: date | None) -> str:
    return value.strftime("%Y%m%d") if value else ""


def _envelope(payload: str, status: int = 1) -> str:
    return (
        "<ENVELOPE>"
        f"<HEADER><VERSION>1</VERSION><STATUS>{status}</STATUS></HEADER>"
        f"<BODY><DATA>{payload}</DATA></BODY>"
        "</ENVELOPE>"
    )


def _failure(code: str, desc: str) -> str:
    return _envelope(
        "<STATUS.LIST><STATUS>"
        + _tag("CODE", code)
        + _tag("DESC", desc)
        + "</STATUS></STATUS.LIST>",
        status=0,
    )


class FakeTallyTransport:
    """A ``TallyTransport`` backed by :class:`FakeState`."""

    def __init__(
        self,
        state: FakeState | None = None,
        *,
        reachable: bool = True,
        ignore_date_filter: bool = True,
    ) -> None:
        self.state = state or default_state()
        self.reachable = reachable
        self.ignore_date_filter = ignore_date_filter
        self.requests: list[str] = []
        self._voucher_seq = len(self.state.vouchers)

    # -- transport ---------------------------------------------------------

    def send(self, xml: str, timeout: float | None = None) -> str:
        if not self.reachable:
            raise TallyUnreachable("Fake Tally is configured as unreachable")
        self.requests.append(xml)
        self._assert_no_write_actions(xml)
        root = parse_xml(decode_response(xml))
        request = (root.findtext("HEADER/TALLYREQUEST") or "").strip().lower()
        if request.startswith("import"):
            return self._handle_import(root)
        return self._handle_export(root)

    @staticmethod
    def _assert_no_write_actions(xml: str) -> None:
        for forbidden in ("Alter", "Delete"):
            if f'ACTION="{forbidden}"' in xml or f"ACTION='{forbidden}'" in xml:
                raise ForbiddenTallyAction(
                    f'Request contains ACTION="{forbidden}"; v1 is create-only'
                )

    # -- exports -----------------------------------------------------------

    def _handle_export(self, root: Element) -> str:
        request_id = (root.findtext("HEADER/ID") or "").strip()
        collection_type = root.findtext("BODY/DESC/TDL/TDLMESSAGE/COLLECTION/TYPE")
        name = (collection_type or request_id).strip()
        if name.startswith("Talai"):
            name = name[len("Talai") :]
        min_alter_id = self._alter_id_floor(root)
        handler = {
            "company": self._companies,
            "listofcompanies": self._companies,
            "ledger": self._ledgers,
            "group": self._groups,
            "stockitem": self._stock_items,
            "costcentre": self._cost_centres,
            "godown": self._godowns,
            "vouchertype": self._voucher_types,
            "voucher": self._vouchers,
            "daybook": self._vouchers,
            "voucherregister": self._vouchers,
            "billspayable": self._bills_payable,
            "billsreceivable": self._bills_receivable,
        }.get(name.replace(" ", "").lower())
        if handler is None:
            return _failure("Unknown Request", f"Could not understand the request '{name}'")
        return _envelope(handler(min_alter_id))

    @staticmethod
    def _alter_id_floor(root: Element) -> int:
        for system in root.iter("SYSTEM"):
            match = _ALTER_ID_FILTER.search(system.text or "")
            if match:
                return int(match.group(1))
        return -1

    def _companies(self, _min_alter_id: int) -> str:
        rows = "".join(
            f'<COMPANY NAME="{escape(c.name)}">'
            + _tag("NAME", c.name)
            + _tag("GUID", c.guid)
            + _tag("STARTINGFROM", _fmt_date(c.starting_from))
            + _tag("BOOKSFROM", _fmt_date(c.books_from))
            + "</COMPANY>"
            for c in self.state.companies
        )
        return f"<COLLECTION>{rows}</COLLECTION>"

    def _ledgers(self, min_alter_id: int) -> str:
        rows = "".join(
            f'<LEDGER NAME="{escape(led.name)}">'
            + _tag("NAME", led.name)
            + _tag("PARENT", led.parent)
            + _tag("OPENINGBALANCE", f"{led.opening_balance:.2f}")
            + _tag("CLOSINGBALANCE", f"{led.closing_balance:.2f}")
            + (_tag("PARTYGSTIN", led.gstin) if led.gstin else "")
            + (_tag("LEDSTATENAME", led.state) if led.state else "")
            + _tag("ISBILLWISEON", "Yes" if led.is_bill_wise else "No")
            + _tag("MASTERID", led.master_id)
            + _tag("ALTERID", led.alter_id)
            + "</LEDGER>"
            for led in self.state.ledgers
            if led.alter_id > min_alter_id
        )
        return f"<COLLECTION>{rows}</COLLECTION>"

    def _groups(self, min_alter_id: int) -> str:
        rows = "".join(
            f'<GROUP NAME="{escape(g.name)}">'
            + _tag("NAME", g.name)
            + _tag("PARENT", g.parent)
            + _tag("PRIMARYGROUP", g.primary_group)
            + _tag("ISREVENUE", "Yes" if g.is_revenue else "No")
            + _tag("AFFECTSGROSSPROFIT", "Yes" if g.affects_gross_profit else "No")
            + _tag("ALTERID", g.alter_id)
            + "</GROUP>"
            for g in self.state.groups
            if g.alter_id > min_alter_id
        )
        return f"<COLLECTION>{rows}</COLLECTION>"

    def _stock_items(self, min_alter_id: int) -> str:
        rows = "".join(
            f'<STOCKITEM NAME="{escape(i.name)}">'
            + _tag("NAME", i.name)
            + _tag("PARENT", i.parent)
            + _tag("BASEUNITS", i.unit)
            + (_tag("HSNCODE", i.hsn) if i.hsn else "")
            + (_tag("GSTRATE", i.gst_rate) if i.gst_rate is not None else "")
            + _tag("CLOSINGBALANCE", f"{i.closing_qty} {i.unit}")
            + _tag("CLOSINGVALUE", f"{i.closing_value:.2f}")
            + _tag("ALTERID", i.alter_id)
            + "</STOCKITEM>"
            for i in self.state.stock_items
            if i.alter_id > min_alter_id
        )
        return f"<COLLECTION>{rows}</COLLECTION>"

    def _named(self, tag: str, rows: list, min_alter_id: int) -> str:
        body = "".join(
            f'<{tag} NAME="{escape(r.name)}">'
            + _tag("NAME", r.name)
            + _tag("PARENT", r.parent)
            + _tag("ALTERID", r.alter_id)
            + f"</{tag}>"
            for r in rows
            if r.alter_id > min_alter_id
        )
        return f"<COLLECTION>{body}</COLLECTION>"

    def _cost_centres(self, min_alter_id: int) -> str:
        return self._named("COSTCENTRE", self.state.cost_centres, min_alter_id)

    def _godowns(self, min_alter_id: int) -> str:
        return self._named("GODOWN", self.state.godowns, min_alter_id)

    def _voucher_types(self, min_alter_id: int) -> str:
        return self._named("VOUCHERTYPE", self.state.voucher_types, min_alter_id)

    def _vouchers(self, min_alter_id: int) -> str:
        return "".join(
            f"<TALLYMESSAGE>{self._voucher_xml(v)}</TALLYMESSAGE>"
            for v in self.state.vouchers
            if v.alter_id > min_alter_id
        )

    def _voucher_xml(self, v: FakeVoucher) -> str:
        parts = [
            _tag("DATE", _fmt_date(v.date)),
            _tag("VOUCHERTYPENAME", v.voucher_type),
            _tag("VOUCHERNUMBER", v.voucher_number),
            _tag("PARTYLEDGERNAME", v.party_ledger),
            _tag("NARRATION", v.narration),
            _tag("REFERENCE", v.reference),
            _tag("GUID", v.guid),
            _tag("ALTERID", v.alter_id),
            _tag("ISCANCELLED", "Yes" if v.is_cancelled else "No"),
        ]
        if v.remote_id:
            parts.append(_tag("REMOTEID", v.remote_id))
        for e in v.ledger_entries:
            cc = (
                "<COSTCENTREALLOCATIONS.LIST>"
                + _tag("NAME", e.cost_centre)
                + _tag("AMOUNT", f"{e.amount:.2f}")
                + "</COSTCENTREALLOCATIONS.LIST>"
                if e.cost_centre
                else ""
            )
            parts.append(
                "<ALLLEDGERENTRIES.LIST>"
                + _tag("LEDGERNAME", e.ledger_name)
                + _tag("ISDEEMEDPOSITIVE", "Yes" if e.is_deemed_positive else "No")
                + _tag("AMOUNT", f"{e.amount:.2f}")
                + cc
                + "</ALLLEDGERENTRIES.LIST>"
            )
        for i in v.inventory_entries:
            parts.append(
                "<ALLINVENTORYENTRIES.LIST>"
                + _tag("STOCKITEMNAME", i.stock_item)
                + _tag("RATE", f"{i.rate}/")
                + _tag("ACTUALQTY", f"{i.quantity} ")
                + _tag("BILLEDQTY", f"{i.quantity} ")
                + _tag("AMOUNT", f"{i.amount:.2f}")
                + (_tag("GODOWNNAME", i.godown) if i.godown else "")
                + (_tag("HSNCODE", i.hsn) if i.hsn else "")
                + "</ALLINVENTORYENTRIES.LIST>"
            )
        return f'<VOUCHER VCHTYPE="{escape(v.voucher_type)}">' + "".join(parts) + "</VOUCHER>"

    def _bills(self, direction: str) -> str:
        rows = "".join(
            f'<BILLS NAME="{escape(b.bill_name)}">'
            + _tag("NAME", b.bill_name)
            + _tag("PARTYLEDGERNAME", b.party_ledger)
            + _tag("BILLDATE", _fmt_date(b.bill_date))
            + _tag("BILLDUEDATE", _fmt_date(b.due_date))
            + _tag("OPENINGBALANCE", f"{b.opening_amount:.2f}")
            + _tag("CLOSINGBALANCE", f"{b.pending_amount:.2f}")
            + "</BILLS>"
            for b in self.state.bills
            if b.direction == direction
        )
        return f"<COLLECTION>{rows}</COLLECTION>"

    def _bills_payable(self, _min_alter_id: int) -> str:
        return self._bills("payable")

    def _bills_receivable(self, _min_alter_id: int) -> str:
        return self._bills("receivable")

    # -- imports -----------------------------------------------------------

    def _handle_import(self, root: Element) -> str:
        created = altered = ignored = 0
        line_errors: list[str] = []
        for index, node in enumerate(root.iter("VOUCHER"), start=1):
            outcome, error = self._create_voucher(node)
            created += 1 if outcome == "created" else 0
            ignored += 1 if outcome == "ignored" else 0
            if error:
                line_errors.append((index, error))
        for node in root.iter("LEDGER"):
            created += self._create_ledger(node)
        errors = len(line_errors)
        body = (
            "<IMPORTRESULT>"
            + _tag("CREATED", created)
            + _tag("ALTERED", altered)
            + _tag("DELETED", 0)
            + _tag("COMBINED", 0)
            + _tag("IGNORED", ignored)
            + _tag("ERRORS", errors)
            + (_tag("LASTVCHID", self._voucher_seq) if created else "")
            + "".join(
                "<LINEERROR>" + _tag("LINE", line) + _tag("DESC", desc) + "</LINEERROR>"
                for line, desc in line_errors
            )
            + "</IMPORTRESULT>"
        )
        return _envelope(body)

    def _create_voucher(self, node: Element) -> tuple[str, str | None]:
        remote_id = node.findtext("REMOTEID")
        if remote_id and self.state.voucher_by_remote_id(remote_id):
            return "ignored", None

        ledger_entries: list[FakeLedgerEntry] = []
        for entry in list(node.iter("ALLLEDGERENTRIES.LIST")) + list(
            node.iter("ACCOUNTINGALLOCATIONS.LIST")
        ):
            name = (entry.findtext("LEDGERNAME") or "").strip()
            if not name:
                continue
            if self.state.ledger(name) is None:
                return "error", f"Could not find Ledger '{name}'"
            ledger_entries.append(
                FakeLedgerEntry(
                    ledger_name=name,
                    amount=to_decimal(entry.findtext("AMOUNT"), Decimal("0")) or Decimal("0"),
                    is_deemed_positive=to_bool(entry.findtext("ISDEEMEDPOSITIVE")),
                    cost_centre=entry.findtext("COSTCENTREALLOCATIONS.LIST/NAME"),
                )
            )

        total = sum((e.amount for e in ledger_entries), Decimal("0"))
        if abs(total) > BALANCE_TOLERANCE:
            debits = sum((-e.amount for e in ledger_entries if e.amount < 0), Decimal("0"))
            credits = sum((e.amount for e in ledger_entries if e.amount > 0), Decimal("0"))
            return "error", (
                f"Voucher totals do not tally! Dr: {debits:,.2f} Cr: {credits:,.2f} "
                f"Diff: {abs(total):,.2f}"
            )

        for item in node.iter("STOCKITEMNAME"):
            name = (item.text or "").strip()
            if name and not any(s.name == name for s in self.state.stock_items):
                return "error", f"Could not find StockItem '{name}'"

        voucher_type = (node.findtext("VOUCHERTYPENAME") or node.get("VCHTYPE") or "").strip()
        self._voucher_seq += 1
        self.state.next_alter_id += 1
        self.state.vouchers.append(
            FakeVoucher(
                voucher_number=self._next_voucher_number(voucher_type),
                voucher_type=voucher_type,
                date=_parse_date(node.findtext("DATE")),
                party_ledger=(node.findtext("PARTYLEDGERNAME") or "").strip(),
                narration=(node.findtext("NARRATION") or "").strip(),
                reference=(node.findtext("REFERENCE") or "").strip(),
                remote_id=remote_id,
                guid=f"4f9d0e3a-0009-0000-0000-{self._voucher_seq:012d}",
                alter_id=self.state.next_alter_id,
                ledger_entries=ledger_entries,
                inventory_entries=[
                    FakeInventoryEntry(
                        stock_item=(e.findtext("STOCKITEMNAME") or "").strip(),
                        quantity=to_decimal(_num(e.findtext("BILLEDQTY")), Decimal("0"))
                        or Decimal("0"),
                        rate=to_decimal(_num(e.findtext("RATE")), Decimal("0")) or Decimal("0"),
                        amount=to_decimal(e.findtext("AMOUNT"), Decimal("0")) or Decimal("0"),
                        godown=e.findtext("GODOWNNAME"),
                        hsn=e.findtext("HSNCODE"),
                    )
                    for e in node.iter("ALLINVENTORYENTRIES.LIST")
                ],
            )
        )
        return "created", None

    def _next_voucher_number(self, voucher_type: str) -> str:
        prefix = (voucher_type[:3] or "VCH").upper()
        return f"{prefix}/26-27/{self._voucher_seq:04d}"

    def _create_ledger(self, node: Element) -> int:
        name = (node.findtext("NAME") or node.get("NAME") or "").strip()
        if not name or self.state.ledger(name):
            return 0
        self.state.next_alter_id += 1
        self.state.ledgers.append(
            FakeLedger(
                name=name,
                parent=(node.findtext("PARENT") or "").strip(),
                gstin=node.findtext("PARTYGSTIN"),
                state=node.findtext("LEDSTATENAME"),
                is_bill_wise=to_bool(node.findtext("ISBILLWISEON")),
                master_id=str(900 + len(self.state.ledgers)),
                alter_id=self.state.next_alter_id,
            )
        )
        return 1


def _num(value: str | None) -> str | None:
    """``50 Box`` / ``450/Box`` → ``50`` / ``450``."""
    if not value:
        return None
    match = re.search(r"-?[\d.,]+", value)
    return match.group() if match else None


def _parse_date(value: str | None) -> date:
    from .parsers import to_date

    return to_date(value) or date.today()
