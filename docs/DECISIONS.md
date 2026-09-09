# Talai — Product & Engineering Decisions

This file records the product‑level decisions the engineering plan depends on.
Each item has a **default** we are building against so work is not blocked, and
a **decision needed** line for the product owner. Change a default here and the
affected tasks in `docs/TASKS.md` are listed under *Impact*.

Legend: ✅ decided · ⏳ default chosen, needs confirmation · ❓ open, depends on
how the project expands.

---

## A. Decisions needed now (defaults chosen)

### A1. Tally as the system of record ✅
Tally stays the single source of truth. Talai's database is a replica plus an
outbox. Anything Talai shows that disagrees with Tally is a Talai bug.

### A2. Database for v1 ✅
**Decided (2026‑09‑09):** SQLite on the LAN host for v1; everything is verified
on SQLite before any move to Supabase. Alembic migrations keep the Postgres path
open. *Impact:* none now; T‑B24 stays in the backlog.

### A3. Which company/ledgers Talai may touch ⏳
**Default:** one Tally company, named in `TALLY_COMPANY_NAME`; writes are refused
if a different company is open in Tally. Development and the first live pushes
happen against a **copy** of the company loaded as a test company.
**Decision needed:** name of the production company and confirmation a test
company copy can be created in Tally. *Impact:* T‑B07, T‑L03.

### A4. Write scope for v1 ✅
**Decided (2026‑09‑09):** create Purchase vouchers **and vendor ledgers**. When a
bill names a party that does not exist in Tally, the Create Bill form prompts
the user ("new vendor — create ledger under Sundry Creditors?") with near‑match
suggestions to avoid duplicates. The ledger is created in the same push, before
the voucher, and both are audited. Still no alter/delete of anything.
*Impact:* T‑B23 and T‑F14 move into v1 Phase 2 (see `TASKS.md`); plan §3.8.

### A5. Voucher numbering ⏳
**Default:** Tally auto‑numbers; Talai shows its own draft id until the voucher
is committed, then shows Tally's number.
**Decision needed:** does the finance team use a manual numbering series for
purchases? If so, Talai must reserve numbers. *Impact:* T‑B11, T‑B12.

### A6. Who may push to Tally ✅
**Decided (2026‑09‑09):** no approval flow. Any Talai user can create, validate
and push drafts once the administrator has set `TALLY_WRITE_ENABLED=true` on the
LAN host. Roles/approvals stay in the backlog (T‑B18/T‑F12).

### A7. Sync cadence and working hours ⏳
**Default:** pull from Tally every 15 minutes between 08:00 and 20:00 local time
(and on demand); never on a timer for writes. Tally must have the company open.
**Decision needed:** office hours and whether a nightly full re‑pull is acceptable
(it can block the Tally UI for a minute on large books). *Impact:* T‑B09.

### A8. Dashboard definitions ✅
**Default (v1):**
- Revenue = Sales Accounts group for the period.
- Cost of sales = Purchase Accounts + Direct Expenses (no stock adjustment).
- Gross profit = Revenue − Cost of sales; margin = GP / Revenue.
- Indirect income / expense = the corresponding groups; Net profit = GP + indirect income − indirect expense.
- Cash & bank = Cash‑in‑Hand + Bank Accounts closing balances as on the period end.
- DPO = (AP outstanding / purchases in period) × days in period; DSO likewise with sales.
- Aging buckets: Current (not yet due), 1–30, 31–60, 61–90, 90+ days past due.
**Decided (2026‑09‑09):** the gross‑profit formula is **user‑configurable** from a
small sidebar widget on the dashboard: *Simple* (above) or *Trading* (Tally’s
P&L style: cost of sales = opening stock + purchases + direct expenses − closing
stock). Stock values come from Tally’s Stock Summary as on the period boundaries
when available, with a manual override. The active formula is shown next to the
gross‑profit figure. *Impact:* T‑B29, T‑F15 added to Phase 1; plan §3.9.

### A9. Period selector ⏳
**Default:** Indian financial year (1 April – 31 March); options: This FY,
Previous FY, This quarter, This month, Custom range. "vs previous period"
compares to the same‑length preceding period.

### A10. OCR provider ✅ (local LLM)
**Decided (2026‑09‑09):** bills never leave the LAN. OCR runs on the Ubuntu
server through **Ollama** with a multimodal open model, **Gemma 3** first
(`gemma3:12b` with a GPU, `gemma3:4b` CPU‑only), behind the `OcrProvider`
interface so the model is a config value (`OCR_PROVIDER=ollama`,
`OLLAMA_MODEL=…`). Extraction uses Ollama structured outputs (JSON schema =
`DraftPurchaseBill` partial + per‑field confidence). A draft created from OCR
lands in **Needs Review** when any key field has confidence below 0.7 or a
validation rule fails. Engineering recommendation and alternatives (Qwen2.5‑VL,
two‑stage Tesseract + LLM) are in plan §3.10. *Impact:* T‑B19, T‑F13 move into
Phase 2.

