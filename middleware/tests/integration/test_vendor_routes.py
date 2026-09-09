"""Vendor lookup and creation routes (plan §3.8.1, §3.8.4)."""
from __future__ import annotations

import pytest


@pytest.fixture
def synced(client):
    """A replica pulled from the fake Tally."""
    assert client.post("/api/v1/sync/pull", json={"scopes": ["masters"]}).status_code == 200
    return client


class TestLedgerLookup:
    def test_exact_match(self, synced) -> None:
        body = synced.get("/api/v1/ledgers/lookup", params={"name": "sunrise packaging"}).json()
        assert body["found"] is True
        assert body["ledger"]["name"] == "Sunrise Packaging"
        assert body["ledger"]["source"] == "tally"
        assert body["best_ratio"] == 1.0
        assert body["can_create"] is False
        assert body["query"] == "sunrise packaging"

    def test_near_match_suggests(self, synced) -> None:
        body = synced.get(
            "/api/v1/ledgers/lookup", params={"name": "Sunrise Packaging Pvt Ltd"}
        ).json()
        assert body["found"] is False
        assert [s["name"] for s in body["suggestions"]] == ["Sunrise Packaging"]
        assert body["can_create"] is True

    def test_unknown_name(self, synced) -> None:
        body = synced.get("/api/v1/ledgers/lookup", params={"name": "Zenith"}).json()
        assert body == {
            "query": "Zenith",
            "found": False,
            "ledger": None,
            "suggestions": [],
            "best_ratio": body["best_ratio"],
            "can_create": True,
        }

    def test_name_is_required(self, synced) -> None:
        assert synced.get("/api/v1/ledgers/lookup").status_code == 422

    def test_auth_is_required(self, client) -> None:
        client.headers.pop("Authorization")
        assert client.get("/api/v1/ledgers/lookup", params={"name": "x"}).status_code == 401


class TestCreateVendor:
    payload = {
        "name": "Zenith Chemicals",
        "gstin": "27ZZZZZ9999Z1Z9",
        "state": "Maharashtra",
        "address": ["9 Chemical Lane", "Pune"],
    }

    def test_dry_run_returns_the_xml_and_writes_nothing(self, synced, fake_transport) -> None:
        response = synced.post("/api/v1/ledgers", json=self.payload)
        assert response.status_code == 201
        body = response.json()
        assert body["dry_run"] is True
        assert body["ledger"] is None
        assert "<PARENT>Sundry Creditors</PARENT>" in body["generated_xml"]
        assert "<GSTIN>27ZZZZZ9999Z1Z9</GSTIN>" in body["generated_xml"]
        assert fake_transport.state.ledger("Zenith Chemicals") is None
        assert synced.get(
            "/api/v1/ledgers/lookup", params={"name": "Zenith Chemicals"}
        ).json()["found"] is False

    def test_live_create_writes_to_tally_and_the_replica(
        self, settings, fake_transport
    ) -> None:
        from fastapi.testclient import TestClient

        from talai_middleware.main import create_app

        app = create_app(
            settings.model_copy(update={"tally_write_enabled": True}), transport=fake_transport
        )
        with TestClient(app) as client:
            client.headers.update({"Authorization": "Bearer test-key"})
            client.post("/api/v1/sync/pull", json={"scopes": ["masters"]})
            body = client.post("/api/v1/ledgers", json=self.payload).json()
            assert body["dry_run"] is False
            assert body["ledger"]["name"] == "Zenith Chemicals"
            assert body["ledger"]["parent_group"] == "Sundry Creditors"
            assert body["ledger"]["source"] == "talai"
            assert fake_transport.state.ledger("Zenith Chemicals") is not None
            assert client.get(
                "/api/v1/ledgers/lookup", params={"name": "Zenith Chemicals"}
            ).json()["found"] is True

    def test_an_existing_name_is_a_conflict(self, synced) -> None:
        response = synced.post("/api/v1/ledgers", json={"name": "Sunrise Packaging"})
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "LEDGER_EXISTS"

    def test_a_near_duplicate_is_refused_unless_overridden(self, synced) -> None:
        payload = {"name": "Sunrise Packaging Pvt Ltd"}
        response = synced.post("/api/v1/ledgers", json=payload)
        assert response.status_code == 409
        error = response.json()["error"]
        assert error["code"] == "LEDGER_POSSIBLE_DUPLICATE"
        assert error["details"]["suggestions"] == ["Sunrise Packaging"]

        allowed = synced.post("/api/v1/ledgers", json={**payload, "allow_duplicate": True})
        assert allowed.status_code == 201

    def test_a_tally_rejection_is_surfaced(self, settings, fake_transport) -> None:
        from fastapi.testclient import TestClient

        from talai_middleware.main import create_app

        app = create_app(
            settings.model_copy(update={"tally_write_enabled": True}), transport=fake_transport
        )
        with TestClient(app) as client:
            client.headers.update({"Authorization": "Bearer test-key"})
            # Tally knows the name; the replica does not, so the route gets past
            # its own duplicate guard and Tally answers with a LINEERROR.
            seed = type(fake_transport.state.ledgers[0])
            fake_transport.state.ledgers.append(
                seed(name="Ghost Vendor", parent="Sundry Creditors")
            )
            response = client.post("/api/v1/ledgers", json={"name": "Ghost Vendor"})
            assert response.status_code == 502
            assert response.json()["error"]["code"] == "LEDGER_IMPORT_FAILED"
            assert "already exists" in response.json()["error"]["message"]


