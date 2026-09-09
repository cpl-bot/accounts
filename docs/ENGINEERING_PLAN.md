# Talai — Engineering Plan (v1)

Talai is a Tally‑connected accounting workspace: a Next.js application for the
finance team, backed by a FastAPI middleware that is the *only* component allowed
to talk to TallyPrime. This document turns the product requirement
(`tally_ai_accounting.pdf`) into an engineering design for v1, the version we
will deploy on the office LAN to validate the Tally connection end to end.

Companion documents:

- `docs/DECISIONS.md` — product decisions taken (with defaults) and open questions.
- `docs/TASKS.md` — executable task backlog with effort estimates.
- `docs/TALLY_INTEGRATION_NOTES.md` — what we know about the TallyPrime XML interface.
- `docs/FRONTEND_REVIEW.md` — review of the existing Next.js scaffold.
- `docs/SETUP.md` / `docs/LAN_DEPLOYMENT.md` — local development and LAN deployment.

---

## 1. Goals and non‑goals for v1

**Goals**

1. Connect to a TallyPrime (Gold, multi‑user) instance over LAN at a configured
   IP/port, confirm the connection and the company loaded, and show that status
   in the UI.
2. Read masters (companies, groups, ledgers, stock items, cost centres, godowns,
   voucher types) and vouchers from Tally on a schedule into a local database
   (SQLite for v1, Postgres/Supabase‑ready).
3. Serve the dashboard (Overview, Payables & Receivables) and the Accounts
   Payable list from the synced database, never from Tally directly.
4. Let a user create a purchase bill in Talai, validate it in the middleware,
   queue it, and commit it to Tally in small batches with a per‑record result.
5. Never corrupt Tally: validation before every write, create‑only writes,
   dry‑run mode by default, full audit log of every XML request/response.
6. Test‑driven: every module has tests; Tally is mocked in all automated tests.

**Non‑goals for v1** (tracked in `DECISIONS.md` as open items)

- Banking, Journal Voucher, Customers CRUD, GSTR‑2B, User & Access pages
  (remain "coming soon" but are routed and wired for data where cheap).
- Multi‑company, multi‑tenant, or cloud (Supabase) deployment.
- Altering or deleting existing Tally vouchers/masters.

Decided on 2026‑09‑09 and **added to v1**: vendor ledger creation (§3.8), a
user‑configurable gross‑profit formula (§3.9), and OCR through a local LLM
(§3.10).

---

## 2. System architecture

```
┌────────────────────────────┐        ┌────────────────────────────┐        ┌──────────────────────┐
│  Browser (LAN users)       │  HTTP  │  Next.js 16 (Talai UI)     │  HTTP  │  FastAPI middleware   │
│  http://<host>:3000        │ ─────► │  app/ (RSC + client)       │ ─────► │  http://<host>:8000   │
│                            │        │  app/api/* proxy routes    │  JSON  │  /api/v1/*            │
└────────────────────────────┘        └────────────────────────────┘        └──────────┬───────────┘
                                                                                       │ XML over HTTP
                                                                        ┌──────────────▼───────────┐
                                                                        │ SQLite (v1) → Postgres    │
                                                                        │ talai.db (sync store,     │
                                                                        │ drafts, audit)            │
                                                                        └──────────────┬───────────┘
                                                                                       │
                                                                        ┌──────────────▼───────────┐
                                                                        │ TallyPrime Gold server PC │
                                                                        │ XML server on :9000       │
                                                                        └──────────────────────────┘
```

**Single source of truth.** Tally remains the accounting system of record. The
middleware database is a *read replica plus outbox*: everything shown in the UI
comes from the replica; everything the UI wants to write goes into an outbox
(`voucher_drafts`) and reaches Tally only through the middleware's batched,
validated sync.

**Responsibilities**

| Layer | Owns | Never does |
|---|---|---|
| Next.js | UI, forms, client validation, session/user context, calling the middleware via server‑side proxy routes | Talk to Tally, hold Tally credentials, compute accounting totals from Tally directly |
| FastAPI middleware | Tally XML client, connection hygiene, scheduled read sync, validation rules, batched write, audit log, dashboard aggregates | Serve UI, know about React |
| Database | Replica of Tally masters/vouchers, outbox of drafts, sync runs, audit, settings | Be edited by hand |
| TallyPrime | Ledger truth, voucher numbering, GST computation as configured in Tally | Be reached by anything except the middleware |

