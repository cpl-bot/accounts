"""OCR service edge cases: skipping, bad stored results, odd numbers (§3.10)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from talai_middleware.db import models, repo
from talai_middleware.db.base import Database
from talai_middleware.ocr.mock import MockOcrProvider
from talai_middleware.ocr.provider import OcrError
from talai_middleware.ocr.schema import OcrFields, OcrLineItem, OcrResult
from talai_middleware.services import ocr_service


@pytest.fixture
def session(settings):
    db = Database(settings.database_url)
    db.create_all()
    with db.session() as s:
        repo.upsert_group(s, name="Sundry Creditors", parent="Current Liabilities")
        repo.upsert_group(s, name="Duties & Taxes", parent="Current Liabilities")
        repo.upsert_group(s, name="Purchase Accounts", parent="")
        repo.upsert_ledger(s, name="BioShield Medical & Co", parent_group="Sundry Creditors")
        repo.upsert_ledger(s, name="CGST @ 9%", parent_group="Duties & Taxes")
        repo.upsert_ledger(s, name="SGST @ 9%", parent_group="Duties & Taxes")
        repo.upsert_ledger(s, name="Purchase", parent_group="Purchase Accounts")
        repo.upsert_stock_item(s, name="Nitrile Gloves", unit="Box")
        s.commit()
        yield s


def attachment(session, tmp_path, data: bytes = b"", name: str = "bill.png") -> models.Attachment:
    path = tmp_path / name
    path.write_bytes(data or b"\x89PNG\r\n\x1a\n")
    row = models.Attachment(
        file_name=name, mime="image/png", path=str(path), size_bytes=path.stat().st_size
    )
    session.add(row)
    session.flush()
    return row


class TestRunOcr:
    def test_no_provider_means_skipped(self, session, settings, tmp_path) -> None:
        row = ocr_service.run_ocr(session, settings, attachment(session, tmp_path))
        assert row.ocr_status == "skipped"
        assert row.ocr_model is None and row.ocr_error is None

    def test_a_missing_file_is_recorded_as_a_failure(self, session, settings, tmp_path) -> None:
        row = attachment(session, tmp_path)
        row.path = str(tmp_path / "gone.png")
        ocr_service.run_ocr(
            session, settings.model_copy(update={"ocr_provider": "mock"}), row
        )
        assert row.ocr_status == "failed"
        assert row.ocr_error
        assert row.ocr_duration_ms is not None
        assert row.ocr_model == "mock"

    def test_a_provider_can_be_injected(self, session, settings, tmp_path) -> None:
        row = ocr_service.run_ocr(
            session, settings, attachment(session, tmp_path), provider=MockOcrProvider()
        )
        assert row.ocr_status == "done"
        assert ocr_service.ocr_result_of(row).fields.invoice_number == "INV/BSM/4471"


class TestStoredResult:
    def test_no_result_is_none(self, session, tmp_path) -> None:
        assert ocr_service.ocr_result_of(attachment(session, tmp_path)) is None

    def test_an_unreadable_result_is_none(self, session, tmp_path) -> None:
        row = attachment(session, tmp_path)
        row.ocr_result_json = "{not json"
        assert ocr_service.ocr_result_of(row) is None

    def test_a_draft_cannot_be_built_without_one(self, session, settings, tmp_path) -> None:
        with pytest.raises(OcrError) as exc:
            ocr_service.create_draft_from_attachment(
                session, settings, attachment(session, tmp_path)
            )
        assert exc.value.code == "OCR_NOT_AVAILABLE"


class TestNumberAndDateCoercion:
    @pytest.mark.parametrize(
        ("value", "expected"),
        [(None, "0.00"), (1234, "1234.00"), (12.345, "12.35" ), ("nonsense", "0.00")],
    )
    def test_money(self, value, expected) -> None:
        assert ocr_service._money(value) == Decimal(expected)

    def test_iso_date(self) -> None:
        assert ocr_service._iso_date("2026-06-10") == date(2026, 6, 10)
        assert ocr_service._iso_date("10/06/2026") is None
        assert ocr_service._iso_date(None) is None


class TestDraftPrefill:
    def result(self, **fields) -> OcrResult:
        return OcrResult(fields=OcrFields(**fields))

    def test_a_known_stock_item_is_matched_case_insensitively(self, session) -> None:
        payload = ocr_service.draft_payload_from_ocr(
            session,
            self.result(line_items=[OcrLineItem(description="nitrile gloves", quantity=2,
                                                rate=100, amount=200)]),
        )
        assert payload.items[0].stock_item == "Nitrile Gloves"

    def test_a_missing_rate_is_derived_from_the_amount(self, session) -> None:
        payload = ocr_service.draft_payload_from_ocr(
            session, self.result(line_items=[OcrLineItem(description="X", quantity=4, amount=100)])
        )
        assert payload.items[0].rate == Decimal("25.00")

    def test_cgst_and_sgst_ledgers_are_guessed_from_the_replica(self, session) -> None:
        payload = ocr_service.draft_payload_from_ocr(
            session, self.result(taxable_value=1000, cgst=90, sgst=90, grand_total=1180)
        )
        assert [line.ledger_name for line in payload.tax_lines] == ["CGST @ 9%", "SGST @ 9%"]

    def test_an_unmatched_tax_ledger_is_left_empty(self, session) -> None:
        payload = ocr_service.draft_payload_from_ocr(
            session, self.result(taxable_value=1000, igst=180, grand_total=1180)
        )
        assert payload.tax_lines[0].ledger_name == ""

    def test_totals_are_derived_when_the_bill_did_not_give_them(self, session) -> None:
        payload = ocr_service.draft_payload_from_ocr(
            session,
            self.result(line_items=[OcrLineItem(description="X", quantity=2, rate=50, amount=100)]),
        )
        assert payload.totals.taxable_value == Decimal("100.00")
        assert payload.totals.grand_total == Decimal("100.00")

    def test_the_voucher_date_defaults_to_today(self, session) -> None:
        payload = ocr_service.draft_payload_from_ocr(session, self.result())
        assert payload.voucher_date == date.today()
        assert payload.bill_date is None

    def test_the_purchase_ledger_falls_back_to_any_purchase_account(self, session) -> None:
        repo.ledger_by_name(session, "Purchase").is_deleted = True
        repo.upsert_ledger(session, name="Purchase - Local", parent_group="Purchase Accounts")
        session.commit()
        payload = ocr_service.draft_payload_from_ocr(session, self.result())
        assert payload.purchase_ledger == "Purchase - Local"

    def test_no_purchase_account_at_all_leaves_it_blank(self, settings) -> None:
        db = Database(settings.database_url)
        db.create_all()
        with db.session() as empty:
            payload = ocr_service.draft_payload_from_ocr(empty, self.result())
            assert payload.purchase_ledger == ""
            assert ocr_service.guess_tax_ledger(empty, "IGST") == ""
