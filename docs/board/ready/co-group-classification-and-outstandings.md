---
id: co-group-classification-and-outstandings
owner: "@orchestrator"
type: bug
created: 2026-09-11
size: M
lane: tally-read-path
priority: 90
doc: docs/TALLY_INTEGRATION_NOTES.md
after: [dev-fix-group-collection-fetch]
---
# Group root classification, is_deemed_positive exposure, and group-outstandings rollup

Found while checking whether Talai can answer "is group X a revenue/
liability group" and "what's the group outstanding for Sundry Debtors /
Sundry Creditors" (2026-09-11, live against 192.168.10.25:9000, "Vigyapan
Mart Pvt.Ltd. - (from 1-Apr-23)"). All three gaps below are blocked on
`dev-fix-group-collection-fetch` landing first (it fixes `group.parent`,
which everything here depends on), but none needs a new column — this is
sync-correctness plus query/API-surface work only.

**1. `primary_group` requests the wrong native field name and will stay
blank even after the FETCHLIST fix.** `client.py: GROUP_FETCH` asks for
`PRIMARYGROUP`; `parsers.py: parse_groups` reads `node.findtext
("PRIMARYGROUP")`. Live testing shows Tally has no `PRIMARYGROUP` tag —
the correct field is `PRIMARYGRPPARENT`. Confirmed live: `tally collection
--id "List of Groups" --fields Name,Parent,PrimaryGroup,IsRevenue --filter
'$Name = "CRI Pumps Pvt.Ltd."'` (a non-root sub-group, parent "Sundry
Debtors") returns `<PRIMARYGRPPARENT>Current Assets</PRIMARYGRPPARENT>`,
never a `<PRIMARYGROUP>` tag. This is a distinct bug from the bare-ID
FETCHLIST issue — it's the wrong tag name, in the same `GROUP_FETCH`
list/`parse_groups` function that card already owns, but not covered by
that card's acceptance test (which checks IsRevenue/IsDeemedPositive/
AffectsGrossProfit/Parent, not primary_group). Needed to answer "is group X
a liability" at the root-category level (Assets/Liabilities/Income/
Expenses), since `is_revenue`/`affects_gross_profit` alone don't say
Asset vs Liability for a balance-sheet group like Sundry Debtors/Creditors.

**2. `GroupOut` (API schema) omits `is_deemed_positive` even though
`models.Group` has the column.** Confirmed by reading
`middleware/talai_middleware/api/schemas.py`: `GroupOut` has `is_revenue`
and `affects_gross_profit` but not `is_deemed_positive`. Live-verified this
matters for sign interpretation: `Sundry Debtors` has
`ISDEEMEDPOSITIVE=Yes`, `Sundry Creditors` has `ISDEEMEDPOSITIVE=No` — a
client cannot correctly read "does a positive ledger balance here mean
money owed to us or by us" from `GET /groups` today.

**3. No hierarchical rollup for "group outstandings"-style questions.**
Live-tested `Group Outstandings --group "Sundry Debtors"`: it's a legacy
display-report shape (`DSPACCNAME`/`DSPCLDRAMT`/`DSPCLCRAMT` pairs, no
FETCHLIST/Data-request form), one row per *immediate* child — which can be
a ledger or a sub-group — giving just name + closing debit + closing
credit, nothing else (no ageing, no bill count). In this company, many
real parties are organized as nested sub-groups under Sundry Debtors, not
flat ledgers: `CRI Pumps Pvt.Ltd.` (28 ledgers by branch), `Lubi Industries
LLP` (21), `SHREE CEMENT LIMITED` (20) are themselves sub-groups, confirmed
via `select parent_group, count(*) from ledgers group by parent_group`.
`repo.list_ledgers(group=...)` (used by `GET /ledgers?group=`) does an
*exact* `parent_group == group` match, so `GET /ledgers?group=Sundry
Debtors` misses every ledger nested under a sub-group like `CRI Pumps
Pvt.Ltd.` entirely. A correct recursive walk already exists but is private
and dashboard-only: `services/aggregates.py: _descendant_groups()` /
`_ledger_names()`, used only for the revenue/cost-of-sales sums in
`aggregates.overview()`. Nothing promotes that walk to a general "closing
balance rolled up under group X, including nested sub-groups" query.

Acceptance:
- `GROUP_FETCH`/`parse_groups` request and read `PRIMARYGRPPARENT` (not
  `PRIMARYGROUP`); `Group.primary_group` is populated correctly for at
  least one nested sub-group after a live pull, matching `tally collection
  --id "List of Groups" --fields Name,PrimaryGroup`.
- `GroupOut` exposes `is_deemed_positive`.
- A repo-level function (reusing/promoting `_descendant_groups`/
  `_ledger_names` out of `aggregates.py`, or equivalent) returns every
  ledger under a group *and its descendant sub-groups*, with closing
  balances summed per immediate child the way `Group Outstandings` does —
  exposed either as a hierarchical `group` filter on `GET /ledgers` or a
  new endpoint (e.g. `GET /groups/{name}/outstandings`).
- A read-only live check against `Sundry Debtors` and `Sundry Creditors`
  reconciles the rolled-up total against Tally's own `Group Outstandings`
  report for those two groups.
- Focused parser/repo/API tests cover a fixture with at least one
  multi-level nested sub-group.

Owns: `middleware/talai_middleware/tally/client.py` (`GROUP_FETCH`),
`parsers.py` (`parse_groups`), `api/schemas.py` (`GroupOut`), `db/repo.py`
(new hierarchical lookup), `services/aggregates.py` (promote the existing
helper rather than duplicate it), `api/masters.py` or a new
`api/groups.py`, focused middleware tests.

Do not own: the bare-collection FETCHLIST fix itself (owned by
`dev-fix-group-collection-fetch`), the dashboard's own revenue/cost-of-
sales group definitions (ground-truth.md / DECISIONS.md A8 — unchanged),
bill-level data (`dev-bill-data-snapshots`), production data writes, live
agent pushes to Tally, the main checkout, or destructive operations.

Out of scope: reproducing `Group Outstandings`' bill-wise ageing detail —
that's `dev-bill-data-snapshots`' bills-table territory, not this card;
this card only covers the closing-balance rollup that `Group Outstandings`
also happens to show.
