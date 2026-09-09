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
