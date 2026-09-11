"""Tests for the XML request builders (plan §3.1)."""
from __future__ import annotations

import xml.etree.ElementTree as ET
from datetime import date
from decimal import Decimal

import pytest

from talai_middleware.tally import envelopes as env
from talai_middleware.tally.envelopes import (
    BillAllocation,
    InventoryEntry,
    LedgerEntry,
    VoucherImport,
)


def parse(xml: str) -> ET.Element:
    return ET.fromstring(xml)


def text(root: ET.Element, path: str) -> str | None:
    node = root.find(path)
    return None if node is None else node.text


def test_list_companies_envelope() -> None:
    root = parse(env.list_companies())
    assert text(root, "HEADER/VERSION") == "1"
    assert text(root, "HEADER/TALLYREQUEST") == "Export"
    assert text(root, "HEADER/TYPE") == "Collection"
    assert text(root, "HEADER/ID") == "Company"
    fetches = [f.text for f in root.findall("BODY/DESC/FETCHLIST/FETCH")]
    assert "NAME" in fetches


def test_collection_with_fetch_company_and_dates() -> None:
    xml = env.collection(
        "Ledger",
        fetch=["NAME", "PARENT", "CLOSINGBALANCE", "ALTERID"],
        company="Acme Foods Pvt Ltd",
        from_date=date(2026, 4, 1),
        to_date=date(2026, 6, 30),
    )
    root = parse(xml)
    assert text(root, "HEADER/ID") == "Ledger"
    sv = "BODY/DESC/STATICVARIABLES/"
    assert text(root, sv + "SVCURRENTCOMPANY") == "Acme Foods Pvt Ltd"
    assert text(root, sv + "SVFROMDATE") == "20260401"
    assert text(root, sv + "SVTODATE") == "20260630"
    assert text(root, sv + "SVEXPORTFORMAT") == "$$SysName:XML"
    assert [f.text for f in root.findall("BODY/DESC/FETCHLIST/FETCH")] == [
        "NAME",
        "PARENT",
        "CLOSINGBALANCE",
        "ALTERID",
    ]


def test_group_collection_uses_fetchlist_respecting_name() -> None:
    root = parse(env.collection("Group", fetch=["NAME", "PARENT"]))
    assert text(root, "HEADER/ID") == "List of Groups"
    assert [f.text for f in root.findall("BODY/DESC/FETCHLIST/FETCH")] == ["NAME", "PARENT"]


def test_collection_with_filters_builds_tdl_collection() -> None:
    xml = env.collection(
        "Ledger", fetch=["NAME"], filters=[("TalaiAlterId", "$AlterID > 42")]
    )
    root = parse(xml)
    # Header must point at the derived collection, not the base one.
    assert text(root, "HEADER/ID") == "TalaiLedger"
    coll = root.find("BODY/DESC/TDL/TDLMESSAGE/COLLECTION")
    assert coll is not None and coll.get("NAME") == "TalaiLedger"
    assert coll.findtext("TYPE") == "Ledger"
    assert coll.findtext("FILTER") == "TalaiAlterId"
    system = root.find("BODY/DESC/TDL/TDLMESSAGE/SYSTEM")
    assert system is not None
    assert system.get("TYPE") == "Formulae"
    assert system.get("NAME") == "TalaiAlterId"
    assert system.text == "$AlterID > 42"


def test_bounded_voucher_collection_uses_date_filter_and_nested_fetches() -> None:
    root = parse(
        env.voucher_collection(
            date(2026, 6, 1), date(2026, 6, 30), company="Acme Foods Pvt Ltd"
        )
    )
    assert text(root, "HEADER/TALLYREQUEST") == "Export"
    assert text(root, "HEADER/TYPE") == "Collection"
    assert text(root, "HEADER/ID") == "TalaiVoucher"
    assert text(root, "BODY/DESC/TDL/TDLMESSAGE/COLLECTION/TYPE") == "Voucher"
    sv = "BODY/DESC/STATICVARIABLES/"
    assert text(root, sv + "SVFROMDATE") == "20260601"
    assert text(root, sv + "SVTODATE") == "20260630"
    fetches = [f.text for f in root.findall("BODY/DESC/FETCHLIST/FETCH")]
    assert {"DATE", "VOUCHERNUMBER", "VOUCHERTYPENAME", "PARTYLEDGERNAME"} <= set(fetches)
    assert {"ALLLEDGERENTRIES.LIST", "LEDGERENTRIES.LIST"} <= set(fetches)
    assert {"ALLINVENTORYENTRIES.LIST", "INVENTORYENTRIES.LIST"} <= set(fetches)
    system = root.find("BODY/DESC/TDL/TDLMESSAGE/SYSTEM[@NAME='TalaiVoucherDate']")
    assert system is not None
    assert system.text == "$Date >= ##SVFromDate AND $Date <= ##SVToDate"


