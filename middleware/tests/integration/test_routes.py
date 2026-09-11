"""Route-level contract tests against the FakeTallyTransport (plan §3.6)."""
from __future__ import annotations

from fastapi.testclient import TestClient

PAYLOAD = {
    "voucher_type": "Purchase",
    "voucher_date": "2026-06-10",
    "bill_date": "2026-06-10",
    "due_date": "2026-07-09",
    "supplier_invoice_no": "INV/API/0001",
    "cost_centre": "Procurement",
    "party": {"ledger_name": "BioShield Medical & Co", "gstin": "27AAAAA0000A1Z5"},
    "purchase_ledger": "Purchase",
    "items": [
        {"stock_item": "Nitrile Gloves", "godown": "Main Store",
         "quantity": "50", "rate": "450", "hsn": "4015"}
    ],
    "tax_lines": [{"ledger_name": "IGST @ 18%", "amount": "4050.00"}],
    "totals": {"taxable_value": "22500.00", "sub_total": "22500.00",
               "gst": "4050.00", "grand_total": "26550.00"},
}


def pull_everything(client: TestClient) -> None:
    response = client.post(
        "/api/v1/sync/pull",
        json={"scopes": ["masters", "vouchers", "bills"],
              "from_date": "2026-05-01", "to_date": "2026-06-30"},
    )
    assert response.status_code == 200, response.text
    items = response.json()["items"]
    assert [i["scope"] for i in items] == ["masters", "vouchers", "bills"]
    assert all(i["status"] == "success" for i in items)


class TestTallyRoutes:
    def test_status(self, client: TestClient) -> None:
        body = client.get("/api/v1/tally/status").json()
        assert body["reachable"] is True
        assert body["company_match"] is True
        assert body["write_enabled"] is False  # default safety switch
        assert body["breaker_open"] is False

    def test_companies(self, client: TestClient) -> None:
        names = [c["name"] for c in client.get("/api/v1/tally/companies").json()["companies"]]
        assert "Acme Foods Pvt Ltd" in names


class TestMasters:
    def test_ledgers_filter_and_paginate(self, client: TestClient) -> None:
        pull_everything(client)
        body = client.get("/api/v1/ledgers?group=Sundry Creditors").json()
        assert body["total"] == 2
        assert {i["name"] for i in body["items"]} == {
            "BioShield Medical & Co", "Sunrise Packaging"
        }
        assert client.get("/api/v1/ledgers?q=bioshield").json()["total"] == 1
        assert len(client.get("/api/v1/ledgers?limit=3").json()["items"]) == 3

    def test_lookups(self, client: TestClient) -> None:
        pull_everything(client)
        for path, expected in (
            ("/api/v1/groups", "Sales Accounts"),
            ("/api/v1/stock-items", "Nitrile Gloves"),
            ("/api/v1/cost-centres", "Procurement"),
            ("/api/v1/godowns", "Main Store"),
            ("/api/v1/voucher-types", "Purchase"),
        ):
            names = [i["name"] for i in client.get(path).json()["items"]]
            assert expected in names


class TestVouchersAndBills:
    def test_vouchers_and_detail(self, client: TestClient) -> None:
        pull_everything(client)
        listing = client.get("/api/v1/vouchers?type=Purchase&from=2026-06-01").json()
        assert listing["total"] >= 1
        voucher_id = listing["items"][0]["id"]
        detail = client.get(f"/api/v1/vouchers/{voucher_id}").json()
        assert detail["ledger_entries"]
        assert client.get("/api/v1/vouchers/999999").status_code == 404

    def test_bills_with_buckets(self, client: TestClient) -> None:
        pull_everything(client)
        body = client.get("/api/v1/bills?direction=payable&as_on=2026-07-01").json()
        assert [b["label"] for b in body["buckets"]] == [
            "Current", "1-30", "31-60", "61-90", "90+"
        ]
        assert float(body["total_pending"]) > 0

    def test_bills_filter_and_party_ranking(self, client: TestClient) -> None:
        pull_everything(client)
        filtered = client.get("/api/v1/bills?party=bioshield").json()
        assert {bill["party_ledger"] for bill in filtered["items"]} == {
            "BioShield Medical & Co"
        }
        assert client.get("/api/v1/bills?party=does-not-exist").json()["items"] == []

        ranking = client.get("/api/v1/bills/by-party?direction=payable").json()
        assert ranking["items"] == [
            {
                "party_ledger": "BioShield Medical & Co",
                "total_pending": "29875.00",
                "open_bill_count": 2,
            },
            {
                "party_ledger": "Sunrise Packaging",
                "total_pending": "18880.00",
                "open_bill_count": 1,
            },
        ]

    def test_bad_direction_is_rejected(self, client: TestClient) -> None:
        assert client.get("/api/v1/bills?direction=sideways").status_code == 422


