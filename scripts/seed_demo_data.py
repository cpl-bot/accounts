#!/usr/bin/env python
"""Seed the SQLite replica from the fake Tally, so the UI runs without Tally.

    uv run --project middleware python scripts/seed_demo_data.py
    uv run --project middleware python scripts/seed_demo_data.py --reset

Creates masters, two months of vouchers, open bills, and one queued draft so
the Accounts Payable screens have something to show.
"""

from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "middleware"))

from talai_middleware.config import Settings  # noqa: E402
from talai_middleware.db import repo  # noqa: E402
from talai_middleware.db.base import Database  # noqa: E402
from talai_middleware.db.models import Base  # noqa: E402
from talai_middleware.services.sync_pull import SyncPuller  # noqa: E402
from talai_middleware.tally.client import TallyClient  # noqa: E402
from talai_middleware.tally.fake import FakeTallyTransport  # noqa: E402
from talai_middleware.tally.fake_seed import COMPANY  # noqa: E402

DEMO_DRAFT = {
    "voucher_type": "Purchase",
    "voucher_date": "2026-06-22",
    "bill_date": "2026-06-22",
    "due_date": "2026-07-22",
    "supplier_invoice_no": "INV/BSM/5001",
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
            "description": "Surgical gloves (box)",
            "stock_item": "Nitrile Gloves",
            "godown": "Main Store",
            "quantity": "20",
            "rate": "450",
            "hsn": "4015",
        }
    ],
    "tax_lines": [{"ledger_name": "IGST @ 18%", "cost_centre": "Procurement",
                   "amount": "1620.00"}],
    "totals": {"taxable_value": "9000.00", "sub_total": "9000.00", "gst": "1620.00",
               "grand_total": "10620.00"},
    "narration": "Demo draft seeded by scripts/seed_demo_data.py",
}


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reset", action="store_true", help="Drop every table first")
    parser.add_argument("--database-url", default=None, help="Override DATABASE_URL")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    settings = Settings()
    if args.database_url:
        settings = settings.model_copy(update={"database_url": args.database_url})

    database = Database(settings.database_url)
    if args.reset:
        Base.metadata.drop_all(database.engine)
    database.create_all()

    client = TallyClient(FakeTallyTransport(), company=COMPANY)
    session = database.new_session()
    try:
        puller = SyncPuller(session, client, settings)
        puller.pull_masters()
        puller.pull_vouchers(date(2026, 5, 1), date(2026, 6, 30))
        puller.pull_bills()
        # Stock valuations at the demo period's boundaries, so the dashboard's
        # trading gross-profit mode (plan §3.9) has something to work with.
        puller.pull_stock_valuations(
            [date(2026, 4, 30), date(2026, 5, 31), date(2026, 6, 30)]
        )
        session.commit()

        if not repo.list_drafts(session):
            draft = repo.create_draft(session, DEMO_DRAFT, created_by="seed_demo_data")
            draft.status = "queued"
            session.commit()

        counts = repo.table_counts(session)
        print(f"Seeded {settings.database_url}")
        for table in ("ledgers", "groups", "stock_items", "stock_valuations", "vouchers",
                      "bills", "voucher_drafts"):
            print(f"  {table:16} {counts.get(table, 0):>6}")
        print("\nStart the middleware and the UI will have data:")
        print("  cd middleware && uv run uvicorn talai_middleware.main:app --port 8000")
        return 0
    finally:
        session.close()


if __name__ == "__main__":
    raise SystemExit(main())