def test_bounded_voucher_collection_rejects_reversed_range() -> None:
    with pytest.raises(ValueError, match="from_date must be on or before to_date"):
        env.voucher_collection(date(2026, 7, 1), date(2026, 6, 30))


def test_report_envelope() -> None:
    root = parse(env.report("Bills Payable", company="Acme", to_date=date(2026, 6, 30)))
    assert text(root, "HEADER/TYPE") == "Report"
    assert text(root, "HEADER/ID") == "Bills Payable"
    assert text(root, "BODY/DESC/STATICVARIABLES/SVTODATE") == "20260630"


def test_escapes_ampersand_in_company_name() -> None:
    xml = env.collection("Ledger", company="A & B Enterprises")
    assert "&amp;" in xml
    assert parse(xml).findtext("BODY/DESC/STATICVARIABLES/SVCURRENTCOMPANY") == (
        "A & B Enterprises"
    )


def sample_voucher() -> VoucherImport:
    return VoucherImport(
        remote_id="e2f0a5f2-0000-4000-8000-000000000001",
        voucher_type="Purchase",
        voucher_date=date(2026, 6, 10),
        party_ledger="BioShield Medical",
        purchase_ledger="Purchase",
        narration="Surgical consumables",
        reference="INV/BSM/4471",
        ledger_entries=[
            LedgerEntry(
                ledger_name="BioShield Medical",
                amount=Decimal("25875.00"),
                is_debit=False,
                bill_allocations=[
                    BillAllocation(
                        name="INV/BSM/4471",
                        bill_type="New Ref",
                        amount=Decimal("25875.00"),
                        due_date=date(2026, 6, 9),
                    )
                ],
            ),
            LedgerEntry(
                ledger_name="Purchase",
                amount=Decimal("21825.00"),
                is_debit=True,
                cost_centre="Procurement",
            ),
            LedgerEntry(
                ledger_name="IGST @ 18%",
                amount=Decimal("4050.00"),
                is_debit=True,
                cost_centre="Procurement",
            ),
        ],
        inventory_entries=[
            InventoryEntry(
                stock_item="Nitrile Gloves",
                quantity=Decimal("50"),
                rate=Decimal("450"),
                amount=Decimal("21825.00"),
                godown="Main Store",
                hsn="4015",
            )
        ],
    )


def test_import_voucher_uses_importdata_wrapper() -> None:
    """The Postman collection's IMPORTDATA/REQUESTDESC/REQUESTDATA shape."""
    root = parse(env.import_voucher(sample_voucher(), company="Acme Foods Pvt Ltd"))
    assert text(root, "HEADER/TALLYREQUEST") == "Import Data"
    assert text(root, "BODY/IMPORTDATA/REQUESTDESC/REPORTNAME") == "Vouchers"
    assert (
        text(root, "BODY/IMPORTDATA/REQUESTDESC/STATICVARIABLES/SVCURRENTCOMPANY")
        == "Acme Foods Pvt Ltd"
    )
    assert root.find("BODY/IMPORTDATA/REQUESTDATA/TALLYMESSAGE/VOUCHER") is not None


