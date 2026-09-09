#!/usr/bin/env python
"""Migrate, pull, and reconcile the replica against Tally.

    uv run --project middleware python scripts/validate_db_sync.py
    uv run --project middleware python scripts/validate_db_sync.py --fake
    uv run --project middleware python scripts/validate_db_sync.py \
        --scope masters --scope bills

Prints per-table row counts, the last sync runs, and reconciliation checks
(ledger count in Tally vs the DB, pending bill totals). Exits non-zero when a
check does not reconcile, so it can gate a LAN deployment.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
MIDDLEWARE = REPO_ROOT / "middleware"
sys.path.insert(0, str(MIDDLEWARE))

from talai_middleware.config import Settings, resolve_sqlite_url  # noqa: E402
from talai_middleware.db import models, repo  # noqa: E402
from talai_middleware.db.audit_sink import SessionAuditSink  # noqa: E402
from talai_middleware.db.base import Database  # noqa: E402
from talai_middleware.services.sync_pull import SyncPuller  # noqa: E402
from talai_middleware.tally.client import TallyClient  # noqa: E402
from talai_middleware.tally.fake import FakeTallyTransport  # noqa: E402
from talai_middleware.tally.transport import HttpxTransport  # noqa: E402

INTERESTING_TABLES = (
    "groups",
    "ledgers",
    "stock_items",
    "cost_centres",
    "godowns",
    "voucher_types",
    "vouchers",
    "voucher_ledger_entries",
    "voucher_inventory_entries",
    "bills",
    "voucher_drafts",
    "sync_runs",
    "audit_log",
)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--scope",
        action="append",
        dest="scopes",
        choices=["masters", "vouchers", "bills"],
        help="Scope to pull (repeatable)",
    )
    parser.add_argument(
        "--fake",
        action="store_true",
        help="Self-test against the in-process fake Tally instead of the LAN",
    )
    parser.add_argument("--skip-migrate", action="store_true")
    return parser.parse_args(argv)


def run_migrations() -> int:
    print("== alembic upgrade head")
    result = subprocess.run(  # noqa: S603 - fixed command, no user input
        ["uv", "run", "alembic", "upgrade", "head"], cwd=MIDDLEWARE, check=False
    )
    return result.returncode


def build_client(settings: Settings, session, use_fake: bool) -> TallyClient:
    transport = (
        FakeTallyTransport()
        if use_fake
        else HttpxTransport(
            settings.tally_host, settings.tally_port, settings.tally_timeout_seconds
        )
    )
    company = "Acme Foods Pvt Ltd" if use_fake else settings.tally_company_name
    return TallyClient(transport, company=company, audit=SessionAuditSink(session))


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    settings = Settings()
    if args.fake:
        settings = settings.model_copy(
            update={"database_url": resolve_sqlite_url("sqlite:///./data/talai-fake.db")}
        )
    if not args.skip_migrate and not args.fake and run_migrations() != 0:
        print("alembic upgrade failed")
        return 2

    database = Database(settings.database_url)
    database.create_all()
    session = database.new_session()
    problems: list[str] = []
    try:
        client = build_client(settings, session, args.fake)
        scopes = args.scopes or ["masters", "vouchers", "bills"]
        print(
            f"\n== pulling {', '.join(scopes)} from "
            f"{'the fake Tally' if args.fake else settings.tally_url}"
        )
        run = SyncPuller(session, client, settings).run(scopes)
        session.commit()
        print(f"   status={run.status} seen={run.records_seen} changed={run.records_changed}")
        if run.error:
            print(f"   error: {run.error}")
            problems.append("the pull run failed")

        print("\n== row counts")
        counts = repo.table_counts(session)
        for table in INTERESTING_TABLES:
            print(f"   {table:32} {counts.get(table, 0):>8}")

        print("\n== recent sync runs")
        for entry in repo.latest_sync_runs(session, limit=5):
            print(
                f"   #{entry.id} {entry.kind:5} {entry.scope:24} {entry.status:8} "
                f"seen={entry.records_seen} changed={entry.records_changed}"
            )

        print("\n== reconciliation")
        problems += reconcile(session, client, counts)
    finally:
        session.close()

    if problems:
        print("\nFAILED:")
        for problem in problems:
            print(f"  - {problem}")
        return 1
    print("\nAll checks reconciled.")
    return 0


def reconcile(session, client: TallyClient, counts: dict[str, int]) -> list[str]:
    """Compare the replica against a fresh read of Tally."""
    problems: list[str] = []
    try:
        tally_ledgers = len(client.ledgers())
    except Exception as exc:  # noqa: BLE001 - reported, not raised
        print(f"   could not re-read ledgers from Tally: {exc}")
        return ["ledger reconciliation could not run"]

    db_ledgers = counts.get("ledgers", 0)
    ok = tally_ledgers == db_ledgers
    print(f"   ledgers: Tally={tally_ledgers} DB={db_ledgers} {'ok' if ok else 'MISMATCH'}")
    if not ok:
        problems.append(f"ledger count differs (Tally {tally_ledgers}, DB {db_ledgers})")

    for direction in ("payable", "receivable"):
        db_total = repo.sum_pending_bills(session, direction)
        try:
            tally_total = sum(b.pending_amount for b in client.bills(direction))
        except Exception as exc:  # noqa: BLE001
            print(f"   could not re-read {direction} bills: {exc}")
            problems.append(f"{direction} bill reconciliation could not run")
            continue
        ok = abs(tally_total - db_total) < 1
        print(
            f"   {direction} pending: Tally={tally_total} DB={db_total} "
            f"{'ok' if ok else 'MISMATCH'}"
        )
        if not ok:
            problems.append(f"{direction} pending total differs")

    orphans = session.query(models.Voucher).filter(models.Voucher.voucher_number == "").count()
    print(f"   vouchers without a number: {orphans}")
    if orphans:
        problems.append(f"{orphans} voucher(s) have no voucher number")
    return problems


if __name__ == "__main__":
    raise SystemExit(main())
