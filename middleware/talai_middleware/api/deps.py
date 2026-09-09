"""Shared dependencies: settings, DB session, Tally client, bearer auth."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from ..config import Settings
from ..db.audit_sink import SessionAuditSink
from ..db.base import Database
from ..tally.client import TallyClient
from .errors import ApiError


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_database(request: Request) -> Database:
    return request.app.state.database


def get_session(request: Request) -> Iterator[Session]:
    database: Database = request.app.state.database
    session = database.new_session()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_tally(request: Request, session: Session = Depends(get_session)) -> TallyClient:
    """A client whose audit rows join this request's transaction."""
    return request.app.state.tally.with_audit(SessionAuditSink(session))


def require_token(request: Request) -> None:
    """Bearer-token auth for everything under ``/api/v1`` (plan §6)."""
    settings: Settings = request.app.state.settings
    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise ApiError(401, "UNAUTHORIZED", "A bearer token is required")
    if token != settings.middleware_api_key:
        raise ApiError(401, "UNAUTHORIZED", "Invalid API key")


SettingsDep = Annotated[Settings, Depends(get_settings)]
SessionDep = Annotated[Session, Depends(get_session)]
TallyDep = Annotated[TallyClient, Depends(get_tally)]
DatabaseDep = Annotated[Database, Depends(get_database)]
