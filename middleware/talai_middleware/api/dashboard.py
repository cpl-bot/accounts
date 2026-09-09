"""Dashboard endpoints, served from the replica (plan §3.6)."""

from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Query

from ..services import aggregates
from .deps import SessionDep
from .schemas import DashboardOverview, DashboardPayables

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

DEFAULT_WINDOW_DAYS = 90


@router.get("/overview", response_model=DashboardOverview, summary="P&L overview")
def overview(
    session: SessionDep,
    from_: date | None = Query(None, alias="from"),
    to: date | None = None,
) -> DashboardOverview:
    to = to or date.today()
    from_ = from_ or (to - timedelta(days=DEFAULT_WINDOW_DAYS))
    return aggregates.overview(session, from_, to)


@router.get("/payables", response_model=DashboardPayables, summary="AP/AR and aging")
def payables(session: SessionDep, as_on: date | None = None) -> DashboardPayables:
    return aggregates.payables(session, as_on or date.today())
