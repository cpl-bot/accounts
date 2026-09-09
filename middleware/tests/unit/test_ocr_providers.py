"""OCR providers: rasterising, the mock, and Ollama over respx (plan §3.10)."""
from __future__ import annotations

import json

import httpx
import pytest
import respx

from talai_middleware.config import Settings
from talai_middleware.ocr import build_provider
from talai_middleware.ocr.mock import MockOcrProvider
from talai_middleware.ocr.ollama import OllamaOcrProvider
from talai_middleware.ocr.provider import OcrError
from talai_middleware.ocr.rasterize import is_pdf, rasterize
from talai_middleware.ocr.schema import ocr_json_schema

BASE = "http://ollama.local:11434"


def make_pdf(pages: int = 1) -> bytes:
    """A tiny PDF, generated rather than committed as a binary fixture."""
    import pymupdf

    document = pymupdf.open()
    for index in range(pages):
        page = document.new_page()
        page.insert_text((72, 100), f"Tax Invoice page {index + 1}")
    data = document.tobytes()
    document.close()
    return data


PNG_1PX = bytes.fromhex(
    "89504e470d0a1a0a0000000d494844520000000100000001080600000"
    "01f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd4"
    "0000000049454e44ae426082"
)


class TestRasterize:
    def test_a_pdf_becomes_one_png_per_page(self) -> None:
        pages = rasterize(make_pdf(2), "application/pdf")
        assert len(pages) == 2
        assert all(page.startswith(b"\x89PNG") for page in pages)

    def test_only_the_first_three_pages_are_rendered(self) -> None:
        assert len(rasterize(make_pdf(5), "application/pdf")) == 3

    def test_max_pages_and_dpi_are_configurable(self) -> None:
        small = rasterize(make_pdf(2), "application/pdf", max_pages=1, dpi=72)
        big = rasterize(make_pdf(2), "application/pdf", max_pages=1, dpi=200)
        assert len(small) == 1
        assert len(big[0]) > len(small[0])

    def test_an_image_is_passed_through(self) -> None:
        assert rasterize(PNG_1PX, "image/png") == [PNG_1PX]

    def test_a_pdf_is_detected_by_its_magic_bytes(self) -> None:
        assert is_pdf(make_pdf(), "application/octet-stream") is True
        assert is_pdf(PNG_1PX, "image/png") is False
        assert len(rasterize(make_pdf(), "application/octet-stream")) == 1

    def test_an_empty_file_is_an_error(self) -> None:
        with pytest.raises(OcrError) as exc:
            rasterize(b"", "application/pdf")
        assert exc.value.code == "OCR_EMPTY_FILE"

    def test_a_corrupt_pdf_is_an_error(self) -> None:
        with pytest.raises(OcrError) as exc:
            rasterize(b"%PDF-1.4 broken", "application/pdf")
        assert exc.value.code == "OCR_BAD_PDF"


class TestMockProvider:
    def test_returns_the_bundled_fixture(self) -> None:
        result = MockOcrProvider().extract(make_pdf(2), "application/pdf")
        assert result.model == "mock"
        assert result.pages == 2
        assert result.fields.supplier_name == "BioShield Medical & Co"
        assert result.fields.invoice_number == "INV/BSM/4471"
        assert result.confidence["supplier_name"] == 0.93

    def test_a_missing_fixture_is_an_ocr_error(self, tmp_path) -> None:
        provider = MockOcrProvider(fixture=tmp_path / "nope.json")
        with pytest.raises(OcrError):
            provider.extract(PNG_1PX, "image/png")


def chat_response(payload: dict) -> httpx.Response:
    return httpx.Response(200, json={"message": {"content": json.dumps(payload)}})


GOOD_PAYLOAD = {
    "fields": {
        "supplier_name": "Sunrise Packaging",
        "invoice_number": "SP/1188",
        "invoice_date": "12/06/2026",
        "taxable_value": 16000,
        "igst": 2880,
        "grand_total": 18880,
        "line_items": [{"description": "Cartons", "quantity": 20, "rate": 800, "amount": 16000}],
    },
    "confidence": {"supplier_name": 0.91, "grand_total": 0.88},
    "raw_text": "SUNRISE PACKAGING ...",
}


