"""Shared pytest fixtures: tmp SQLite DB, FakeTallyTransport, TestClient."""
from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path

import pytest

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "xml"

os.environ.setdefault("SYNC_ENABLED", "false")


def load_fixture(name: str) -> str:
    """Read a captured/hand-written Tally XML response."""
    return (FIXTURE_DIR / name).read_text(encoding="utf-8")


@pytest.fixture
def fixture_xml():
    return load_fixture


@pytest.fixture
def settings(tmp_path: Path):
    from talai_middleware.config import Settings

    return Settings(
        _env_file=None,
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        tally_company_name="Acme Foods Pvt Ltd",
        middleware_api_key="test-key",
        sync_enabled=False,
        upload_dir=str(tmp_path / "uploads"),
    )


@pytest.fixture
def fake_transport():
    from talai_middleware.tally.fake import FakeTallyTransport

    return FakeTallyTransport()


@pytest.fixture
def client(settings, fake_transport) -> Iterator:
    from fastapi.testclient import TestClient

    from talai_middleware.main import create_app

    app = create_app(settings, transport=fake_transport)
    with TestClient(app) as test_client:
        test_client.headers.update({"Authorization": "Bearer test-key"})
        yield test_client
