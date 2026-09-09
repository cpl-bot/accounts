"""The replica schema and repository helpers (plan §3.3)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from talai_middleware.db import models, repo
from talai_middleware.db.base import Database


def test_every_planned_table_exists(settings) -> None:
    db = Database(settings.database_url)
    db.create_all()
    expected = {
        "settings", "sync_runs", "groups", "ledgers", "stock_items", "cost_centres",
        "godowns", "voucher_types", "vouchers", "voucher_ledger_entries",
        "voucher_inventory_entries", "bills", "voucher_drafts", "attachments", "audit_log",
    }
    assert expected <= set(models.Base.metadata.tables)


def test_tally_sourced_rows_carry_sync_columns() -> None:
    for table in ("ledgers", "groups", "stock_items", "vouchers"):
        columns = set(models.Base.metadata.tables[table].columns.keys())
        assert {"tally_guid", "tally_master_id", "tally_alter_id", "company_name",
                "synced_at", "is_deleted"} <= columns


def test_upsert_ledger_is_idempotent(settings) -> None:
    db = Database(settings.database_url)
    db.create_all()
    with db.session() as session:
        for closing in (Decimal("100.00"), Decimal("250.00")):
            repo.upsert_ledger(
                session,
                name="Acme Supplier",
                parent_group="Sundry Creditors",
                closing_balance=closing,
                tally_guid="guid-1",
                tally_alter_id=7,
                company_name="Acme",
            )
        session.commit()
        rows = repo.list_ledgers(session)
        assert len(rows) == 1
        assert rows[0].closing_balance == Decimal("250.00")


def test_settings_roundtrip(settings) -> None:
    db = Database(settings.database_url)
    db.create_all()
    with db.session() as session:
        repo.set_setting(session, "tally_host", "10.0.0.9")
        session.commit()
        assert repo.get_setting(session, "tally_host") == "10.0.0.9"
        assert repo.get_setting(session, "missing", "fallback") == "fallback"
        assert repo.all_settings(session)["tally_host"] == "10.0.0.9"


def test_sync_run_lifecycle(settings) -> None:
    db = Database(settings.database_url)
    db.create_all()
    with db.session() as session:
        run = repo.start_sync_run(session, kind="pull", scope="masters")
        session.commit()
        assert run.status == "running"
        repo.finish_sync_run(session, run, status="success", records_seen=10, records_changed=3)
        session.commit()
        latest = repo.latest_sync_runs(session, limit=5)
        assert latest[0].status == "success"
        assert latest[0].records_changed == 3
        assert latest[0].finished_at is not None


def test_max_alter_id_helper(settings) -> None:
    db = Database(settings.database_url)
    db.create_all()
    with db.session() as session:
        repo.upsert_ledger(session, name="A", parent_group="X", tally_alter_id=5)
        repo.upsert_ledger(session, name="B", parent_group="X", tally_alter_id=12)
        session.commit()
        assert repo.max_alter_id(session, models.Ledger) == 12
        assert repo.max_alter_id(session, models.Voucher) is None


def test_voucher_replace_children(settings) -> None:
    db = Database(settings.database_url)
    db.create_all()
    with db.session() as session:
        voucher = repo.upsert_voucher(
            session,
            voucher_number="PUR/1",
            voucher_type="Purchase",
            voucher_date=date(2026, 6, 10),
            party_ledger="Acme Supplier",
            amount=Decimal("1180.00"),
            tally_guid="v-guid-1",
            ledger_entries=[{"ledger_name": "Acme Supplier", "amount": Decimal("1180.00")}],
            inventory_entries=[{"stock_item": "Gloves", "qty": Decimal("2")}],
        )
        session.commit()
        assert len(voucher.ledger_entries) == 1
        # A second pull of the same voucher replaces the lines rather than duplicating.
        voucher = repo.upsert_voucher(
            session,
            voucher_number="PUR/1",
            voucher_type="Purchase",
            voucher_date=date(2026, 6, 10),
            party_ledger="Acme Supplier",
            amount=Decimal("1180.00"),
            tally_guid="v-guid-1",
            ledger_entries=[
                {"ledger_name": "Acme Supplier", "amount": Decimal("1180.00")},
                {"ledger_name": "Purchase", "amount": Decimal("-1000.00")},
            ],
            inventory_entries=[],
        )
        session.commit()
        assert len(voucher.ledger_entries) == 2
        assert voucher.inventory_entries == []
        assert len(repo.list_vouchers(session)) == 1