class TestDashboard:
    def test_overview(self, client: TestClient) -> None:
        pull_everything(client)
        body = client.get("/api/v1/dashboard/overview?from=2026-05-01&to=2026-06-30").json()
        assert float(body["revenue"]) == 86000.0
        assert float(body["gross_profit"]) == 38175.0
        assert len(body["trends"]) == 2

    def test_payables(self, client: TestClient) -> None:
        pull_everything(client)
        body = client.get("/api/v1/dashboard/payables?as_on=2026-07-01").json()
        assert float(body["total_payable"]) > 0
        assert body["payable_buckets"]


class TestDraftsLifecycle:
    def test_create_validate_queue_and_dry_run_push(self, client: TestClient) -> None:
        pull_everything(client)
        created = client.post("/api/v1/drafts", json=PAYLOAD)
        assert created.status_code == 201, created.text
        draft = created.json()
        assert draft["status"] == "validated"
        assert draft["errors"] == []

        draft_id = draft["id"]
        assert client.post(f"/api/v1/drafts/{draft_id}/validate").json()["status"] == (
            "validated"
        )
        queued = client.post(f"/api/v1/drafts/{draft_id}/queue").json()
        assert queued["status"] == "queued"

        pushed = client.post("/api/v1/sync/push", json={}).json()
        assert pushed["results"][0]["dry_run"] is True
        assert pushed["results"][0]["status"] == "validated"
        stored = client.get(f"/api/v1/drafts/{draft_id}").json()
        assert "<REMOTEID>" in stored["generated_xml"]

    def test_invalid_draft_reports_issues_and_cannot_be_queued(
        self, client: TestClient
    ) -> None:
        pull_everything(client)
        bad = dict(PAYLOAD, party={"ledger_name": "Ghost Supplier"})
        draft = client.post("/api/v1/drafts", json=bad).json()
        assert draft["status"] == "draft"
        assert "LEDGER_NOT_FOUND" in [e["code"] for e in draft["errors"]]
        response = client.post(f"/api/v1/drafts/{draft['id']}/queue")
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "DRAFT_INVALID"

    def test_update_and_delete(self, client: TestClient) -> None:
        pull_everything(client)
        draft_id = client.post("/api/v1/drafts", json=PAYLOAD).json()["id"]
        updated = client.put(
            f"/api/v1/drafts/{draft_id}",
            json=dict(PAYLOAD, narration="Updated narration"),
        ).json()
        assert updated["payload"]["narration"] == "Updated narration"
        assert client.delete(f"/api/v1/drafts/{draft_id}").status_code == 204
        assert client.get(f"/api/v1/drafts/{draft_id}").status_code == 404

    def test_structural_validation_is_a_422(self, client: TestClient) -> None:
        response = client.post("/api/v1/drafts", json={"voucher_date": "not-a-date"})
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "VALIDATION_ERROR"