### A11. Authentication ⏳
**Default (v1):** none in the UI; the Next.js server holds a shared bearer
token for the middleware; both bound to the LAN. The sidebar user block shows a
static name from settings.
**Decision needed:** when multi‑user identity is required (audit trail per
person). *Impact:* T‑F12, T‑B18.

### A12. Hosting on the LAN ✅
**Decided (2026‑09‑09):** a local **Ubuntu server** on the office LAN runs the
middleware (8000), Next.js (3000) and Ollama (11434). systemd units and an
install script live in `deploy/`; see `docs/LAN_DEPLOYMENT.md` §2.

### A13. Bill attachments retention ⏳
**Default:** stored on the middleware host under `middleware/data/uploads/`,
20 MB max per file, PDF/PNG/JPG only, kept indefinitely.

### A14. GST computation ⏳
**Default:** Talai sends tax ledger lines exactly as entered; Tally is *not*
asked to auto‑compute GST. Validation checks arithmetic only. 
**Decision needed:** whether to rely on Tally's GST auto‑calculation instead
(depends on how ledgers are configured in the company). *Impact:* T‑B11, T‑B13.

---

## B. Open questions (depend on project expansion)

| # | Question | Why it matters | Earliest phase |
|---|---|---|---|
| B1 | Will Talai serve more than one company or more than one Tally installation? | Multi‑tenant schema, company column everywhere, per‑company settings | Phase 2 |
| B2 | Do we move the replica to Supabase, and does the Next.js app then read Supabase directly (as the PRD suggests) or keep going through the middleware? | Two read paths vs one; RLS design; secrets in Vercel | Phase 2 |
| B3 | Sales invoices (AR) creation, receipts, payments, journal vouchers, bank reconciliation — which is next after purchase bills? | Each needs its own envelope, validation rules, and UI | Phase 3+ |
| B4 | GSTR‑2B reconciliation: source of the GSTR‑2B file (GST portal download vs API) | Parser and matching logic | Phase 3+ |
| B5 | Vendor/customer master management inside Talai (creating ledgers) | Write scope expansion, see A4 | Phase 2 |
| B6 | Do we need bill‑wise details (New Ref / Agst Ref) on every purchase, or only for bill‑wise‑enabled ledgers? | Affects the voucher envelope and aging accuracy | Phase 1 |
| B7 | Cost centres and godowns: are they actually used in the books? | Optional fields vs required | Phase 1 |
| B8 | Approval workflow and roles (A6) | Auth, roles table, UI states | Phase 2 |
| B9 | How far back should the replica hold vouchers? (current FY only vs all) | Initial pull duration; SQLite size | Phase 1 |
| B10 | Notification channel for failed pushes (email/WhatsApp/none) | Worker + credentials | Phase 3 |
| B11 | TallyPrime version in the office (7.x has native JSON; older is XML only) | Whether to add a JSON transport | Phase 1 (check) |
| B12 | Backup policy for the middleware database and uploads | Cron + storage location | Phase 4 |

---

## C. Engineering decisions already taken

| Decision | Choice | Alternatives considered |
|---|---|---|
| Middleware language/framework | Python 3.11 + FastAPI | Node worker inside Next.js (rejected: PRD asks for FastAPI; Python XML/ETL tooling is stronger) |
| Package manager | `uv` for Python, `pnpm` for Node | pip/poetry; npm |
| ORM / migrations | SQLAlchemy 2.0 + Alembic | raw sqlite3 (no migration path to Postgres) |
| Tally transport | XML over HTTP, port 9000, one request per voucher | Batching many vouchers in one envelope (rejected: failures are not attributable) |
| Idempotency key | Draft UUID sent as `REMOTEID`, read‑back after commit | Voucher number matching (fragile with auto‑numbering) |
| Browser → middleware | Never direct; Next.js `app/api/talai/*` proxy adds bearer token | CORS direct calls (rejected: exposes token to browser) |
| Frontend data layer | zod schemas + thin fetch hooks | TanStack Query, tRPC (unnecessary at this size) |
| Test doubles | In‑process fake Tally server (`FakeTallyTransport`) + MSW handlers for the UI | Recording proxies (no Tally in CI) |
| Default write mode | Dry run (`TALLY_WRITE_ENABLED=false`) | Live by default (rejected: PRD says prevent corruption at all cost) |
