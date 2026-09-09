# Talai — Task Backlog and Effort Estimates

Estimates are in **engineer‑days** (an experienced developer working alone) and
**agent‑hours** (Claude Opus/Sonnet subagent wall‑clock with a human reviewing).
Status reflects this branch. Every task follows TDD: the acceptance test is
listed and must exist and pass before the task is closed.

Status: ✅ done on this branch · 🔶 partially done · ⬜ not started

## Phase 0 — Foundations

| ID | Task | Acceptance test | Days | Agent‑h | Status |
|---|---|---|---|---|---|
| T‑P01 | Engineering plan, decisions, backlog, Tally integration notes | Documents reviewed by product owner | 1.0 | 2 | ✅ |
| T‑P02 | Review existing Next.js scaffold (`docs/FRONTEND_REVIEW.md`) | Findings ranked with file paths | 0.5 | 1 | ✅ |
| T‑P03 | Rename app to Talai; remove Vercel analytics; enable type checking in build | `pnpm build` green with `ignoreBuildErrors=false`; no "AI Accountant" string | 0.25 | 0.5 | ✅ |
| T‑P04 | Frontend test harness (Vitest, RTL, MSW) + first tests for `lib/format.ts` | `pnpm test` runs and passes | 0.5 | 1 | ✅ |
| T‑P05 | Middleware skeleton (uv, FastAPI app factory, settings, auth, `/health`) | `uv run pytest` passes health + auth tests | 0.5 | 1 | ✅ |
| T‑P06 | `.env.example` (root + middleware), `docs/SETUP.md`, `docs/LAN_DEPLOYMENT.md` | A new machine follows SETUP and reaches `/health` and `http://host:3000` | 0.5 | 1 | ✅ |

## Phase 1 — Read path (Tally → replica → UI)

| ID | Task | Acceptance test | Days | Agent‑h | Status |
|---|---|---|---|---|---|
| T‑B01 | `TallyTransport` protocol, `HttpxTransport`, `FakeTallyTransport` | Fake answers list‑companies; httpx transport tested with respx incl. timeout/HTML error | 1.0 | 2 | ✅ |
| T‑B02 | XML envelope builders for collections and reports | Golden‑file tests for companies, ledgers, groups, stock items, cost centres, godowns, voucher types, Day Book, Bills Payable/Receivable | 1.0 | 2 | ✅ |
| T‑B03 | Tolerant XML parsers (encoding, control chars, bare `&`) | Fixture XML with each quirk parses; HTML/empty response raises typed error | 1.0 | 2 | ✅ |
| T‑B04 | SQLAlchemy models + Alembic initial migration (plan §3.3) | `alembic upgrade head` on empty SQLite creates all tables; downgrade works | 1.0 | 1.5 | ✅ |
| T‑B05 | `/tally/status`, `/tally/test-connection`, `/tally/companies` with company‑match logic | Route tests: reachable, unreachable, wrong company | 0.5 | 1 | ✅ |
| T‑B06 | Settings table + `/settings` GET/PUT (host, port, company, interval) | Env default → DB override precedence tested | 0.5 | 1 | ✅ |
| T‑B07 | Pull sync: masters upsert by GUID, soft‑delete missing | Two consecutive pulls are idempotent; renamed ledger updates in place | 1.5 | 3 | ✅ |
| T‑B08 | Pull sync: vouchers by date range with overlap; lines replaced per voucher | Back‑dated edit inside overlap window is picked up | 1.5 | 3 | ✅ |
| T‑B09 | Scheduler with working hours, circuit breaker, `SYNC_ENABLED` | Breaker opens after 3 failures, backs off, status exposes it | 1.0 | 2 | ✅ |
| T‑B10 | Bills (payables/receivables) pull + aging buckets endpoint | Bucket sums equal total pending; boundaries at 30/60/90 tested | 1.0 | 2 | ✅ |
| T‑B14 | Dashboard aggregates (`/dashboard/overview`, `/dashboard/payables`) per DECISIONS A8 | Seeded replica produces known GP, net profit, cash & bank, trends | 1.5 | 3 | ✅ |
| T‑B15 | Capture anonymised real XML responses from office Tally into `tests/fixtures/xml/` | Parsers pass on real captures | 0.5 | — (needs LAN) | ⬜ |
| T‑F01 | zod schemas for the whole API contract + `apiFetch` client + typed errors | Schema tests against OpenAPI examples | 1.0 | 2 | ✅ |
| T‑F02 | Server‑side proxy route `app/api/talai/[...path]` with bearer token, demo mode | Proxy forwards method/body/headers; 502 on unreachable; demo returns fixtures | 0.5 | 1 | ✅ |
| T‑F03 | Data hooks (`useTallyStatus`, dashboard, bills, drafts, settings) | Hook tests with MSW: loading, success, error, refetch | 1.0 | 2 | ✅ |
| T‑F04 | Configuration page (host/port, test connection, company select, save) + header status pill | RTL tests: success and failure paths | 1.0 | 2 | ✅ |
| T‑F05 | Dashboard wired to API with period → from/to, loading/error states | Page smoke test with MSW; period change refetches | 1.0 | 2 | ✅ |
| T‑F06 | Accounts Payable list from API (vouchers + drafts), real pagination, tabs | Table renders from props; tab filters tested | 1.0 | 2 | ✅ |
| T‑L01 | LAN validation: `scripts/check_tally_connection.py` against office Tally | Script exits 0, lists the company | 0.25 | — | ⬜ (needs LAN) |
| T‑L02 | LAN validation: `scripts/validate_db_sync.py` full pull, reconcile ledger counts and bill totals with Tally reports | Script exits 0; dashboard numbers match Tally P&L for one month | 1.0 | — | ⬜ (needs LAN) |

