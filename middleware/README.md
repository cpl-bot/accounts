# Talai middleware

The FastAPI service that is the **only** component allowed to talk to
TallyPrime. It keeps a local read replica of Tally (masters, vouchers, bills),
serves the Talai UI from that replica, and commits new purchase bills back to
Tally through a validated, audited, batched write path.

Design: [`docs/ENGINEERING_PLAN.md`](../docs/ENGINEERING_PLAN.md) §3.
Tally XML facts: [`docs/TALLY_INTEGRATION_NOTES.md`](../docs/TALLY_INTEGRATION_NOTES.md).
API contract: [`docs/openapi.json`](../docs/openapi.json).

---

## Install

Requires Python 3.11+ and [uv](https://docs.astral.sh/uv/).

```bash
cd middleware
uv sync --extra dev          # creates .venv from uv.lock
cp .env.example .env         # then edit TALLY_HOST / TALLY_COMPANY_NAME
```

## Run

```bash
cd middleware
uv run alembic upgrade head                                        # migrate
uv run uvicorn talai_middleware.main:app --host 0.0.0.0 --port 8000
```

Interactive docs at `http://<host>:8000/docs`; liveness at `/health` (the only
route that needs no token). Everything else is under `/api/v1` and requires
`Authorization: Bearer $MIDDLEWARE_API_KEY`.

No Tally on your network? Seed the replica from the built-in fake:

```bash
uv run --project middleware python scripts/seed_demo_data.py     # from the repo root
```

## Test and lint

```bash
cd middleware
uv run pytest -q
uv run pytest -q --cov=talai_middleware --cov-report=term-missing
uv run ruff check .
```

Every test uses `FakeTallyTransport` (an in-process Tally simulator) or `respx`;
nothing in the suite touches the network. The fake also *asserts* that no
request contains `ACTION="Alter"` or `ACTION="Delete"`, so a future change that
tries to modify Tally data fails the build.

## Migrate

```bash
cd middleware
uv run alembic upgrade head                       # apply
uv run alembic revision --autogenerate -m "..."   # after changing db/models.py
```

SQLite lives at `middleware/data/talai.db` (git-ignored). Moving to
Postgres/Supabase is a `DATABASE_URL` change plus `alembic upgrade head`.

## What the API exposes beyond the core contract

Added with plan §3.8–§3.10 (all under `/api/v1`, all bearer-token protected):

| Method & path | Purpose |
|---|---|
| `GET /ledgers/lookup?name=` | Exact match plus up to five near-matches under Sundry Creditors, with `best_ratio` and `can_create` (§3.8.1). |
| `POST /ledgers` | Create a vendor ledger. With `TALLY_WRITE_ENABLED=false` it returns `{dry_run:true, generated_xml, ledger:null}` and sends nothing (§3.8.4). |
| `GET /settings/dashboard` / `PUT /settings/dashboard` | The gross-profit formula (§3.9). Unknown group names come back in `warnings`; they never block the save. |
| `POST /sync/pull {"scopes":["stock"]}` | Pull closing stock values at the FY start, each month start and today (§3.9). `stock` is one of the default scopes. |
| `POST /attachments` (multipart) | Store a bill and start OCR in the background (§3.10). |
| `GET /attachments`, `GET /attachments/{id}` | `ocr_status`, `ocr_result`, `ocr_model`, `ocr_duration_ms`, `ocr_error`. |
| `POST /attachments/{id}/ocr` | Re-run OCR, synchronously. |
| `POST /attachments/{id}/draft` | Create a `voucher_draft` pre-filled from the OCR result, with `needs_review` and `review_reasons`. |

`DraftPurchaseBill.party` gained `create_if_missing` (default `false`). When it is
true and the vendor is unknown, push sends an **Import Ledger** request first and
only then the voucher; a dry run stores both envelopes on the draft
(`generated_xml`, `generated_ledger_xml`). A ledger that Tally refuses fails the
draft and the voucher request is never sent. Ledgers Talai created carry
`source='talai'` until a pull confirms them (`source='tally'`).

## OCR of uploaded bills

Bills never leave the LAN: `OCR_PROVIDER=ollama` calls **Ollama** on the Ubuntu
server, `mock` returns a bundled fixture (useful for demos and tests), and the
default `none` stores uploads without reading them.

```bash
# on the machine running Ollama
ollama pull gemma3:12b

# from the repo root, once OLLAMA_BASE_URL points at it
uv run --project middleware python scripts/check_ocr.py --sample
uv run --project middleware python scripts/check_ocr.py invoice.pdf
```

`check_ocr.py` exits 2 (Ollama unreachable), 3 (model not pulled) or 4 (a file
could not be read), so it works as a deployment gate.

How a bill becomes a draft:

1. `POST /attachments` stores the file under `UPLOAD_DIR` with a random name.
2. A background task rasterises PDFs with PyMuPDF (first 3 pages, 150 dpi;
   images are passed through) and POSTs the pages to Ollama's `/api/chat` with
   `format` set to the JSON Schema of `OcrResult`, `stream:false` and
   `temperature:0`, so the model must answer in that shape.
3. Post-processing is deterministic and tested: dates are normalised day-first
   (`10/06/2026`, `10-06-26`, `09 Jul 2026` → ISO), the GSTIN's format *and*
   check digit are verified, the arithmetic is cross-checked (taxable + GST +
   other charges vs the grand total, within ₹1 — a match raises every
   confidence by 0.1, a mismatch caps `grand_total` at 0.5), and the supplier
   name is matched to a Sundry Creditors ledger.
4. `POST /attachments/{id}/draft` pre-fills a purchase bill. Stock items that
   are not in the replica are left blank on purpose, so validation asks the
   reviewer instead of guessing an inventory movement. Tax ledgers are guessed
   from Duties & Taxes ledgers whose names contain CGST/SGST/IGST.

| Variable | Default | Meaning |
|---|---|---|
| `OCR_PROVIDER` | `none` | `none` \| `mock` \| `ollama` |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Where Ollama listens |
| `OLLAMA_MODEL` | `gemma3:12b` | Must be pulled first |
| `OCR_TIMEOUT_SECONDS` | `180` | A 12B vision model on CPU is slow |
| `OCR_MIN_CONFIDENCE` | `0.7` | Below this, a key field lands in `review_reasons` |

## Support scripts (run from the repo root)

```bash
uv run --project middleware python scripts/check_tally_connection.py --xml
uv run --project middleware python scripts/validate_db_sync.py            # or --fake
uv run --project middleware python scripts/dry_run_push.py
uv run --project middleware python scripts/seed_demo_data.py --reset
uv run --project middleware python scripts/check_ocr.py --sample
uv run python middleware/scripts/export_openapi.py                        # refresh docs/openapi.json
```

`check_ocr.py` exits 3 when `OLLAMA_MODEL` is not pulled.
`check_tally_connection.py` exits 2 (TCP unreachable), 3 (XML server not
answering) or 4 (expected company not open), so it works as a deployment gate.
`validate_db_sync.py` exits non-zero when the replica does not reconcile.

## Docker

```bash
docker build -t talai-middleware middleware
docker run --rm -p 8000:8000 -v talai-data:/data \
  -e DATABASE_URL=sqlite:////data/talai.db -e UPLOAD_DIR=/data/uploads \
  -e TALLY_HOST=192.168.1.24 -e MIDDLEWARE_API_KEY=... talai-middleware
```

The entrypoint runs `alembic upgrade head` and then uvicorn on `$HOST:$PORT`.

---

## Safety switches

| Switch | Default | Effect |
|---|---|---|
| `TALLY_WRITE_ENABLED` | `false` | When false, `POST /sync/push` validates each draft, stores the generated XML on it and marks it `validated` + `dry_run`. **Nothing is sent to Tally.** |
| Company match | enforced | A write is refused unless `TALLY_COMPANY_NAME` is one of the companies currently open in Tally. `/tally/status` reports `company_match`. |
| Create-only | enforced in code | v1 emits `ACTION="Create"` only. The fake transport raises on Alter/Delete. |
| `SYNC_ENABLED` | `true` | Disables the background pull scheduler when false. |
| Circuit breaker | 3 failures | After `SYNC_BREAKER_THRESHOLD` consecutive failures the scheduler backs off exponentially to `SYNC_BREAKER_MAX_BACKOFF_MINUTES`; `/tally/status` exposes `breaker_open`. |
| `OCR_PROVIDER` | `none` | OCR is off by default: uploads are stored and marked `skipped`, and nothing is sent to Ollama. |
| `AUDIT_STORE_XML` | `false` | When true, every audit row keeps the full request and response XML. |
| Bearer token | required | Every `/api/v1` route needs `MIDDLEWARE_API_KEY`. Only `/health` is open. |

The recommended rollout is Phase 2 of the plan: run with `TALLY_WRITE_ENABLED=false`,
inspect ten drafts' generated XML with `scripts/dry_run_push.py`, then enable
writes against a **test company** before the live one.

---

## Tally-side setup (on the TallyPrime Gold server PC)

Derived from `docs/TALLY_INTEGRATION_NOTES.md`; verify against the office
installation, since the vendor documentation was not reachable when those notes
were gathered.

1. **Enable the XML/HTTP server.** In TallyPrime press **F1 (Help) → Settings →
   Advanced Configuration**. Set TallyPrime to act as **Both** (client *and*
   server) — "Server" alone is enough if this PC only serves. Set the
   **Port** to `9000` (the default) and accept.
2. **Keep the company open.** Tally answers XML requests only for companies
   that are currently loaded. If the PC is restarted, the company must be
   reopened before the middleware can sync. Set `TALLY_COMPANY_NAME` to that
   company's exact name.
3. **Leave TallyPrime running and signed in.** The XML server is part of the
   application; closing Tally closes the port.
4. **Allow the port through the Windows firewall.** In an elevated PowerShell:

   ```powershell
   New-NetFirewallRule -DisplayName "TallyPrime XML 9000" -Direction Inbound `
     -Protocol TCP -LocalPort 9000 -Action Allow -Profile Private
   ```

   Restrict `-RemoteAddress` to the middleware host if you can.
5. **Give the PC a fixed address.** A DHCP reservation or static IP, so
   `TALLY_HOST` does not drift. Note that a TallyPrime *Server* deployment uses
   port 9090 for its gateway; the XML/HTTP port for integrations stays 9000.
6. **Verify from the middleware host:**

   ```bash
   uv run --project middleware python scripts/check_tally_connection.py --xml
   ```

   It prints reachability, latency, the companies currently open, and whether
   the expected company matches.
7. **Watch the load.** Write requests can block the Tally UI for LAN users who
   are viewing the same voucher or master, so keep `PUSH_BATCH_SIZE` small and
   leave `PUSH_INTER_REQUEST_DELAY_MS` in place.

---

## Layout

```
talai_middleware/
  main.py        app factory, lifespan (scheduler), routers
  config.py      every env var, with safe defaults
  audit.py       audit entry + sinks
  api/           deps (auth, session, client), errors, schemas, routers
  tally/         transport, envelopes, parsers, client, errors, fake (+ seed data)
  ocr/           schema, provider protocol, mock, ollama, rasterize, postprocess
  db/            models, engine, repository functions, audit sink
  services/      sync_pull, sync_push, validation, aggregates, ledger_lookup,
                 ocr_service, scheduler
alembic/         migrations (initial schema, vendor ledgers, stock valuations, OCR)
scripts/         export_openapi.py
tests/           unit/, integration/, fixtures/xml/
```

---

## Deviations from the plan

The plan (§3) was followed except where noted here.

1. **`api/settings.py` is `api/settings_routes.py`.** `settings.py` inside the
   package would shadow `talai_middleware.config`'s role in imports and read
   ambiguously next to it.
2. **Import envelopes use the `IMPORTDATA` wrapper**
   (`ENVELOPE → BODY → IMPORTDATA → REQUESTDESC/REQUESTDATA → TALLYMESSAGE`)
   rather than `BODY → TALLYMESSAGE` directly, and purchase item lines use
   `ALLINVENTORYENTRIES.LIST` with a nested `ACCOUNTINGALLOCATIONS.LIST` (the
   purchase-ledger allocation per item) instead of `INVENTORYENTRIES.LIST` plus
   a standalone purchase `ALLLEDGERENTRIES.LIST`. This follows the Postman
   collection findings in the integration notes (§11) and is the shape
   TallyPrime expects for an invoice-view purchase voucher.
3. **The Day Book date range is re-applied in Python.** Tally may ignore
   `SVFROMDATE`/`SVTODATE` on that export, so `sync_pull` filters the parsed
   vouchers by date as well as asking Tally to.
4. **Bills come from the `Bills Payable` / `Bills Receivable` reports** and the
   parser accepts `BILLS`, `BILLFIXED` or `BILL` elements, because the exact
   element names could not be confirmed. This is the highest-risk parser and
   the first thing to check against the office Tally.
5. **Audit rows join the caller's transaction** (`SessionAuditSink`) instead of
   being written on a separate connection. SQLite allows a single writer, and a
   second connection blocked for the full busy timeout on every Tally call
   (a pull took 25 s instead of 0.1 s). A log line is always emitted, so an
   exchange is still traceable if the surrounding transaction rolls back.
6. **`TALLY_WRITE_ENABLED` is not settable through `PUT /settings`.** Enabling
   writes requires an environment change and a restart, on purpose.
7. **Two extra config knobs** beyond §3.7: `TALLY_STATUS_TIMEOUT_SECONDS` (the
   cheap probe must not hang behind the 30 s request timeout) and
   `SYNC_BREAKER_*` (the plan describes the breaker's behaviour but names no
   variables). `MAX_FUTURE_DAYS`, `SYNC_OVERLAP_DAYS` and `UPLOAD_DIR` are
   named in the plan's prose and are implemented as env vars.
8. **OCR ships behind a switch.** §3.10 is implemented, but `OCR_PROVIDER`
   defaults to `none`, so a deployment that has not installed Ollama simply
   stores uploads with `ocr_status="skipped"`.
9. **`GET/PUT /settings/dashboard` returns one field more than §3.9.**
   `DashboardFormulaOut` is `DashboardFormula` plus `warnings: string[]`. The
   six documented fields are unchanged; the extra one carries the advisory
   "that group is not in the replica" messages, which would otherwise only
   reach a log file.
10. **`stock_adjustment_status` in `simple` mode is `applied`.** It reports
   whether the *configured* formula could be applied as configured, so simple
   mode — which has no stock adjustment to make — is `applied` with both stock
   figures zero. `manual` means at least one figure came from `manual_*`;
   `unavailable` means trading was asked for and no figure could be found, so
   the period was computed like `simple`.
11. **`attachments.ocr_json` was replaced**, not extended: the migration drops
   it and adds `ocr_result_json`, `ocr_model`, `ocr_duration_ms`, `ocr_error`.
   Nothing ever wrote a meaningful value to the old column.
12. **`OcrFields` money and quantities are `float`, not `Decimal`.** The same
   models generate the JSON Schema Ollama constrains the model with, and a
   grammar needs a plain `{"type":"number"}`. Everything that must be exact
   converts to `Decimal` when the draft is built.
13. **`POST /attachments` commits before queueing its background task.** The
   task opens its own session and FastAPI runs it before the request's
   session-scoped dependency commits, so without the explicit commit it would
   not see the row.
14. **Weekly full re-pull is not scheduled.** `POST /sync/pull` with an explicit
   `from_date`/`to_date` covers it; wiring it to a weekly timer is Phase 1 work.

## Open questions for the office Tally

These shape the parsers and should be confirmed with a real capture (task
T-B14 in the plan's backlog):

- the exact element names and fields of the **Bills Payable / Bills Receivable**
  export (deviation 4 above);
- whether the **Day Book** export honours `SVFROMDATE`/`SVTODATE` on this
  TallyPrime version, and whether it returns `REMOTEID` for imported vouchers
  (the read-back after a live push depends on it);
- whether a **derived TDL collection** with `$AlterID > n` is the right delta
  filter for this version, or whether the plain collection must be re-read;
- the **`ALTERID` semantics for vouchers** (it is documented per company, but
  whether back-dated edits always bump it is unverified);
- whether the purchase voucher should carry `GSTREGISTRATIONTYPE`/`PLACEOFSUPPLY`
  fields for the company's GST setup, and how **TDS** lines are expected to look;
- the real **rate/quantity formatting** Tally accepts (`450/Box` vs `450/`) once
  a unit is present on the stock item;
- practical **batch size and timeout** for imports on this hardware;
- **which GSTIN element a ledger master takes on import** — `GSTIN`,
  `PARTYGSTIN`, or both. `envelopes.import_ledger` sends both, which is
  harmless if one is ignored but should be trimmed once we know;
- whether `REMOTEID` is accepted on a **ledger** master at all (it is
  documented for vouchers), and whether a duplicate ledger name really comes
  back as a `LINEERROR` rather than being silently altered — the fake assumes
  it does, and the whole "never create a duplicate vendor" guarantee rests on
  it;
- the **Stock Summary export's shape**: whether it carries a grand-total
  element (the parser prefers one if present, else sums each top-level
  `STOCKITEM`'s `CLOSINGVALUE`), whether sub-items are nested under their
  group, and whether `SVFROMDATE=SVTODATE` really yields the closing value as
  on that date;
- whether a **ledger created by Talai** comes back from the next pull with the
  same name and no surprises (the `source` column exists to spot the ones that
  do not).