**Why Next.js proxies to the middleware.** Browsers on the LAN talk only to
Next.js. Route handlers under `app/api/*` forward to the middleware with a
shared bearer token from the server environment (`MIDDLEWARE_API_KEY`). This
keeps the middleware unreachable from the browser, lets us swap the middleware
host without a client rebuild, and is the seam where per‑user auth is added later.

---

## 3. Backend (FastAPI middleware)

Location: `middleware/` (Python 3.11+, managed with `uv`).

```
middleware/
  pyproject.toml
  .env.example
  talai_middleware/
    __init__.py
    main.py                 # FastAPI app factory, lifespan (scheduler), routers
    config.py               # pydantic-settings; all env vars documented here
    api/
      deps.py               # DB session, auth (bearer token), tally client
      health.py             # /health, /tally/status
      tally.py              # /tally/companies, /tally/test-connection
      masters.py            # /ledgers, /groups, /stock-items, /cost-centres, /godowns, /voucher-types
      vouchers.py           # /vouchers (read replica), /drafts (outbox CRUD)
      sync.py               # /sync/runs, /sync/pull, /sync/push
      dashboard.py          # /dashboard/overview, /dashboard/payables
      settings.py           # /settings (tally host/port/company overrides)
    tally/
      transport.py          # Protocol: send(xml) -> xml; HttpxTransport; FakeTallyTransport
      envelopes.py          # XML request builders (export collections/reports, import vouchers/ledgers)
      parsers.py            # XML → typed dataclasses; encoding fixes; error extraction
      client.py             # TallyClient: high-level ops (list_companies, ledgers, vouchers, import_voucher …)
      errors.py             # TallyUnreachable, TallyCompanyNotOpen, TallyImportError(line_errors)
    db/
      base.py               # SQLAlchemy 2.0 engine/session; SQLite by default, DATABASE_URL override
      models.py             # tables (see §3.3)
      repo.py               # typed repository functions used by services/routes
    services/
      sync_pull.py          # Tally → DB (masters, vouchers, bills) with delta by ALTERID
      sync_push.py          # DB outbox → Tally (batched, validated, audited)
      validation.py         # rules engine for drafts (see §3.5)
      aggregates.py         # dashboard numbers from the replica
      scheduler.py          # interval pull; working-hours guard
    audit.py                # store every Tally request/response (redacted) with timing
  tests/
    conftest.py             # FakeTally server fixture, sqlite tmp db, TestClient
    fixtures/xml/           # captured/hand-written Tally XML responses
    unit/                   # envelopes, parsers, validation, aggregates
    integration/            # routes with FakeTallyTransport
```

### 3.1 Tally client design

- `TallyTransport` protocol: `send(xml: str, timeout: float) -> str`. Two
  implementations: `HttpxTransport` (POST to `http://{host}:{port}`,
  `Content-Type: text/xml;charset=utf-8`) and `FakeTallyTransport` (in‑process
  simulator that routes on `<TALLYREQUEST>`/`<ID>` and returns canned or
  computed XML). All automated tests use the fake; `scripts/check_tally_connection.py`
  uses the real one.
- Request envelope builders live in `envelopes.py` and are pure functions with
  golden‑file tests.
- Parsers tolerate Tally quirks: UTF‑16/UTF‑8 declarations, `&#4;` control
  characters, unescaped `&`, empty bodies, HTML error pages.
- `TallyClient` exposes typed operations only; no raw XML crosses into
  services or routes.
- Every call is recorded via `audit.py` (request hash, size, duration, status,
  error summary; full XML stored when `AUDIT_STORE_XML=true`).

### 3.2 Connection hygiene

- `GET /api/v1/tally/status` runs a cheap request (list companies) with a short
  timeout and returns `{reachable, companies[], active_company, expected_company,
  company_match, latency_ms, checked_at}`.
- Writes are refused unless: reachable, `company_match` is true, and
  `TALLY_WRITE_ENABLED=true`. The UI shows the reason.
- Pull sync is skipped (and logged) when Tally is unreachable; it never fails
  loudly at users.
- Circuit breaker: after 3 consecutive failures, the scheduler backs off
  exponentially (max 30 min) and `/tally/status` exposes `breaker_open`.

### 3.3 Data model (SQLAlchemy, SQLite v1, Postgres later)

