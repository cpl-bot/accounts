---
id: vch-point-in-time-ledger-balances
owner: "@orchestrator"
type: chore
created: 2026-09-11
size: M
lane: tally-read-path
doc: docs/TALLY_INTEGRATION_NOTES.md
after: [dev-fix-group-collection-fetch]
---
# Replica has no point-in-time ledger balances — blocks Trial Balance / Balance Sheet

Trial Balance and Balance Sheet are inherently **as-of-a-date** snapshots
(confirmed live: `tally report --id "Trial Balance"` / `"Balance Sheet"`
return closing debit/credit amounts as of `--to`, not a transactional list).
The replica cannot answer "what was ledger X's balance on an arbitrary past
date" today, and the gap is structural, not just missing sync coverage:

- `middleware/talai_middleware/db/models.py`: `Ledger` stores exactly one
  `opening_balance` and one `closing_balance` — both single point-in-time
  values (whatever they were at the last masters sync), with no history.
  There is no ledger-balance-snapshot table anywhere in the schema (checked
  the full model list: groups, ledgers, vouchers, voucher_ledger_entries,
  voucher_inventory_entries, bills, stock_items, stock_valuations (stock
  only), cost_centres, godowns, voucher_types, settings, sync_runs,
  audit_log — nothing for ledger balance history).
  `stock_valuations` is the closest analog (point-in-time stock value
  snapshots already exist for that domain) but has no ledger equivalent.
- `services/sync_pull.py:voucher_window()` defaults the pull range to
  `[start-of-*calendar*-year, today]` when there's no prior successful pull
  and no explicit range — note this is calendar-year (Jan 1), not this
  company's fiscal year (the company name is suffixed "(from 1-Apr-23)", so
  Tally's own FY starts April 1). Even setting that mismatch aside, the
  window is a rolling/bootstrap range, not a guaranteed-complete history:
  nothing in the sync layer asserts "every voucher since the ledger's
  opening-balance reference date is present," which is exactly what a
  bottom-up (opening_balance + sum of entries to date) reconstruction of an
  as-of balance would require to be correct.
- Reconstructing an as-of-date balance bottom-up also depends on correct
  group hierarchy for any rollup above the individual-ledger level — the
  same dependency called out in `vch-financial-statements-api`, tracked by
  `dev-fix-group-collection-fetch` (bare `Group` pull currently drops
  PARENT for every group).

This card is the schema/sync-layer half of the financial-statements gap;
`vch-financial-statements-api` is the API-surface half and depends on this
one. Two viable directions exist and the choice is an implementation
decision, not pre-made here:

1. **Snapshot-based**: add a ledger-balance-snapshot table (as-of date +
   ledger + debit/credit closing amount, one analog of `stock_valuations`)
   populated by a new/extended sync step that pulls Trial Balance (or `List
   of Accounts` + per-ledger closing balances) from Tally periodically or
   on-demand for a requested date, then serves Trial Balance/Balance Sheet
   reads from that table.
2. **Reconstruction-based**: guarantee full voucher history from each
   ledger's opening-balance reference date forward (not just the rolling
   window), and compute as-of balances as `opening_balance + sum(entries up
   to date)`, verified complete via `sync_runs`/`audit_log` coverage
   checks.

Acceptance:
- A documented decision (in the card body, updated in place) on which of the
  two directions above — or another — is taken, with the reasoning.
- Whichever direction: `GET /reports/trial-balance` and
  `GET /reports/balance-sheet` (from `vch-financial-statements-api`) can
  answer for an arbitrary `as_of` date within the covered range without a
  live Tally call per request, and the endpoint/response makes clear what
  date range is actually covered (so an out-of-range `as_of` fails loudly
  rather than silently returning a partial/wrong number).
- If snapshot-based: new table + migration, a sync step that populates it,
  and it is wired into `sync_runs` like other sync scopes.
- If reconstruction-based: a coverage check that fails closed (refuses to
  answer) rather than silently returning an incomplete rollup when history
  before the requested `as_of` is missing.
- Focused tests cover both a covered date (correct answer) and an
  out-of-range/incomplete-coverage date (explicit failure, not a wrong
  number).

Owns: schema/migration changes (new table if snapshot-based), `services/sync_pull.py`
(new sync step if needed), coverage-check helpers used by
`vch-financial-statements-api`'s endpoints.

Do not own: the report endpoints themselves (owned by
`vch-financial-statements-api`), `/dashboard/*`, masters endpoint fixes
(owned by `dev-fix-group-collection-fetch`), production writes, live agent
pushes to Tally, the main checkout, destructive operations.

Out of scope: historical balances predating the company's Tally data (1-Apr-23
per the company name), any write/import path, changing A8.

## Needs owner decision

Choose the point-in-time balance architecture: dated Tally-backed snapshots or
reconstruction from a guaranteed-complete voucher history. State the required
coverage guarantee, freshness expectation, and acceptable behavior outside
that coverage. Financial-statement and ledger-statement cards remain sequenced
until this decision is recorded.
