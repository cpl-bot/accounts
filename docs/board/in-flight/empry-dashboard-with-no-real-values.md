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
