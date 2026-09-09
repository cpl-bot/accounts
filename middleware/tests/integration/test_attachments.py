"""Attachment upload, OCR and draft pre-fill (plan §3.10)."""
from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from talai_middleware.main import create_app


def make_pdf(text: str = "Tax Invoice") -> bytes:
    import pymupdf

    document = pymupdf.open()
    document.new_page().insert_text((72, 100), text)
    data = document.tobytes()
    document.close()
    return data


def upload(client: TestClient, name: str = "bill.pdf", mime: str = "application/pdf"):
    return client.post(
        "/api/v1/attachments", files={"file": (name, make_pdf(), mime)}
    )


def make_client(settings, fake_transport, **overrides) -> Iterator[TestClient]:
    app = create_app(settings.model_copy(update=overrides), transport=fake_transport)
    with TestClient(app) as client:
        client.headers.update({"Authorization": "Bearer test-key"})
        yield client


@pytest.fixture
def ocr_client(settings, fake_transport) -> Iterator[TestClient]:
    """A client with ``OCR_PROVIDER=mock`` and masters already pulled."""
    yield from _mock_client(settings, fake_transport)


def _mock_client(settings, fake_transport, **extra):
    for client in make_client(settings, fake_transport, ocr_provider="mock", **extra):
        client.post("/api/v1/sync/pull", json={"scopes": ["masters"]})
        yield client


class TestUpload:
    def test_ocr_is_skipped_when_the_provider_is_none(self, client) -> None:
        body = upload(client).json()
        assert body["ocr_status"] == "skipped"
        assert body["ocr_result"] is None
        assert body["ocr_model"] is None

    def test_the_background_task_fills_the_result(self, ocr_client) -> None:
        response = upload(ocr_client)
        assert response.status_code == 201
        attachment = response.json()
        assert attachment["file_name"] == "bill.pdf"
        assert attachment["size_bytes"] > 0

        # TestClient runs background tasks before returning, so it is already done
        stored = ocr_client.get(f"/api/v1/attachments/{attachment['id']}").json()
        assert stored["ocr_status"] == "done"
        assert stored["ocr_model"] == "mock"
        assert stored["ocr_duration_ms"] is not None
        assert stored["ocr_error"] is None
        assert stored["ocr_result"]["fields"]["invoice_number"] == "INV/BSM/4471"

    def test_post_processing_ran_on_the_stored_result(self, ocr_client) -> None:
        attachment = upload(ocr_client).json()
        result = ocr_client.get(f"/api/v1/attachments/{attachment['id']}").json()["ocr_result"]
        # dates normalised, supplier mapped onto the replica's ledger
        assert result["fields"]["invoice_date"] == "2026-06-10"
        assert result["fields"]["due_date"] == "2026-07-09"
        assert result["fields"]["party_ledger_name"] == "BioShield Medical & Co"
        assert result["confidence"]["party_ledger"] == 1.0
        # the fixture's arithmetic adds up, so every confidence went up by 0.1
        assert result["confidence"]["supplier_name"] == pytest.approx(1.0)

    def test_an_unsupported_type_is_rejected(self, ocr_client) -> None:
        response = ocr_client.post(
            "/api/v1/attachments", files={"file": ("notes.txt", b"hello", "text/plain")}
        )
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "UNSUPPORTED_MEDIA_TYPE"

    def test_a_file_over_the_limit_is_rejected(self, settings, fake_transport) -> None:
        for client in make_client(settings, fake_transport, max_upload_mb=0):
            response = client.post(
                "/api/v1/attachments", files={"file": ("b.png", b"x" * 10, "image/png")}
            )
            assert response.status_code == 400
            assert response.json()["error"]["code"] == "FILE_TOO_LARGE"

    def test_a_broken_file_records_the_failure(self, ocr_client) -> None:
        attachment = ocr_client.post(
            "/api/v1/attachments",
            files={"file": ("broken.pdf", b"%PDF-1.4 nonsense", "application/pdf")},
        ).json()
        stored = ocr_client.get(f"/api/v1/attachments/{attachment['id']}").json()
        assert stored["ocr_status"] == "failed"
        assert "PDF" in stored["ocr_error"]
        assert stored["ocr_result"] is None


