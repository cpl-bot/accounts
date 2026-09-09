"""Tests for the tolerant Tally XML decoders/parsers (plan §3.1)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from talai_middleware.tally import parsers as P
from talai_middleware.tally.errors import TallyResponseError


class TestDecode:
    def test_plain_utf8(self) -> None:
        assert P.decode_response(b"<ENVELOPE><A>hi</A></ENVELOPE>").startswith("<ENVELOPE>")

    def test_utf16_declaration_and_bom(self) -> None:
        raw = '<?xml version="1.0" encoding="UTF-16"?><ENVELOPE><A>₹</A></ENVELOPE>'
        assert "₹" in P.decode_response(raw.encode("utf-16"))

    def test_strips_control_characters(self) -> None:
        out = P.decode_response("<ENVELOPE><A>a&#4;b\x04c</A></ENVELOPE>")
        assert "&#4;" not in out and "\x04" not in out
        assert P.parse_xml(out).findtext("A") == "abc"

    def test_fixes_bare_ampersand(self) -> None:
        out = P.decode_response("<ENVELOPE><A>Smith & Co</A></ENVELOPE>")
        assert P.parse_xml(out).findtext("A") == "Smith & Co"

    def test_keeps_valid_entities(self) -> None:
        out = P.decode_response("<ENVELOPE><A>Smith &amp; Co &#38; Sons</A></ENVELOPE>")
        assert P.parse_xml(out).findtext("A") == "Smith & Co & Sons"

    def test_empty_response_rejected(self) -> None:
        with pytest.raises(TallyResponseError, match="empty"):
            P.decode_response(b"   ")

    def test_html_error_page_rejected(self) -> None:
        with pytest.raises(TallyResponseError, match="HTML"):
            P.decode_response(b"<html><body>404 Not Found</body></html>")

    def test_non_xml_rejected(self) -> None:
        with pytest.raises(TallyResponseError):
            P.parse_xml("not xml at all")


class TestStatus:
    def test_status_zero_raises(self, fixture_xml) -> None:
        with pytest.raises(TallyResponseError) as exc:
            P.parse_xml(P.decode_response(fixture_xml("error_status_zero.xml")))
        assert "Unknown Request" in str(exc.value)


class TestMasters:
    def test_companies(self, fixture_xml) -> None:
        companies = P.parse_companies(fixture_xml("companies.xml"))
        assert [c.name for c in companies] == [
            "Acme Foods Pvt Ltd",
            "Acme Foods Pvt Ltd (Test)",
        ]
        assert companies[0].starting_from == date(2025, 4, 1)
        assert companies[0].guid == "4f9d0e3a-0001-0000-0000-000000000001"
        assert companies[1].guid is None

    def test_ledgers(self, fixture_xml) -> None:
        ledgers = P.parse_ledgers(fixture_xml("ledgers.xml"))
        assert len(ledgers) == 2
        bio = ledgers[0]
        assert bio.name == "BioShield Medical & Co"
        assert bio.parent_group == "Sundry Creditors"
        assert bio.closing_balance == Decimal("-25875.50")
        assert bio.opening_balance == Decimal("-12000.00")
        assert bio.gstin == "27AAAAA0000A1Z5"
        assert bio.state == "Maharashtra"
        assert bio.is_bill_wise is True
        assert bio.alter_id == 908
        assert bio.master_id == "412"
        assert ledgers[1].gstin is None

    def test_groups(self, fixture_xml) -> None:
        groups = P.parse_groups(fixture_xml("groups.xml"))
        assert groups[0].name == "Sundry Creditors"
        assert groups[0].is_revenue is False
        assert groups[1].is_revenue is True
        assert groups[1].affects_gross_profit is True
        assert groups[1].parent == ""

    def test_stock_items(self, fixture_xml) -> None:
        items = P.parse_stock_items(fixture_xml("stock_items.xml"))
        item = items[0]
        assert item.name == "Nitrile Gloves"
        assert item.unit == "Box"
        assert item.hsn == "4015"
        assert item.gst_rate == Decimal("18")
        assert item.closing_qty == Decimal("120")
        assert item.closing_value == Decimal("54000.00")

    def test_simple_names(self, fixture_xml) -> None:
        rows = P.parse_named(fixture_xml("cost_centres.xml"), "COSTCENTRE")
        assert rows[0].name == "Procurement"
        assert rows[0].parent == ""
        assert rows[0].alter_id == 4


class TestVouchers:
    def test_day_book(self, fixture_xml) -> None:
        vouchers = P.parse_vouchers(fixture_xml("vouchers_daybook.xml"))
        assert len(vouchers) == 2
        pur = vouchers[0]
        assert pur.voucher_number == "PUR/26-27/0042"
        assert pur.voucher_type == "Purchase"
        assert pur.date == date(2026, 6, 10)
        assert pur.party_ledger == "BioShield Medical & Co"
        assert pur.narration == "Surgical consumables"
        assert pur.reference == "INV/BSM/4471"
        assert pur.remote_id == "e2f0a5f2-0000-4000-8000-000000000001"
        assert pur.alter_id == 1502
        assert pur.is_cancelled is False
        # Amount is the absolute value of the party (credit) side.
        assert pur.amount == Decimal("25875.00")
        assert len(pur.ledger_entries) == 3
        assert pur.ledger_entries[1].amount == Decimal("-21825.00")
        assert pur.ledger_entries[1].is_deemed_positive is True
        assert pur.ledger_entries[1].cost_centre == "Procurement"
        assert len(pur.inventory_entries) == 1
        inv = pur.inventory_entries[0]
        assert inv.stock_item == "Nitrile Gloves"
        assert inv.quantity == Decimal("50")
        assert inv.rate == Decimal("450")
        assert inv.godown == "Main Store"
        assert inv.hsn == "4015"
        assert vouchers[1].voucher_type == "Sales"
        assert vouchers[1].inventory_entries == []


class TestBills:
    def test_bills_payable(self, fixture_xml) -> None:
        bills = P.parse_bills(fixture_xml("bills_payable.xml"), direction="payable")
        assert len(bills) == 2
        first = bills[0]
        assert first.bill_name == "INV/BSM/4471"
        assert first.party_ledger == "BioShield Medical & Co"
        assert first.bill_date == date(2026, 6, 10)
        assert first.due_date == date(2026, 7, 9)
        assert first.opening_amount == Decimal("25875.00")
        assert first.pending_amount == Decimal("25875.00")
        assert first.direction == "payable"
        assert bills[1].pending_amount == Decimal("4000.00")


class TestImportResult:
    def test_success(self, fixture_xml) -> None:
        result = P.parse_import_result(fixture_xml("import_success.xml"))
        assert result.created == 1
        assert result.errors == 0
        assert result.ok is True
        assert result.last_voucher_id == "1544"
        assert result.line_errors == []

    def test_line_errors(self, fixture_xml) -> None:
        result = P.parse_import_result(fixture_xml("import_line_error.xml"))
        assert result.created == 0
        assert result.errors == 2
        assert result.ok is False
        assert "Could not find Ledger 'Ghost Supplier'" in result.line_errors[0]
        assert "do not tally" in result.line_errors[1]

    def test_missing_importresult_is_an_error(self) -> None:
        with pytest.raises(TallyResponseError, match="IMPORTRESULT"):
            P.parse_import_result("<ENVELOPE><BODY><DATA/></BODY></ENVELOPE>")
