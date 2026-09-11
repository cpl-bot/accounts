---
id: debug-live-voucher-export-shape
owner: owner
type: chore
created: 2026-09-10
size: S
lane: lan-validation
tags: [time-gated, verify-prod]
doc: docs/TALLY_INTEGRATION_NOTES.md
---
# Capture a bounded live Tally voucher export

The current `Report/Day Book` request is rejected as unknown, while an unbounded `Data/Voucher Register` and a bare Voucher collection each kept Tally busy until the client timed out. The development card needs one proven, server-filtered request shape.

Unblock: against the read-only office company, run the proposed derived `Collection/Voucher` request for one date known to contain vouchers, then add an anonymized XML fixture and record the TallyPrime release, elapsed time, returned voucher count, and matching Day Book count.

Acceptance: the captured request completes within the configured timeout, all returned voucher dates fall inside the requested day, ledger and inventory entry shapes are represented, and the anonymized fixture parses without customer or financial identifiers.

Owns: one anonymized fixture under `middleware/tests/fixtures/xml/` and the observed-request note in `docs/TALLY_INTEGRATION_NOTES.md`.

Do not own: middleware implementation files, Tally configuration, production writes, live agent pushes, the main checkout from an executor lane, or destructive operations.

Out of scope: changing Tally data, testing imports, exporting an unbounded fiscal year, or implementing the production client.

Depends on: none.

## Grooming note (2026-09-11)

`docs/board/fixtures/fixture1_daybook_vouchers_anon.xml` is available, and the
dependent bounded Voucher implementation has independently proven a typed,
one-day live request. This card still lacks the requested capture metadata:
TallyPrime release, elapsed time, and a matching Day Book count. Keep it
waiting until that evidence is recorded or the owner explicitly waives it.
