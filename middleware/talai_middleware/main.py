"""FastAPI application factory and uvicorn entry point.

Run with::

    uv run uvicorn talai_middleware.main:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .api import dashboard, drafts, health, masters, settings_routes, sync, tally, vouchers
from .api.deps import require_token
from .api.errors import install_error_handlers
from .config import Settings, get_settings
from .db.base import Database
from .services.scheduler import SyncScheduler
from .tally.client import TallyClient
from .tally.transport import HttpxTransport, TallyTransport

logger = logging.getLogger(__name__)

API_PREFIX = "/api/v1"
PROTECTED_ROUTERS = (
    tally.router,
    settings_routes.router,
    masters.router,
    vouchers.router,
    drafts.router,
    sync.router,
    dashboard.router,
)


def configure_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)-8s %(name)s %(message)s",
    )


def create_app(
    settings: Settings | None = None, transport: TallyTransport | None = None
) -> FastAPI:
    """Build the application. Tests pass a ``FakeTallyTransport``."""
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    database = Database(settings.database_url)
    database.create_all()
    tally_transport = transport or HttpxTransport(
        settings.tally_host, settings.tally_port, settings.tally_timeout_seconds
    )
    tally_client = TallyClient(
        tally_transport,
        company=settings.tally_company_name,
        store_xml=settings.audit_store_xml,
        timeout=settings.tally_timeout_seconds,
    )
    scheduler = SyncScheduler(settings, database, tally_client)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        await scheduler.start()
        try:
            yield
        finally:
            await scheduler.stop()

    app = FastAPI(
        title="Talai middleware",
        version=__version__,
        description=(
            "The only component allowed to talk to TallyPrime. Every route under "
            "/api/v1 requires a bearer token; /health does not."
        ),
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.database = database
    app.state.tally = tally_client
    app.state.scheduler = scheduler

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    install_error_handlers(app)

    app.include_router(health.router)
    for router in PROTECTED_ROUTERS:
        app.include_router(router, prefix=API_PREFIX, dependencies=[Depends(require_token)])
    return app


app = create_app()
