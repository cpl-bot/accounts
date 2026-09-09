"""Tests for settings loading (plan §3.7)."""

from talai_middleware.config import Settings


def test_defaults_are_safe() -> None:
    s = Settings(_env_file=None)
    assert s.tally_port == 9000
    assert s.tally_write_enabled is False
    assert s.audit_store_xml is False
    assert s.sync_interval_minutes == 15
    assert s.push_batch_size == 10
    assert s.push_inter_request_delay_ms == 250
    assert s.sync_overlap_days == 3
    assert s.max_future_days == 0
    assert s.cors_origins_list == ["http://localhost:3000"]
    assert s.working_hours == (8, 20)
    assert s.tally_url == f"http://{s.tally_host}:{s.tally_port}"


def test_cors_origins_split_and_wildcard() -> None:
    s = Settings(_env_file=None, cors_origins="http://a.local:3000, http://b.local")
    assert s.cors_origins_list == ["http://a.local:3000", "http://b.local"]
    assert Settings(_env_file=None, cors_origins="*").cors_origins_list == ["*"]


def test_working_hours_parsing() -> None:
    assert Settings(_env_file=None, sync_working_hours="06:30-22:15").working_hours == (6, 22)
    assert Settings(_env_file=None, sync_working_hours="bogus").working_hours == (8, 20)


def test_relative_sqlite_url_is_anchored_to_middleware_dir() -> None:
    from talai_middleware.config import MIDDLEWARE_DIR

    s = Settings(_env_file=None, database_url="sqlite:///./data/x.db")
    assert s.database_url == f"sqlite:///{MIDDLEWARE_DIR / 'data' / 'x.db'}"
    # Already-absolute, in-memory and non-sqlite URLs are left alone.
    assert (
        Settings(_env_file=None, database_url="sqlite:////tmp/a.db").database_url
        == "sqlite:////tmp/a.db"
    )
    assert (
        Settings(_env_file=None, database_url="sqlite:///:memory:").database_url
        == "sqlite:///:memory:"
    )
    pg = "postgresql://u:p@h/db"
    assert Settings(_env_file=None, database_url=pg).database_url == pg


def test_relative_upload_dir_is_anchored_to_middleware_dir() -> None:
    from talai_middleware.config import MIDDLEWARE_DIR

    s = Settings(_env_file=None, upload_dir="./data/uploads")
    assert s.upload_dir == str(MIDDLEWARE_DIR / "data" / "uploads")
    assert Settings(_env_file=None, upload_dir="/srv/uploads").upload_dir == "/srv/uploads"


def test_env_file_is_read_from_middleware_dir_not_cwd() -> None:
    from talai_middleware.config import MIDDLEWARE_DIR

    assert Settings.model_config["env_file"] == str(MIDDLEWARE_DIR / ".env")


# --------------------------------------------------------------------------
# OCR (plan §3.10)
# --------------------------------------------------------------------------


def test_ocr_defaults_are_off() -> None:
    from talai_middleware.config import Settings

    settings = Settings(_env_file=None)
    assert settings.ocr_provider == "none"
    assert settings.ocr_enabled is False
    assert settings.ollama_base_url == "http://localhost:11434"
    assert settings.ollama_model == "gemma3:12b"
    assert settings.ocr_timeout_seconds == 180.0
    assert settings.ocr_min_confidence == 0.7


def test_ocr_provider_is_validated() -> None:
    import pytest
    from pydantic import ValidationError

    from talai_middleware.config import Settings

    assert Settings(_env_file=None, ocr_provider="ollama").ocr_enabled is True
    with pytest.raises(ValidationError):
        Settings(_env_file=None, ocr_provider="tesseract")
