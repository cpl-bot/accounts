---
id: led-ledger-balance-query-api
owner: "@orchestrator"
type: feature
created: 2026-09-11
size: S
lane: tally-read-path
priority: 100
doc: docs/TALLY_INTEGRATION_NOTES.md
---
# GET /ledgers has no closing-balance threshold filter or a group-wise balance summary

Found while checking whether Talai can answer "which ledgers have closing
balance > ₹N" and "ledger-wise balance summary by group" (2026-09-11, live
against 192.168.10.25:9000, "Vigyapan Mart Pvt.Ltd. - (from 1-Apr-23)").
Unlike `led-fix-ledger-collection-fetch`, `closing_balance` and
`parent_group` are **not** affected by that bug — both already sync
correctly today (verified: `data/talai.db` ledgers rows have real
`closing_balance`/`parent_group` values matching live Tally, e.g. "Admudra
Advertising" closing balance `-17192695.30` matches exactly). This is a pure
API-surface gap: the data needed already lives in the replica, nothing to
sync.

**1. No closing-balance threshold filter.** `repo.list_ledgers` /
`GET /ledgers` (`middleware/talai_middleware/db/repo.py`,
`api/masters.py`) accept only `group` (exact `parent_group` equality) and
`q` (name substring) — no `min_closing_balance`/`max_closing_balance` or
similar. Answering "closing balance > ₹1,00,00,000" today means fetching
the full `/ledgers` list (paginated, up to 1791 rows) and filtering
client-side.

One live-verified wrinkle worth designing around: Tally's own TDL filter
on `$ClosingBalance` compares by **magnitude, not signed value**. Confirmed
live: `tally collection --id "List of Ledgers" --filter '$ClosingBalance >
50000000'` returns "Input Igst@18%" whose `CLOSINGBALANCE` is
`-100392104.61` — only explainable if Tally filters on
`ABS($ClosingBalance) > 50000000`, since the raw signed comparison
(`-100392104.61 > 50000000`) is false. A naive `WHERE closing_balance > :n`
in Talai's SQL would silently disagree with what Tally itself calls
"greater than" and with what a user asking "closing balance > ₹N" almost
certainly means (money owed either direction, not just Dr-signed balances)
per the skill's documented Dr/Cr sign convention. The filter should compare
`ABS(closing_balance) > :n` (or expose both magnitude and
direction-aware variants explicitly) rather than assume signed comparison.

**2. No ledger-wise balance summary grouped by group.** There's no endpoint
that returns ledgers rolled up/grouped under their parent group with
balances — today a caller must fetch `/groups` and `/ledgers` separately
and join client-side. `parent_group` is a flat immediate-parent string per
ledger (not hierarchy-aware — see the separate hierarchy gap below), so a
group-wise summary at the "immediate parent" level is directly computable
from existing columns with no schema change.

Note: "ledgers under group X including nested sub-groups" (walking the
group hierarchy, e.g. `CRI Pumps Pvt.Ltd.` is itself a sub-group of Sundry
Debtors with 28 ledgers under it) is **already carded** by
`co-group-classification-and-outstandings` (acceptance item 3: a
hierarchical rollup exposed via `GET /ledgers` or a new endpoint) — do not
duplicate that here. This card's group-wise summary only needs to cover
the flat immediate-parent case; if the hierarchical rollup lands first,
this card's summary should reuse it rather than re-walk the hierarchy
separately.

Acceptance:
- `GET /ledgers` accepts an optional balance-threshold filter (e.g.
  `min_abs_closing_balance`) implemented as `ABS(closing_balance) > :n` at
  the repo layer, with the magnitude-vs-signed choice documented in the
  endpoint's own docstring/OpenAPI summary so API consumers aren't
  surprised by a Sundry Creditor's negative closing balance passing a
  positive threshold.
- A new query or endpoint (e.g. `GET /ledgers/balance-summary?group=`, or
  a `group_by=parent_group` mode on `/ledgers`) returns, per immediate
  parent group: ledger count and summed closing balance (Dr/Cr split or
  net, matching the sign convention already documented in the tally-erp
  skill). Reuses `co-group-classification-and-outstandings`'s hierarchical
  helper if that card has landed by the time this is implemented, rather
  than re-implementing a parallel rollup.
- A read-only live check reconciles the threshold filter and the
  group-wise summary against a live `tally collection --filter
  '$ClosingBalance > N'` / manual sum for at least two groups (e.g. Sundry
  Debtors, Sundry Creditors).
- Focused repo/API tests cover the threshold filter (including a
  negative-balance ledger crossing the threshold by magnitude) and the
  group-wise summary.

Owns: `middleware/talai_middleware/db/repo.py` (`list_ledgers`,
`count_ledgers`, new summary query), `api/masters.py` (new param/endpoint),
`api/schemas.py` (new response model if a new endpoint), focused tests.

Do not own: the group-hierarchy walk itself (owned by
`co-group-classification-and-outstandings`), the ledger-collection-fetch
data bug (owned by `led-fix-ledger-collection-fetch`), `services/
aggregates.py`, database schema/migrations, production data writes, live
agent pushes to Tally, the main checkout, or destructive operations.

Out of scope: date-ranged/point-in-time balance thresholds (that's
`vch-point-in-time-ledger-balances`' territory, not the current-closing-
balance filter this card adds).