class TestSyncRoutes:
    def test_pull_returns_one_run_per_scope(self, client: TestClient) -> None:
        body = client.post("/api/v1/sync/pull", json={"scopes": ["masters", "bills"]}).json()
        assert [i["scope"] for i in body["items"]] == ["masters", "bills"]
        assert all(i["kind"] == "pull" and i["status"] == "success" for i in body["items"])

    def test_status_lists_every_scope_in_order(self, client: TestClient) -> None:
        body = client.get("/api/v1/sync/status").json()
        assert [s["scope"] for s in body["scopes"]] == [
            "masters", "vouchers", "bills", "stock"
        ]
        # Nothing has run yet: every scope is unknown.
        assert all(s["status"] is None for s in body["scopes"])
        assert all(s["last_success_at"] is None for s in body["scopes"])

    def test_status_after_a_successful_pull(self, client: TestClient) -> None:
        pull_everything(client)
        scopes = {s["scope"]: s for s in client.get("/api/v1/sync/status").json()["scopes"]}
        for name in ("masters", "vouchers", "bills"):
            assert scopes[name]["status"] == "success"
            assert scopes[name]["last_run_at"] and scopes[name]["last_finished_at"]
            assert scopes[name]["last_success_at"]
            assert scopes[name]["error"] is None
        # ``stock`` was not requested, so it has never run.
        assert scopes["stock"]["status"] is None
        assert scopes["stock"]["last_success_at"] is None

    def test_status_after_a_failed_pull_keeps_the_last_success(
        self, client: TestClient, fake_transport
    ) -> None:
        pull_everything(client)
        fake_transport.fail_on = {"voucher"}
        body = client.post(
            "/api/v1/sync/pull", json={"scopes": ["masters", "vouchers"]}
        ).json()
        assert [(i["scope"], i["status"]) for i in body["items"]] == [
            ("masters", "success"), ("vouchers", "failed")
        ]
        scopes = {s["scope"]: s for s in client.get("/api/v1/sync/status").json()["scopes"]}
        assert scopes["vouchers"]["status"] == "failed"
        assert scopes["vouchers"]["error"]
        # The earlier success is still reported, so the UI can say how stale it is.
        assert scopes["vouchers"]["last_success_at"]
        assert scopes["masters"]["status"] == "success"
        assert scopes["masters"]["error"] is None

    def test_runs_history(self, client: TestClient) -> None:
        pull_everything(client)
        runs = client.get("/api/v1/sync/runs?limit=5").json()["items"]
        assert runs[0]["kind"] == "pull"
        run_id = runs[0]["id"]
        assert client.get(f"/api/v1/sync/runs/{run_id}").json()["id"] == run_id
        assert client.get("/api/v1/sync/runs/424242").status_code == 404


class TestSettingsRoutes:
    def test_read_and_update(self, client: TestClient) -> None:
        assert client.get("/api/v1/settings").json()["tally_port"] == 9000
        updated = client.put(
            "/api/v1/settings", json={"tally_host": "10.0.0.9", "sync_interval_minutes": 30}
        ).json()
        assert updated["tally_host"] == "10.0.0.9"
        assert updated["sync_interval_minutes"] == 30
        assert client.get("/api/v1/settings").json()["tally_host"] == "10.0.0.9"


class TestAttachments:
    def test_upload_pdf(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/attachments",
            files={"file": ("bill.pdf", b"%PDF-1.4 fake", "application/pdf")},
        )
        assert response.status_code == 201
        body = response.json()
        assert body["file_name"] == "bill.pdf"
        assert body["ocr_status"] == "skipped"

    def test_rejects_other_types(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/attachments",
            files={"file": ("notes.txt", b"hello", "text/plain")},
        )
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "UNSUPPORTED_MEDIA_TYPE"


class TestAuditTrail:
    def test_every_tally_call_is_logged(self, client: TestClient) -> None:
        from sqlalchemy import func, select

        from talai_middleware.db import models

        pull_everything(client)
        database = client.app.state.database
        with database.session() as session:
            count = session.scalar(select(func.count()).select_from(models.AuditLog))
            assert count > 0
            row = session.scalars(select(models.AuditLog)).first()
            assert row.request_xml is None  # AUDIT_STORE_XML is false by default
