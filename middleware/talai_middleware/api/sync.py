"""Sync endpoints: trigger a pull, commit the outbox, read run history."""

from __future__ import annotations

from fastapi import APIRouter, Query

from ..db import repo
from ..services import sync_push
from ..services.sync_pull import SCOPES, SyncPuller
from .deps import SessionDep, SettingsDep, TallyDep
from .errors import ApiError
from .schemas import (
    PullRequest,
    PushRequest,
    PushResponse,
    SyncRunList,
    SyncRunOut,
    SyncScopeStatus,
    SyncStatusOut,
)

router = APIRouter(prefix="/sync", tags=["sync"])


@router.post("/pull", response_model=SyncRunList, summary="Pull from Tally now")
def pull(
    payload: PullRequest, session: SessionDep, tally: TallyDep, settings: SettingsDep
) -> SyncRunList:
    """One run row per scope, in the order the scopes were attempted."""
    runs = SyncPuller(session, tally, settings).run(
        payload.scopes, payload.from_date, payload.to_date
    )
    return SyncRunList(items=[SyncRunOut.model_validate(r) for r in runs])


@router.post("/push", response_model=PushResponse, summary="Commit queued drafts")
def push(
    payload: PushRequest, session: SessionDep, tally: TallyDep, settings: SettingsDep
) -> PushResponse:
    run, results = sync_push.push(session, tally, settings, payload.draft_ids)
    return PushResponse(run=SyncRunOut.model_validate(run), results=results)


@router.get("/status", response_model=SyncStatusOut, summary="Per-scope pull status")
def status(session: SessionDep) -> SyncStatusOut:
    """Where each pull scope stands: latest run, latest success, latest error."""
    latest = repo.latest_pull_run_per_scope(session)
    scopes = []
    for scope in SCOPES:
        run = latest.get(scope)
        success = repo.last_successful_pull(session, scope)
        scopes.append(
            SyncScopeStatus(
                scope=scope,
                status=run.status if run else None,
                last_run_at=run.started_at if run else None,
                last_finished_at=run.finished_at if run else None,
                last_success_at=success.finished_at if success else None,
                error=run.error if run else None,
            )
        )
    return SyncStatusOut(scopes=scopes)


@router.get("/runs", response_model=SyncRunList, summary="Recent sync runs")
def runs(session: SessionDep, limit: int = Query(20, ge=1, le=200)) -> SyncRunList:
    return SyncRunList(
        items=[SyncRunOut.model_validate(r) for r in repo.latest_sync_runs(session, limit)]
    )


@router.get("/runs/{run_id}", response_model=SyncRunOut, summary="One sync run")
def run(run_id: int, session: SessionDep) -> SyncRunOut:
    row = repo.get_sync_run(session, run_id)
    if row is None:
        raise ApiError(404, "NOT_FOUND", f"Sync run {run_id} does not exist")
    return SyncRunOut.model_validate(row)
