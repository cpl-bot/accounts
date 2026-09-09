#!/usr/bin/env python
"""Write the OpenAPI document to docs/openapi.json (plan §5, contract test).

    uv run python scripts/export_openapi.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

MIDDLEWARE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MIDDLEWARE))

from talai_middleware.config import Settings  # noqa: E402
from talai_middleware.main import create_app  # noqa: E402
from talai_middleware.tally.fake import FakeTallyTransport  # noqa: E402

DEFAULT_OUTPUT = MIDDLEWARE.parent / "docs" / "openapi.json"


def build_schema() -> dict:
    """Build the app with a fake transport and an in-memory DB, then dump its schema."""
    settings = Settings(
        _env_file=None, database_url="sqlite:///:memory:", sync_enabled=False
    )
    app = create_app(settings, transport=FakeTallyTransport())
    return app.openapi()


def main(argv: list[str] | None = None) -> int:
    argv = argv if argv is not None else sys.argv[1:]
    output = Path(argv[0]) if argv else DEFAULT_OUTPUT
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(build_schema(), indent=2) + "\n", encoding="utf-8")
    print(f"wrote {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
