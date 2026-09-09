"""The fake Tally's Import Data behaviour — this is what push tests rely on."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from talai_middleware.tally import envelopes as env
from talai_middleware.tally import parsers as P
from talai_middleware.tally.fake import FakeTallyTransport


def voucher(remote_id: str = "draft-1", party: str = "BioShield Medical & Co") -> env.VoucherImport:
    return env.VoucherImport(
        remote_id=remote_id,
        voucher_type="Purchase",
        voucher_date=date(2026, 6, 10),
        party_ledger=party,
        purchase_ledger="Purchase",
        reference="INV/BSM/9001",
        ledger_entries=[
            env.LedgerEntry(party, Decimal("1180.00"), is_debit=False),
            env.LedgerEntry("Purchase", Decimal("1000.00"), is_debit=True),
            env.LedgerEntry("IGST @ 18%", Decimal("180.00"), is_debit=True),
        ],
    )


def test_import_creates_a_voucher_and_assigns_a_number(
    fake_transport: FakeTallyTransport,
) -> None:
    before = len(fake_transport.state.vouchers)
    result = P.parse_import_result(fake_transport.send(env.import_voucher(voucher())))
    assert result.created == 1
    assert result.ok
    assert len(fake_transport.state.vouchers) == before + 1
    created = fake_transport.state.vouchers[-1]
    assert created.voucher_number.startswith("PUR/")
    assert created.remote_id == "draft-1"


def test_remote_id_is_idempotent(fake_transport: FakeTallyTransport) -> None:
    fake_transport.send(env.import_voucher(voucher("draft-x")))
    count = len(fake_transport.state.vouchers)
    result = P.parse_import_result(fake_transport.send(env.import_voucher(voucher("draft-x"))))
    assert result.created == 0
    assert result.ignored == 1
    assert len(fake_transport.state.vouchers) == count


def test_unknown_ledger_produces_a_realistic_line_error(
    fake_transport: FakeTallyTransport,
) -> None:
    result = P.parse_import_result(
        fake_transport.send(env.import_voucher(voucher(party="Ghost Supplier")))
    )
    assert result.created == 0
    assert result.errors == 1
    assert "Could not find Ledger 'Ghost Supplier'" in result.line_errors[0]


def test_unbalanced_voucher_is_rejected(fake_transport: FakeTallyTransport) -> None:
    # Build the XML through the builder, then break the balance in the raw XML
    # so we exercise the fake's own check rather than the builder's.
    xml = env.import_voucher(voucher()).replace(
        "<AMOUNT>1180.00</AMOUNT>", "<AMOUNT>1190.00</AMOUNT>", 1
    )
    result = P.parse_import_result(fake_transport.send(xml))
    assert result.errors == 1
    assert "do not tally" in result.line_errors[0]


def test_created_voucher_is_visible_in_the_day_book(
    fake_transport: FakeTallyTransport,
) -> None:
    fake_transport.send(env.import_voucher(voucher("draft-visible")))
    vouchers = P.parse_vouchers(
        fake_transport.send(env.report("Day Book", from_date=date(2026, 6, 1),
                                       to_date=date(2026, 6, 30)))
    )
    assert "draft-visible" in [v.remote_id for v in vouchers]


def test_import_ledger_creates_a_master(fake_transport: FakeTallyTransport) -> None:
    result = P.parse_import_result(
        fake_transport.send(env.import_ledger("New Supplier", "Sundry Creditors"))
    )
    assert result.created == 1
    assert "New Supplier" in [ledger.name for ledger in fake_transport.state.ledgers]


# --------------------------------------------------------------------------
# Vendor ledger creation (plan §3.8)
# --------------------------------------------------------------------------


def test_import_ledger_stores_the_master_details(fake_transport: FakeTallyTransport) -> None:
    result = P.parse_import_result(
        fake_transport.send(
            env.import_ledger(
                "Bright Steel Traders",
                "Sundry Creditors",
                gstin="27AAAAA0000A1Z5",
                state="Maharashtra",
                gst_registration_type="Regular",
                remote_id="draft-9-party",
            )
        )
    )
    assert result.created == 1 and result.ok
    created = fake_transport.state.ledger("Bright Steel Traders")
    assert created is not None
    assert created.parent == "Sundry Creditors"
    assert created.gstin == "27AAAAA0000A1Z5"
    assert created.state == "Maharashtra"
    assert created.is_bill_wise is True


def test_duplicate_ledger_name_is_rejected_with_a_line_error(
    fake_transport: FakeTallyTransport,
) -> None:
    before = len(fake_transport.state.ledgers)
    result = P.parse_import_result(
        fake_transport.send(env.import_ledger("BioShield Medical & Co", "Sundry Creditors"))
    )
    assert result.created == 0
    assert result.errors == 1
    assert "BioShield Medical & Co" in result.line_errors[0]
    assert "already exists" in result.line_errors[0]
    assert len(fake_transport.state.ledgers) == before


def test_ledger_import_still_refuses_alter_actions(fake_transport: FakeTallyTransport) -> None:
    import pytest

    from talai_middleware.tally.fake import ForbiddenTallyAction

    xml = env.import_ledger("Whoever", "Sundry Creditors").replace(
        'ACTION="Create"', 'ACTION="Alter"'
    )
    with pytest.raises(ForbiddenTallyAction):
        fake_transport.send(xml)


def test_stock_summary_is_deterministic(fake_transport: FakeTallyTransport) -> None:
    from datetime import date as date_type

    xml = fake_transport.send(env.stock_summary_report(date_type(2026, 6, 30)))
    total = P.parse_stock_valuation(xml)
    assert total == fake_transport.stock_value_on(date_type(2026, 6, 30))
    assert total == P.parse_stock_valuation(
        fake_transport.send(env.stock_summary_report(date_type(2026, 6, 30)))
    )
    assert total != P.parse_stock_valuation(
        fake_transport.send(env.stock_summary_report(date_type(2026, 5, 31)))
    )
