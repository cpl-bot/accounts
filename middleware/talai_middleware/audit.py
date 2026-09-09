"""Audit sink for every exchange with Tally (plan §3.1).

The client calls :meth:`AuditSink.record` for every request, successful or not.
The default sink only logs; the DB-backed sink in ``db.repo`` writes an
``audit_log`` row. Full XML is stored only when ``AUDIT_STORE_XML`` is true.
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from typing import Protocol, runtime_checkable

logger = logging.getLogger(__name__)


def request_hash(xml: str) -> str:
    """Stable short hash of a request, used to correlate retries."""
    return hashlib.sha256(xml.encode("utf-8")).hexdigest()[:16]


@dataclass
class AuditEntry:
    """One request/response exchange with Tally."""

    direction: str
    operation: str
    request_hash: str
    status: str
    duration_ms: int
    request_xml: str | None = None
    response_xml: str | None = None
    error: str | None = None


@runtime_checkable
class AuditSink(Protocol):
    def record(self, entry: AuditEntry) -> None: ...


class LoggingAuditSink:
    """Default sink: a single structured log line per exchange."""

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


class MemoryAuditSink:
    """Collects entries in a list; used by tests and the support scripts."""

    def __init__(self) -> None:
        self.entries: list[AuditEntry] = []

    def record(self, entry: AuditEntry) -> None:
        self.entries.append(entry)
