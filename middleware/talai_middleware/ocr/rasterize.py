"""PDF → PNG pages for the vision model (plan §3.10).

Only the first :data:`MAX_PAGES` pages are rendered: a purchase bill's fields
are on page one, and every extra page costs the model seconds of inference.
Images are passed through untouched.
"""

from __future__ import annotations

import logging

import pymupdf

from .provider import OcrError

logger = logging.getLogger(__name__)

MAX_PAGES = 3
DPI = 150
PDF_MIMES = {"application/pdf", "application/x-pdf"}


def is_pdf(data: bytes, mime: str) -> bool:
    return (mime or "").lower() in PDF_MIMES or data[:5] == b"%PDF-"


def rasterize(
    data: bytes, mime: str, max_pages: int = MAX_PAGES, dpi: int = DPI
) -> list[bytes]:
    """One PNG per page for a PDF; ``[data]`` for anything else."""
    if not data:
        raise OcrError("The file is empty", code="OCR_EMPTY_FILE")
    if not is_pdf(data, mime):
        return [data]
    try:
        document = pymupdf.open(stream=data, filetype="pdf")
    except Exception as exc:  # noqa: BLE001 - pymupdf raises several types
        raise OcrError(f"Could not open the PDF: {exc}", code="OCR_BAD_PDF") from exc
    with document:
        total = document.page_count
        pages = [
            document.load_page(index).get_pixmap(dpi=dpi).tobytes("png")
            for index in range(min(total, max_pages))
        ]
    if not pages:
        raise OcrError("The PDF has no pages", code="OCR_BAD_PDF")
    logger.debug("rasterised %d of %d PDF pages at %d dpi", len(pages), total, dpi)
    return pages