All Tally‑sourced rows carry `tally_guid`, `tally_master_id`, `tally_alter_id`,
`company_name`, `synced_at`. Money is stored as `NUMERIC(18,2)` (Decimal in
Python), dates as ISO `DATE`.

| Table | Purpose | Key columns |
|---|---|---|
| `settings` | runtime overrides | `key`, `value` (tally_host, tally_port, company_name, sync_interval) |
| `sync_runs` | one row per pull/push run | `kind` (pull/push), `scope`, `status`, `started_at`, `finished_at`, `records_seen`, `records_changed`, `error` |
| `groups` | Tally groups | `name`, `parent`, `primary_group`, `is_revenue`, `is_deemed_positive`, `affects_gross_profit` |
| `ledgers` | Tally ledgers | `name`, `parent_group`, `opening_balance`, `closing_balance`, `gstin`, `mailing_name`, `address`, `state`, `gst_registration_type`, `is_bill_wise` |
| `stock_items` | inventory items | `name`, `parent`, `unit`, `hsn`, `gst_rate`, `closing_qty`, `closing_value` |
| `cost_centres`, `godowns`, `voucher_types` | lookups | `name`, `parent` |
| `vouchers` | header per Tally voucher | `voucher_number`, `voucher_type`, `date`, `party_ledger`, `narration`, `amount`, `reference`, `is_cancelled` |
| `voucher_ledger_entries` | ledger lines | `voucher_id`, `ledger_name`, `amount` (signed), `is_deemed_positive`, `cost_centre` |
| `voucher_inventory_entries` | item lines | `voucher_id`, `stock_item`, `godown`, `qty`, `rate`, `amount`, `hsn` |
| `bills` | open bill references (Bills Payable/Receivable) | `party_ledger`, `bill_name`, `bill_date`, `due_date`, `opening_amount`, `pending_amount`, `direction` (payable/receivable) |
| `voucher_drafts` | outbox from UI | `id (uuid)`, `payload_json`, `status` (draft/validated/queued/committing/committed/failed), `validation_errors_json`, `tally_voucher_number`, `tally_guid`, `attempts`, `created_by`, `created_at`, `updated_at` |
| `attachments` | uploaded bill files | `draft_id`, `file_name`, `mime`, `path`, `ocr_status`, `ocr_json` |
| `audit_log` | every Tally exchange | `direction`, `operation`, `request_hash`, `request_xml?`, `response_xml?`, `status`, `duration_ms`, `error`, `created_at` |

Migrations: Alembic from day one so the Supabase move is a DSN change plus a
migration run.

### 3.4 Sync design

**Pull (Tally → DB)**, scheduled every `SYNC_INTERVAL_MINUTES` (default 15) inside
`SYNC_WORKING_HOURS` (default 08:00–20:00 local) and on demand via `POST /sync/pull`.

1. Masters: export each collection with a `FETCH` list. Upsert by `tally_guid`
   (fallback `name` when GUID is absent). Rows not seen in a full pull are marked
   `is_deleted`.
2. Vouchers: export Day Book for `[last_success_date − overlap_days, today]`
   (`overlap_days=3`) and upsert by GUID; replace child lines per voucher.
   A weekly full re‑pull of the current financial year catches back‑dated edits.
3. Bills: export Bills Payable and Bills Receivable reports; replace table per run.
4. Delta strategy: where Tally returns `ALTERID`, remember the max per collection
   and filter by `$AlterID > last` on the next run (falls back to full pull).

**Push (DB → Tally)**, only on user action (`POST /sync/push`) and never on a timer.

1. Select drafts in `queued` in FIFO order, up to `PUSH_BATCH_SIZE` (default 10).
2. Re‑validate each against the *current* replica (ledger exists, item exists…).
3. Build one `Import Data` envelope per draft (not one per batch), so a failure
   is attributable. Send sequentially with `PUSH_INTER_REQUEST_DELAY_MS` (default 250).
4. Parse `<CREATED>/<ALTERED>/<ERRORS>/<LINEERROR>`; success → `committed` with
   voucher number and, after a read‑back by `REMOTEID`, the Tally GUID.
   Failure → `failed` with the line errors; drafts are never retried automatically.
5. Idempotency: each draft's UUID is sent as `REMOTEID`; before sending, the
   middleware checks the replica and Tally for a voucher with that `REMOTEID`.
