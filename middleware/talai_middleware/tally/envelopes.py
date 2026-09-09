"""Pure builders for TallyPrime XML request envelopes.

Everything here is a pure function of its arguments so the builders can be
covered by golden-file tests. See ``docs/TALLY_INTEGRATION_NOTES.md`` for the
shapes these follow.

Conventions:

* dates are serialised as ``YYYYMMDD``;
* money is serialised with two decimals;
* ledger amounts follow Tally's sign convention — a debit is
  ``ISDEEMEDPOSITIVE=Yes`` with a *negative* amount, a credit is
  ``ISDEEMEDPOSITIVE=No`` with a *positive* amount. Callers pass positive
  magnitudes plus ``is_debit`` and never deal with the sign themselves.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from xml.sax.saxutils import escape

XML_VERSION = "1"
BALANCE_TOLERANCE = Decimal("0.01")


def fmt_date(value: date) -> str:
    """Tally's date format."""
    return value.strftime("%Y%m%d")


def fmt_amount(value: Decimal) -> str:
    """Two-decimal money string."""
    return f"{Decimal(value):.2f}"


def _tag(name: str, value: object) -> str:
    return f"<{name}>{escape(str(value))}</{name}>"


def _header(request: str, type_: str, id_: str) -> str:
    return (
        "<HEADER>"
        f"<VERSION>{XML_VERSION}</VERSION>"
        f"<TALLYREQUEST>{request}</TALLYREQUEST>"
        f"<TYPE>{type_}</TYPE>"
        f"<ID>{escape(id_)}</ID>"
        "</HEADER>"
    )


def _static_variables(
    company: str | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
    extra: dict[str, str] | None = None,
) -> str:
    parts = ["<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>"]
    if company:
        parts.append(_tag("SVCURRENTCOMPANY", company))
    if from_date:
        parts.append(_tag("SVFROMDATE", fmt_date(from_date)))
    if to_date:
        parts.append(_tag("SVTODATE", fmt_date(to_date)))
    for key, value in (extra or {}).items():
        parts.append(_tag(key, value))
    return "<STATICVARIABLES>" + "".join(parts) + "</STATICVARIABLES>"


def _fetchlist(fetch: list[str] | None) -> str:
    if not fetch:
        return ""
    return "<FETCHLIST>" + "".join(f"<FETCH>{escape(f)}</FETCH>" for f in fetch) + "</FETCHLIST>"


def _envelope(header: str, body: str) -> str:
    return f"<ENVELOPE>{header}<BODY>{body}</BODY></ENVELOPE>"


# --------------------------------------------------------------------------
# Export requests
# --------------------------------------------------------------------------


def list_companies() -> str:
    """Companies currently open in Tally."""
    body = (
        "<DESC>"
        + _static_variables()
        + _fetchlist(["NAME", "COMPANYNUMBER", "STARTINGFROM", "BOOKSFROM", "GUID"])
        + "</DESC>"
    )
    return _envelope(_header("Export", "Collection", "Company"), body)


def collection(
    name: str,
    fetch: list[str] | None = None,
    company: str | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
    filters: list[tuple[str, str]] | None = None,
) -> str:
    """Export a Tally collection.

    When ``filters`` are given (``(filter_name, tdl_formula)`` pairs, e.g.
    ``("TalaiAlterId", "$AlterID > 42")``) a derived collection ``Talai<Name>``
    is declared inline via TDL and requested instead of the base collection,
    which is the documented way to filter a collection export.
    """
    desc = [_static_variables(company, from_date, to_date), _fetchlist(fetch)]
    request_id = name
    if filters:
        request_id = f"Talai{name.replace(' ', '')}"
        fetch_tdl = "".join(f"<FETCH>{escape(f)}</FETCH>" for f in (fetch or []))
        filter_tags = "".join(f"<FILTER>{escape(fname)}</FILTER>" for fname, _ in filters)
        systems = "".join(
            f'<SYSTEM TYPE="Formulae" NAME="{escape(fname)}">{escape(formula)}</SYSTEM>'
            for fname, formula in filters
        )
        desc.append(
            "<TDL><TDLMESSAGE>"
            f'<COLLECTION NAME="{escape(request_id)}" ISMODIFY="No" ISFIXED="No">'
            f"{_tag('TYPE', name)}{fetch_tdl}{filter_tags}"
            "</COLLECTION>"
            f"{systems}"
            "</TDLMESSAGE></TDL>"
        )
    return _envelope(
        _header("Export", "Collection", request_id), "<DESC>" + "".join(desc) + "</DESC>"
    )


def report(
    name: str,
    company: str | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
) -> str:
    """Export a built-in Tally report (Day Book, Bills Payable, …)."""
    body = "<DESC>" + _static_variables(company, from_date, to_date) + "</DESC>"
    return _envelope(_header("Export", "Report", name), body)


# --------------------------------------------------------------------------
# Import payloads
# --------------------------------------------------------------------------


@dataclass
class BillAllocation:
    """A bill-wise reference on a party ledger line."""

    name: str
    bill_type: str = "New Ref"
    amount: Decimal = Decimal("0")
    due_date: date | None = None


