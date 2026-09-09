"""A fixture-backed OCR provider (plan §3.10).

``OCR_PROVIDER=mock`` gives the whole attachment pipeline — background task,
post-processing, draft pre-fill — something deterministic to run against
without Ollama on the machine. It reads the *file* only far enough to tell
PDFs from images, so it also exercises the rasteriser.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from .provider import OcrError
from .rasterize import rasterize
from .schema import OcrResult

logger = logging.getLogger(__name__)

DEFAULT_FIXTURE = Path(__file__).with_name("fixtures") / "sample_invoice.json"


class MockOcrProvider:
    """Returns a canned :class:`OcrResult`, with real page counting."""

    name = "mock"

    def __init__(self, fixture: Path | str | None = None) -> None:
        self.fixture = Path(fixture) if fixture else DEFAULT_FIXTURE

    def extract(self, data: bytes, mime: str) -> OcrResult:
        pages = rasterize(data, mime)
        try:
            payload = json.loads(self.fixture.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise OcrError(f"Mock fixture {self.fixture} is unusable: {exc}") from exc
        result = OcrResult.model_validate(payload)
        result.model = self.name
        result.duration_ms = 0
        result.pages = len(pages)
        logger.info("mock OCR returned %d pages of fixture data", result.pages)
        return result
