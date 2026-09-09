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

### A2. Database for v1 ⏳
**Default:** SQLite file on the LAN host, accessed only by the middleware, with
Alembic migrations so the same schema moves to Postgres/Supabase later.
**Decision needed:** confirm Supabase is a *later* phase, not v1. Running a
cloud database means the middleware must reach the internet and the office data
leaves the LAN. *Impact:* T‑B03, T‑B04, T‑B20.

### A3. Which company/ledgers Talai may touch ⏳
**Default:** one Tally company, named in `TALLY_COMPANY_NAME`; writes are refused
if a different company is open in Tally. Development and the first live pushes
happen against a **copy** of the company loaded as a test company.
**Decision needed:** name of the production company and confirmation a test
company copy can be created in Tally. *Impact:* T‑B07, T‑L03.

### A4. Write scope for v1 ⏳
**Default:** create Purchase vouchers only. No alter, no delete, no master
creation (vendors must already exist as ledgers in Tally). If the vendor is
missing, the draft is flagged `LEDGER_NOT_FOUND` and someone creates it in Tally.
**Decision needed:** should Talai be allowed to *create* a vendor ledger when
the OCR/entry finds a new supplier? (Reasonable for v1.1; increases corruption
surface.) *Impact:* T‑B12, T‑F09.

### A5. Voucher numbering ⏳
**Default:** Tally auto‑numbers; Talai shows its own draft id until the voucher
is committed, then shows Tally's number.
**Decision needed:** does the finance team use a manual numbering series for
purchases? If so, Talai must reserve numbers. *Impact:* T‑B11, T‑B12.

### A6. Who may push to Tally ⏳
**Default:** any Talai user can create and validate drafts; **pushing** requires
the middleware flag `TALLY_WRITE_ENABLED=true`, which the administrator sets on
the LAN host. No per‑user roles in v1 (two users, both accountants).
**Decision needed:** should one of the two employees be an approver before a
push? *Impact:* T‑F12, T‑B18 (roles) would move from backlog to v1.

### A7. Sync cadence and working hours ⏳
**Default:** pull from Tally every 15 minutes between 08:00 and 20:00 local time
(and on demand); never on a timer for writes. Tally must have the company open.
**Decision needed:** office hours and whether a nightly full re‑pull is acceptable
(it can block the Tally UI for a minute on large books). *Impact:* T‑B09.

### A8. Dashboard definitions ⏳
**Default (v1):**
- Revenue = Sales Accounts group for the period.
- Cost of sales = Purchase Accounts + Direct Expenses (no stock adjustment).
- Gross profit = Revenue − Cost of sales; margin = GP / Revenue.
- Indirect income / expense = the corresponding groups; Net profit = GP + indirect income − indirect expense.
- Cash & bank = Cash‑in‑Hand + Bank Accounts closing balances as on the period end.
- DPO = (AP outstanding / purchases in period) × days in period; DSO likewise with sales.
- Aging buckets: Current (not yet due), 1–30, 31–60, 61–90, 90+ days past due.
**Decision needed:** confirm these match how the CA reads Tally's P&L
(Tally's P&L includes opening/closing stock in gross profit). *Impact:* T‑B14.

### A9. Period selector ⏳
**Default:** Indian financial year (1 April – 31 March); options: This FY,
Previous FY, This quarter, This month, Custom range. "vs previous period"
compares to the same‑length preceding period.

### A10. OCR provider ❓
**Default (v1):** no OCR. Upload stores the file and opens the Create Bill form
empty; an `OcrProvider` interface with a mock exists so a provider can be added.
**Decision needed:** provider choice (Claude vision with structured output vs.
Google Document AI vs. AWS Textract vs. an Indian GST‑invoice API), the budget
per bill, and whether bills may leave the LAN. *Impact:* T‑B19, T‑F13.

### A11. Authentication ⏳
**Default (v1):** none in the UI; the Next.js server holds a shared bearer
token for the middleware; both bound to the LAN. The sidebar user block shows a
static name from settings.
**Decision needed:** when multi‑user identity is required (audit trail per
person). *Impact:* T‑F12, T‑B18.

### A12. Hosting on the LAN ⏳
**Default:** one always‑on machine on the office LAN (can be the Tally server
PC itself, or a Mac/Linux box) runs both the middleware (port 8000) and Next.js
(port 3000). Users open `http://<host>:3000`. Docker Compose is provided as an
optional alternative.
**Decision needed:** which machine, and whether it is Windows (affects the
run‑as‑service instructions). *Impact:* T‑L01, T‑L02.

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