## Phase 2 — Write path (dry run)

| ID | Task | Acceptance test | Days | Agent‑h | Status |
|---|---|---|---|---|---|
| T‑B11 | Purchase voucher Import envelope builder (ledger, inventory, bill, cost‑centre allocations, `REMOTEID`) | Golden XML; debit/credit sign convention; totals balance | 1.5 | 3 | ✅ |
| T‑B12 | Validation rules engine (plan §3.5) | One test per rule code; duplicate supplier invoice guard | 1.5 | 3 | ✅ |
| T‑B13 | Drafts outbox API (CRUD, validate, queue) | State machine transitions tested; invalid transitions 409 | 1.0 | 2 | ✅ |
| T‑B16 | Push service: batch, delay, dry‑run storing generated XML, audit rows | Dry run never calls transport; live path parses CREATED/LINEERROR | 1.5 | 3 | ✅ |
| T‑B17 | Attachments upload endpoint + `OcrProvider` interface with mock | Rejects wrong mime/size; stores file; mock OCR returns fixture | 0.5 | 1 | ✅ |
| T‑F07 | Create Bill form → `DraftPurchaseBill`, inline validation issues, queue button | Form test builds exact payload; issues rendered by field | 1.5 | 3 | ✅ |
| T‑F08 | Sync modal → `/sync/push`, per‑record results, dry‑run banner | RTL test for committed/failed/dry‑run renders | 0.5 | 1 | ✅ |
| T‑F09 | Upload modal → `/attachments` (single file), opens Create Bill prefilled from OCR JSON | Upload test; prefill test | 0.5 | 1 | 🔶 (upload done, prefill pending OCR decision) |
| T‑F10 | Accessible Modal (focus trap, Escape, aria) | Keyboard tests | 0.25 | 0.5 | ✅ |
| T‑L03 | LAN dry run: 10 real bills entered, XML reviewed by the accountant | Sign‑off recorded in `docs/LAN_DEPLOYMENT.md` checklist | 1.0 | — | ⬜ |

## Phase 3 — Write path (live, test company)

| ID | Task | Acceptance test | Days | Agent‑h | Status |
|---|---|---|---|---|---|
| T‑B20 | Read‑back by `REMOTEID` after commit; store Tally GUID/number; re‑push is a no‑op | Fake Tally: second push of same draft returns existing voucher | 0.5 | 1 | 🔶 (implemented against fake; verify on Tally) |
| T‑B21 | Error catalogue: map Tally `LINEERROR` strings to friendly messages | Table‑driven test | 0.5 | 1 | ⬜ |
| T‑L04 | Enable `TALLY_WRITE_ENABLED=true` against a **test company**; push 10 bills; verify in Tally | Totals match; voucher count +10; re‑push adds 0 | 1.0 | — | ⬜ |
| T‑L05 | Load test: 50 queued drafts, observe Tally UI responsiveness for LAN users; tune batch size/delay | No Tally error; delay documented | 0.5 | — | ⬜ |

## Phase 4 — v1 LAN release

| ID | Task | Acceptance test | Days | Agent‑h | Status |
|---|---|---|---|---|---|
| T‑L06 | Run as services (systemd / NSSM on Windows / Docker Compose) with auto‑restart | Reboot test | 0.5 | 1 | 🔶 (compose + docs provided) |
| T‑L07 | Backup of `talai.db` + uploads (daily copy) | Restore test | 0.25 | 0.5 | ⬜ |
| T‑B22 | Basic observability: structured logs, `/sync/runs` page in UI | UI lists last 20 runs with status | 0.5 | 1 | ⬜ |
| T‑F11 | Sync history page + failed‑draft retry UX | RTL tests | 0.5 | 1 | ⬜ |
| T‑L08 | One‑week pilot with two employees; collect issues | Zero duplicate/failed vouchers | — | — | ⬜ |

## Backlog (post‑v1, depends on DECISIONS §B)

| ID | Task | Days |
|---|---|---|
| T‑B18 / T‑F12 | Users, roles, approver flow, per‑user audit | 3 |
| T‑B19 / T‑F13 | OCR provider integration (per DECISIONS A10) and confidence‑based "Needs Review" | 3 |
| T‑B23 | Vendor ledger creation from Talai (DECISIONS A4) | 1.5 |
| T‑B24 | Supabase/Postgres deployment, DSN switch, RLS | 2 |
| T‑B25 | Sales invoices, receipts, payments, journal vouchers | 5 |
| T‑B26 | GSTR‑2B import and reconciliation | 4 |
| T‑B27 | Banking module (statement import, matching) | 4 |
| T‑B28 | TallyPrime JSON transport (if office runs 7.x) | 1 |

## Totals

| Phase | Engineer‑days | Agent‑hours |
|---|---|---|
| 0 | 3.25 | 6.5 |
| 1 | 17.25 | 34.5 |
| 2 | 10.25 | 20.5 |
| 3 | 2.5 | 2 |
| 4 | 1.75 | 3.5 |
| **v1 total** | **~35 days** | **~67 agent‑hours** plus LAN validation time |

Parallelisation: backend and frontend tracks are independent once the API
contract (plan §3.6) is fixed; the LAN tasks (T‑L*) require a person at the
office and cannot be delegated to agents.
