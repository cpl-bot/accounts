"""Audit sink that writes ``audit_log`` rows into the caller's session.

SQLite allows one writer at a time, so the sink must never open a second
connection while the surrounding unit of work holds a write transaction open —
it would simply block. Instead each request (and each sync run) binds a sink to
its own session; the audit rows commit with the work they describe.
"""

from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from ..audit import AuditEntry
from .repo import write_audit

logger = logging.getLogger(__name__)


class SessionAuditSink:
    """Writes into an existing session. Never raises into the caller's path."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def record(self, entry: AuditEntry) -> None:
        logger.info(
            "tally %s %s status=%s duration_ms=%d hash=%s%s",
            entry.direction,
            entry.operation,
            entry.status,
            entry.duration_ms,
            entry.request_hash,
            f" error={entry.error}" if entry.error else "",
        )
        try:
            write_audit(self.session, entry)
            self.session.flush()
        except Exception:  # noqa: BLE001 - auditing must not break a Tally call
            logger.exception("could not write audit row for %s", entry.operation)
