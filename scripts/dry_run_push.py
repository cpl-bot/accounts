#!/usr/bin/env python
"""Validate queued drafts and print the XML that would be sent to Tally.

    uv run --project middleware python scripts/dry_run_push.py
    uv run --project middleware python scripts/dry_run_push.py --draft <uuid>

Writes are forced off regardless of TALLY_WRITE_ENABLED, so this is always safe
to run against the production Tally host.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "middleware"))

from talai_middleware.config import Settings  # noqa: E402
from talai_middleware.db.audit_sink import SessionAuditSink  # noqa: E402
from talai_middleware.db.base import Database  # noqa: E402
from talai_middleware.db.repo import get_draft  # noqa: E402
from talai_middleware.services import sync_push  # noqa: E402
from talai_middleware.tally.client import TallyClient  # noqa: E402
from talai_middleware.tally.transport import HttpxTransport  # noqa: E402


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--draft", action="append", dest="drafts", help="Draft id (repeatable)")
    parser.add_argument("--no-xml", action="store_true", help="Print results only")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    settings = Settings().model_copy(update={"tally_write_enabled": False})
    database = Database(settings.database_url)
    session = database.new_session()
    client = TallyClient(
        HttpxTransport(settings.tally_host, settings.tally_port, settings.tally_timeout_seconds),
        company=settings.tally_company_name,
        audit=SessionAuditSink(session),
    )
    try:
        _run, results = sync_push.push(session, client, settings, args.drafts)
        session.commit()
        if not results:
            print("No queued drafts to push.")
            return 0
        failures = 0
        for result in results:
            print(f"\n=== draft {result.draft_id}: {result.status} ===")
            for issue in result.errors:
                print(f"  [{issue.severity}] {issue.code} {issue.field}: {issue.message}")
            if result.status == "failed":
                failures += 1
                continue
            draft = get_draft(session, result.draft_id)
            if draft and draft.generated_xml and not args.no_xml:
                print(draft.generated_xml)
        print(f"\n{len(results)} draft(s) processed, {failures} failed. Nothing was sent.")
        return 1 if failures else 0
    finally:
        session.close()


if __name__ == "__main__":
    raise SystemExit(main())
