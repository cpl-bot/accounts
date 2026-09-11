---
id: dev-bounded-voucher-collection
owner: "@orchestrator"
type: bug
created: 2026-09-10
size: M
lane: tally-read-path
priority: 20
after: [dev-reject-tally-protocol-errors, debug-live-voucher-export-shape]
doc: docs/TALLY_INTEGRATION_NOTES.md
---
# Replace Day Book with a bounded Voucher collection

`TallyClient.day_book()` sends an unsupported `Report/Day Book` request. Bare Voucher and Voucher Register exports can be unbounded, so the replacement must enforce its date window in TDL rather than relying only on static variables.

Acceptance:
- Voucher pulls use a derived `Collection` with base type `Voucher`, mandatory from/to dates, and a `$Date` filter tied to `##SVFromDate` and `##SVToDate`.
- Fetches include every field consumed by `parse_vouchers()`, including nested ledger and inventory entries.
- Reversed ranges are rejected before network I/O; the existing Python date filter remains defense in depth.
- The fake transport distinguishes request type and enforces the date filter; envelope, client, sync, scheduler, and integration tests pass.
- The anonymized live fixture from `debug-live-voucher-export-shape` parses and a read-only bounded pull persists voucher rows and ledger entries.

Owns: `middleware/talai_middleware/tally/envelopes.py`, `middleware/talai_middleware/tally/client.py`, `middleware/talai_middleware/tally/fake.py`, voucher fixtures, and focused middleware tests.

Do not own: bill parser/request work, dashboard/frontend files, database schema, production data writes, live agent pushes, the main checkout, or destructive operations.

Out of scope: unbounded fiscal-year exports, voucher import/write behavior, REMOTEID read-back, and redesigning aggregate formulas.

Depends on: `dev-reject-tally-protocol-errors`, `debug-live-voucher-export-shape`.

## Implementation landed (2026-09-11)

- Voucher pulls now use a derived, server-date-filtered `TalaiVoucher` collection.
- Reversed ranges fail before network I/O; the existing client-side date filter remains defense in depth.
- REMOTEID read-back queries the fiscal year containing the imported voucher date, including a backdated regression test.
- Middleware Ruff and pytest passed independently (383 tests).

## Live validation failed (2026-09-11)

The read-only office-Tally pull reached the derived `TalaiVoucher` request, but Tally returned 3,486 parsed rows. The client-side date safeguard persisted only 73 rows in the requested overlap window, so replica data is protected, but the required server-side date bound is not working. Investigate and correct the live TDL request shape before this card can close.
