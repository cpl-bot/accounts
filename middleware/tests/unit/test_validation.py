"""Business validation rules (plan §3.5)."""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest

from talai_middleware.api.schemas import DraftPurchaseBill
from talai_middleware.db import repo
from talai_middleware.db.base import Database
from talai_middleware.services import validation
from talai_middleware.services.sync_pull import SyncPuller
from talai_middleware.tally.client import TallyClient
from talai_middleware.tally.fake import FakeTallyTransport


@pytest.fixture
def session(settings):
    """A replica populated from the fake Tally, so rules see real masters."""
    db = Database(settings.database_url)
    db.create_all()
    client = TallyClient(FakeTallyTransport(), company="Acme Foods Pvt Ltd")
    with db.session() as session:
        SyncPuller(session, client, settings).pull_masters()
        session.commit()
        yield session


def make_payload(**overrides) -> DraftPurchaseBill:
    data = {
        "voucher_type": "Purchase",
        "voucher_date": "2026-06-10",
        "bill_date": "2026-06-10",
        "due_date": "2026-07-09",
        "supplier_invoice_no": "INV/BSM/9999",
        "cost_centre": "Procurement",
        "party": {
            "ledger_name": "BioShield Medical & Co",
            "gstin": "27AAAAA0000A1Z5",
            "source_of_supply": "Maharashtra",
            "destination_of_supply": "Maharashtra",
        },
        "purchase_ledger": "Purchase",
        "items": [
            {
                "stock_item": "Nitrile Gloves",
                "godown": "Main Store",
                "quantity": "50",
                "rate": "450",
                "hsn": "4015",
            }
        ],
        "ledger_lines": [],
        "tax_lines": [{"ledger_name": "IGST @ 18%", "amount": "4050.00"}],
        "totals": {
            "taxable_value": "22500.00",
            "sub_total": "22500.00",
            "gst": "4050.00",
            "grand_total": "26550.00",
        },
    }
    data.update(overrides)
    return DraftPurchaseBill.model_validate(data)


def codes(issues) -> list[str]:
    return [i.code for i in issues]


def test_a_clean_bill_has_no_issues(session) -> None:
    assert validation.validate_draft(session, make_payload()) == []


def test_unknown_party_ledger(session) -> None:
    payload = make_payload(party={"ledger_name": "Ghost Supplier"})
    issues = validation.validate_draft(session, payload)
    assert "LEDGER_NOT_FOUND" in codes(issues)
    assert issues[0].field == "party.ledger_name"


def test_party_in_the_wrong_group(session) -> None:
    payload = make_payload(party={"ledger_name": "Metro Hospital"})
    assert "LEDGER_WRONG_GROUP" in codes(validation.validate_draft(session, payload))


def test_purchase_ledger_must_be_under_purchase_accounts(session) -> None:
    assert "PURCHASE_LEDGER_WRONG_GROUP" in codes(
        validation.validate_draft(session, make_payload(purchase_ledger="Office Rent"))
    )
    assert "PURCHASE_LEDGER_NOT_FOUND" in codes(
        validation.validate_draft(session, make_payload(purchase_ledger="Nope"))
    )


def test_tax_ledger_must_be_under_duties_and_taxes(session) -> None:
    payload = make_payload(tax_lines=[{"ledger_name": "Office Rent", "amount": "4050.00"}])
    assert "TAX_LEDGER_WRONG_GROUP" in codes(validation.validate_draft(session, payload))


def test_unknown_stock_item_godown_and_cost_centre(session) -> None:
    payload = make_payload(
        items=[
            {
                "stock_item": "Unobtanium",
                "godown": "Nowhere",
                "quantity": "50",
                "rate": "450",
            }
        ],
        cost_centre="Imaginary",
    )
    issues = codes(validation.validate_draft(session, payload))
    assert "STOCK_ITEM_NOT_FOUND" in issues
    assert "GODOWN_NOT_FOUND" in issues
    assert "COST_CENTRE_NOT_FOUND" in issues


