---
id: debug-live-bill-export-shape
owner: owner
type: chore
created: 2026-09-10
size: S
lane: lan-validation
tags: [time-gated, verify-prod]
doc: docs/TALLY_INTEGRATION_NOTES.md
---
# Capture live Tally Bills Payable and Receivable XML

The current `Report/Bills Payable` and `Report/Bills Receivable` requests are rejected as unknown. Official guidance indicates `TYPE=Data`, but the actual element hierarchy must be captured before adapting the speculative bill parser.

Unblock: against the read-only office company, run `Data/Bills Payable` and `Data/Bills Receivable`, then add anonymized XML fixtures and record the TallyPrime release, elapsed time, row counts, and totals matched to both Tally reports.

Acceptance: fixtures cover at least one open bill when the source report is nonempty, retain party/reference/date/due-date/pending-amount structure, and contain no customer or financial identifiers.

Owns: anonymized fixtures under `middleware/tests/fixtures/xml/` and the observed-response note in `docs/TALLY_INTEGRATION_NOTES.md`.

Do not own: middleware implementation files, Tally configuration, production writes, live agent pushes, the main checkout from an executor lane, or destructive operations.

Out of scope: changing bill references, testing imports, guessing undocumented response tags, or implementing the production parser.

Depends on: none.

## input from owner:

all required fixtures are in docs/board/fixtures/
