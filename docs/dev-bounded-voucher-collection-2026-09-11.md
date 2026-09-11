# Dispatch: bounded Voucher collection

## Identity

- Task ID: `dev-bounded-voucher-collection`
- Board card: `docs/board/ready/dev-bounded-voucher-collection.md`
- Specification: `docs/TALLY_INTEGRATION_NOTES.md`
- Harness: `opencode`
- Mode: `interactive`
- Model: `openai/gpt-5.6-luna`
- Effort: high
- Lane: `bounded-voucher-collection`
- Worktree: `/Users/admin/Documents/accounts-wt/bounded-voucher-collection`

## Verified premise

`TallyClient.day_book()` currently sends `Report/Day Book`, while the board card records that the office Tally rejects it. The newly captured owner fixture at `docs/board/fixtures/fixture1_daybook_vouchers_anon.xml` is a successful Collection response containing vouchers dated 2026-09-11, ledger entries, and inventory entry shapes. Its capture-time/release/count comparison metadata was not supplied; do not invent it.

## Objective and acceptance

Replace the report request with a derived, date-bounded `Collection` of base type `Voucher`. It must require from/to dates and enforce `$Date` between `##SVFromDate` and `##SVToDate` in TDL. Fetch every field consumed by `parse_vouchers()`, including nested ledger and inventory entries. Reject reversed ranges before network I/O and retain the client-side date filter as defense in depth.

The fake must reject the old report form and enforce the derived request's date filter. Add focused failing-first tests for the request, invalid range, fixture parsing, client, sync, scheduler, and integration behavior as applicable. Run middleware Ruff and pytest; run relevant frontend gates only if touched. Perform no production writes or external publishing.

## Already true

- `dev-reject-tally-protocol-errors` and `fix-group-collection-fetch` are landed on main.
- `sync_pull.py` still calls `client.day_book(from_date, to_date)` and retains its defensive Python date filter.
- Bill work belongs to the blocked follow-up `dev-bill-data-snapshots`; do not change bill request/parser code.
- The captured XML is an owner-provided test fixture, not a license for live Tally calls beyond a read-only, explicitly requested verification.

## Ownership boundary

### Owns

- `middleware/talai_middleware/tally/envelopes.py`
- `middleware/talai_middleware/tally/client.py`
- `middleware/talai_middleware/tally/fake.py`
- Voucher fixtures and focused middleware tests for this behavior
- The `bounded-voucher-collection` row in `docs/lanes.md`

### Does not own

- Bill request/parser work, owned by `dev-bill-data-snapshots`
- Dashboard/frontend files and aggregate formulas
- Database schema
- Main checkout, production data writes, live agent pushes, destructive operations, and live external publishing

## Execution policy

- Subagents: forbidden
- Workflows: forbidden
- Maximum child concurrency: 0
- Write-capable child isolation: none
- Stopping condition: report after a committed lane result and direct gate exit codes, or stop with the exact unresolved live-Tally contract issue.
- Escalation condition: a fixture/request mismatch that cannot be reconciled from the captured artifact.

## Required process

1. Claim `bounded-voucher-collection` in `docs/lanes.md` and commit that claim before implementation.
2. Work only in the named lane worktree and owned files.
3. Reconcile with current `origin/main` before modifying shared middleware files and again before handoff.
4. Run `cd middleware && uv run ruff check . && uv run pytest -q`; judge exit codes directly.
5. Do not pipe a gate command, make production writes, or push live agent changes.

## Report contract

Return branch, worktree, commit, lane status, changed/excluded files, implemented mechanism, gate exit codes/counts, unrun tests, known residue, and any remaining owner-side live verification.
