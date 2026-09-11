"""Dashboard aggregates computed from the replica (plan §3.6)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from talai_middleware.db import models
from talai_middleware.db.base import Database
from talai_middleware.services import aggregates
from talai_middleware.services.sync_pull import SyncPuller
from talai_middleware.tally.client import TallyClient
from talai_middleware.tally.fake import FakeTallyTransport


@pytest.fixture
def session(settings):
    db = Database(settings.database_url)
    db.create_all()
    client = TallyClient(FakeTallyTransport(), company="Acme Foods Pvt Ltd")
    session = db.new_session()
    puller = SyncPuller(session, client, settings)
    puller.pull_masters()
    puller.pull_vouchers(date(2026, 5, 1), date(2026, 6, 30))
    puller.pull_bills()
    session.commit()
    yield session
    session.close()


class TestOverview:
    def test_revenue_and_cost_of_sales(self, session) -> None:
        overview = aggregates.overview(session, date(2026, 5, 1), date(2026, 6, 30))
        # Sales Accounts credits over the window: 36,000 + 50,000.
        assert overview.revenue == Decimal("86000.00")
        # Purchase Accounts + Direct Expenses debits: 10,000 + 21,825 + 16,000.
        assert overview.cost_of_sales == Decimal("47825.00")
        assert overview.gross_profit == Decimal("38175.00")
        assert overview.gross_margin_pct > 0

    def test_net_profit_includes_indirect_lines(self, session) -> None:
        overview = aggregates.overview(session, date(2026, 5, 1), date(2026, 6, 30))
        expected = (
            overview.gross_profit + overview.indirect_income - overview.indirect_expense
        )
        assert overview.net_profit == expected

    def test_cash_and_bank_uses_closing_balances(self, session) -> None:
        overview = aggregates.overview(session, date(2026, 5, 1), date(2026, 6, 30))
        assert overview.cash_and_bank == Decimal("430800.00")

    def test_monthly_trends(self, session) -> None:
        overview = aggregates.overview(session, date(2026, 5, 1), date(2026, 6, 30))
        assert [p.month for p in overview.trends] == ["2026-05", "2026-06"]
        assert overview.trends[0].revenue == Decimal("36000.00")
        assert all(
            p.gross_profit == p.revenue - p.cost_of_sales for p in overview.trends
        )

    def test_empty_period_is_all_zeroes(self, session) -> None:
        overview = aggregates.overview(session, date(2020, 1, 1), date(2020, 1, 31))
        assert overview.revenue == Decimal("0")
        assert overview.gross_margin_pct == Decimal("0")


class TestAging:
    def test_buckets_are_the_documented_five(self, session) -> None:
        buckets = aggregates.aging_buckets(session, "payable", as_on=date(2026, 7, 1))
        assert [b.label for b in buckets] == ["Current", "1-30", "31-60", "61-90", "90+"]

    def test_a_bill_lands_in_the_right_bucket(self, session) -> None:
        # INV/0042 (due 2026-07-09) and INV/0043 (due 2026-07-18) are both
        # still current on 2026-07-01.
        buckets = {
            b.label: b for b in aggregates.aging_buckets(session, "payable", date(2026, 7, 1))
        }
        assert buckets["Current"].amount == Decimal("44755.00")
        assert buckets["Current"].count == 2
        # INV/0041 was due 2026-06-11, i.e. 20 days overdue.
        assert buckets["1-30"].amount == Decimal("4000.00")

    def test_totals_match_the_pending_sum(self, session) -> None:
        buckets = aggregates.aging_buckets(session, "payable", date(2026, 8, 15))
        total = sum(b.amount for b in buckets)
        assert total == Decimal("48755.00")

    def test_future_dated_bill_is_excluded_like_list_bills(self, session) -> None:
        session.add(
            models.Bill(
                party_ledger="BioShield Medical & Co",
                bill_name="FUTURE/1",
                bill_date=date(2026, 8, 1),
                due_date=date(2026, 8, 31),
                pending_amount=Decimal("100.00"),
                direction="payable",
            )
        )
        session.commit()

        all_buckets = aggregates.aging_buckets(session, "payable", date(2026, 7, 1))
        party_buckets = aggregates.aging_buckets(
            session, "payable", date(2026, 7, 1), party="bioshield"
        )
        assert sum(bucket.amount for bucket in all_buckets) == Decimal("48755.00")
        assert sum(bucket.amount for bucket in party_buckets) == Decimal("29875.00")


class TestPayables:
    def test_payables_summary(self, session) -> None:
        payables = aggregates.payables(session, as_on=date(2026, 7, 1))
        assert payables.total_payable == Decimal("48755.00")
        assert payables.total_receivable == Decimal("71480.00")
        assert payables.payable_buckets and payables.receivable_buckets

    def test_dpo_and_dso_are_positive_when_there_is_activity(self, session) -> None:
        payables = aggregates.payables(session, as_on=date(2026, 7, 1))
        assert payables.dpo_days > 0
        assert payables.dso_days > 0

    def test_no_activity_gives_zero_ratios(self, settings) -> None:
        db = Database(settings.database_url)
        db.create_all()
        with db.session() as empty:
            payables = aggregates.payables(empty, as_on=date(2026, 7, 1))
            assert payables.dpo_days == Decimal("0")
            assert payables.dso_days == Decimal("0")
