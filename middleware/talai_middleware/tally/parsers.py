"""Tolerant decoding and parsing of TallyPrime XML responses.

TallyPrime's XML is only approximately well formed. In the wild we see:

* a ``UTF-16`` declaration on bytes that are actually UTF-16LE (with or without BOM);
* raw control characters and numeric references to them (``&#4;`` is the classic);
* bare ``&`` in ledger and party names ("Smith & Co");
* an HTML error page, or an empty body, when the request never reached Tally.

``decode_response`` repairs all of that before ``parse_xml`` hands back an
element tree. Everything below returns plain dataclasses; no raw XML escapes
this module.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from xml.etree.ElementTree import Element  # noqa: S405 - element type only

from defusedxml.ElementTree import fromstring as safe_fromstring

from .errors import TallyResponseError
from .rows import (
    BillRow,
    Company,
    GroupRow,
    ImportResult,
    LedgerRow,
    MasterRow,
    StockItemRow,
    VoucherInventoryEntry,
    VoucherLedgerEntry,
    VoucherRow,
)

_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
_CONTROL_REFS = re.compile(r"&#(?:0*(?:[0-8]|1[124-9]|2[0-9]|3[01]));")
_BARE_AMP = re.compile(r"&(?!#[0-9]+;|#x[0-9a-fA-F]+;|[a-zA-Z][a-zA-Z0-9]*;)")
_QTY = re.compile(r"-?[\d.,]+")


# --------------------------------------------------------------------------
# Decoding
# --------------------------------------------------------------------------


def decode_response(raw: bytes | str) -> str:
    """Turn a raw Tally HTTP body into parseable XML text.

    Raises ``TallyResponseError`` when the body is empty or is obviously not a
    Tally envelope (an HTML error page, typically from a proxy or a wrong port).
    """
    if isinstance(raw, bytes):
        text = _decode_bytes(raw)
    else:
        text = raw
    text = text.lstrip("﻿").strip()
    if not text:
        raise TallyResponseError("Tally returned an empty response body")
    lowered = text[:200].lower()
    if lowered.startswith("<html") or "<!doctype html" in lowered:
        raise TallyResponseError(
            "Tally returned an HTML page, not XML — check the host/port and that "
            "the XML/HTTP server is enabled"
        )
    text = _CONTROL_REFS.sub("", text)
    text = _CONTROL_CHARS.sub("", text)
    text = _BARE_AMP.sub("&amp;", text)
    return text


def _decode_bytes(raw: bytes) -> str:
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        return raw.decode("utf-16", errors="replace")
    head = raw[:120].decode("ascii", errors="ignore").lower()
    if "utf-16" in head:
        try:
            return raw.decode("utf-16", errors="strict")
        except UnicodeDecodeError:
            pass
    return raw.decode("utf-8", errors="replace")


def parse_xml(text: str) -> Element:
    """Parse decoded XML and raise on a ``STATUS`` 0 envelope."""
    try:
        root = safe_fromstring(text)
    except Exception as exc:  # noqa: BLE001 - any parse failure is the same to us
        raise TallyResponseError(f"Could not parse Tally XML: {exc}") from exc
    _raise_for_status(root)
    _raise_for_plain_text_error(root)
    return root


def _raise_for_status(root: Element) -> None:
    status = root.findtext("HEADER/STATUS")
    if status is not None and status.strip() == "0":
        code = root.findtext(".//STATUS.LIST/STATUS/CODE") or "UNKNOWN"
        desc = root.findtext(".//STATUS.LIST/STATUS/DESC") or "Tally reported a failure"
        raise TallyResponseError(f"Tally error {code}: {desc}", details={"code": code})


def _raise_for_plain_text_error(root: Element) -> None:
    if root.tag == "ENVELOPE":
        return
    text = (root.text or "").strip()
    if not text:
        return
    if list(root):
        return
    raise TallyResponseError(f"Tally returned a plain-text error: {text}")


def _root(source: str | Element) -> Element:
    if isinstance(source, Element):
        return source
    return parse_xml(decode_response(source))


# --------------------------------------------------------------------------
# Field helpers
# --------------------------------------------------------------------------


def to_decimal(value: str | None, default: Decimal | None = None) -> Decimal | None:
    """Tally money/number text → Decimal (handles ``1,234.00`` and blanks)."""
    if value is None:
        return default
    cleaned = value.replace(",", "").strip()
    if not cleaned:
        return default
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        return default


def to_date(value: str | None) -> date | None:
    """``YYYYMMDD`` (or ``DD-MM-YYYY``) → date."""
    if not value:
        return None
    cleaned = value.strip()
    for fmt in ("%Y%m%d", "%d-%m-%Y", "%d-%b-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(cleaned, fmt).date()
        except ValueError:
            continue
    return None


def to_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"yes", "true", "1"}


def _quantity(value: str | None) -> Decimal | None:
    """``50 Box`` / ``450/Box`` → Decimal('50') / Decimal('450')."""
    if not value:
        return None
    match = _QTY.search(value)
    return to_decimal(match.group()) if match else None


def _name_of(node: Element) -> str:
    return (node.findtext("NAME") or node.get("NAME") or "").strip()


def _int_or_none(value: str | None) -> int | None:
    try:
        return int((value or "").strip())
    except ValueError:
        return None


# --------------------------------------------------------------------------
# Parsers
# --------------------------------------------------------------------------


def _iter(root: Element, *tags: str):
    for tag in tags:
        yield from root.iter(tag)


def parse_companies(source: str | Element) -> list[Company]:
    """Companies open in Tally (``COMPANY`` or ``REMOTECOMPANY`` elements)."""
    root = _root(source)
    return [
        Company(
            name=_name_of(node),
            guid=(node.findtext("GUID") or None),
            starting_from=to_date(node.findtext("STARTINGFROM")),
            books_from=to_date(node.findtext("BOOKSFROM")),
        )
        for node in _iter(root, "COMPANY", "REMOTECOMPANY")
        if _name_of(node)
    ]


def _base_fields(node: Element) -> dict:
    return {
        "name": _name_of(node),
        "parent": (node.findtext("PARENT") or "").strip(),
        "guid": node.findtext("GUID") or None,
        "master_id": (node.findtext("MASTERID") or "").strip() or None,
        "alter_id": _int_or_none(node.findtext("ALTERID")),
    }


def parse_ledgers(source: str | Element) -> list[LedgerRow]:
    rows: list[LedgerRow] = []
    for node in _iter(_root(source), "LEDGER"):
        if not _name_of(node):
            continue
        base = _base_fields(node)
        rows.append(
            LedgerRow(
                **base,
                parent_group=base["parent"],
                opening_balance=to_decimal(node.findtext("OPENINGBALANCE")),
                closing_balance=to_decimal(node.findtext("CLOSINGBALANCE")),
                gstin=(node.findtext("PARTYGSTIN") or node.findtext("GSTIN") or None),
                mailing_name=node.findtext("MAILINGNAME") or None,
                address=_joined_address(node),
                state=node.findtext("LEDSTATENAME") or node.findtext("STATENAME") or None,
                gst_registration_type=node.findtext("GSTREGISTRATIONTYPE") or None,
                is_bill_wise=to_bool(node.findtext("ISBILLWISEON")),
            )
        )
    return rows


def _joined_address(node: Element) -> str | None:
    lines = [a.text.strip() for a in node.iter("ADDRESS") if a.text and a.text.strip()]
    return ", ".join(lines) or None


def parse_groups(source: str | Element) -> list[GroupRow]:
    rows: list[GroupRow] = []
    for node in _iter(_root(source), "GROUP"):
        if not _name_of(node):
            continue
        rows.append(
            GroupRow(
                **_base_fields(node),
                primary_group=(node.findtext("PRIMARYGROUP") or "").strip(),
                is_revenue=to_bool(node.findtext("ISREVENUE")),
                is_deemed_positive=to_bool(node.findtext("ISDEEMEDPOSITIVE")),
                affects_gross_profit=to_bool(node.findtext("AFFECTSGROSSPROFIT")),
            )
        )
    return rows


def parse_stock_items(source: str | Element) -> list[StockItemRow]:
    rows: list[StockItemRow] = []
    for node in _iter(_root(source), "STOCKITEM"):
        if not _name_of(node):
            continue
        rows.append(
            StockItemRow(
                **_base_fields(node),
                unit=(node.findtext("BASEUNITS") or "").strip(),
                hsn=node.findtext("HSNCODE") or node.findtext("HSN") or None,
                gst_rate=to_decimal(node.findtext("GSTRATE")),
                closing_qty=_quantity(node.findtext("CLOSINGBALANCE")),
                closing_value=to_decimal(node.findtext("CLOSINGVALUE")),
            )
        )
    return rows


def parse_named(source: str | Element, tag: str) -> list[MasterRow]:
    """Simple ``name``/``parent`` lookups: cost centres, godowns, voucher types."""
    return [
        MasterRow(**_base_fields(node)) for node in _iter(_root(source), tag) if _name_of(node)
    ]


def parse_vouchers(source: str | Element) -> list[VoucherRow]:
    """Vouchers from a Day Book / Voucher Register export."""
    rows: list[VoucherRow] = []
    for node in _iter(_root(source), "VOUCHER"):
        ledger_entries = [
            VoucherLedgerEntry(
                ledger_name=(e.findtext("LEDGERNAME") or "").strip(),
                amount=to_decimal(e.findtext("AMOUNT"), Decimal("0")) or Decimal("0"),
                is_deemed_positive=to_bool(e.findtext("ISDEEMEDPOSITIVE")),
                cost_centre=e.findtext("COSTCENTREALLOCATIONS.LIST/NAME"),
            )
            for e in node.findall("ALLLEDGERENTRIES.LIST") + node.findall("LEDGERENTRIES.LIST")
            if (e.findtext("LEDGERNAME") or "").strip()
        ]
        inventory_entries = [
            VoucherInventoryEntry(
                stock_item=(e.findtext("STOCKITEMNAME") or "").strip(),
                quantity=_quantity(e.findtext("BILLEDQTY") or e.findtext("ACTUALQTY")),
                rate=_quantity(e.findtext("RATE")),
                amount=to_decimal(e.findtext("AMOUNT")),
                godown=e.findtext("GODOWNNAME")
                or e.findtext("BATCHALLOCATIONS.LIST/GODOWNNAME"),
                hsn=e.findtext("HSNCODE"),
            )
            for e in node.findall("ALLINVENTORYENTRIES.LIST")
            + node.findall("INVENTORYENTRIES.LIST")
            if (e.findtext("STOCKITEMNAME") or "").strip()
        ]
        party = (node.findtext("PARTYLEDGERNAME") or node.findtext("PARTYNAME") or "").strip()
        rows.append(
            VoucherRow(
                voucher_number=(node.findtext("VOUCHERNUMBER") or "").strip(),
                voucher_type=(
                    node.findtext("VOUCHERTYPENAME") or node.get("VCHTYPE") or ""
                ).strip(),
                date=to_date(node.findtext("DATE")),
                party_ledger=party,
                narration=(node.findtext("NARRATION") or "").strip(),
                reference=(node.findtext("REFERENCE") or "").strip(),
                amount=_voucher_amount(ledger_entries, party),
                guid=node.findtext("GUID") or None,
                master_id=(node.findtext("MASTERID") or "").strip() or None,
                alter_id=_int_or_none(node.findtext("ALTERID")),
                remote_id=node.findtext("REMOTEID") or None,
                is_cancelled=to_bool(node.findtext("ISCANCELLED")),
                ledger_entries=ledger_entries,
                inventory_entries=inventory_entries,
            )
        )
    return rows


def _voucher_amount(entries: list[VoucherLedgerEntry], party: str) -> Decimal:
    """Voucher face value: the party line if there is one, else the debit total."""
    for entry in entries:
        if party and entry.ledger_name == party:
            return abs(entry.amount)
    debits = sum((abs(e.amount) for e in entries if e.amount < 0), Decimal("0"))
    return debits


BILL_TAGS = ("BILLS", "BILLFIXED", "BILL")


def parse_bills(source: str | Element, direction: str) -> list[BillRow]:
    """Open bill references from a Bills Payable / Bills Receivable export.

    ``direction`` is ``payable`` or ``receivable``; Tally does not label the rows
    so the caller must say which report it asked for.
    """
    rows: list[BillRow] = []
    for node in _iter(_root(source), *BILL_TAGS):
        name = _name_of(node) or (node.findtext("BILLREF") or "").strip()
        if not name:
            continue
        opening = to_decimal(node.findtext("OPENINGBALANCE"), Decimal("0")) or Decimal("0")
        pending = to_decimal(node.findtext("CLOSINGBALANCE"), opening) or Decimal("0")
        rows.append(
            BillRow(
                party_ledger=(
                    node.findtext("PARTYLEDGERNAME") or node.findtext("LEDGERNAME") or ""
                ).strip(),
                bill_name=name,
                direction=direction,
                bill_date=to_date(node.findtext("BILLDATE") or node.findtext("DATE")),
                due_date=to_date(
                    node.findtext("BILLDUEDATE") or node.findtext("BILLCREDITPERIOD")
                ),
                opening_amount=abs(opening),
                pending_amount=abs(pending),
            )
        )
    return rows


#: Elements a Stock Summary export may use for the grand total. Which one (if
#: any) TallyPrime emits is unverified — see the middleware README's open
#: questions — so the parser prefers a total when it finds one and otherwise
#: adds the items up itself.
STOCK_TOTAL_TAGS = (
    "TOTALCLOSINGVALUE",
    "GRANDTOTALCLOSINGVALUE",
    "CLOSINGVALUETOTAL",
)


def parse_stock_valuation(source: str | Element) -> Decimal | None:
    """Total closing stock value from a Stock Summary export (plan §3.9).

    Tolerant by design: an explicit total element wins; otherwise the
    ``CLOSINGVALUE`` of each top-level ``STOCKITEM`` is summed (nested
    sub-items are skipped, because Tally already rolls them into their
    parent); failing that, any bare ``CLOSINGVALUE`` elements are summed.
    Returns ``None`` when the report carries no value at all.
    """
    root = _root(source)
    for tag in STOCK_TOTAL_TAGS:
        node = next(root.iter(tag), None)
        if node is not None:
            value = to_decimal(node.text)
            if value is not None:
                return value

    items = _top_level_stock_items(root)
    if items:
        values = [to_decimal(node.findtext("CLOSINGVALUE")) for node in items]
        present = [v for v in values if v is not None]
        if present:
            return sum(present, Decimal("0"))

    bare = [to_decimal(node.text) for node in root.iter("CLOSINGVALUE")]
    present = [v for v in bare if v is not None]
    return sum(present, Decimal("0")) if present else None


def _top_level_stock_items(root: Element) -> list[Element]:
    """``STOCKITEM`` elements that are not nested inside another ``STOCKITEM``."""
    nested = {
        id(child) for node in root.iter("STOCKITEM") for child in node.iter("STOCKITEM")
        if child is not node
    }
    return [node for node in root.iter("STOCKITEM") if id(node) not in nested]


def parse_import_result(source: str | Element) -> ImportResult:
    """Parse ``<IMPORTRESULT>`` from an Import Data response."""
    root = _root(source)
    node = next(root.iter("IMPORTRESULT"), None)
    if node is None:
        raise TallyResponseError("Tally response contained no IMPORTRESULT block")

    def count(tag: str) -> int:
        return _int_or_none(node.findtext(tag)) or 0

    line_errors: list[str] = []
    for err in node.iter("LINEERROR"):
        desc = err.findtext("DESC")
        line = err.findtext("LINE")
        text = (desc or err.text or "").strip()
        if not text:
            continue
        line_errors.append(f"Line {line}: {text}" if line else text)
    return ImportResult(
        created=count("CREATED"),
        altered=count("ALTERED"),
        deleted=count("DELETED"),
        combined=count("COMBINED"),
        ignored=count("IGNORED"),
        errors=count("ERRORS"),
        last_voucher_id=(node.findtext("LASTVCHID") or "").strip() or None,
        line_errors=line_errors,
    )


__all__ = [
    "BillRow",
    "Company",
    "GroupRow",
    "ImportResult",
    "LedgerRow",
    "MasterRow",
    "StockItemRow",
    "VoucherInventoryEntry",
    "VoucherLedgerEntry",
    "VoucherRow",
    "decode_response",
    "parse_bills",
    "parse_companies",
    "parse_groups",
    "parse_import_result",
    "parse_ledgers",
    "parse_named",
    "parse_stock_items",
    "parse_stock_valuation",
    "parse_vouchers",
    "parse_xml",
    "to_bool",
    "to_date",
    "to_decimal",
]
