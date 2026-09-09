"""OCR through a local Ollama vision model (plan §3.10).

Bills never leave the LAN: the middleware POSTs the page images to Ollama's
``/api/chat`` on the Ubuntu server. ``format`` carries the JSON Schema of
:class:`~talai_middleware.ocr.schema.OcrResult`, so Ollama constrains decoding
to that shape instead of hoping the model answers with JSON.
"""

from __future__ import annotations

import base64
import json
import logging
import time
from dataclasses import dataclass, field

import httpx

from .provider import OcrError
from .rasterize import rasterize
from .schema import OcrResult, ocr_json_schema

logger = logging.getLogger(__name__)

PROMPT = (
    "You are reading a scanned Indian GST purchase invoice. "
    "Extract the fields exactly as printed; do not calculate, guess or invent "
    "values. Use null for anything the document does not show. Amounts are "
    "plain numbers without currency symbols or thousands separators. Dates are "
    "copied verbatim from the document. For every field also give a confidence "
    "between 0 and 1 describing how clearly you could read it, and put the full "
    "text you read into raw_text."
)


@dataclass
class OllamaCheck:
    """What ``scripts/check_ocr.py`` and ``/health`` want to know."""

    reachable: bool = False
    model: str = ""
    model_present: bool = False
    models: list[str] = field(default_factory=list)
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.reachable and self.model_present


class OllamaOcrProvider:
    """Calls ``POST {base_url}/api/chat`` with the page images attached."""

    def __init__(
        self,
        base_url: str = "http://localhost:11434",
        model: str = "gemma3:12b",
        timeout: float = 180.0,
        client: httpx.Client | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout
        self._client = client

    @property
    def name(self) -> str:
        return f"ollama:{self.model}"

    def _http(self) -> httpx.Client:
        return self._client or httpx.Client(timeout=self.timeout)

    # -- reachability ------------------------------------------------------

    def check(self) -> OllamaCheck:
        """Is Ollama up, and has ``OLLAMA_MODEL`` been pulled?"""
        try:
            response = self._http().get(f"{self.base_url}/api/tags", timeout=self.timeout)
            response.raise_for_status()
            payload = response.json()
        except httpx.HTTPError as exc:
            return OllamaCheck(model=self.model, error=f"Ollama is not reachable: {exc}")
        except ValueError as exc:
            return OllamaCheck(
                reachable=True, model=self.model, error=f"/api/tags was not JSON: {exc}"
            )
        names = [str(entry.get("name", "")) for entry in payload.get("models", [])]
        present = self.model in names or any(
            name.split(":")[0] == self.model.split(":")[0] and name == self.model
            for name in names
        )
        missing = f"Model '{self.model}' is not pulled. Run: ollama pull {self.model}"
        return OllamaCheck(
            reachable=True,
            model=self.model,
            model_present=present,
            models=names,
            error=None if present else missing,
        )

    # -- extraction --------------------------------------------------------

    def extract(self, data: bytes, mime: str) -> OcrResult:
        pages = rasterize(data, mime)
        images = [base64.b64encode(page).decode("ascii") for page in pages]
        body = {
            "model": self.model,
            "messages": [{"role": "user", "content": PROMPT, "images": images}],
            "format": ocr_json_schema(),
            "stream": False,
            "options": {"temperature": 0},
        }
        started = time.perf_counter()
        try:
            response = self._http().post(
                f"{self.base_url}/api/chat", json=body, timeout=self.timeout
            )
            response.raise_for_status()
            envelope = response.json()
        except httpx.TimeoutException as exc:
            raise OcrError(
                f"Ollama did not answer within {self.timeout:g}s", code="OCR_TIMEOUT"
            ) from exc
        except httpx.HTTPStatusError as exc:
            raise OcrError(
                f"Ollama returned HTTP {exc.response.status_code}", code="OCR_HTTP_ERROR"
            ) from exc
        except httpx.HTTPError as exc:
            raise OcrError(f"Ollama is not reachable: {exc}", code="OCR_UNREACHABLE") from exc
        except ValueError as exc:
            raise OcrError(f"Ollama did not return JSON: {exc}", code="OCR_INVALID_JSON") from exc

        content = (envelope.get("message") or {}).get("content")
        if not content:
            raise OcrError("Ollama returned an empty message", code="OCR_INVALID_JSON")
        try:
            parsed = json.loads(content)
        except ValueError as exc:
            logger.warning("Ollama content was not JSON: %s", content[:300])
            raise OcrError(
                f"The model did not return valid JSON: {exc}", code="OCR_INVALID_JSON"
            ) from exc
        try:
            result = OcrResult.model_validate(parsed)
        except Exception as exc:  # noqa: BLE001 - pydantic raises ValidationError
            raise OcrError(
                f"The model's JSON did not match the OCR schema: {exc}",
                code="OCR_INVALID_JSON",
            ) from exc
        result.model = self.name
        result.duration_ms = int((time.perf_counter() - started) * 1000)
        result.pages = len(pages)
        logger.info("OCR via %s took %d ms over %d page(s)", self.name, result.duration_ms,
                    result.pages)
        return result