@dataclass
class LedgerEntry:
    """One accounting line. ``amount`` is a positive magnitude."""

    ledger_name: str
    amount: Decimal
    is_debit: bool
    cost_centre: str | None = None
    bill_allocations: list[BillAllocation] = field(default_factory=list)


@dataclass
class InventoryEntry:
    """One stock line of a purchase voucher."""

    stock_item: str
    quantity: Decimal
    rate: Decimal
    amount: Decimal
    godown: str | None = None
    unit: str = ""
    hsn: str | None = None


@dataclass
class VoucherImport:
    """Everything needed to build a create-only voucher import envelope.

    ``ledger_entries`` always carries the *complete* accounting picture — party,
    purchase ledger, taxes — so the payload can be balance-checked in one place.
    When ``inventory_entries`` are present the ``purchase_ledger`` line is not
    emitted as an ``ALLLEDGERENTRIES.LIST``: it moves into the
    ``ACCOUNTINGALLOCATIONS.LIST`` of each item line, which is how TallyPrime
    expects an invoice-view purchase voucher.
    """

    remote_id: str
    voucher_type: str
    voucher_date: date
    party_ledger: str
    ledger_entries: list[LedgerEntry]
    inventory_entries: list[InventoryEntry] = field(default_factory=list)
    purchase_ledger: str | None = None
    narration: str = ""
    reference: str = ""
    reference_date: date | None = None
    voucher_number: str | None = None

    def debit_total(self) -> Decimal:
        return sum((e.amount for e in self.ledger_entries if e.is_debit), Decimal("0"))

    def credit_total(self) -> Decimal:
        return sum((e.amount for e in self.ledger_entries if not e.is_debit), Decimal("0"))

    def is_balanced(self) -> bool:
        return abs(self.debit_total() - self.credit_total()) <= BALANCE_TOLERANCE

    @property
    def is_invoice(self) -> bool:
        return bool(self.inventory_entries)


def _signed(entry: LedgerEntry) -> Decimal:
    return -entry.amount if entry.is_debit else entry.amount


def _ledger_entry_xml(entry: LedgerEntry) -> str:
    parts = [
        _tag("LEDGERNAME", entry.ledger_name),
        _tag("ISDEEMEDPOSITIVE", "Yes" if entry.is_debit else "No"),
        _tag("AMOUNT", fmt_amount(_signed(entry))),
    ]
    for bill in entry.bill_allocations:
        bill_parts = [
            _tag("NAME", bill.name),
            _tag("BILLTYPE", bill.bill_type),
            _tag("AMOUNT", fmt_amount(-bill.amount if entry.is_debit else bill.amount)),
        ]
        if bill.due_date:
            bill_parts.append(_tag("BILLCREDITPERIOD", fmt_date(bill.due_date)))
        parts.append("<BILLALLOCATIONS.LIST>" + "".join(bill_parts) + "</BILLALLOCATIONS.LIST>")
    if entry.cost_centre:
        parts.append(_cost_centre_xml(entry.cost_centre, _signed(entry)))
    return "<ALLLEDGERENTRIES.LIST>" + "".join(parts) + "</ALLLEDGERENTRIES.LIST>"


def _cost_centre_xml(name: str, amount: Decimal) -> str:
    return (
        "<COSTCENTREALLOCATIONS.LIST>"
        + _tag("NAME", name)
        + _tag("AMOUNT", fmt_amount(amount))
        + "</COSTCENTREALLOCATIONS.LIST>"
    )


def _inventory_entry_xml(
    entry: InventoryEntry, purchase_ledger: str | None, cost_centre: str | None
) -> str:
    """One ``ALLINVENTORYENTRIES.LIST`` item line of an invoice-view voucher."""
    qty = f"{entry.quantity} {entry.unit}"
    parts = [
        _tag("STOCKITEMNAME", entry.stock_item),
        _tag("ISDEEMEDPOSITIVE", "Yes"),
        _tag("RATE", f"{entry.rate}/{entry.unit}"),
        _tag("ACTUALQTY", qty),
        _tag("BILLEDQTY", qty),
        _tag("AMOUNT", fmt_amount(-entry.amount)),
    ]
    if entry.hsn:
        parts.append(_tag("HSNCODE", entry.hsn))
    if entry.godown:
        parts.append(_tag("GODOWNNAME", entry.godown))
        parts.append(
            "<BATCHALLOCATIONS.LIST>"
            + _tag("GODOWNNAME", entry.godown)
            + _tag("BATCHNAME", "Primary Batch")
            + _tag("AMOUNT", fmt_amount(-entry.amount))
            + _tag("ACTUALQTY", qty)
            + _tag("BILLEDQTY", qty)
            + "</BATCHALLOCATIONS.LIST>"
        )
    if purchase_ledger:
        alloc = [
            _tag("LEDGERNAME", purchase_ledger),
            _tag("ISDEEMEDPOSITIVE", "Yes"),
            _tag("AMOUNT", fmt_amount(-entry.amount)),
        ]
        if cost_centre:
            alloc.append(_cost_centre_xml(cost_centre, -entry.amount))
        parts.append(
            "<ACCOUNTINGALLOCATIONS.LIST>" + "".join(alloc) + "</ACCOUNTINGALLOCATIONS.LIST>"
        )
    return "<ALLINVENTORYENTRIES.LIST>" + "".join(parts) + "</ALLINVENTORYENTRIES.LIST>"


