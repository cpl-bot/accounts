"""Local-LLM OCR for uploaded bills (plan §3.10).

Nothing here reaches the internet: ``OCR_PROVIDER=ollama`` talks to Ollama on
the same LAN, ``mock`` returns a bundled fixture, and ``none`` (the default)
means uploads are stored but never read.
"""

# NB: the ``postprocess`` *function* is deliberately not re-exported here — it
# would shadow the submodule of the same name.

from __future__ import annotations

import logging

from ..config import Settings
from .mock import MockOcrProvider
from .ollama import OllamaCheck, OllamaOcrProvider
from .provider import OcrError, OcrProvider
from .schema import KEY_FIELDS, OcrFields, OcrLineItem, OcrResult, ocr_json_schema

logger = logging.getLogger(__name__)

__all__ = [
    "KEY_FIELDS",
    "MockOcrProvider",
    "OcrError",
    "OcrFields",
    "OcrLineItem",
    "OcrProvider",
    "OcrResult",
    "OllamaCheck",
    "OllamaOcrProvider",
    "build_provider",
    "ocr_json_schema",
]


def build_provider(settings: Settings) -> OcrProvider | None:
    """The provider named by ``OCR_PROVIDER``; ``None`` when OCR is off."""
    if settings.ocr_provider == "mock":
        return MockOcrProvider()
    if settings.ocr_provider == "ollama":
        return OllamaOcrProvider(
            base_url=settings.ollama_base_url,
            model=settings.ollama_model,
            timeout=settings.ocr_timeout_seconds,
        )
    logger.debug("OCR is disabled (OCR_PROVIDER=%s)", settings.ocr_provider)
    return None
