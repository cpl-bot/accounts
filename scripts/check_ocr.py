#!/usr/bin/env python
"""Check the local OCR stack, then read one or more bills with it (plan §3.10).

    uv run --project middleware python scripts/check_ocr.py --sample
    uv run --project middleware python scripts/check_ocr.py bill1.pdf bill2.jpg
    uv run --project middleware python scripts/check_ocr.py --model qwen2.5vl:7b --sample

Exit codes make it usable as a deployment gate:

    0  Ollama answered and every file was read
    2  Ollama is not reachable at OLLAMA_BASE_URL
    3  the model is not pulled (run: ollama pull <model>)
    4  Ollama answered but a file could not be read
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "middleware"))

from talai_middleware.config import Settings  # noqa: E402
from talai_middleware.ocr.ollama import OllamaOcrProvider  # noqa: E402
from talai_middleware.ocr.provider import OcrError  # noqa: E402
from talai_middleware.ocr.schema import KEY_FIELDS, OcrResult  # noqa: E402

EXIT_OK = 0
EXIT_UNREACHABLE = 2
EXIT_MODEL_MISSING = 3
EXIT_OCR_FAILED = 4

MIMES = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}


def sample_bill() -> tuple[bytes, str]:
    """A one-page invoice generated on the fly, so --sample needs no fixture."""
    import pymupdf

    document = pymupdf.open()
    page = document.new_page()
    lines = [
        "BIOSHIELD MEDICAL & CO",
        "GSTIN 27AAAAA0000A1Z5",
        "Tax Invoice INV/BSM/4471   dated 10/06/2026",
        "Surgical gloves (box)   HSN 4015   50 x 450.00 = 22,500.00",
        "IGST 18% .......... 4,050.00",
        "Grand Total ....... 26,550.00",
    ]
    for index, line in enumerate(lines):
        page.insert_text((56, 80 + index * 22), line, fontsize=12)
    data = document.tobytes()
    document.close()
    return data, "application/pdf"


def mime_for(path: Path) -> str:
    return MIMES.get(path.suffix.lower(), "application/octet-stream")


def print_result(label: str, result: OcrResult) -> None:
    print(f"\n-- {label}")
    print(f"   model      {result.model}")
    print(f"   duration   {result.duration_ms} ms over {result.pages} page(s)")
    print("   fields")
    for name, value in result.fields.model_dump().items():
        if name == "line_items":
            for index, item in enumerate(value or []):
                print(f"     line_items[{index}]        {item}")
            continue
        confidence = result.confidence.get(name)
        marker = " *" if name in KEY_FIELDS else "  "
        shown = "-" if confidence is None else f"{confidence:.2f}"
        print(f"     {marker} {name:20} {str(value):40} conf {shown}")
    if result.raw_text:
        preview = result.raw_text.strip().splitlines()[:5]
        print("   raw_text (first lines)")
        for line in preview:
            print(f"     | {line}")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="*", help="Bills to read (PDF/PNG/JPEG)")
    parser.add_argument("--sample", action="store_true", help="Read a generated sample bill")
    parser.add_argument("--base-url", default=None, help="Override OLLAMA_BASE_URL")
    parser.add_argument("--model", default=None, help="Override OLLAMA_MODEL")
    parser.add_argument("--timeout", type=float, default=None, help="Seconds per request")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    settings = Settings()
    provider = OllamaOcrProvider(
        base_url=args.base_url or settings.ollama_base_url,
        model=args.model or settings.ollama_model,
        timeout=args.timeout or settings.ocr_timeout_seconds,
    )

    print(f"== Ollama at {provider.base_url}")
    check = provider.check()
    if not check.reachable:
        print(f"   UNREACHABLE: {check.error}")
        print("   Is `ollama serve` running on that host, and is the port open?")
        return EXIT_UNREACHABLE
    print(f"   reachable, {len(check.models)} model(s) installed")
    for name in check.models:
        print(f"     - {name}")
    if not check.model_present:
        print(f"   MISSING: {check.error}")
        return EXIT_MODEL_MISSING
    print(f"   model '{provider.model}' is pulled")

    documents: list[tuple[str, bytes, str]] = []
    if args.sample:
        data, mime = sample_bill()
        documents.append(("generated sample bill", data, mime))
    for name in args.files:
        path = Path(name)
        if not path.is_file():
            print(f"   no such file: {path}")
            return EXIT_OCR_FAILED
        documents.append((str(path), path.read_bytes(), mime_for(path)))

    if not documents:
        print("\nNothing to read. Pass file paths, or --sample.")
        return EXIT_OK

    failures = 0
    for label, data, mime in documents:
        try:
            print_result(label, provider.extract(data, mime))
        except OcrError as exc:
            failures += 1
            print(f"\n-- {label}\n   FAILED [{exc.code}] {exc.message}")
    return EXIT_OCR_FAILED if failures else EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