def test_totals_must_add_up(session) -> None:
    payload = make_payload(
        totals={
            "taxable_value": "22500.00",
            "sub_total": "22500.00",
            "gst": "4050.00",
            "grand_total": "30000.00",
        }
    )
    assert "TOTAL_MISMATCH" in codes(validation.validate_draft(session, payload))


def test_taxable_value_must_match_the_item_lines(session) -> None:
    payload = make_payload(
        totals={
            "taxable_value": "10.00",
            "sub_total": "10.00",
            "gst": "4050.00",
            "grand_total": "4060.00",
        }
    )
    assert "TAXABLE_VALUE_MISMATCH" in codes(validation.validate_draft(session, payload))


def test_zero_amount_lines_are_rejected(session) -> None:
    payload = make_payload(
        ledger_lines=[{"ledger_name": "DISCOUNT", "amount": "0"}],
    )
    assert "ZERO_AMOUNT_LINE" in codes(validation.validate_draft(session, payload))


def test_no_items_and_no_lines_is_an_empty_voucher(session) -> None:
    payload = make_payload(
        items=[], tax_lines=[],
        totals={"taxable_value": "0", "sub_total": "0", "grand_total": "0"},
    )
    assert "EMPTY_VOUCHER" in codes(validation.validate_draft(session, payload))


def test_future_voucher_date_is_rejected(session) -> None:
    future = (date.today() + timedelta(days=5)).isoformat()
    payload = make_payload(voucher_date=future, bill_date=future, due_date=future)
    assert "VOUCHER_DATE_IN_FUTURE" in codes(validation.validate_draft(session, payload))


def test_bill_date_after_voucher_date_is_rejected(session) -> None:
    payload = make_payload(voucher_date="2026-06-10", bill_date="2026-06-20")
    assert "BILL_DATE_AFTER_VOUCHER_DATE" in codes(validation.validate_draft(session, payload))


def test_due_date_before_bill_date_is_rejected(session) -> None:
    payload = make_payload(bill_date="2026-06-10", due_date="2026-06-01")
    assert "DUE_DATE_BEFORE_BILL_DATE" in codes(validation.validate_draft(session, payload))


def test_gstin_format_is_a_warning(session) -> None:
    payload = make_payload(
        party={"ledger_name": "BioShield Medical & Co", "gstin": "NOTAGSTIN"}
    )
    issues = validation.validate_draft(session, payload)
    gstin_issues = [i for i in issues if i.code == "GSTIN_FORMAT"]
    assert gstin_issues and gstin_issues[0].severity == "warning"
    assert not validation.has_errors(issues)


def test_gstin_state_code_mismatch_is_a_warning(session) -> None:
    payload = make_payload(
        party={
            "ledger_name": "BioShield Medical & Co",
            "gstin": "09AAAAA0000A1Z5",
            "source_of_supply": "Maharashtra",
        }
    )
    issues = validation.validate_draft(session, payload)
    assert "GSTIN_STATE_MISMATCH" in codes(issues)
    assert not validation.has_errors(issues)


def test_duplicate_supplier_invoice_is_an_error_unless_overridden(session) -> None:
    repo.upsert_voucher(
        session,
        voucher_number="PUR/26-27/0099",
        voucher_type="Purchase",
        voucher_date=date(2026, 6, 1),
        party_ledger="BioShield Medical & Co",
        reference="INV/BSM/9999",
        amount=Decimal("100"),
        tally_guid="dup-guid",
    )
    session.flush()
    assert "DUPLICATE_SUPPLIER_INVOICE" in codes(
        validation.validate_draft(session, make_payload())
    )
    assert "DUPLICATE_SUPPLIER_INVOICE" not in codes(
        validation.validate_draft(session, make_payload(allow_duplicate=True))
    )


def test_has_errors_ignores_warnings() -> None:
    from talai_middleware.api.schemas import ValidationIssue

    warning = ValidationIssue(code="X", field="f", message="m", severity="warning")
    error = ValidationIssue(code="Y", field="f", message="m")
    assert validation.has_errors([warning]) is False
    assert validation.has_errors([warning, error]) is True
