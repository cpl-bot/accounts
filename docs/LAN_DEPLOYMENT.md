# Talai — LAN Deployment and v1 Validation Checklist

Target: one always‑on machine on the office LAN (the "Talai host") runs the
middleware and the Next.js app. Two accountants use TallyPrime Gold on the LAN
today; they will open Talai in a browser at `http://<talai-host>:3000`.

```
 Accountant PC 1 ──┐                 ┌─────────────────────────────┐        ┌──────────────────────┐
 Accountant PC 2 ──┼── browser ────► │ Talai host                  │ :9000  │ Tally server PC       │
                   │   :3000         │  Next.js :3000              │ ─────► │ TallyPrime Gold       │
 (Tally clients) ──┘                 │  FastAPI :8000 (LAN only)   │  XML   │ XML/HTTP server on    │
                                     │  SQLite data/talai.db       │        │ company kept open     │
                                     └─────────────────────────────┘        └──────────────────────┘
```

## 1. Tally‑side setup (on the Tally server PC, once)

1. Open TallyPrime with the production company loaded (the XML server only
   answers for companies that are open).
2. `F1 (Help) → Settings → Connectivity → Client/Server configuration`:
   set **TallyPrime acts as** to `Both` (or `Server`), **Enable ODBC Server**
   `Yes`, **Port** `9000`. Restart Tally if prompted.
3. Windows Defender Firewall → allow inbound TCP 9000 on the private network
   profile, for `tally.exe` (or the port).
4. Note the PC's LAN IP (`ipconfig`). Give it a DHCP reservation or static IP;
   Talai stores it in `TALLY_HOST`.
5. Gold licence note: the XML port belongs to the Tally *instance* on this PC,
   not to individual users. LAN clients using Tally normally are unaffected, but
   heavy XML exports can make the Tally UI pause for a moment; keep the pull
   interval at 15 minutes or more during working hours.
6. Create a **test company** as a copy of the production company (Tally:
   `Alt+F3 → Create` then restore a backup, or duplicate the data folder). All
   live‑write validation (section 5) happens against this copy first.

## 2. Talai host setup

Choose one:

### Option A — bare processes (Linux/macOS/Windows)

```bash
git clone <repo> talai && cd talai
cp .env.example .env && cp middleware/.env.example middleware/.env
# edit both .env files (see docs/SETUP.md §2). Set MIDDLEWARE_URL=http://localhost:8000
cd middleware && uv sync && uv run alembic upgrade head && cd ..
pnpm install && pnpm build
```

Run (two terminals, or as services in section 6):

```bash
cd middleware && uv run uvicorn talai_middleware.main:app --host 0.0.0.0 --port 8000
HOSTNAME=0.0.0.0 PORT=3000 pnpm start
```

### Option B — Docker Compose

```bash
cp .env.example .env && cp middleware/.env.example middleware/.env   # edit both
docker compose up -d --build
```

`docker-compose.yml` starts `middleware` (8000) and `web` (3000) and persists
`middleware/data` as a volume. The middleware reaches Tally by the LAN IP in
`TALLY_HOST`; no host networking needed.

### Firewall on the Talai host

Allow inbound TCP 3000 from the LAN. Do **not** expose 8000 beyond localhost
unless the Next.js app runs on a different machine; if it does, allow 8000 only
from that machine's IP.

## 3. Connection validation (phase 1, read‑only)

Run from the Talai host, repo root:

```bash
uv run --project middleware python scripts/check_tally_connection.py --xml
```

Expected: `reachable: yes`, latency under ~500 ms, the company list containing
`TALLY_COMPANY_NAME`, `company_match: yes`. Then:

```bash
uv run --project middleware python scripts/validate_db_sync.py --scopes masters,vouchers,bills
```

Expected: exit code 0 and a table of row counts. Compare with Tally:

| Check | Where in Tally | Where in Talai |
|---|---|---|
| Ledger count | `Gateway → Chart of Accounts → Ledgers` | script output `ledgers` |
| Purchase vouchers this month | `Day Book`, filter Purchase | `GET /vouchers?type=Purchase&from=&to=` |
| Bills payable total | `Display → Statements of Accounts → Outstandings → Payables` | `GET /bills?direction=payable` `total_pending` |
| Gross profit / net profit for last month | `Profit & Loss A/c`, period F2 | Dashboard → Overview, same period |

Record differences in `docs/DECISIONS.md` A8 (definitions) before changing code.

Then in the browser: **Configuration** → host/port prefilled from env → *Test
connection* → pick the company → Save. The header pill turns green.

## 4. Dry‑run write validation (phase 2)

Keep `TALLY_WRITE_ENABLED=false`.

1. Accountant enters 10 real purchase bills through **Accounts Payable → Create Bill**.
2. Each shows *Validated* (or the exact rule that failed; fix the ledger in Tally
   or the entry in Talai).
3. Click **Sync → Sync selected**. The response says *dry run*; each draft now
   holds the generated XML. Print it:

   ```bash
   uv run --project middleware python scripts/dry_run_push.py
   ```

4. The accountant reviews the XML against how they would enter the same bill in
   Tally (party ledger, purchase ledger, tax ledgers, amounts, bill reference,
   date). Sign off in the table below.

## 5. Live write validation (phase 3, test company only)

1. In Tally, open the **test company** instead of production. In
   `middleware/.env` set `TALLY_COMPANY_NAME=<test company name>` and
   `TALLY_WRITE_ENABLED=true`; restart the middleware.
2. Sync the 10 drafts. Expected: 10 `committed`, each with a Tally voucher number.
3. In Tally: Day Book shows 10 new purchase vouchers with matching totals;
   Bills Payable shows the new references.
4. Click Sync again on the same drafts: 0 created (idempotency by `REMOTEID`).
5. Enter a deliberately wrong bill (unknown ledger): expect `failed` with the
   Tally line error and nothing created in Tally.
6. Only after all of the above: point `TALLY_COMPANY_NAME` back to production,
   keep `TALLY_WRITE_ENABLED=true`, restart, and start the one‑week pilot.

## 6. Running as services

- **Linux (systemd):** two unit files, `talai-middleware.service`
  (`ExecStart=/path/uv run uvicorn talai_middleware.main:app --host 0.0.0.0 --port 8000`,
  `WorkingDirectory=/path/talai/middleware`) and `talai-web.service`
  (`ExecStart=/usr/bin/pnpm start`, `Environment=HOSTNAME=0.0.0.0 PORT=3000`).
  `Restart=always`.
- **Windows:** use NSSM (`nssm install TalaiMiddleware ...`) or Task Scheduler
  "At startup" tasks, or Docker Desktop with Option B.
- **macOS:** `launchd` plists in `~/Library/LaunchAgents`, `KeepAlive=true`.

## 7. Backups

Daily copy of `middleware/data/talai.db` and `middleware/data/uploads/` to a
network share. The replica can always be rebuilt from Tally, but drafts,
attachments and the audit log cannot.

## 8. Sign‑off table

| Step | Date | Who | Result / notes |
|---|---|---|---|
| 1. Tally XML server reachable from Talai host | | | |
| 3. Full pull reconciles with Tally | | | |
| 3. Dashboard matches Tally P&L for one month | | | |
| 4. 10 dry‑run bills reviewed | | | |
| 5. 10 live bills in test company, re‑push no‑op | | | |
| 5. Invalid bill rejected without side effects | | | |
| 6. Services restart after reboot | | | |
| Pilot week complete, zero duplicates | | | |