6. Dry run: with `TALLY_WRITE_ENABLED=false` (default), push performs steps 1–3,
   stores the generated XML on the draft (`generated_xml`), and marks it
   `validated` with `dry_run=true`. This is how we validate v1 on the LAN before
   enabling live writes.

### 3.5 Validation rules (middleware, before any write)

Structural (schema) rules via pydantic; business rules in `validation.py`, each
returning `{code, field, message, severity}`:

- Party ledger exists and belongs to Sundry Creditors (purchase) — `LEDGER_NOT_FOUND`, `LEDGER_WRONG_GROUP`.
- Purchase ledger exists under Purchase Accounts; tax ledgers exist under Duties & Taxes.
- Stock items, godowns, cost centres exist (when inventory is used).
- Amounts: debits equal credits within ₹0.01; grand total = subtotal + taxes; no zero‑amount lines.
- Dates: voucher date within the company's current financial year and not in the future beyond `MAX_FUTURE_DAYS` (default 0); bill date ≤ voucher date; due date ≥ bill date.
- GSTIN format (15 chars, state code matches source of supply) — warning, not error.
- Duplicate guard: same party + supplier invoice number already in `vouchers` → error `DUPLICATE_SUPPLIER_INVOICE` (overridable by a flag stored on the draft).
- Voucher number: leave empty so Tally auto‑numbers unless the voucher type is manual.

### 3.6 API contract (`/api/v1`, JSON, bearer token)

Errors follow `{error: {code, message, details?}}` with proper HTTP status.

| Method & path | Purpose | Response shape |
|---|---|---|
| `GET /health` | liveness | `{status:"ok", version, db:"ok"}` |
| `GET /tally/status` | connection check (see §3.2) | `TallyStatus` |
| `POST /tally/test-connection` | test arbitrary `{host, port}` without saving | `TallyStatus` |
| `GET /tally/companies` | companies currently open in Tally | `{companies:[{name, guid?, start_from, books_from}]}` |
| `GET /settings` / `PUT /settings` | tally host/port/company, sync interval | `Settings` |
| `GET /ledgers?group=&q=&limit=&offset=` | ledgers from replica | `{items:[Ledger], total}` |
| `GET /groups`, `/stock-items`, `/cost-centres`, `/godowns`, `/voucher-types` | lookups | `{items:[…]}` |
| `GET /vouchers?type=&from=&to=&party=&limit=&offset=` | replica vouchers | `{items:[VoucherSummary], total}` |
| `GET /vouchers/{id}` | with lines | `Voucher` |
| `GET /bills?direction=payable|receivable&as_on=` | open bills + aging buckets | `{buckets:[…], items:[Bill], total_pending}` |
| `GET /dashboard/overview?from=&to=` | gross profit, cash & bank, P&L summary, trends | `DashboardOverview` |
| `GET /dashboard/payables?as_on=` | AP/AR outstanding, DPO/DSO, aging | `DashboardPayables` |
| `POST /drafts` | create draft purchase bill | `Draft` (status `draft` or `validated`) |
| `GET /drafts?status=` / `GET /drafts/{id}` / `PUT /drafts/{id}` / `DELETE /drafts/{id}` | outbox CRUD | `Draft` |
| `POST /drafts/{id}/validate` | run rules, store result | `{status, errors:[ValidationIssue]}` |
| `POST /drafts/{id}/queue` | mark queued (requires validated) | `Draft` |
| `POST /sync/pull` `{scopes:["masters","vouchers","bills"]}` | trigger pull now | `SyncRun` |
| `POST /sync/push` `{draft_ids?:[…]}` | commit queued drafts (or the given ones) | `{run: SyncRun, results:[{draft_id, status, voucher_number?, errors?}]}` |
| `GET /sync/runs?limit=` / `GET /sync/runs/{id}` | history | `[SyncRun]` |
| `POST /attachments` (multipart) | upload bill file, returns attachment + (mock) OCR | `Attachment` |

