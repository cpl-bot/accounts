# Talai Agent Guide

## Structure

- This is two services: the Next.js 16 app is at the repository root (`app/`, `components/`, `lib/`); the FastAPI service is under `middleware/`.
- Only `middleware/` may talk to TallyPrime. Browser code calls `/api/talai/*`; `app/api/talai/[...path]/route.ts` proxies server-side to middleware and adds the bearer token.
- Tally is the system of record. Middleware SQLite is the read replica plus outbox; UI reads come from it and writes go through validated, audited middleware sync.
- `docs/openapi.json` is generated from the FastAPI app; regenerate it after API changes with `uv run python middleware/scripts/export_openapi.py` from the repository root.

## Setup And Commands

- Use Node 22 with pnpm 10, and Python 3.11 with `uv`; copy `.env.example` to `.env` and `middleware/.env.example` to `middleware/.env` before running either service.
- From the repository root, run the frontend checks in this order: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- Run one frontend test with `pnpm exec vitest run tests/lib/format.test.ts` (replace the path); Vitest uses jsdom, Testing Library, and MSW from `tests/setup.ts`.
- From `middleware/`, install and initialize with `uv sync && uv run alembic upgrade head`; run `uv run ruff check . && uv run pytest -q`.
- From `middleware/`, run one backend test with `uv run pytest -q tests/unit/test_validation.py -k <name>`; backend pytest configuration and fixtures live in `middleware/pyproject.toml` and `middleware/tests/conftest.py`.
- Start development servers with `pnpm dev` at the root and `uv run uvicorn talai_middleware.main:app --reload --host 0.0.0.0 --port 8000` from `middleware/`.
- Root support scripts use `uv run --project middleware python scripts/<script>.py`; `seed_demo_data.py` prepares a local replica, while `check_tally_connection.py`, `validate_db_sync.py`, and `dry_run_push.py` are LAN/deployment checks.

## Safety And Data

- `TALLY_WRITE_ENABLED=false` is the safe default: it validates and generates XML without sending it. Do not enable writes or target a live company during ordinary development; follow `docs/LAN_DEPLOYMENT.md` for the test-company rollout.
- Automated middleware tests use `FakeTallyTransport` or `respx`, never a real Tally or network; the fake rejects `ACTION="Alter"` and `ACTION="Delete"`.
- Relative SQLite and upload paths are anchored to `middleware/` by `talai_middleware/config.py`, regardless of the directory used to launch a command.
- Production schema changes belong in Alembic migrations (`uv run alembic revision --autogenerate -m "..."` after model changes), followed by `uv run alembic upgrade head`; do not hand-edit the database.

## Project Workflow

- `CLAUDE.md` and `docs/board/` define the work process; read `docs/board/ground-truth.md` and any `docs/board/in-flight/*.md` before starting work, and use Ready cards as the work queue.
- Use `docs/ENGINEERING_PLAN.md` for architecture, `docs/DECISIONS.md` for settled product defaults, and `docs/SETUP.md` for environment and deployment details rather than duplicating those specs here.
