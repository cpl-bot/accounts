---
id: vch-financial-statements-api
owner: "@orchestrator"
type: feature
created: 2026-09-11
size: L
lane: tally-read-path
doc: docs/TALLY_INTEGRATION_NOTES.md
after: [dev-fix-group-collection-fetch, vch-point-in-time-ledger-balances]
---
# No Trial Balance / Profit and Loss / Balance Sheet / Cash Flow / Funds Flow endpoints exist

Talai today has exactly one financial-summary endpoint, `GET /dashboard/overview`
(`middleware/talai_middleware/api/dashboard.py` +
`middleware/talai_middleware/services/aggregates.py`), and it is Talai's own
deliberately narrow gross-profit view: Revenue = Sales Accounts only, Cost of
sales = Purchase Accounts + Direct Expenses, per `docs/board/ground-truth.md`
/ `docs/DECISIONS.md` A8 (settled 2026-09-09). It is not a Trial Balance, not
a Balance Sheet, not a Cash Flow or Funds Flow statement, and its own P&L is
narrower than Tally's Trading-account P&L on purpose. **This card is
additive** — a genuinely new set of reports alongside `/dashboard/overview`,
not a fix or a reconciliation of A8's formula. Do not change A8's
revenue/cost-of-sales definition to satisfy this card.

Verified live against 192.168.10.25:9000 / Vigyapan Mart (2026-09-11),
FY 2026-04-01..2026-09-10:

- **Trial Balance** (`tally report --id "Trial Balance" --from --to`):
  returns a flat sequence of `<DSPACCNAME><DSPDISPNAME>` /
  `<DSPACCINFO><DSPCLDRAMT>/<DSPCLCRAMT>` pairs — closing debit/credit
  amounts per top-level group only (8 rows: Capital Account, Loans
  (Liability), Current Liabilities, Fixed Assets, Investments, Indirect
  Incomes, ...). With `--explode` (`EXPLODEFLAG=Yes`) it expands one level
  deeper (188 rows, e.g. "Reserves and surplus", "Share Capital", "Bank OD
  A/c", "TERM LOAN ICICI BANK" alongside their parent groups) but **there is
  no parent/child linkage field in the response** — nesting is implied purely
  by report row order, not by an explicit PARENT tag. Reconstructing a
  correct rollup from this shape (or from the replica) depends on already
  having correct group hierarchy, which is the exact defect tracked by
  `dev-fix-group-collection-fetch` (bare `Group` collection pull drops
  PARENT/ISREVENUE/AFFECTSGROSSPROFIT for every group today) — hence the
  `after:` dependency.
- **Profit and Loss** (`--id "Profit and Loss"`): confirms the prior
  investigation's finding — sections are `Sales Accounts`, `Direct Incomes`,
  `Cost of Sales :` (with sub-lines `Opening Stock`, `Add: Purchase
  Accounts`, `Less: Closing Stock`), `Direct Expenses`, `Indirect Incomes`,
  `Indirect Expenses`. No single `GROSSPROFIT` or `NETPROFIT` tag anywhere;
  a caller must sum `DSPDISPNAME` sections itself (Revenue = Sales Accounts +
  Direct Incomes; Cost of Sales = Opening Stock + Purchases − Closing Stock +
  Direct Expenses; Net Profit = everything including Indirect
  Incomes/Expenses). Note Tally's own P&L folds **Direct Incomes** into
  revenue — A8 deliberately excludes it from Talai's dashboard number.
- **Balance Sheet** (`--id "Balance Sheet"`): same `DSPACCNAME`/`DSPACCINFO`
  shape as Trial Balance, top-level sections Capital Account, Loans
  (Liability), Current Liabilities, Suspense A/c, Profit & Loss A/c (assets
  side: Fixed Assets, Investments, Current Assets). Same flat/no-parent-link
  shape and same hierarchy dependency as Trial Balance.
- **Cash Flow** and **Funds Flow** (`--id "Cash Flow"` / `"Funds Flow"`, same
  from/to): both return period-bucketed totals only —
  `<DSPPERIOD>April</DSPPERIOD><DSPACCINFO><DSPDRAMT>/<DSPCRAMT>/<DSPCLAMT>`
  repeated per month in the range. This is a **net movement summary per
  month**, not a categorized operating/investing/financing statement — Tally
  does not hand back a line-item breakdown of *why* cash moved in this
  export shape. Any Talai report built on this would be similarly coarse
  unless a materially different TDL request is used; flagging this as a
  ceiling on what "Cash Flow"/"Funds Flow" can mean here, not a blocker.

**Can the replica answer any of this today? No.** `aggregates.py` already has
the right shape of machinery — `_descendant_groups()` (group-hierarchy
walk), `_ledger_names()`, `_entry_sum()`/`_credits()`/`_debits()` (signed
sum of `voucher_ledger_entries` joined to `vouchers` in a date window) — but
it is hard-wired to A8's five group buckets (`REVENUE_GROUPS`,
`COST_OF_SALES_GROUPS`, `INDIRECT_INCOME_GROUPS`, `INDIRECT_EXPENSE_GROUPS`,
`CASH_GROUPS`). The underlying capability these five reports actually need is
generic: **roll up ledger balances/movements by arbitrary group, as of a
date or over a range**, driven by the full group tree rather than five fixed
names. That generalization is real work but is architecturally the same
machinery already proven by the dashboard.

Acceptance:
- New read-only endpoints under the existing `/api/v1` prefix, e.g.
  `GET /reports/trial-balance?as_of=`, `GET /reports/profit-and-loss?from=&to=`,
  `GET /reports/balance-sheet?as_of=`, `GET /reports/cash-flow?from=&to=`,
  `GET /reports/funds-flow?from=&to=`. Exact paths are the implementer's
  call; keep them clearly namespaced apart from `/dashboard/*` so nobody
  mistakes one for a variant of the other.
- A generalized rollup helper (new function(s) in `services/aggregates.py`
  or a sibling module) that walks the full group tree and buckets ledger
  balances/movements by top-level group name, replacing the five hard-coded
  tuples for this new code path — `dashboard.py`'s existing formula and A8's
  definition are untouched.
- Trial Balance and Balance Sheet responses are genuinely point-in-time
  (as-of a single date, not just a from/to window) — see
  `vch-point-in-time-ledger-balances` for the data-availability precondition
  this needs from the replica/sync layer.
- P&L response mirrors Tally's own section layout closely enough to be
  reconciled against a live `tally report --id "Profit and Loss"` pull for
  the same period (Sales Accounts, Direct Incomes, Cost of Sales
  sub-breakdown, Direct Expenses, Indirect Incomes/Expenses, with computed
  gross/net profit).
- Cash Flow / Funds Flow responses are documented as period-bucketed net
  movement totals (matching what Tally itself returns), not misrepresented
  as categorized statements.
- A read-only spot check against live Tally (same date/period) shows the new
  endpoints' totals reconciling with `tally report` output for Trial
  Balance, P&L, and Balance Sheet.

Owns: new report endpoints/router, new aggregate rollup helpers, associated
schemas, focused tests. May read (not modify) `services/aggregates.py`'s
existing helpers or extract/share code with them.

Do not own: `/dashboard/overview` or `/dashboard/payables` formulas (A8 is
settled — do not touch), masters endpoints, bill endpoints, database schema
migrations (owned by `vch-point-in-time-ledger-balances` if new tables are
needed), production writes, live agent pushes to Tally, the main checkout,
destructive operations.

Out of scope: changing A8's dashboard definition, a categorized
operating/investing/financing Cash Flow statement (Tally's own export
doesn't support it cleanly, see above), any write/import path.