class TestOllamaProvider:
    def provider(self) -> OllamaOcrProvider:
        return OllamaOcrProvider(base_url=BASE, model="gemma3:12b", timeout=5)

    @respx.mock
    def test_a_successful_extraction(self) -> None:
        route = respx.post(f"{BASE}/api/chat").mock(return_value=chat_response(GOOD_PAYLOAD))
        result = self.provider().extract(make_pdf(), "application/pdf")

        assert result.fields.supplier_name == "Sunrise Packaging"
        assert result.model == "ollama:gemma3:12b"
        assert result.pages == 1
        assert result.duration_ms is not None

        sent = json.loads(route.calls[0].request.content)
        assert sent["model"] == "gemma3:12b"
        assert sent["stream"] is False
        assert sent["options"]["temperature"] == 0
        assert sent["format"] == ocr_json_schema()
        message = sent["messages"][0]
        assert message["role"] == "user"
        assert "invoice" in message["content"].lower()
        assert len(message["images"]) == 1
        assert isinstance(message["images"][0], str)

    @respx.mock
    def test_every_page_is_attached_as_an_image(self) -> None:
        route = respx.post(f"{BASE}/api/chat").mock(return_value=chat_response(GOOD_PAYLOAD))
        self.provider().extract(make_pdf(3), "application/pdf")
        assert len(json.loads(route.calls[0].request.content)["messages"][0]["images"]) == 3

    @respx.mock
    def test_invalid_json_from_the_model(self) -> None:
        respx.post(f"{BASE}/api/chat").mock(
            return_value=httpx.Response(200, json={"message": {"content": "I think it's ~₹18k"}})
        )
        with pytest.raises(OcrError) as exc:
            self.provider().extract(PNG_1PX, "image/png")
        assert exc.value.code == "OCR_INVALID_JSON"

    @respx.mock
    def test_json_that_does_not_match_the_schema(self) -> None:
        respx.post(f"{BASE}/api/chat").mock(
            return_value=httpx.Response(200, json={"message": {"content": '{"fields": 7}'}})
        )
        with pytest.raises(OcrError) as exc:
            self.provider().extract(PNG_1PX, "image/png")
        assert exc.value.code == "OCR_INVALID_JSON"

    @respx.mock
    def test_an_empty_message(self) -> None:
        respx.post(f"{BASE}/api/chat").mock(return_value=httpx.Response(200, json={}))
        with pytest.raises(OcrError) as exc:
            self.provider().extract(PNG_1PX, "image/png")
        assert exc.value.code == "OCR_INVALID_JSON"

    @respx.mock
    def test_a_timeout(self) -> None:
        respx.post(f"{BASE}/api/chat").mock(side_effect=httpx.ReadTimeout("too slow"))
        with pytest.raises(OcrError) as exc:
            self.provider().extract(PNG_1PX, "image/png")
        assert exc.value.code == "OCR_TIMEOUT"
        assert "5s" in exc.value.message

    @respx.mock
    def test_an_http_error(self) -> None:
        respx.post(f"{BASE}/api/chat").mock(return_value=httpx.Response(500, text="boom"))
        with pytest.raises(OcrError) as exc:
            self.provider().extract(PNG_1PX, "image/png")
        assert exc.value.code == "OCR_HTTP_ERROR"

    @respx.mock
    def test_ollama_down(self) -> None:
        respx.post(f"{BASE}/api/chat").mock(side_effect=httpx.ConnectError("refused"))
        with pytest.raises(OcrError) as exc:
            self.provider().extract(PNG_1PX, "image/png")
        assert exc.value.code == "OCR_UNREACHABLE"


class TestOllamaCheck:
    def provider(self) -> OllamaOcrProvider:
        return OllamaOcrProvider(base_url=BASE, model="gemma3:12b", timeout=5)

    @respx.mock
    def test_model_is_pulled(self) -> None:
        respx.get(f"{BASE}/api/tags").mock(
            return_value=httpx.Response(
                200, json={"models": [{"name": "gemma3:12b"}, {"name": "llama3:8b"}]}
            )
        )
        check = self.provider().check()
        assert check.ok is True
        assert check.reachable is True and check.model_present is True
        assert check.models == ["gemma3:12b", "llama3:8b"]
        assert check.error is None

    @respx.mock
    def test_model_not_pulled(self) -> None:
        respx.get(f"{BASE}/api/tags").mock(
            return_value=httpx.Response(200, json={"models": [{"name": "llama3:8b"}]})
        )
        check = self.provider().check()
        assert check.reachable is True
        assert check.model_present is False
        assert check.ok is False
        assert "ollama pull gemma3:12b" in check.error

    @respx.mock
    def test_ollama_unreachable(self) -> None:
        respx.get(f"{BASE}/api/tags").mock(side_effect=httpx.ConnectError("refused"))
        check = self.provider().check()
        assert check.reachable is False and check.ok is False
        assert "not reachable" in check.error

    @respx.mock
    def test_tags_is_not_json(self) -> None:
        respx.get(f"{BASE}/api/tags").mock(return_value=httpx.Response(200, text="<html>"))
        check = self.provider().check()
        assert check.reachable is True and check.model_present is False
        assert "not JSON" in check.error


class TestBuildProvider:
    def test_none_disables_ocr(self) -> None:
        assert build_provider(Settings(_env_file=None, ocr_provider="none")) is None

    def test_mock(self) -> None:
        assert isinstance(build_provider(Settings(_env_file=None, ocr_provider="mock")),
                          MockOcrProvider)

    def test_ollama_is_configured_from_settings(self) -> None:
        provider = build_provider(
            Settings(
                _env_file=None, ocr_provider="ollama", ollama_base_url=BASE + "/",
                ollama_model="qwen2.5vl:7b", ocr_timeout_seconds=42,
            )
        )
        assert isinstance(provider, OllamaOcrProvider)
        assert provider.base_url == BASE
        assert provider.model == "qwen2.5vl:7b"
        assert provider.timeout == 42
        assert provider.name == "ollama:qwen2.5vl:7b"
