"""Runtime settings overrides stored in the ``settings`` table (plan §3.6)."""

from __future__ import annotations

from fastapi import APIRouter

from ..db import repo
from .deps import SessionDep, SettingsDep
from .schemas import SettingsPayload, SettingsUpdate

router = APIRouter(prefix="/settings", tags=["settings"])

KEYS = ("tally_host", "tally_port", "tally_company_name", "sync_interval_minutes")


def _current(session, settings) -> SettingsPayload:
    stored = repo.all_settings(session)
    return SettingsPayload(
        tally_host=stored.get("tally_host", settings.tally_host),
        tally_port=int(stored.get("tally_port", settings.tally_port)),
        tally_company_name=stored.get("tally_company_name", settings.tally_company_name),
        sync_interval_minutes=int(
            stored.get("sync_interval_minutes", settings.sync_interval_minutes)
        ),
        tally_write_enabled=settings.tally_write_enabled,
    )


@router.get("", response_model=SettingsPayload, summary="Effective settings")
def read_settings(session: SessionDep, settings: SettingsDep) -> SettingsPayload:
    return _current(session, settings)


@router.put("", response_model=SettingsPayload, summary="Override settings")
def update_settings(
    payload: SettingsUpdate, session: SessionDep, settings: SettingsDep
) -> SettingsPayload:
    """``TALLY_WRITE_ENABLED`` is deliberately not settable over HTTP (plan §6)."""
    for key in KEYS:
        value = getattr(payload, key)
        if value is not None:
            repo.set_setting(session, key, str(value))
    session.flush()
    return _current(session, settings)
