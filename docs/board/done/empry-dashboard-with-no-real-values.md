---
id: empry-dashboard-with-no-real-values
type: bug
created: 2026-09-10
size: M
lane: tally-read-path
priority: 40
tags: [verify-prod, time-gated]
after: [dev-bounded-voucher-collection, dev-bill-data-snapshots]
doc: docs/SYNC_RELIABILITY_PLAN.md
---
# Empty dashboard shows no real values

The dashboard for Vigyapan Mart Pvt.Ltd. shows zero revenue, cost of sales, and profit because the replica contains masters but no vouchers, voucher lines, or bills. Cash and bank is nonzero because it comes from ledger closing balances.

Acceptance:
- A read-only full pull for the selected fiscal year persists vouchers, voucher ledger entries, and any open bills returned by Tally.
- `scripts/validate_db_sync.py` fails on a rejected Tally response instead of accepting `0 == 0`, and exits 0 only after source and replica counts/totals reconcile.
- `/api/talai/dashboard/overview?from=2026-04-01&to=2026-09-10` derives P&L values from the populated replica and the browser displays the same values.

Owns: `scripts/validate_db_sync.py`, its focused tests, and final read-only API/browser verification.

Do not own: Tally request builders and parsers owned by the prerequisite cards, frontend redesign, the main checkout from an executor lane, production data writes, live agent pushes, or destructive operations.

Out of scope: changing dashboard formulas, inventing replacement figures, making SQLite the system of record, or enabling Tally writes.

Depends on: `dev-bounded-voucher-collection`, `dev-bill-data-snapshots`.

**Nextjs App** is running and accessible on localhost:3000

![shot](docs/board-assets/20260910-183014-65d5.png)

Outcome (2026-09-11): Added validated `--from-date`/`--to-date` options to
`scripts/validate_db_sync.py`, forwarded them to `SyncPuller.run()`, and made
any non-success sync run fail validation. Middleware gates passed: Ruff and
394 tests. The bounded read-only office pull for `2026-04-01` through
`2026-09-10` succeeded with 3,475 vouchers, 14,561 voucher ledger entries,
2,303 bills, and exact ledger and bill reconciliations. The authenticated
middleware and Next.js proxy overview responses both returned revenue
`1556725.00`, cost of sales `123623.00`, and net profit `1433103.80`.

The initial migration step was blocked by the pre-existing replica schema
having tables without a usable Alembic version state; the successful pull used
`--skip-migrate` against that existing schema. The documented `pnpm dev`
command was blocked by the worktree's external `node_modules` symlink and
non-interactive pnpm 11 module purge, so Next.js was started with its installed
webpack binary. HTTP page/proxy verification passed; visual browser
verification was unavailable in this API session.
