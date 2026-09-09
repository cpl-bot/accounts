"""App factory, auth and health (plan §3.6, §6)."""
from __future__ import annotations

from fastapi.testclient import TestClient

from talai_middleware.main import create_app


def test_health_needs_no_token(client: TestClient) -> None:
    response = client.get("/health", headers={"Authorization": ""})
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["db"] == "ok"
    assert body["version"]


def test_other_routes_require_a_bearer_token(client: TestClient) -> None:
    response = client.get("/api/v1/tally/status", headers={"Authorization": ""})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"


def test_wrong_token_is_rejected(client: TestClient) -> None:
    response = client.get(
        "/api/v1/tally/status", headers={"Authorization": "Bearer nope"}
    )
    assert response.status_code == 401


def test_valid_token_passes(client: TestClient) -> None:
    assert client.get("/api/v1/tally/status").status_code == 200


def test_cors_headers_come_from_settings(settings, fake_transport) -> None:
    settings = settings.model_copy(update={"cors_origins": "http://ui.local:3000"})
    with TestClient(create_app(settings, transport=fake_transport)) as client:
        response = client.get(
            "/health", headers={"Origin": "http://ui.local:3000"}
        )
        assert response.headers["access-control-allow-origin"] == "http://ui.local:3000"


def test_unknown_route_uses_the_error_envelope(client: TestClient) -> None:
    body = client.get("/api/v1/does-not-exist").json()
    assert set(body["error"]) >= {"code", "message"}


def test_openapi_is_generated(client: TestClient) -> None:
    schema = client.get("/openapi.json").json()
    assert schema["info"]["title"] == "Talai middleware"
    assert "/api/v1/tally/status" in schema["paths"]
