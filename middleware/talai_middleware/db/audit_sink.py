"""Audit sink that writes ``audit_log`` rows into the caller's session.

SQLite allows one writer at a time, so the sink must never open a second
connection while the surrounding unit of work holds a write transaction open —
it would simply block. Instead each request (and each sync run) binds a sink to
its own session; the audit rows commit with the work they describe.

Because they share the caller's transaction, a rollback takes the audit rows
with it — which would erase the record of the very Tally call that forced the
rollback. The sink therefore buffers the entries it has written but not yet
seen committed, and exposes :meth:`replay` (re-write them after a rollback) and
:meth:`checkpoint` (forget them once the caller has committed). Callers that do
not care — every request route, which either commits or fails as a whole — can
ignore both.
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
        #: entries written into the session but not yet known to be committed
        self.buffered: list[AuditEntry] = []

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
        self.buffered.append(entry)
        self._write(entry)

    def checkpoint(self) -> None:
        """Forget the buffered entries: the caller has committed their rows."""
        self.buffered.clear()

    def replay(self) -> None:
        """Re-write the buffered entries a rollback discarded."""
        for entry in self.buffered:
            self._write(entry)

    def _write(self, entry: AuditEntry) -> None:
        try:
            write_audit(self.session, entry)
            self.session.flush()
        except Exception:  # noqa: BLE001 - auditing must not break a Tally call
            logger.exception("could not write audit row for %s", entry.operation)