def test_import_voucher_shape_and_signs() -> None:
    root = parse(env.import_voucher(sample_voucher()))
    voucher = root.find("BODY/IMPORTDATA/REQUESTDATA/TALLYMESSAGE/VOUCHER")
    assert voucher is not None
    assert voucher.get("ACTION") == "Create"
    assert voucher.get("VCHTYPE") == "Purchase"
    assert voucher.get("OBJVIEW") == "Invoice Voucher View"
    assert voucher.findtext("ISINVOICE") == "Yes"
    assert voucher.findtext("DATE") == "20260610"
    assert voucher.findtext("EFFECTIVEDATE") == "20260610"
    assert voucher.findtext("REMOTEID") == "e2f0a5f2-0000-4000-8000-000000000001"
    assert voucher.findtext("PARTYLEDGERNAME") == "BioShield Medical"
    assert voucher.findtext("NARRATION") == "Surgical consumables"
    assert voucher.findtext("REFERENCE") == "INV/BSM/4471"
    assert voucher.findtext("VOUCHERNUMBER") is None  # Tally auto-numbers

    entries = voucher.findall("ALLLEDGERENTRIES.LIST")
    # The purchase ledger moves into ACCOUNTINGALLOCATIONS under the item line,
    # so only the party and the tax line remain as accounting entries.
    assert [e.findtext("LEDGERNAME") for e in entries] == [
        "BioShield Medical",
        "IGST @ 18%",
    ]
    party, tax = entries
    # Credit: ISDEEMEDPOSITIVE No, positive amount.
    assert party.findtext("ISDEEMEDPOSITIVE") == "No"
    assert party.findtext("AMOUNT") == "25875.00"
    # Debit: ISDEEMEDPOSITIVE Yes, negative amount.
    assert tax.findtext("ISDEEMEDPOSITIVE") == "Yes"
    assert tax.findtext("AMOUNT") == "-4050.00"

    bill = party.find("BILLALLOCATIONS.LIST")
    assert bill is not None
    assert bill.findtext("NAME") == "INV/BSM/4471"
    assert bill.findtext("BILLTYPE") == "New Ref"
    assert bill.findtext("AMOUNT") == "25875.00"
    assert bill.findtext("BILLCREDITPERIOD") == "20260609"

    cc = tax.find("COSTCENTREALLOCATIONS.LIST")
    assert cc is not None
    assert cc.findtext("NAME") == "Procurement"
    assert cc.findtext("AMOUNT") == "-4050.00"


def test_import_voucher_item_lines_use_allinventoryentries() -> None:
    voucher = parse(env.import_voucher(sample_voucher())).find(
        "BODY/IMPORTDATA/REQUESTDATA/TALLYMESSAGE/VOUCHER"
    )
    assert voucher is not None
    assert voucher.find("INVENTORYENTRIES.LIST") is None
    inv = voucher.find("ALLINVENTORYENTRIES.LIST")
    assert inv is not None
    assert inv.findtext("STOCKITEMNAME") == "Nitrile Gloves"
    assert inv.findtext("ISDEEMEDPOSITIVE") == "Yes"
    assert inv.findtext("ACTUALQTY") == "50 "
    assert inv.findtext("BILLEDQTY") == "50 "
    assert inv.findtext("RATE") == "450/"
    assert inv.findtext("AMOUNT") == "-21825.00"
    assert inv.findtext("GODOWNNAME") == "Main Store"
    assert inv.findtext("HSNCODE") == "4015"
    alloc = inv.find("ACCOUNTINGALLOCATIONS.LIST")
    assert alloc is not None
    assert alloc.findtext("LEDGERNAME") == "Purchase"
    assert alloc.findtext("ISDEEMEDPOSITIVE") == "Yes"
    assert alloc.findtext("AMOUNT") == "-21825.00"


def test_import_voucher_without_inventory_keeps_all_ledger_entries() -> None:
    v = sample_voucher()
    v.inventory_entries = []
    voucher = parse(env.import_voucher(v)).find(
        "BODY/IMPORTDATA/REQUESTDATA/TALLYMESSAGE/VOUCHER"
    )
    assert voucher is not None
    assert voucher.get("OBJVIEW") == "Accounting Voucher View"
    assert voucher.findtext("ISINVOICE") is None
    assert [e.findtext("LEDGERNAME") for e in voucher.findall("ALLLEDGERENTRIES.LIST")] == [
        "BioShield Medical",
        "Purchase",
        "IGST @ 18%",
    ]


def test_import_voucher_never_alters_or_deletes() -> None:
    xml = env.import_voucher(sample_voucher())
    assert 'ACTION="Alter"' not in xml
    assert 'ACTION="Delete"' not in xml


def test_import_voucher_rejects_unbalanced_payload() -> None:
    v = sample_voucher()
    v.ledger_entries[1].amount = Decimal("21000.00")
    with pytest.raises(ValueError, match="do not balance"):
        env.import_voucher(v)


def test_import_ledger_envelope() -> None:
    xml = env.import_ledger(
        name="New Supplier", parent="Sundry Creditors", gstin="27AAAAA0000A1Z5"
    )
    root = parse(xml)
    assert text(root, "BODY/IMPORTDATA/REQUESTDESC/REPORTNAME") == "All Masters"
    ledger = root.find("BODY/IMPORTDATA/REQUESTDATA/TALLYMESSAGE/LEDGER")
    assert ledger is not None
    assert ledger.get("ACTION") == "Create"
    assert ledger.get("NAME") == "New Supplier"
    assert ledger.findtext("PARENT") == "Sundry Creditors"
    assert ledger.findtext("PARTYGSTIN") == "27AAAAA0000A1Z5"


