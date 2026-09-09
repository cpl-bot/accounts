"""Liveness endpoint — the one route that needs no token."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from .. import __version__
from .deps import DatabaseDep

router = APIRouter(tags=["health"])


class Health(BaseModel):
    status: str
    version: str
    db: str


@router.get("/health", response_model=Health, summary="Liveness probe")
def health(database: DatabaseDep) -> Health:
    return Health(
        status="ok", version=__version__, db="ok" if database.healthy() else "error"
    )
