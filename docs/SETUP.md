# Talai — Local Development Setup

Two processes make up Talai: the **Next.js app** (repo root) and the **FastAPI
middleware** (`middleware/`). Only the middleware talks to TallyPrime. You can
develop the UI without Tally at all (demo mode) and develop the middleware
without Tally (fake transport in tests, seeded replica for the API).

## 1. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 22.x | `node -v` |
| pnpm | 10.x | `corepack enable && corepack prepare pnpm@10 --activate` |
| Python | 3.11+ | `python3 --version` |
| uv | 0.8+ | https://docs.astral.sh/uv/ — `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| TallyPrime | Gold, XML server enabled | Only needed for LAN validation, see `docs/LAN_DEPLOYMENT.md` |

## 2. Clone and configure environment files

```bash
git clone <repo> talai && cd talai
cp .env.example .env                     # Next.js
cp middleware/.env.example middleware/.env   # middleware
```

Fill the two `.env` files in your terminal editor. The minimum you must set:

| File | Variable | What to put |
|---|---|---|
| `middleware/.env` | `TALLY_HOST` | LAN IP of the PC running TallyPrime (e.g. `192.168.1.24`) |
| `middleware/.env` | `TALLY_PORT` | Tally XML port, default `9000` |
| `middleware/.env` | `TALLY_COMPANY_NAME` | Exact company name as shown in Tally |
| `middleware/.env` | `MIDDLEWARE_API_KEY` | Any long random string |
| `.env` | `MIDDLEWARE_API_KEY` | **The same string** |
| `.env` | `MIDDLEWARE_URL` | `http://localhost:8000` on one machine; the LAN host URL otherwise |

Leave `TALLY_WRITE_ENABLED=false` until the dry‑run checklist in
`docs/LAN_DEPLOYMENT.md` is complete. Every other variable has a documented
default inside the example files.

## 3. Middleware

```bash
cd middleware
uv sync                                  # creates .venv and installs deps (dev group included)
uv run alembic upgrade head              # creates data/talai.db
uv run pytest -q                         # all tests use a fake Tally
uv run uvicorn talai_middleware.main:app --reload --host 0.0.0.0 --port 8000
```

Useful checks:

```bash
curl http://localhost:8000/health
curl -H "Authorization: Bearer $MIDDLEWARE_API_KEY" http://localhost:8000/api/v1/tally/status
open http://localhost:8000/docs           # interactive OpenAPI
```

No Tally on your machine? Seed the replica with demo data so every read endpoint
returns something:

```bash
uv run --project middleware python scripts/seed_demo_data.py
```

## 4. Next.js app

```bash
pnpm install
pnpm test                                # vitest + testing-library + msw
pnpm typecheck
pnpm dev                                 # http://localhost:3000
```

Set `NEXT_PUBLIC_DEMO_MODE=true` in `.env` to run the UI with fixture data and
no middleware at all.

## 5. Support scripts (run from the repo root)

| Script | Purpose |
|---|---|
| `uv run --project middleware python scripts/check_tally_connection.py` | TCP + XML handshake with Tally; prints companies and latency; `--xml` dumps raw XML |
| `uv run --project middleware python scripts/validate_db_sync.py --scopes masters,vouchers,bills` | Runs a pull and reconciles row counts/totals against Tally; `--fake` self‑tests without Tally |
| `uv run --project middleware python scripts/dry_run_push.py` | Validates queued drafts and prints the XML that *would* be sent |
| `uv run --project middleware python scripts/seed_demo_data.py` | Fills the replica from fixtures for UI development |
| `middleware/scripts/export_openapi.py` | Regenerates `docs/openapi.json` after API changes |

## 6. Test‑driven workflow

1. Pick a task from `docs/TASKS.md`; its acceptance test tells you what to write first.
2. Backend: add a test under `middleware/tests/unit` or `tests/integration`
   using the `fake_tally` fixture; run `uv run pytest -q -k <name>` until green.
3. Frontend: add a test next to the component or under `tests/`; run
   `pnpm test:watch`.
4. Before pushing: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` and
   `cd middleware && uv run ruff check . && uv run pytest -q`.

## 7. Troubleshooting

- **`/tally/status` says unreachable** — run `scripts/check_tally_connection.py --xml`.
  Common causes: company not open in Tally, XML server disabled, Windows
  firewall blocking 9000, wrong IP.
- **401 from the middleware** — the two `MIDDLEWARE_API_KEY` values differ.
- **Fonts fail during `pnpm build` offline** — the layout falls back to system
  fonts; see `docs/FRONTEND_REVIEW.md`.
- **SQLite locked** — only one middleware process may use `data/talai.db`; stop
  duplicate `uvicorn` instances.
