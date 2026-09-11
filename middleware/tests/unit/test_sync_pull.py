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


def test_masters_always_do_a_full_refresh(puller, transport) -> None:
    """No ALTERID delta any more: a second pull asks for the whole list."""
    puller.pull_masters()
    puller.session.commit()
    transport.requests.clear()
    puller.pull_masters()
    assert transport.requests
    assert not any("$AlterID &gt;" in r or "$AlterID >" in r for r in transport.requests)


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


def test_pull_records_one_sync_run_per_scope(db, transport, settings) -> None:
    session = db.new_session()
    client = TallyClient(transport, company="Acme Foods Pvt Ltd")
    runs = SyncPuller(session, client, settings).run(["masters", "bills"])
    session.commit()
    assert [r.scope for r in runs] == ["masters", "bills"]
    assert [r.status for r in runs] == ["success", "success"]
    assert all(r.records_seen > 0 for r in runs)
    assert {r.id for r in repo.latest_sync_runs(session)} >= {r.id for r in runs}
    session.close()


def test_run_uses_scopes_order_whatever_order_was_asked_for(db, transport, settings) -> None:
    session = db.new_session()
    client = TallyClient(transport, company="Acme Foods Pvt Ltd")
    runs = SyncPuller(session, client, settings).run(["bills", "masters"])
    assert [r.scope for r in runs] == ["masters", "bills"]
    session.close()


def test_pull_marks_every_requested_scope_failed_when_tally_is_unreachable(
    db, settings
) -> None:
    session = db.new_session()
    client = TallyClient(FakeTallyTransport(reachable=False))
    runs = SyncPuller(session, client, settings).run(["masters", "bills"])
    session.commit()
    assert [r.scope for r in runs] == ["masters", "bills"]
    assert all(r.status == "failed" and r.error for r in runs)
    rows = repo.latest_sync_runs(session)
    assert [r.status for r in rows] == ["failed", "failed"]
    session.close()


def test_a_failing_scope_does_not_roll_back_or_block_the_others(db, settings) -> None:
    """masters commit, the failing scope keeps nothing, later scopes still run."""
    transport = FakeTallyTransport(fail_on={"Day Book"})
    session = db.new_session()
    client = TallyClient(transport, company="Acme Foods Pvt Ltd")
    runs = SyncPuller(session, client, settings).run(["masters", "vouchers", "bills"])

    assert [(r.scope, r.status) for r in runs] == [
        ("masters", "success"), ("vouchers", "failed"), ("bills", "success")
    ]
    # masters survived the vouchers rollback...
    assert len(repo.list_ledgers(session)) == 15
    # ...the failing scope stored nothing...
    assert repo.list_vouchers(session) == []
    # ...and the scope after it still ran.
    assert repo.sum_pending_bills(session, "payable") > 0

    failed = [r for r in repo.latest_sync_runs(session) if r.status == "failed"]
    assert [r.scope for r in failed] == ["vouchers"]
    assert failed[0].error
    session.close()


def test_a_failing_scope_keeps_its_audit_row(db, settings) -> None:
    """The rollback must not erase the audit row of the call that failed."""
    from talai_middleware.db.audit_sink import SessionAuditSink

    transport = FakeTallyTransport(fail_on={"Day Book"})
    session = db.new_session()
    client = TallyClient(transport, company="Acme Foods Pvt Ltd").with_audit(
        SessionAuditSink(session)
    )
    SyncPuller(session, client, settings).run(["vouchers"])
    rows = list(session.scalars(select(models.AuditLog)))
    assert [r.operation for r in rows] == ["report:Day Book"]
    assert rows[0].status == "error"
    session.close()


def test_an_unexpected_error_leaves_no_running_row(db, settings) -> None:
    class Boom(TallyClient):
        def bills(self, direction: str):
            raise RuntimeError("kaboom")

    session = db.new_session()
    client = Boom(FakeTallyTransport(), company="Acme Foods Pvt Ltd")
    with pytest.raises(RuntimeError):
        SyncPuller(session, client, settings).run(["masters", "bills"])
    rows = {r.scope: r for r in repo.latest_sync_runs(session)}
    assert rows["masters"].status == "success"
    assert rows["bills"].status == "failed"
    assert "kaboom" in rows["bills"].error
    assert not [r for r in rows.values() if r.status == "running"]
    session.close()


def test_the_second_voucher_pull_uses_an_incremental_window(
    db, transport, settings
) -> None:
    session = db.new_session()
    client = TallyClient(transport, company="Acme Foods Pvt Ltd")
    puller = SyncPuller(session, client, settings)

    first = puller.run(["vouchers"])[0]
    assert first.status == "success"
    started = first.started_at.date()

    expected_start = started - timedelta(days=settings.sync_overlap_days)
    assert puller.voucher_window()[0] == expected_start

    transport.requests.clear()
    puller.run(["vouchers"])
    day_book = [r for r in transport.requests if "Day Book" in r]
    assert day_book
    assert f"<SVFROMDATE>{expected_start:%Y%m%d}</SVFROMDATE>" in day_book[-1]
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
        runs = puller.run()
        assert [r.scope for r in runs] == list(SCOPES)
        assert all(r.status == "success" for r in runs)
        assert puller.session.scalar(select(func.count()).select_from(m.StockValuation)) > 0

    def test_stock_can_be_pulled_on_its_own(self, puller) -> None:
        from talai_middleware.db import models as m

        runs = puller.run(["stock"])
        assert [r.scope for r in runs] == ["stock"]
        assert runs[0].status == "success"
        assert puller.session.scalar(select(func.count()).select_from(m.StockValuation)) > 0


def test_plain_text_protocol_error_fails_the_scope(db, settings) -> None:
    transport = FakeTallyTransport(plain_text_error_on={"Day Book"})
    session = db.new_session()
    client = TallyClient(transport, company="Acme Foods Pvt Ltd")
    runs = SyncPuller(session, client, settings).run(["vouchers"])
    assert runs[0].status == "failed"
    assert runs[0].error
    session.close()


def test_failed_bills_scope_preserves_previous_snapshot(db, settings) -> None:
    session = db.new_session()
    good_transport = FakeTallyTransport()
    client = TallyClient(good_transport, company="Acme Foods Pvt Ltd")
    SyncPuller(session, client, settings).run(["bills"])
    session.commit()
    prior_payable = repo.list_bills(session, "payable")
    assert len(prior_payable) > 0

    bad_transport = FakeTallyTransport(plain_text_error_on={"Bills Payable"})
    bad_client = TallyClient(bad_transport, company="Acme Foods Pvt Ltd")
    runs = SyncPuller(session, bad_client, settings).run(["bills"])
    assert runs[0].status == "failed"

    still_there = repo.list_bills(session, "payable")
    assert len(still_there) == len(prior_payable)
    session.close()
