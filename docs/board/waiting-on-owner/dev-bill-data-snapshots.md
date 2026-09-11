---
id: dev-bill-data-snapshots
owner: "@orchestrator"
type: bug
created: 2026-09-10
size: M
lane: tally-read-path
priority: 30
after: [dev-bounded-voucher-collection, debug-live-bill-export-shape]
doc: docs/TALLY_INTEGRATION_NOTES.md
---
# Pull bill snapshots with validated Data requests

The existing `Report/Bills Payable` and `Report/Bills Receivable` requests are rejected by the office Tally. The replacement must use the captured live response rather than assuming the current hand-written fixture matches TallyPrime.

Acceptance:
- Payable and receivable pulls use validated `TYPE=Data` request envelopes with an explicit as-of date and no lower date bound that would omit older open bills.
- `parse_bills()` matches the anonymized live fixtures and preserves party, reference, bill date, due date, pending amount, and direction.
- Snapshot replacement occurs only after both the request and parsing succeed; a failed direction leaves its previous rows intact.
- The fake rejects the old `TYPE=Report` shape, accepts the validated Data shape, and focused envelope, parser, client, and sync tests pass.
- A read-only live pull reconciles counts and pending totals with Tally Bills Payable and Receivable.

Owns: bill-related changes in `middleware/talai_middleware/tally/envelopes.py`, `client.py`, `parsers.py`, `fake.py`, bill fixtures, and focused middleware tests.

Do not own: voucher collection behavior already landed by its prerequisite, dashboard/frontend files, database schema unless the live fixture proves it unavoidable, production writes, live agent pushes, the main checkout, or destructive operations.

Out of scope: reconstructing historical outstanding balances from voucher allocations, changing Tally bill references, or adding AP/AR product features.

Depends on: `dev-bounded-voucher-collection`, `debug-live-bill-export-shape`.

## Implementation landed (2026-09-11)

- Bill pulls now use explicit-as-of `TYPE=Data` exports without a lower date bound.
- The parser handles the captured flat `BILLFIXED` records and their sibling values.
- A failed direction preserves its existing snapshot.
- Middleware Ruff and pytest passed independently (389 tests).

## Waiting on owner

Run read-only payable and receivable pulls against the office Tally, then reconcile returned counts and pending totals with the corresponding Tally reports.
