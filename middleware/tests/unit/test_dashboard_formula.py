"""The configurable gross-profit formula (plan §3.9)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from talai_middleware.api.schemas import DashboardFormula
from talai_middleware.db import repo
from talai_middleware.db.base import Database
from talai_middleware.services import aggregates
from talai_middleware.services.sync_pull import SyncPuller
from talai_middleware.tally.client import TallyClient
from talai_middleware.tally.fake import FakeTallyTransport

PERIOD = (date(2026, 5, 1), date(2026, 6, 30))


@pytest.fixture
def session(settings):
    """A replica pulled from the fake Tally: two months of trading."""
    db = Database(settings.database_url)
    db.create_all()
    client = TallyClient(FakeTallyTransport(), company="Acme Foods Pvt Ltd")
    with db.session() as s:
        puller = SyncPuller(s, client, settings)
        puller.pull_masters()
        puller.pull_vouchers(*PERIOD)
        s.commit()
        yield s


def store(session, **fields) -> DashboardFormula:
    formula = DashboardFormula(**fields)
    aggregates.save_formula(session, formula)
    session.commit()
    return formula


class TestStoredFormula:
    def test_defaults_match_the_plan(self, session) -> None:
        formula = aggregates.load_formula(session)
        assert formula.gross_profit_mode == "simple"
        assert formula.stock_source == "tally"
        assert formula.manual_opening_stock is None
        assert formula.manual_closing_stock is None
        assert formula.revenue_groups == ["Sales Accounts"]
        assert formula.cost_of_sales_groups == ["Purchase Accounts", "Direct Expenses"]

    def test_roundtrip(self, session) -> None:
        store(session, gross_profit_mode="trading", stock_source="manual",
              manual_opening_stock=Decimal("1000.00"), revenue_groups=["Sales Accounts"])
        loaded = aggregates.load_formula(session)
        assert loaded.gross_profit_mode == "trading"
        assert loaded.manual_opening_stock == Decimal("1000.00")

    def test_a_corrupt_stored_value_falls_back_to_the_defaults(self, session) -> None:
        repo.set_setting(session, aggregates.FORMULA_KEY, "not json")
        session.commit()
        assert aggregates.load_formula(session).gross_profit_mode == "simple"

    def test_unknown_group_names_are_reported_but_not_rejected(self, session) -> None:
        warnings = aggregates.formula_warnings(
            session, DashboardFormula(revenue_groups=["Sales Accounts", "Made Up Group"])
        )
        assert warnings == ["Group 'Made Up Group' is not in the replica"]

    def test_no_warnings_when_the_replica_has_no_groups(self, settings) -> None:
        db = Database(settings.database_url)
        db.create_all()
        with db.session() as empty:
            assert aggregates.formula_warnings(
                empty, DashboardFormula(revenue_groups=["Anything"])
            ) == []


class TestSimpleMode:
    def test_uses_the_configured_groups(self, session) -> None:
        overview = aggregates.overview(session, *PERIOD)
        assert overview.formula.gross_profit_mode == "simple"
        assert overview.gross_profit == overview.revenue - overview.cost_of_sales
        assert overview.stock_adjustment_status == "applied"
        assert overview.opening_stock == Decimal("0.00")

    def test_narrowing_cost_of_sales_raises_gross_profit(self, session) -> None:
        wide = aggregates.overview(session, *PERIOD)
        store(session, cost_of_sales_groups=["Direct Expenses"])
        narrow = aggregates.overview(session, *PERIOD)
        assert narrow.cost_of_sales < wide.cost_of_sales
        assert narrow.gross_profit > wide.gross_profit
        assert narrow.formula.cost_of_sales_groups == ["Direct Expenses"]

    def test_an_empty_revenue_group_list_zeroes_revenue(self, session) -> None:
        store(session, revenue_groups=[])
        assert aggregates.overview(session, *PERIOD).revenue == Decimal("0.00")


class TestTradingMode:
    def test_opening_is_the_day_before_from_and_closing_is_to(self, session) -> None:
        repo.upsert_stock_valuation(session, date(2026, 4, 30), Decimal("40000.00"))
        repo.upsert_stock_valuation(session, date(2026, 6, 30), Decimal("55000.00"))
        session.commit()
        simple = aggregates.overview(session, *PERIOD)
        store(session, gross_profit_mode="trading")
        trading = aggregates.overview(session, *PERIOD)

        assert trading.stock_adjustment_status == "applied"
        assert trading.opening_stock == Decimal("40000.00")
        assert trading.closing_stock == Decimal("55000.00")
        assert trading.cost_of_sales == simple.cost_of_sales + Decimal("40000.00") - Decimal(
            "55000.00"
        )
        assert trading.gross_profit == trading.revenue - trading.cost_of_sales

    def test_manual_source_ignores_the_replica(self, session) -> None:
        repo.upsert_stock_valuation(session, date(2026, 4, 30), Decimal("40000.00"))
        repo.upsert_stock_valuation(session, date(2026, 6, 30), Decimal("55000.00"))
        session.commit()
        store(session, gross_profit_mode="trading", stock_source="manual",
              manual_opening_stock=Decimal("1000.00"),
              manual_closing_stock=Decimal("2000.00"))
        overview = aggregates.overview(session, *PERIOD)
        assert overview.stock_adjustment_status == "manual"
        assert (overview.opening_stock, overview.closing_stock) == (
            Decimal("1000.00"), Decimal("2000.00")
        )

    def test_a_missing_boundary_falls_back_to_the_manual_value(self, session) -> None:
        repo.upsert_stock_valuation(session, date(2026, 4, 30), Decimal("40000.00"))
        session.commit()
        store(session, gross_profit_mode="trading",
              manual_closing_stock=Decimal("52000.00"))
        overview = aggregates.overview(session, *PERIOD)
        assert overview.stock_adjustment_status == "manual"
        assert overview.opening_stock == Decimal("40000.00")
        assert overview.closing_stock == Decimal("52000.00")

    def test_only_an_opening_valuation_and_no_manual_closing_is_unavailable(
        self, session
    ) -> None:
        """A missing boundary must not be faked as zero and labelled manual."""
        repo.upsert_stock_valuation(session, date(2026, 4, 30), Decimal("40000.00"))
        session.commit()
        simple = aggregates.overview(session, *PERIOD)
        store(session, gross_profit_mode="trading")
        overview = aggregates.overview(session, *PERIOD)
        assert overview.stock_adjustment_status == "unavailable"
        assert overview.opening_stock == Decimal("0.00")
        assert overview.closing_stock == Decimal("0.00")
        assert overview.cost_of_sales == simple.cost_of_sales

    def test_only_a_closing_valuation_and_no_manual_opening_is_unavailable(
        self, session
    ) -> None:
        repo.upsert_stock_valuation(session, date(2026, 6, 30), Decimal("55000.00"))
        session.commit()
        simple = aggregates.overview(session, *PERIOD)
        store(session, gross_profit_mode="trading")
        overview = aggregates.overview(session, *PERIOD)
        assert overview.stock_adjustment_status == "unavailable"
        assert (overview.opening_stock, overview.closing_stock) == (
            Decimal("0.00"), Decimal("0.00")
        )
        assert overview.cost_of_sales == simple.cost_of_sales

    def test_a_tally_opening_plus_a_manual_closing_is_manual_with_both_real_values(
        self, session
    ) -> None:
        repo.upsert_stock_valuation(session, date(2026, 4, 30), Decimal("40000.00"))
        session.commit()
        simple = aggregates.overview(session, *PERIOD)
        store(session, gross_profit_mode="trading",
              manual_closing_stock=Decimal("52000.00"))
        overview = aggregates.overview(session, *PERIOD)
        assert overview.stock_adjustment_status == "manual"
        assert overview.opening_stock == Decimal("40000.00")
        assert overview.closing_stock == Decimal("52000.00")
        assert overview.cost_of_sales == simple.cost_of_sales + Decimal(
            "40000.00"
        ) - Decimal("52000.00")

    def test_a_lone_manual_value_is_not_enough(self, session) -> None:
        store(session, gross_profit_mode="trading", stock_source="manual",
              manual_opening_stock=Decimal("1000.00"))
        overview = aggregates.overview(session, *PERIOD)
        assert overview.stock_adjustment_status == "unavailable"
        assert overview.opening_stock == Decimal("0.00")

    def test_no_stock_values_at_all_is_unavailable_and_degrades_to_simple(
        self, session
    ) -> None:
        simple = aggregates.overview(session, *PERIOD)
        store(session, gross_profit_mode="trading")
        overview = aggregates.overview(session, *PERIOD)
        assert overview.stock_adjustment_status == "unavailable"
        assert overview.opening_stock == Decimal("0.00")
        assert overview.closing_stock == Decimal("0.00")
        assert overview.cost_of_sales == simple.cost_of_sales

    def test_a_pulled_valuation_feeds_the_trading_formula(self, session, settings) -> None:
        transport = FakeTallyTransport()
        client = TallyClient(transport, company="Acme Foods Pvt Ltd")
        puller = SyncPuller(session, client, settings)
        puller.pull_stock_valuations([date(2026, 4, 30), date(2026, 6, 30)])
        session.commit()
        store(session, gross_profit_mode="trading")
        overview = aggregates.overview(session, *PERIOD)
        assert overview.stock_adjustment_status == "applied"
        assert overview.opening_stock == transport.stock_value_on(date(2026, 4, 30))
        assert overview.closing_stock == transport.stock_value_on(date(2026, 6, 30))