`DraftPurchaseBill` payload (mirrors the PRD's Create Bill form):

```json
{
  "gst_registration": "27AABCN1234C1ZP",
  "voucher_type": "Purchase",
  "voucher_date": "2026-06-10",
  "bill_date": "2026-05-10",
  "due_date": "2026-06-09",
  "supplier_invoice_no": "INV/BSM/4471",
  "cost_centre": "Procurement",
  "party": { "ledger_name": "BioShield Medical", "gstin": "27AAAAA0000A1Z5",
             "gst_treatment": "regular", "billing_address": "…",
             "source_of_supply": "Maharashtra", "destination_of_supply": "Maharashtra" },
  "purchase_ledger": "Purchase",
  "items": [ { "description": "Surgical gloves (box)", "stock_item": "Nitrile Gloves",
               "godown": "Main Store", "quantity": 50, "rate": 450, "hsn": "4015" } ],
  "ledger_lines": [ { "ledger_name": "DISCOUNT", "cost_centre": "Procurement", "amount": -675,
                      "description": "Discount @ 3%" } ],
  "tax_lines": [ { "ledger_name": "IGST @ 18%", "cost_centre": "Procurement", "amount": 4050 } ],
  "reverse_charge": false,
  "narration": "…",
  "totals": { "taxable_value": 22500, "sub_total": 21825, "gst": 4050, "tds": 0,
              "other_taxes": 0, "grand_total": 25875 }
}
```

### 3.8 Vendor ledger creation (DECISIONS A4)

Talai may create a **Sundry Creditors** ledger when a bill names a party Tally
does not know. The flow is deliberately explicit so a typo never becomes a
duplicate vendor.

1. `GET /ledgers/lookup?name=<text>` → `{found, ledger?, suggestions:[Ledger]}`.
   `found` is an exact, case‑insensitive match; `suggestions` are up to 5
   near‑matches (normalised: lower‑case, punctuation and "pvt/ltd/private/limited"
   tokens stripped, difflib ratio ≥ 0.8) restricted to Sundry Creditors.
2. `DraftPurchaseBill.party` gains `create_if_missing: bool` (default `false`).
   Validation: party missing and flag false → error `LEDGER_NOT_FOUND` with
   `details.can_create=true` and `details.suggestions`; flag true → warning
   `LEDGER_WILL_BE_CREATED`; flag true but a suggestion has ratio ≥ 0.95 →
   error `LEDGER_POSSIBLE_DUPLICATE` (user must pick the existing one or rename).
3. Push: for a draft with the flag, the middleware first sends an **Import
   Ledger** envelope (`NAME`, `PARENT=Sundry Creditors`, `ISBILLWISEON=Yes`,
   `GSTIN`, `PARTYGSTIN`, `GSTREGISTRATIONTYPE`, `LEDSTATENAME`, `ADDRESS.LIST`,
   `MAILINGNAME`, `REMOTEID=<draft id>-party`), parses `CREATED`, inserts the
   ledger into the replica, then sends the voucher. Dry run stores both XMLs on
   the draft (`generated_xml`, `generated_ledger_xml`). A failed ledger create
   fails the draft before any voucher request is sent.
4. `POST /ledgers` (`VendorLedgerCreate`) creates a vendor directly from the
   Vendors screen with the same envelope; dry run returns `{dry_run:true,
   generated_xml}` instead of writing.
5. `ledgers` rows created by Talai carry `source='talai'` until the next pull
   confirms them from Tally (`source='tally'`).

### 3.9 Configurable gross‑profit formula (DECISIONS A8)

`GET/PUT /settings/dashboard` → `DashboardFormula`:

```json
{
  "gross_profit_mode": "simple" | "trading",
  "stock_source": "tally" | "manual",
  "manual_opening_stock": null | "123.45",
  "manual_closing_stock": null | "123.45",
  "revenue_groups": ["Sales Accounts"],
  "cost_of_sales_groups": ["Purchase Accounts", "Direct Expenses"]
}
```

- **simple**: cost of sales = Σ cost_of_sales_groups for the period.
- **trading**: cost of sales = opening stock + Σ cost_of_sales_groups − closing
  stock. Opening stock = stock value as on the day before `from`; closing stock
  = as on `to`.
- Stock values come from a new `stock_valuations` table (`as_on`, `closing_value`,
  `source`) filled by the pull sync from Tally's **Stock Summary** report at the
  period boundaries the dashboard needs (FY start, month starts, today); when a
  boundary is missing the aggregate falls back to `manual_*` and reports it.
- `DashboardOverview` gains `formula` (the active `DashboardFormula`),
  `opening_stock`, `closing_stock`, and `stock_adjustment_status`
  (`applied | manual | unavailable`). The UI shows the mode next to the gross‑profit
  figure and edits it from a sidebar widget (`components/dashboard/formula-widget.tsx`).

### 3.10 OCR with a local LLM (DECISIONS A10)

Bills never leave the LAN. The middleware calls **Ollama** on the Ubuntu server.

- Config: `OCR_PROVIDER=none|mock|ollama`, `OLLAMA_BASE_URL=http://localhost:11434`,
  `OLLAMA_MODEL=gemma3:12b`, `OCR_TIMEOUT_SECONDS=180`, `OCR_MIN_CONFIDENCE=0.7`.
- `talai_middleware/ocr/`: `OcrProvider` protocol
  (`extract(data: bytes, mime: str) -> OcrResult`), `MockOcrProvider` (fixture),
  `OllamaOcrProvider`. PDFs are rasterised page‑by‑page with PyMuPDF (first 3
  pages, 150 dpi); images are passed as‑is. The request uses Ollama's
  `/api/chat` with `images` and `format: <JSON schema>` (structured outputs) so
  the model must return `OcrResult`:

  ```json
  { "fields": { "supplier_name": "…", "supplier_gstin": "…", "invoice_number": "…",
                "invoice_date": "YYYY-MM-DD", "due_date": null, "place_of_supply": "…",
                "line_items": [{"description": "…", "hsn": "…", "quantity": 1, "rate": 0, "amount": 0}],
                "taxable_value": 0, "cgst": 0, "sgst": 0, "igst": 0, "tds": 0, "other_charges": 0,
                "grand_total": 0, "narration": null },
    "confidence": { "supplier_name": 0.0-1.0, "...": 0.0-1.0 },
    "raw_text": "…" }
  ```

- Post‑processing (deterministic, tested): normalise dates, GSTIN checksum,
  arithmetic check (taxable + taxes + other = grand total within ₹1 → raises
  every confidence by 0.1, else lowers `grand_total` to ≤ 0.5), map
  `supplier_name` to a ledger via `/ledgers/lookup`.
- Attachments: `POST /attachments` stores the file and runs OCR in a background
  task; `GET /attachments`, `GET /attachments/{id}` expose `ocr_status`
  (`pending|running|done|failed|skipped`), `ocr_result`, `ocr_model`,
  `ocr_duration_ms`; `POST /attachments/{id}/ocr` re‑runs; `POST
  /attachments/{id}/draft` creates a `voucher_draft` pre‑filled from the OCR
  result with `needs_review=true` when any key field (supplier, invoice number,
  date, grand total) is below `OCR_MIN_CONFIDENCE` or validation fails.
- Model recommendation and sizing are in `docs/OCR_LOCAL_LLM.md`.

### 3.7 Configuration (env)

See `middleware/.env.example`. Key variables: `TALLY_HOST`, `TALLY_PORT`,
`TALLY_COMPANY_NAME`, `TALLY_TIMEOUT_SECONDS`, `TALLY_WRITE_ENABLED`,
`DATABASE_URL`, `MIDDLEWARE_API_KEY`, `SYNC_INTERVAL_MINUTES`,
`SYNC_WORKING_HOURS`, `PUSH_BATCH_SIZE`, `AUDIT_STORE_XML`, `CORS_ORIGINS`,
`OCR_PROVIDER`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OCR_TIMEOUT_SECONDS`,
`OCR_MIN_CONFIDENCE`.

---

## 4. Frontend (Next.js 16, React 19, Tailwind 4)

Keep the existing scaffold's look and structure; replace mock data with a typed
API layer and add the Configuration page.

```
app/
  (app)/…                      # existing routes
  (app)/configuration/page.tsx # Tally connection + sync settings (new, real)
  api/talai/[...path]/route.ts # server-side proxy to middleware (adds bearer token)
lib/
  api/
    schema.ts                  # zod schemas for every middleware response (contract tests)
    client.ts                  # typed fetch wrappers (server + client), error normalisation
    hooks.ts                   # useTallyStatus, useDashboardOverview, useBills, useDrafts…
  mock-data.ts                 # retained as fixtures for tests/storybook only
  format.ts, utils.ts
components/
  layout/tally-status-pill.tsx # green/red connection indicator in the header
  ap/…                         # bills-table/create-bill-form wired to drafts API
  configuration/…              # connection form, test button, company select, sync controls
tests/
  setup.ts                     # vitest + testing-library + msw handlers
  msw/handlers.ts              # mocked middleware responses (shared with dev "demo mode")
```

Decisions:

- **Data fetching:** server components fetch through `lib/api/client.ts` where
  the page is static per request (dashboard); client components use small
  hooks over `fetch` with SWR‑style revalidation for interactive views (AP list,
  sync modal, configuration). No global state library.
- **Validation:** zod on both the API responses (contract) and the Create Bill
  form (client‑side mirror of §3.5 structural rules; business rules stay in the middleware).
- **Demo mode:** `NEXT_PUBLIC_DEMO_MODE=true` serves the retained mock data via
  MSW‑style handlers so the UI can run without a middleware; off by default.
- **Testing:** Vitest + React Testing Library + jsdom; MSW for network. Rule:
  components render from props; hooks are tested against mocked fetch; pages
  get one smoke test each.
- **Build hygiene:** remove `typescript.ignoreBuildErrors`; add `pnpm lint`,
  `pnpm typecheck`, `pnpm test`, `pnpm test:watch`.
- **Branding:** app name is **Talai** everywhere (package name, metadata, sidebar,
  README, favicon title).

User‑visible flows in v1:

1. *Configuration → Tally connection*: enter IP/port, **Test connection**, see
   companies open in Tally, pick the expected company, save. Header pill shows
   live status.
2. *Dashboard*: numbers from `/dashboard/*`, period selector drives `from/to`.
3. *Accounts Payable*: All Bills = replica purchase vouchers + drafts; Needs
   Review = drafts with validation errors; Bill Uploads = attachments awaiting
   a draft. **Sync** opens the modal → `POST /sync/push`; results shown per row.
4. *Create Bill*: form → `POST /drafts` → inline validation issues → **Queue for
   sync**.

---

## 5. Test strategy (TDD)

- Write the failing test first for every unit listed in `docs/TASKS.md`; the
  task is done when the test passes and the module is wired.
- **Middleware:** `pytest` with `FakeTallyTransport`; golden XML files for
  request builders; parser tests seeded from real captures once we have them
  (task T‑B14 captures anonymised XML from the office Tally into `tests/fixtures/xml/`).
- **Frontend:** Vitest + RTL; MSW handlers derived from the zod schemas so a
  contract change fails both sides.
- **Contract test:** a JSON schema export from the FastAPI OpenAPI document is
  checked into `docs/openapi.json`; a frontend test asserts the zod schemas
  accept the OpenAPI examples.
- **LAN validation (manual, scripted):** `scripts/check_tally_connection.py`,
  `scripts/validate_db_sync.py`, and the dry‑run push are the acceptance
  checklist in `docs/LAN_DEPLOYMENT.md`.

---

## 6. Security and safety

- Middleware bound to the LAN interface only; bearer token required on every
  route except `/health`.
- Tally write path disabled by default; enabling requires an explicit env flag
  and a matching company name.
- No Alter/Delete requests in v1 code paths; the fake transport asserts this.
- Audit log retains every write request/response; read requests are summarised.
- Uploaded files stored under `middleware/data/uploads/` with random names; only
  PDF/PNG/JPG accepted; 20 MB per file for v1.
- Secrets only in `.env` files (git‑ignored); `.env.example` documents them.

---

## 7. Delivery phases

| Phase | Outcome | Exit criterion |
|---|---|---|
| 0 — Foundations (this PR) | Plan, decisions, backlog, rename, test harnesses, middleware skeleton with fake Tally, frontend API layer, scripts, env examples | `pnpm test`, `pnpm build`, `uv run pytest` green |
| 1 — Read path | Pull sync for masters/vouchers/bills; dashboard and AP list from replica | Dashboard numbers reconcile with Tally reports for one month |
| 2 — Write path (dry run) | Drafts, validation, generated XML, dry‑run push, audit | 10 drafts validated and inspected on LAN with `TALLY_WRITE_ENABLED=false` |
| 3 — Write path (live) | Live push to a **test company** in Tally, read‑back, idempotency | Vouchers appear in Tally with correct totals; re‑push is a no‑op |
| 4 — v1 LAN release | Two employees use Talai daily for purchase bills | One week without a failed or duplicated voucher |

Effort estimates per task are in `docs/TASKS.md`.