def _import_envelope(report_name: str, message_xml: str, company: str | None) -> str:
    """The ``IMPORTDATA`` wrapper used by every write request."""
    static = (
        f"<STATICVARIABLES>{_tag('SVCURRENTCOMPANY', company)}</STATICVARIABLES>"
        if company
        else "<STATICVARIABLES></STATICVARIABLES>"
    )
    body = (
        "<IMPORTDATA>"
        f"<REQUESTDESC>{_tag('REPORTNAME', report_name)}{static}</REQUESTDESC>"
        f'<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">{message_xml}</TALLYMESSAGE>'
        "</REQUESTDATA>"
        "</IMPORTDATA>"
    )
    header = (
        f"<HEADER><VERSION>{XML_VERSION}</VERSION>"
        "<TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>"
    )
    return f"<ENVELOPE>{header}<BODY>{body}</BODY></ENVELOPE>"


def import_voucher(voucher: VoucherImport, company: str | None = None) -> str:
    """Build a create-only ``Import Data`` envelope for one voucher.

    Raises ``ValueError`` when the payload is unbalanced — the middleware must
    never send Tally a voucher it already knows will be rejected.
    """
    if not voucher.is_balanced():
        raise ValueError(
            "Ledger entries do not balance: "
            f"Dr {fmt_amount(voucher.debit_total())} / Cr {fmt_amount(voucher.credit_total())}"
        )
    obj_view = "Invoice Voucher View" if voucher.is_invoice else "Accounting Voucher View"
    parts = [
        _tag("DATE", fmt_date(voucher.voucher_date)),
        _tag("EFFECTIVEDATE", fmt_date(voucher.voucher_date)),
        _tag("VOUCHERTYPENAME", voucher.voucher_type),
        _tag("REMOTEID", voucher.remote_id),
        _tag("PARTYLEDGERNAME", voucher.party_ledger),
        _tag("PERSISTEDVIEW", obj_view),
    ]
    if voucher.is_invoice:
        parts.append(_tag("ISINVOICE", "Yes"))
    if voucher.voucher_number:
        parts.append(_tag("VOUCHERNUMBER", voucher.voucher_number))
    if voucher.reference:
        parts.append(_tag("REFERENCE", voucher.reference))
    if voucher.reference_date:
        parts.append(_tag("REFERENCEDATE", fmt_date(voucher.reference_date)))
    if voucher.narration:
        parts.append(_tag("NARRATION", voucher.narration))

    # The purchase ledger is represented by the item lines' accounting
    # allocations when inventory is used, so drop its standalone entry.
    inline_ledger = voucher.purchase_ledger if voucher.is_invoice else None
    purchase_cost_centre = next(
        (e.cost_centre for e in voucher.ledger_entries if e.ledger_name == inline_ledger),
        None,
    )
    for entry in voucher.ledger_entries:
        if inline_ledger and entry.ledger_name == inline_ledger:
            continue
        parts.append(_ledger_entry_xml(entry))
    parts.extend(
        _inventory_entry_xml(e, inline_ledger, purchase_cost_centre)
        for e in voucher.inventory_entries
    )

    voucher_xml = (
        f'<VOUCHER VCHTYPE="{escape(voucher.voucher_type)}" ACTION="Create" '
        f'OBJVIEW="{obj_view}">' + "".join(parts) + "</VOUCHER>"
    )
    return _import_envelope("Vouchers", voucher_xml, company)


def import_ledger(
    name: str,
    parent: str,
    gstin: str | None = None,
    mailing_name: str | None = None,
    address: list[str] | None = None,
    state: str | None = None,
    is_bill_wise: bool = True,
    company: str | None = None,
) -> str:
    """Build a create-only ``Import Data`` envelope for one ledger master."""
    parts = [
        _tag("NAME", name),
        _tag("PARENT", parent),
        _tag("ISBILLWISEON", "Yes" if is_bill_wise else "No"),
        _tag("OPENINGBALANCE", "0.00"),
    ]
    if mailing_name:
        parts.append(_tag("MAILINGNAME", mailing_name))
    if gstin:
        parts.append(_tag("PARTYGSTIN", gstin))
        parts.append(_tag("GSTREGISTRATIONTYPE", "Regular"))
    if state:
        parts.append(_tag("LEDSTATENAME", state))
    if address:
        parts.append(
            '<ADDRESS.LIST TYPE="String">'
            + "".join(_tag("ADDRESS", line) for line in address)
            + "</ADDRESS.LIST>"
        )
    ledger_xml = f'<LEDGER NAME="{escape(name)}" ACTION="Create">' + "".join(parts) + "</LEDGER>"
    return _import_envelope("All Masters", ledger_xml, company)