# --------------------------------------------------------------------------
# Vendor ledger creation (plan §3.8)
# --------------------------------------------------------------------------


def test_import_ledger_golden_envelope() -> None:
    xml = env.import_ledger(
        name="Bright Steel Traders",
        parent="Sundry Creditors",
        gstin="27AAAAA0000A1Z5",
        gst_registration_type="Regular",
        mailing_name="Bright Steel Traders",
        address=["12 MIDC Road", "Andheri East"],
        state="Maharashtra",
        is_bill_wise=True,
        remote_id="draft-1-party",
        company="Acme Foods Pvt Ltd",
    )
    root = parse(xml)
    assert text(root, "HEADER/TALLYREQUEST") == "Import Data"
    desc = "BODY/IMPORTDATA/REQUESTDESC/"
    assert text(root, desc + "REPORTNAME") == "All Masters"
    assert text(root, desc + "STATICVARIABLES/SVCURRENTCOMPANY") == "Acme Foods Pvt Ltd"

    ledger = root.find("BODY/IMPORTDATA/REQUESTDATA/TALLYMESSAGE/LEDGER")
    assert ledger is not None
    assert ledger.get("ACTION") == "Create"
    assert ledger.get("NAME") == "Bright Steel Traders"
    assert ledger.findtext("NAME") == "Bright Steel Traders"
    assert ledger.findtext("PARENT") == "Sundry Creditors"
    assert ledger.findtext("ISBILLWISEON") == "Yes"
    assert ledger.findtext("GSTIN") == "27AAAAA0000A1Z5"
    assert ledger.findtext("PARTYGSTIN") == "27AAAAA0000A1Z5"
    assert ledger.findtext("GSTREGISTRATIONTYPE") == "Regular"
    assert ledger.findtext("LEDSTATENAME") == "Maharashtra"
    assert ledger.findtext("MAILINGNAME") == "Bright Steel Traders"
    assert ledger.findtext("REMOTEID") == "draft-1-party"
    assert [a.text for a in ledger.findall("ADDRESS.LIST/ADDRESS")] == [
        "12 MIDC Road",
        "Andheri East",
    ]
    assert 'ACTION="Alter"' not in xml and 'ACTION="Delete"' not in xml


def test_import_ledger_omits_optional_fields() -> None:
    root = parse(env.import_ledger(name="Plain Vendor", parent="Sundry Creditors"))
    ledger = root.find("BODY/IMPORTDATA/REQUESTDATA/TALLYMESSAGE/LEDGER")
    assert ledger.findtext("GSTIN") is None
    assert ledger.findtext("GSTREGISTRATIONTYPE") is None
    assert ledger.findtext("LEDSTATENAME") is None
    assert ledger.findtext("REMOTEID") is None
    assert ledger.find("ADDRESS.LIST") is None


def test_import_ledger_escapes_ampersands_in_the_name() -> None:
    xml = env.import_ledger(name="Smith & Co", parent="Sundry Creditors")
    assert "Smith &amp; Co" in xml
    root = parse(xml)
    ledger = root.find("BODY/IMPORTDATA/REQUESTDATA/TALLYMESSAGE/LEDGER")
    assert ledger.get("NAME") == "Smith & Co"


# --------------------------------------------------------------------------
# Stock Summary, for the trading gross-profit formula (plan §3.9)
# --------------------------------------------------------------------------


def test_stock_summary_report_pins_both_dates_to_as_on() -> None:
    root = parse(
        env.stock_summary_report(date(2026, 4, 1), company="Acme Foods Pvt Ltd")
    )
    assert text(root, "HEADER/TALLYREQUEST") == "Export"
    assert text(root, "HEADER/TYPE") == "Report"
    assert text(root, "HEADER/ID") == "Stock Summary"
    sv = "BODY/DESC/STATICVARIABLES/"
    assert text(root, sv + "SVFROMDATE") == "20260401"
    assert text(root, sv + "SVTODATE") == "20260401"
    assert text(root, sv + "SVCURRENTCOMPANY") == "Acme Foods Pvt Ltd"
