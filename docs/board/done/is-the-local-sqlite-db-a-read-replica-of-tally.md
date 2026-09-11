---
id: is-the-local-sqlite-db-a-read-replica-of-tally
owner: "@orchestrator"
type: chore
created: 2026-09-10
size: S
lane: tally-read-path
---
# Confirm SQLite replica completeness and offline dashboard behavior

Confirm whether the current sync process maintains a complete read replica so the dashboard works while the Tally machine is offline, and whether data is stored in the format consumed by the Next.js application.

Outcome (2026-09-10): architecture is correct but the live replica is incomplete. SQLite held 59 groups and 1,790 ledgers, but zero vouchers, voucher ledger entries, and bills. Live voucher and bill requests returned `<RESPONSE>Unknown Request, cannot be processed</RESPONSE>`; the client parsed those protocol errors as empty lists and recorded successful zero-row scopes. The Next.js dashboard correctly rendered the resulting empty aggregates. Follow-up implementation and live-capture work is tracked by the linked tally-read-path cards.
