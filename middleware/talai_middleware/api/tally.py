"""Tally connection routes (plan §3.2, §3.6)."""

from __future__ import annotations

from fastapi import APIRouter, Request

from ..tally.client import TallyClient, TallyStatusResult
from ..tally.transport import HttpxTransport
from .deps import SettingsDep, TallyDep
from .schemas import CompanyInfo, CompanyList, TallyStatus, TestConnectionRequest

router = APIRouter(prefix="/tally", tags=["tally"])


def _to_status(
    result: TallyStatusResult, write_enabled: bool, breaker_open: bool = False
) -> TallyStatus:
    return TallyStatus(
        reachable=result.reachable,
        companies=[
            CompanyInfo(
                name=c.name, guid=c.guid, start_from=c.starting_from, books_from=c.books_from
            )
            for c in result.companies
        ],
        active_company=result.active_company,
        expected_company=result.expected_company,
        company_match=result.company_match,
        latency_ms=result.latency_ms,
        checked_at=result.checked_at,
        write_enabled=write_enabled and result.company_match,
        breaker_open=breaker_open,
        error=result.error,
    )


@router.get("/status", response_model=TallyStatus, summary="Connection health")
def status(request: Request, tally: TallyDep, settings: SettingsDep) -> TallyStatus:
    scheduler = getattr(request.app.state, "scheduler", None)
    return _to_status(
        tally.ping(timeout=settings.tally_status_timeout_seconds),
        write_enabled=settings.tally_write_enabled,
        breaker_open=bool(scheduler and scheduler.breaker_open),
    )


@router.post("/test-connection", response_model=TallyStatus, summary="Test an arbitrary host/port")
def test_connection(payload: TestConnectionRequest, settings: SettingsDep) -> TallyStatus:
    """Probe a host/port without saving it — used by the Configuration page."""
    client = TallyClient(
        HttpxTransport(payload.host, payload.port, settings.tally_status_timeout_seconds),
        company=payload.company_name or settings.tally_company_name,
        timeout=settings.tally_status_timeout_seconds,
    )
    return _to_status(client.ping(), write_enabled=settings.tally_write_enabled)


@router.get("/companies", response_model=CompanyList, summary="Companies open in Tally")
def companies(tally: TallyDep) -> CompanyList:
    return CompanyList(
        companies=[
            CompanyInfo(
                name=c.name, guid=c.guid, start_from=c.starting_from, books_from=c.books_from
            )
            for c in tally.list_companies()
        ]
    )
