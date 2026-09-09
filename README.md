# Talai

Talai is a Tally‑connected accounting workspace for a small finance team: a
one‑snapshot dashboard, payables & receivables with aging, and purchase‑bill
entry that is validated and synced into TallyPrime — without ever letting the
browser or an unchecked write touch the books.

```
Browser (LAN) ──► Next.js 16 app (:3000) ──► FastAPI middleware (:8000) ──► TallyPrime Gold (XML on :9000)
                                                     │
                                                     └──► SQLite replica + outbox (Postgres/Supabase‑ready)
```

## Repository layout

| Path | What |
|---|---|
| `app/`, `components/`, `lib/` | Next.js UI (React 19, Tailwind 4, shadcn) and typed API layer |
| `app/api/talai/[...path]` | Server‑side proxy to the middleware (adds the bearer token) |
| `middleware/` | FastAPI middleware: Tally XML client, sync, validation, outbox, audit |
| `scripts/` | Support scripts: Tally connection check, DB sync validation, dry‑run push, demo seed |
| `docs/` | Engineering plan, decisions, task backlog, Tally notes, setup and LAN deployment guides |
| `tests/`, `middleware/tests/` | Vitest/RTL/MSW and pytest suites; Tally is always mocked |

## Start here

1. **Read** `docs/ENGINEERING_PLAN.md` (architecture and API contract) and
   `docs/DECISIONS.md` (product decisions that need confirming).
2. **Set up** with `docs/SETUP.md`: copy the two `.env.example` files, fill
   them in, run `uv sync` / `pnpm install`.
3. **Work** from `docs/TASKS.md`; every task names its acceptance test (TDD).
4. **Deploy on the LAN** with `docs/LAN_DEPLOYMENT.md` and its sign‑off checklist.

## Quick commands

```bash
# frontend
pnpm install && pnpm test && pnpm typecheck && pnpm build && pnpm dev

# middleware
cd middleware && uv sync && uv run alembic upgrade head && uv run pytest -q
uv run uvicorn talai_middleware.main:app --reload --host 0.0.0.0 --port 8000

# LAN checks (repo root)
uv run --project middleware python scripts/check_tally_connection.py --xml
uv run --project middleware python scripts/validate_db_sync.py --scopes masters,vouchers,bills
uv run --project middleware python scripts/dry_run_push.py
```

## Safety switches

- `TALLY_WRITE_ENABLED=false` (default): pushes validate and generate XML but
  never send it to Tally.
- Writes are refused unless the company open in Tally matches `TALLY_COMPANY_NAME`.
- v1 never alters or deletes anything in Tally; every exchange is audited.