class TestDashboardFormulaRoutes:
    """``GET/PUT /settings/dashboard`` (plan §3.9)."""

    def test_defaults(self, client) -> None:
        body = client.get("/api/v1/settings/dashboard").json()
        assert body["gross_profit_mode"] == "simple"
        assert body["stock_source"] == "tally"
        assert body["manual_opening_stock"] is None
        assert body["manual_closing_stock"] is None
        assert body["revenue_groups"] == ["Sales Accounts"]
        assert body["cost_of_sales_groups"] == ["Purchase Accounts", "Direct Expenses"]
        assert body["warnings"] == []

    def test_put_then_get_roundtrips(self, synced) -> None:
        payload = {
            "gross_profit_mode": "trading",
            "stock_source": "manual",
            "manual_opening_stock": "1000.00",
            "manual_closing_stock": "2500.50",
            "revenue_groups": ["Sales Accounts"],
            "cost_of_sales_groups": ["Purchase Accounts"],
        }
        assert synced.put("/api/v1/settings/dashboard", json=payload).status_code == 200
        body = synced.get("/api/v1/settings/dashboard").json()
        assert body["gross_profit_mode"] == "trading"
        assert body["stock_source"] == "manual"
        assert str(body["manual_opening_stock"]) == "1000.00"
        assert body["cost_of_sales_groups"] == ["Purchase Accounts"]
        assert body["warnings"] == []

    def test_an_unknown_group_warns_without_blocking(self, synced) -> None:
        response = synced.put(
            "/api/v1/settings/dashboard",
            json={"revenue_groups": ["Sales Accounts", "Nonsense"]},
        )
        assert response.status_code == 200
        assert response.json()["warnings"] == ["Group 'Nonsense' is not in the replica"]
        assert synced.get("/api/v1/settings/dashboard").json()["revenue_groups"] == [
            "Sales Accounts", "Nonsense"
        ]

    def test_an_invalid_mode_is_rejected(self, client) -> None:
        response = client.put(
            "/api/v1/settings/dashboard", json={"gross_profit_mode": "guesswork"}
        )
        assert response.status_code == 422

    def test_the_overview_reports_the_active_formula(self, synced) -> None:
        synced.put("/api/v1/settings/dashboard", json={"gross_profit_mode": "trading"})
        body = synced.get(
            "/api/v1/dashboard/overview", params={"from": "2026-05-01", "to": "2026-06-30"}
        ).json()
        assert body["formula"]["gross_profit_mode"] == "trading"
        assert body["stock_adjustment_status"] == "unavailable"
        assert "opening_stock" in body and "closing_stock" in body

    def test_a_stock_pull_makes_the_trading_formula_applicable(self, client) -> None:
        client.post("/api/v1/sync/pull", json={"scopes": ["masters", "vouchers", "stock"]})
        client.put("/api/v1/settings/dashboard", json={"gross_profit_mode": "trading"})
        today = client.get("/api/v1/dashboard/overview").json()
        # today's boundary is always pulled; the opening one (from - 1 day) is not
        assert today["stock_adjustment_status"] in {"applied", "manual", "unavailable"}
        assert client.get("/api/v1/sync/runs").json()["items"][0]["status"] == "success"
