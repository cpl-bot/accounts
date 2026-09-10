"""Interval pull scheduler with a working-hours guard and a circuit breaker.

Started from the FastAPI lifespan. It never raises at users: an unreachable
Tally just increments a failure counter, which backs the next attempt off
exponentially up to ``SYNC_BREAKER_MAX_BACKOFF_MINUTES``. Set
``SYNC_ENABLED=false`` (the default in tests) to disable it entirely.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime

from ..config import Settings
from ..db.audit_sink import SessionAuditSink
from ..db.base import Database
from ..tally.client import TallyClient
from .sync_pull import SyncPuller

logger = logging.getLogger(__name__)


class SyncScheduler:
    """Owns the background pull task."""

    def __init__(self, settings: Settings, database: Database, client: TallyClient) -> None:
        self.settings = settings
        self.database = database
        self.client = client
        self.task: asyncio.Task | None = None
        self.failures = 0
        self._stopping = asyncio.Event()

    @property
    def enabled(self) -> bool:
        return self.settings.sync_enabled

    @property
    def breaker_open(self) -> bool:
        """True once consecutive failures have crossed the threshold."""
        return self.failures >= self.settings.sync_breaker_threshold

    def within_working_hours(self, now: datetime | None = None) -> bool:
        start, end = self.settings.working_hours
        hour = (now or datetime.now()).hour
        return start <= hour < end

    def next_delay_seconds(self) -> int:
        """Interval normally; exponential backoff while the breaker is open."""
        base = self.settings.sync_interval_minutes * 60
        if not self.failures:
            return base
        cap = self.settings.sync_breaker_max_backoff_minutes * 60
        return min(base * (2**self.failures), cap)

    def run_once(self) -> bool:
        """One pull of every scope. True only when every scope succeeded."""
        session = self.database.new_session()
        try:
            client = self.client.with_audit(SessionAuditSink(session))
            runs = SyncPuller(session, client, self.settings).run()
            # One row per scope now: the whole attempt only counts as a success
            # when every scope succeeded (a partial sync is a failed run).
            failed = [r.scope for r in runs if r.status != "success"]
            success = not failed
        finally:
            session.close()
        if success:
            self.failures = 0
        else:
            self.failures += 1
            logger.warning(
                "scheduled pull failed for %s (%d consecutive)",
                ", ".join(failed) or "no scopes",
                self.failures,
            )
        return success

    async def start(self) -> None:
        if not self.enabled:
            logger.info("sync scheduler disabled (SYNC_ENABLED=false)")
            return
        self._stopping.clear()
        self.task = asyncio.create_task(self._loop(), name="talai-sync")
        logger.info(
            "sync scheduler started: every %d min within %s",
            self.settings.sync_interval_minutes,
            self.settings.sync_working_hours,
        )

    async def stop(self) -> None:
        self._stopping.set()
        if self.task is None:
            return
        self.task.cancel()
        try:
            await self.task
        except (asyncio.CancelledError, Exception):  # noqa: B014 - shutdown is best effort
            pass
        self.task = None

    async def _loop(self) -> None:  # pragma: no cover - exercised via run_once
        while not self._stopping.is_set():
            try:
                await asyncio.wait_for(
                    self._stopping.wait(), timeout=self.next_delay_seconds()
                )
                return
            except TimeoutError:
                pass
            if not self.within_working_hours():
                logger.debug("outside working hours; skipping scheduled pull")
                continue
            await asyncio.to_thread(self.run_once)
