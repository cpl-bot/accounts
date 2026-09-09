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

## Support scripts (run from the repo root)

```bash
uv run --project middleware python scripts/check_tally_connection.py --xml
uv run --project middleware python scripts/validate_db_sync.py            # or --fake
uv run --project middleware python scripts/dry_run_push.py
uv run --project middleware python scripts/seed_demo_data.py --reset
uv run python middleware/scripts/export_openapi.py                        # refresh docs/openapi.json
```

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
  db/            models, engine, repository functions, audit sink
  services/      sync_pull, sync_push, validation, aggregates, scheduler
alembic/         migrations (initial schema)
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
8. **OCR is stubbed.** `POST /attachments` stores the file and records
   `ocr_status="skipped"`; choosing a provider is a product decision (§1).
9. **Weekly full re-pull is not scheduled.** `POST /sync/pull` with an explicit
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
- practical **batch size and timeout** for imports on this hardware.
