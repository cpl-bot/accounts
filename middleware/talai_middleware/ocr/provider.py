"""The OCR provider protocol and its error type (plan §3.10)."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from .schema import OcrResult


class OcrError(RuntimeError):
    """Raised when a provider cannot produce a usable :class:`OcrResult`."""

    def __init__(self, message: str, code: str = "OCR_FAILED") -> None:
        super().__init__(message)
        self.message = message
        self.code = code


@runtime_checkable
class OcrProvider(Protocol):
    """Read a bill and return structured fields.

    ``name`` identifies the provider (and, for Ollama, the model) on the
    attachment row so a result can always be traced back to what produced it.
    """

    name: str

    def extract(self, data: bytes, mime: str) -> OcrResult:
        """Extract fields from one document. Raises :class:`OcrError`."""
        ...