class TestListAndReRun:
    def test_list_and_filter_by_draft(self, ocr_client) -> None:
        first = upload(ocr_client).json()
        listing = ocr_client.get("/api/v1/attachments").json()
        assert listing["total"] == 1
        assert listing["items"][0]["id"] == first["id"]
        assert ocr_client.get(
            "/api/v1/attachments", params={"draft_id": "nobody"}
        ).json()["total"] == 0

    def test_unknown_attachment_is_404(self, ocr_client) -> None:
        assert ocr_client.get("/api/v1/attachments/missing").status_code == 404
        assert ocr_client.post("/api/v1/attachments/missing/ocr").status_code == 404
        assert ocr_client.post("/api/v1/attachments/missing/draft").status_code == 404

    def test_rerun_is_synchronous(self, ocr_client) -> None:
        attachment = upload(ocr_client).json()
        body = ocr_client.post(f"/api/v1/attachments/{attachment['id']}/ocr").json()
        assert body["ocr_status"] == "done"
        assert body["ocr_result"]["fields"]["supplier_name"] == "BioShield Medical & Co"

    def test_rerun_is_refused_when_ocr_is_off(self, client) -> None:
        attachment = upload(client).json()
        response = client.post(f"/api/v1/attachments/{attachment['id']}/ocr")
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "OCR_DISABLED"


class TestDraftFromAttachment:
    def test_a_draft_is_prefilled_from_the_fields(self, ocr_client) -> None:
        attachment = upload(ocr_client).json()
        response = ocr_client.post(f"/api/v1/attachments/{attachment['id']}/draft")
        assert response.status_code == 201
        draft = response.json()

        payload = draft["payload"]
        assert payload["party"]["ledger_name"] == "BioShield Medical & Co"
        assert payload["supplier_invoice_no"] == "INV/BSM/4471"
        assert payload["voucher_date"] == "2026-06-10"
        assert payload["bill_date"] == "2026-06-10"
        assert payload["due_date"] == "2026-07-09"
        assert payload["purchase_ledger"] == "Purchase"
        assert payload["totals"]["grand_total"] == "26550.00"
        assert payload["tax_lines"] == [
            {"ledger_name": "IGST @ 18%", "cost_centre": None,
             "amount": "4050.00", "description": None}
        ]
        assert draft["attachment_id"] == attachment["id"]

    def test_an_unknown_stock_item_is_left_blank_for_the_reviewer(self, ocr_client) -> None:
        attachment = upload(ocr_client).json()
        draft = ocr_client.post(f"/api/v1/attachments/{attachment['id']}/draft").json()
        item = draft["payload"]["items"][0]
        assert item["stock_item"] == ""
        assert item["description"] == "Surgical gloves (box)"
        assert item["quantity"] == "50.00"
        assert item["rate"] == "450.00"
        assert "STOCK_ITEM_NOT_FOUND" in [e["code"] for e in draft["errors"]]

    def test_the_draft_needs_review_and_says_why(self, ocr_client) -> None:
        attachment = upload(ocr_client).json()
        draft = ocr_client.post(f"/api/v1/attachments/{attachment['id']}/draft").json()
        assert draft["needs_review"] is True
        assert any("STOCK_ITEM_NOT_FOUND" in reason for reason in draft["review_reasons"])

    def test_low_confidence_is_listed_as_a_review_reason(
        self, settings, fake_transport, tmp_path
    ) -> None:
        import json

        from talai_middleware.ocr.mock import DEFAULT_FIXTURE

        payload = json.loads(DEFAULT_FIXTURE.read_text())
        payload["confidence"]["invoice_number"] = 0.2
        fixture = tmp_path / "unsure.json"
        fixture.write_text(json.dumps(payload))

        app = create_app(
            settings.model_copy(update={"ocr_provider": "mock"}), transport=fake_transport
        )
        with TestClient(app) as client:
            client.headers.update({"Authorization": "Bearer test-key"})
            client.post("/api/v1/sync/pull", json={"scopes": ["masters"]})
            attachment = upload(client).json()
            # re-run against the low-confidence fixture
            from talai_middleware.db import repo
            from talai_middleware.ocr.mock import MockOcrProvider
            from talai_middleware.services import ocr_service

            session = app.state.database.new_session()
            row = repo.get_attachment(session, attachment["id"])
            ocr_service.run_ocr(
                session, app.state.settings, row, provider=MockOcrProvider(fixture)
            )
            session.commit()
            session.close()

            draft = client.post(f"/api/v1/attachments/{attachment['id']}/draft").json()
            assert any(
                "invoice_number" in reason and "confidence" in reason
                for reason in draft["review_reasons"]
            )

    def test_a_draft_cannot_be_built_without_a_result(self, client) -> None:
        attachment = upload(client).json()   # OCR is off, so status is skipped
        response = client.post(f"/api/v1/attachments/{attachment['id']}/draft")
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "OCR_NOT_AVAILABLE"

    def test_the_draft_appears_in_the_outbox_with_its_review_state(self, ocr_client) -> None:
        attachment = upload(ocr_client).json()
        created = ocr_client.post(f"/api/v1/attachments/{attachment['id']}/draft").json()
        listed = ocr_client.get("/api/v1/drafts").json()["items"]
        assert [d["id"] for d in listed] == [created["id"]]
        assert listed[0]["needs_review"] is True
        assert listed[0]["attachment_id"] == attachment["id"]
