"""Scheduler: interval, working-hours guard, circuit breaker (plan §3.2, §3.4)."""
from __future__ import annotations

from datetime import datetime

from talai_middleware.db.base import Database
from talai_middleware.services.scheduler import SyncScheduler
from talai_middleware.tally.client import TallyClient
from talai_middleware.tally.fake import FakeTallyTransport


def make(settings, reachable: bool = True) -> SyncScheduler:
    database = Database(settings.database_url)
    database.create_all()
    client = TallyClient(FakeTallyTransport(reachable=reachable), company="Acme Foods Pvt Ltd")
    return SyncScheduler(settings, database, client)


def test_disabled_by_settings_never_starts(settings) -> None:
    scheduler = make(settings)
    assert scheduler.enabled is False


def test_working_hours_guard(settings) -> None:
    scheduler = make(settings.model_copy(update={"sync_working_hours": "08:00-20:00"}))
    assert scheduler.within_working_hours(datetime(2026, 6, 10, 9, 0)) is True
    assert scheduler.within_working_hours(datetime(2026, 6, 10, 7, 59)) is False
    assert scheduler.within_working_hours(datetime(2026, 6, 10, 20, 30)) is False


def test_a_successful_run_pulls_and_resets_the_breaker(settings) -> None:
    scheduler = make(settings)
    scheduler.failures = 2
    assert scheduler.run_once() is True
    assert scheduler.failures == 0
    assert scheduler.breaker_open is False


def test_failures_open_the_breaker_and_back_off(settings) -> None:
    settings = settings.model_copy(update={"sync_interval_minutes": 1})
    scheduler = make(settings, reachable=False)
    for _ in range(settings.sync_breaker_threshold):
        assert scheduler.run_once() is False
    assert scheduler.breaker_open is True
    # Backoff grows with the failure count until it hits the cap.
    scheduler.failures = 1
    first = scheduler.next_delay_seconds()
    scheduler.failures = 2
    assert first < scheduler.next_delay_seconds() <= (
        settings.sync_breaker_max_backoff_minutes * 60
    )


def test_backoff_is_capped(settings) -> None:
    scheduler = make(settings, reachable=False)
    scheduler.failures = 50
    cap = settings.sync_breaker_max_backoff_minutes * 60
    assert scheduler.next_delay_seconds() == cap


def test_normal_delay_is_the_configured_interval(settings) -> None:
    scheduler = make(settings.model_copy(update={"sync_interval_minutes": 7}))
    assert scheduler.next_delay_seconds() == 7 * 60


def test_start_is_a_no_op_when_disabled(settings) -> None:
    import asyncio

    scheduler = make(settings)
    asyncio.run(scheduler.start())
    assert scheduler.task is None
    asyncio.run(scheduler.stop())
