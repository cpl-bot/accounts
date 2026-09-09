"""Pull sync: Tally → replica (plan §3.4)."""
from __future__ import annotations

from datetime import date, timedelta

import pytest
from sqlalchemy import func, select

from talai_middleware.db import models, repo
from talai_middleware.db.base import Database
from talai_middleware.services.sync_pull import SyncPuller
from talai_middleware.tally.client import TallyClient
from talai_middleware.tally.fake import FakeTallyTransport


@pytest.fixture
def db(settings):
    database = Database(settings.database_url)
    database.create_all()
    return database


@pytest.fixture
def transport() -> FakeTallyTransport:
    return FakeTallyTransport()


@pytest.fixture
def puller(db, transport, settings):
    session = db.new_session()
    client = TallyClient(transport, company="Acme Foods Pvt Ltd")
    yield SyncPuller(session, client, settings)
    session.close()


def test_pull_masters_populates_every_lookup(puller) -> None:
    changed = puller.pull_masters()
    session = puller.session
    session.commit()
    assert changed > 0
    assert len(repo.list_ledgers(session)) == 15
    assert len(repo.list_simple(session, models.Group)) == 13
    assert len(repo.list_simple(session, models.StockItem)) == 2
    assert len(repo.list_simple(session, models.CostCentre)) == 2
    assert len(repo.list_simple(session, models.Godown)) == 2
    assert len(repo.list_simple(session, models.VoucherType)) == 5
    ledger = repo.ledger_by_name(session, "BioShield Medical & Co")
    assert ledger.gstin == "27AAAAA0000A1Z5"
    assert ledger.tally_alter_id == 908


def test_pull_masters_is_idempotent(puller) -> None:
    puller.pull_masters()
    puller.session.commit()
    before = len(repo.list_ledgers(puller.session))
    puller.pull_masters()
    puller.session.commit()
    assert len(repo.list_ledgers(puller.session)) == before


def test_second_pull_uses_the_alter_id_delta(puller, transport) -> None:
    puller.pull_masters()
    puller.session.commit()
    transport.requests.clear()
    puller.pull_masters()
    assert any("$AlterID &gt;" in r or "$AlterID >" in r for r in transport.requests)


def test_pull_vouchers_filters_by_date_client_side(puller) -> None:
    """The Day Book export ignores SVFROMDATE/SVTODATE, so we must re-filter."""
    puller.pull_vouchers(date(2026, 6, 1), date(2026, 6, 30))
    puller.session.commit()
    vouchers = repo.list_vouchers(puller.session)
    assert vouchers, "expected June vouchers"
    assert all(date(2026, 6, 1) <= v.date <= date(2026, 6, 30) for v in vouchers)
    # The fake returns May vouchers too; they must not have been stored.
    assert "PUR/26-27/0041" not in [v.voucher_number for v in vouchers]


def test_pull_vouchers_stores_lines(puller) -> None:
    puller.pull_vouchers(date(2026, 6, 1), date(2026, 6, 30))
    puller.session.commit()
    voucher = next(
        v for v in repo.list_vouchers(puller.session) if v.voucher_number == "PUR/26-27/0042"
    )
    assert len(voucher.ledger_entries) == 3
    assert len(voucher.inventory_entries) == 1
    assert voucher.inventory_entries[0].stock_item == "Nitrile Gloves"


def test_pull_vouchers_uses_overlap_days(puller, settings) -> None:
    session = puller.session
    run = repo.start_sync_run(session, kind="pull", scope="vouchers")
    repo.finish_sync_run(session, run, status="success")
    session.commit()
    window = puller.voucher_window()
    assert window[1] >= date.today()
    assert window[0] <= date.today() - timedelta(days=settings.sync_overlap_days)


def test_pull_bills_replaces_the_table(puller) -> None:
    puller.pull_bills()
    puller.session.commit()
    first = repo.list_bills(puller.session, "payable")
    puller.pull_bills()
    puller.session.commit()
    assert len(repo.list_bills(puller.session, "payable")) == len(first)
    assert repo.sum_pending_bills(puller.session, "payable") > 0


def test_pull_records_a_sync_run(db, transport, settings) -> None:
    session = db.new_session()
    client = TallyClient(transport, company="Acme Foods Pvt Ltd")
    run = SyncPuller(session, client, settings).run(["masters", "bills"])
    session.commit()
    assert run.status == "success"
    assert run.scope == "masters,bills"
    assert run.records_seen > 0
    assert repo.latest_sync_runs(session)[0].id == run.id
    session.close()


def test_pull_marks_the_run_failed_when_tally_is_unreachable(db, settings) -> None:
    session = db.new_session()
    client = TallyClient(FakeTallyTransport(reachable=False))
    run = SyncPuller(session, client, settings).run(["masters"])
    session.commit()
    assert run.status == "failed"
    assert run.error
    session.close()


# --------------------------------------------------------------------------
# Stock valuations (plan §3.9)
# --------------------------------------------------------------------------


class TestStockValuations:
    def test_boundaries_cover_the_financial_year_month_starts_and_today(self) -> None:
        from talai_middleware.services.sync_pull import stock_boundaries

        boundaries = stock_boundaries(date(2026, 6, 17))
        assert boundaries[0] == date(2026, 4, 1)
        assert boundaries == [
            date(2026, 4, 1), date(2026, 5, 1), date(2026, 6, 1), date(2026, 6, 17)
        ]

    def test_january_belongs_to_the_previous_financial_year(self) -> None:
        from talai_middleware.services.sync_pull import stock_boundaries

        boundaries = stock_boundaries(date(2027, 1, 5))
        assert boundaries[0] == date(2026, 4, 1)
        assert boundaries[-1] == date(2027, 1, 5)
        assert date(2027, 1, 1) in boundaries

    def test_the_first_of_april_is_not_duplicated(self) -> None:
        from talai_middleware.services.sync_pull import stock_boundaries

        assert stock_boundaries(date(2026, 4, 1)) == [date(2026, 4, 1)]

    def test_pull_upserts_one_row_per_boundary(self, puller) -> None:
        from talai_middleware.db import models as m

        boundaries = [date(2026, 5, 1), date(2026, 6, 1)]
        changed = puller.pull_stock_valuations(boundaries)
        puller.session.commit()

        stmt = select(m.StockValuation).order_by(m.StockValuation.as_on)
        rows = list(puller.session.scalars(stmt))
        assert changed == 2
        assert [r.as_on for r in rows] == boundaries
        assert all(r.source == "tally" for r in rows)
        assert rows[0].closing_value != rows[1].closing_value

    def test_pull_is_idempotent(self, puller) -> None:
        from talai_middleware.db import models as m

        puller.pull_stock_valuations([date(2026, 5, 1)])
        puller.pull_stock_valuations([date(2026, 5, 1)])
        puller.session.commit()
        assert puller.session.scalar(select(func.count()).select_from(m.StockValuation)) == 1

    def test_stock_is_a_default_scope(self, puller) -> None:
        from talai_middleware.db import models as m
        from talai_middleware.services.sync_pull import SCOPES

        assert "stock" in SCOPES
        run = puller.run()
        assert run.status == "success"
        assert "stock" in run.scope
        assert puller.session.scalar(select(func.count()).select_from(m.StockValuation)) > 0

    def test_stock_can_be_pulled_on_its_own(self, puller) -> None:
        from talai_middleware.db import models as m

        run = puller.run(["stock"])
        assert run.scope == "stock"
        assert puller.session.scalar(select(func.count()).select_from(m.StockValuation)) > 0
