"""Tests for the typed TallyClient (plan §3.1)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from talai_middleware.audit import MemoryAuditSink
from talai_middleware.tally import envelopes as env
from talai_middleware.tally.client import TallyClient
from talai_middleware.tally.errors import TallyResponseError, TallyUnreachable
from talai_middleware.tally.fake import FakeTallyTransport


@pytest.fixture
def audit() -> MemoryAuditSink:
    return MemoryAuditSink()


@pytest.fixture
def tally(fake_transport: FakeTallyTransport, audit: MemoryAuditSink) -> TallyClient:
    return TallyClient(fake_transport, company="Acme Foods Pvt Ltd", audit=audit)


def test_list_companies(tally: TallyClient) -> None:
    assert tally.list_companies()[0].name == "Acme Foods Pvt Ltd"


def test_masters_are_typed(tally: TallyClient) -> None:
    assert any(led.parent_group == "Sundry Creditors" for led in tally.ledgers())
    assert any(g.name == "Sales Accounts" for g in tally.groups())
    assert tally.stock_items()[0].unit == "Box"
    assert [c.name for c in tally.cost_centres()] == ["Procurement", "Administration"]
    assert [g.name for g in tally.godowns()] == ["Main Store", "Cold Storage"]
    assert "Purchase" in [v.name for v in tally.voucher_types()]


def test_group_full_and_delta_pulls_use_fetchlist_respecting_requests(
    tally: TallyClient, fake_transport: FakeTallyTransport
) -> None:
    groups = tally.groups()
    assert any(group.parent for group in groups)
    assert any(group.affects_gross_profit for group in groups)
    assert "<ID>List of Groups</ID>" in fake_transport.requests[-1]

    tally.groups(since_alter_id=1)
    assert "<ID>TalaiGroup</ID>" in fake_transport.requests[-1]


def test_delta_by_alter_id(tally: TallyClient) -> None:
    all_ledgers = tally.ledgers()
    newest = max(led.alter_id or 0 for led in all_ledgers)
    assert tally.ledgers(since_alter_id=newest) == []
    assert len(tally.ledgers(since_alter_id=newest - 1)) == 1


def test_day_book_and_bills(tally: TallyClient) -> None:
    vouchers = tally.day_book(date(2026, 6, 1), date(2026, 6, 30))
    assert vouchers, "expected the fake Voucher collection to return vouchers"
    payable = tally.bills("payable")
    assert all(b.direction == "payable" for b in payable)
    assert sum(b.pending_amount for b in payable) > Decimal("0")


def test_day_book_rejects_reversed_range_before_network_io(
    fake_transport: FakeTallyTransport,
) -> None:
    client = TallyClient(fake_transport)
    with pytest.raises(ValueError, match="from_date must be on or before to_date"):
        client.day_book(date(2026, 7, 1), date(2026, 6, 30))
    assert fake_transport.requests == []


def test_import_voucher_round_trip(tally: TallyClient) -> None:
    voucher = env.VoucherImport(
        remote_id="draft-round-trip",
        voucher_type="Purchase",
        voucher_date=date(2026, 6, 20),
        party_ledger="Sunrise Packaging",
        purchase_ledger="Purchase",
        ledger_entries=[
            env.LedgerEntry("Sunrise Packaging", Decimal("1180.00"), is_debit=False),
            env.LedgerEntry("Purchase", Decimal("1000.00"), is_debit=True),
            env.LedgerEntry("IGST @ 18%", Decimal("180.00"), is_debit=True),
        ],
    )
    result = tally.import_voucher(voucher)
    assert result.ok and result.created == 1
    found = tally.find_voucher_by_remote_id("draft-round-trip")
    assert found is not None
    assert found.voucher_number.startswith("PUR/")


def test_every_call_is_audited(tally: TallyClient, audit: MemoryAuditSink) -> None:
    tally.list_companies()
    tally.ledgers()
    assert [e.operation for e in audit.entries] == ["list_companies", "collection:Ledger"]
    assert all(e.status == "ok" for e in audit.entries)
    assert all(e.duration_ms >= 0 for e in audit.entries)
    # XML is not retained unless explicitly asked for.
    assert audit.entries[0].request_xml is None


def test_audit_can_store_xml(fake_transport: FakeTallyTransport) -> None:
    audit = MemoryAuditSink()
    client = TallyClient(fake_transport, audit=audit, store_xml=True)
    client.list_companies()
    assert audit.entries[0].request_xml is not None
    assert audit.entries[0].response_xml is not None


def test_failures_are_audited_and_raised(audit: MemoryAuditSink) -> None:
    client = TallyClient(FakeTallyTransport(reachable=False), audit=audit)
    with pytest.raises(TallyUnreachable):
        client.list_companies()
    assert audit.entries[0].status == "error"
    assert audit.entries[0].error


def test_ping_reports_latency(tally: TallyClient) -> None:
    result = tally.ping()
    assert result.reachable is True
    assert result.latency_ms >= 0
    assert "Acme Foods Pvt Ltd" in [c.name for c in result.companies]
    assert result.company_match is True


def test_ping_when_unreachable() -> None:
    client = TallyClient(FakeTallyTransport(reachable=False), company="Acme Foods Pvt Ltd")
    result = client.ping()
    assert result.reachable is False
    assert result.company_match is False
    assert result.error


class _RecordingTransport:
    """Captures the timeout each send() was given."""

    def __init__(self) -> None:
        self.timeouts: list[float | None] = []

    def send(self, xml: str, timeout: float | None = None) -> str:
        self.timeouts.append(timeout)
        return FakeTallyTransport().send(xml, timeout)


def test_ping_uses_its_own_short_timeout() -> None:
    transport = _RecordingTransport()
    client = TallyClient(transport, company="Acme Foods Pvt Ltd", timeout=30.0)
    result = client.ping(timeout=5.0)
    assert result.reachable is True
    assert transport.timeouts == [5.0]


def test_ping_defaults_to_client_timeout() -> None:
    transport = _RecordingTransport()
    client = TallyClient(transport, timeout=30.0)
    client.ping()
    assert transport.timeouts == [30.0]


def test_parser_failure_is_audited_as_error(audit: MemoryAuditSink) -> None:
    transport = FakeTallyTransport(plain_text_error_on={"Voucher"})
    client = TallyClient(transport, company="Acme Foods Pvt Ltd", audit=audit)
    with pytest.raises(TallyResponseError):
        client.day_book(date(2026, 6, 1), date(2026, 6, 30))
    assert audit.entries[-1].status == "error"
    assert audit.entries[-1].error
