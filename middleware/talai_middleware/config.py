"""Application configuration.

Every environment variable used by the middleware is declared here and
documented in ``.env.example`` (plan §3.7). Defaults are deliberately safe:
writes to Tally are disabled and full XML is not stored in the audit log.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_WORKING_HOURS = (8, 20)

# The ``middleware/`` directory. Relative paths in settings (the SQLite file,
# the upload directory) and the ``.env`` file are anchored here, so the API
# server, Alembic and the repo-root support scripts all share one database
# no matter which directory they are started from.
MIDDLEWARE_DIR = Path(__file__).resolve().parents[1]

_SQLITE_PREFIX = "sqlite:///"


def resolve_sqlite_url(url: str) -> str:
    """Make a relative ``sqlite:///./file.db`` URL absolute under ``MIDDLEWARE_DIR``.

    Absolute paths (``sqlite:////abs/path``), in-memory databases and non-SQLite
    URLs are returned unchanged.
    """
    if not url.startswith(_SQLITE_PREFIX):
        return url
    path = url[len(_SQLITE_PREFIX) :]
    if not path or path.startswith("/") or path.startswith(":memory:") or path.startswith("file:"):
        return url
    return f"{_SQLITE_PREFIX}{(MIDDLEWARE_DIR / path).resolve()}"


class Settings(BaseSettings):
    """Runtime configuration, read from the environment or ``middleware/.env``."""

    model_config = SettingsConfigDict(
        env_file=str(MIDDLEWARE_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- Tally connection -------------------------------------------------
    tally_host: str = "192.168.1.24"
    tally_port: int = 9000
    tally_company_name: str = ""
    tally_timeout_seconds: float = 30.0
    tally_status_timeout_seconds: float = 5.0
    tally_write_enabled: bool = False

    # --- Middleware -------------------------------------------------------
    middleware_api_key: str = "change-me"
    database_url: str = "sqlite:///./data/talai.db"
    cors_origins: str = "http://localhost:3000"
    host: str = "0.0.0.0"
    port: int = 8000
    log_level: str = "INFO"

    # --- Sync -------------------------------------------------------------
    sync_enabled: bool = True
    sync_interval_minutes: int = 15
    sync_working_hours: str = "08:00-20:00"
    sync_overlap_days: int = 3
    sync_breaker_threshold: int = 3
    sync_breaker_max_backoff_minutes: int = 30

    # --- Push -------------------------------------------------------------
    push_batch_size: int = 10
    push_inter_request_delay_ms: int = 250
    max_future_days: int = 0

    # --- OCR (plan §3.10) -------------------------------------------------
    #: ``none`` disables OCR entirely, ``mock`` returns a bundled fixture,
    #: ``ollama`` calls the local LLM. Bills never leave the LAN.
    ocr_provider: Literal["none", "mock", "ollama"] = "none"
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "gemma3:12b"
    ocr_timeout_seconds: float = 180.0
    #: Below this, a field is listed in a draft's ``review_reasons``.
    ocr_min_confidence: float = 0.7

    # --- Audit / uploads --------------------------------------------------
    audit_store_xml: bool = False
    upload_dir: str = "./data/uploads"
    max_upload_mb: int = 20

    @model_validator(mode="after")
    def _anchor_relative_paths(self) -> Settings:
        self.database_url = resolve_sqlite_url(self.database_url)
        upload = Path(self.upload_dir)
        if not upload.is_absolute():
            self.upload_dir = str((MIDDLEWARE_DIR / upload).resolve())
        return self

    @property
    def ocr_enabled(self) -> bool:
        """False when ``OCR_PROVIDER=none``: uploads are stored, not read."""
        return self.ocr_provider != "none"

    @property
    def tally_url(self) -> str:
        """Base URL of the TallyPrime XML/HTTP server."""
        return f"http://{self.tally_host}:{self.tally_port}"

    @property
    def cors_origins_list(self) -> list[str]:
        """``CORS_ORIGINS`` split into a list; ``*`` is passed through."""
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def working_hours(self) -> tuple[int, int]:
        """``SYNC_WORKING_HOURS`` as ``(start_hour, end_hour)``.

        Falls back to the documented default when the value is unparseable, so a
        typo in ``.env`` never stops the scheduler from running sensibly.
        """
        try:
            start, end = self.sync_working_hours.split("-")
            return int(start.split(":")[0]), int(end.split(":")[0])
        except (ValueError, IndexError):
            return DEFAULT_WORKING_HOURS


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached settings instance used by the app factory and dependencies."""
    return Settings()
