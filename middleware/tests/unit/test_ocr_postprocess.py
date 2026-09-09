"""Deterministic OCR post-processing (plan §3.10)."""
from __future__ import annotations

import pytest

import talai_middleware.ocr.postprocess as pp
from talai_middleware.db import repo
from talai_middleware.db.base import Database
from talai_middleware.ocr.schema import OcrFields, OcrResult


@pytest.fixture
def session(settings):
    db = Database(settings.database_url)
    db.create_all()
    with db.session() as s:
        repo.upsert_group(s, name="Sundry Creditors", parent="Current Liabilities")
        repo.upsert_ledger(s, name="BioShield Medical & Co", parent_group="Sundry Creditors")
        s.commit()
        yield s


def result(**fields) -> OcrResult:
    confidence = fields.pop("confidence", {})
    return OcrResult(fields=OcrFields(**fields), confidence=dict(confidence))


class TestNormaliseDate:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("10/06/2026", "2026-06-10"),
            ("10-06-2026", "2026-06-10"),
            ("10.06.2026", "2026-06-10"),
            ("10-06-26", "2026-06-10"),
            ("01/12/2025", "2025-12-01"),
            ("09 Jul 2026", "2026-07-09"),
            ("9 July 2026", "2026-07-09"),
            ("09-Jul-2026", "2026-07-09"),
            ("2026-06-10", "2026-06-10"),
            ("  10 Jun 2026 ", "2026-06-10"),
            ("Jun 10 2026", "2026-06-10"),
            ("not a date", None),
            ("", None),
            (None, None),
            ("31/02/2026", None),
        ],
    )
    def test_formats(self, raw, expected) -> None:
        assert pp.normalise_date(raw) == expected

    def test_day_comes_first(self) -> None:
        """05/06/2026 is 5 June, never 6 May."""
        assert pp.normalise_date("05/06/2026") == "2026-06-05"


class TestGstin:
    @pytest.mark.parametrize(
        ("gstin", "valid"),
        [
            ("29AAGCB7383J1Z4", True),
            ("27AAAAA0000A1Z2", True),
            # the demo GSTIN used all over the fake seed data is *not* valid
            ("27AAAAA0000A1Z5", False),
            ("27AAAAA0000A1Z4", False),   # wrong check digit
            ("27AAAAA0000A1Y5", False),   # 14th char must be Z
            ("27AAAAA0000A1Z", False),    # too short
            ("", False),
            (None, False),
        ],
    )
    def test_validity(self, gstin, valid) -> None:
        assert pp.gstin_is_valid(gstin) is valid

    def test_checksum_of_a_short_value_is_none(self) -> None:
        assert pp.gstin_checksum("27AAA") is None

    def test_an_invalid_gstin_lowers_its_confidence(self, session) -> None:
        out = pp.postprocess(
            session, result(supplier_gstin="27aaaaa0000a1z4", confidence={"supplier_gstin": 0.9})
        )
        assert out.fields.supplier_gstin == "27AAAAA0000A1Z4"
        assert out.confidence["supplier_gstin"] <= 0.3

    def test_a_valid_gstin_keeps_its_confidence(self, session) -> None:
        out = pp.postprocess(
            session, result(supplier_gstin="29AAGCB7383J1Z4", confidence={"supplier_gstin": 0.9})
        )
        assert out.confidence["supplier_gstin"] == 0.9


class TestArithmetic:
    def test_a_bill_that_adds_up_raises_every_confidence(self, session) -> None:
        out = pp.postprocess(
            session,
            result(
                taxable_value=22500, igst=4050, grand_total=26550,
                confidence={"grand_total": 0.8, "supplier_name": 0.5},
            ),
        )
        assert out.confidence["grand_total"] == 0.9
        assert out.confidence["supplier_name"] == 0.6

    def test_confidence_is_capped_at_one(self, session) -> None:
        out = pp.postprocess(
            session,
            result(taxable_value=100, grand_total=100, confidence={"grand_total": 0.97}),
        )
        assert out.confidence["grand_total"] == 1.0

    def test_a_bill_that_does_not_add_up_caps_the_grand_total(self, session) -> None:
        out = pp.postprocess(
            session,
            result(
                taxable_value=22500, igst=4050, grand_total=30000,
                confidence={"grand_total": 0.95, "supplier_name": 0.9},
            ),
        )
        assert out.confidence["grand_total"] == 0.5
        assert out.confidence["supplier_name"] == 0.9

    def test_a_rupee_of_rounding_is_tolerated(self, session) -> None:
        assert pp.arithmetic_holds(
            result(taxable_value=22500, igst=4050, grand_total=26550.99)
        ) is True
        assert pp.arithmetic_holds(
            result(taxable_value=22500, igst=4050, grand_total=26552)
        ) is False

    def test_missing_numbers_skip_the_check(self, session) -> None:
        assert pp.arithmetic_holds(result(grand_total=100)) is None
        out = pp.postprocess(session, result(grand_total=100, confidence={"grand_total": 0.4}))
        assert out.confidence["grand_total"] == 0.4

    def test_tds_is_not_part_of_the_invoice_total(self, session) -> None:
        assert pp.arithmetic_holds(
            result(taxable_value=1000, tds=100, grand_total=1000)
        ) is True


class TestPartyLedger:
    def test_an_exact_supplier_maps_to_its_ledger(self, session) -> None:
        out = pp.postprocess(session, result(supplier_name="BioShield Medical & Co"))
        assert out.fields.party_ledger_name == "BioShield Medical & Co"
        assert out.confidence["party_ledger"] == 1.0

    def test_a_near_match_maps_with_its_ratio(self, session) -> None:
        out = pp.postprocess(session, result(supplier_name="Bioshld Medical"))
        assert out.fields.party_ledger_name == "BioShield Medical & Co"
        assert 0.8 <= out.confidence["party_ledger"] < 1.0

    def test_an_unknown_supplier_maps_to_nothing(self, session) -> None:
        out = pp.postprocess(session, result(supplier_name="Zenith Chemicals"))
        assert out.fields.party_ledger_name is None
        assert out.confidence["party_ledger"] == 0.0

    def test_a_missing_supplier_is_zero_confidence(self, session) -> None:
        out = pp.postprocess(session, result())
        assert out.confidence["party_ledger"] == 0.0


def test_postprocess_normalises_both_dates(session) -> None:
    out = pp.postprocess(session, result(invoice_date="10/06/2026", due_date="09 Jul 2026"))
    assert out.fields.invoice_date == "2026-06-10"
    assert out.fields.due_date == "2026-07-09"
    assert pp.as_of(out).isoformat() == "2026-06-10"
    assert pp.as_of(result()) is None


def test_low_confidence_fields_are_the_key_ones() -> None:
    out = result(confidence={"supplier_name": 0.9, "invoice_number": 0.4, "grand_total": 0.95})
    assert out.low_confidence_fields(0.7) == ["invoice_number", "invoice_date"]
