---
id: rcv-bill-party-filter-and-ranking
owner: "@orchestrator"
type: feature
created: 2026-09-11
size: S
lane: tally-read-path
priority: 10
doc: docs/TALLY_INTEGRATION_NOTES.md
after: [dev-bill-data-snapshots]
---
# GET /bills has no party filter and no party-wise ranked outstanding

Checked whether Talai can answer "Ledger Outstandings for party X" and
"which debtors/creditors owe the most" (2026-09-11, live against
192.168.10.25:9000, "Vigyapan Mart Pvt.Ltd. - (from 1-Apr-23)"). Both are
answerable from data the `bills` table already stores — this is API-surface
work only, no schema change.

Confirmed live: `tally report --id "Ledger Outstandings" --ledger "ACE SOLAR
RENEWABLE ENERGY LLP"` returns one `<BILLFIXED>` block per open bill for
that single party (`BILLDATE`, `BILLREF`, `BILLOP`, `BILLCL`, `BILLDUE`,
`BILLOVERDUE`) — the same fields `models.Bill` already stores as
`bill_date`/`bill_name`/`opening_amount`/`pending_amount`/`due_date`
(`middleware/talai_middleware/db/models.py`), just scoped to one party.

Read `middleware/talai_middleware/api/vouchers.py` (`GET /bills`) and
`db/repo.py`: the endpoint takes only `direction` and `as_on`.
`repo.list_bills()`/`repo._open_bills_filter()` never filter on
`Bill.party_ledger`, even though the column exists and is indexed. So today
there is no way to ask "just this party's open bills" through the API —
a caller must fetch every open bill for a direction and filter client-side.

Separately, `services/aggregates.py` (`payables()`, `aging_buckets()`) only
produces direction-wide totals and due-date-aged buckets — never grouped by
`party_ledger`. `DashboardPayables` (schema) has no party breakdown. So
"which debtors owe us the most" / "which creditors we owe the most" is
**not** already answered by `/dashboard/payables` — it only has aging
buckets, not a party ranking.

Acceptance:
- `GET /bills` accepts an optional `party` query param (case-insensitive
  substring match on `party_ledger`, mirroring the existing `ilike`
  convention in `_voucher_query`), so a single party's open bills (with
  aging) can be fetched directly — this is the Ledger-Outstandings-for-a-
  party use case.
- A new ranked aggregate is exposed (either as a query param on `GET /bills`
  e.g. `group_by=party`, or a small new endpoint, e.g.
  `GET /bills/by-party?direction=payable&as_on=`) returning, per party:
  total pending amount and open bill count, sorted descending by amount —
  this answers "who owes us the most" / "who do we owe the most".
- Both respect the existing `direction`/`as_on` semantics unchanged; neither
  changes `aging_buckets()` or the dashboard payables formula.
- A read-only live check: the party-filtered `GET /bills` result for one
  party matches `tally report --id "Ledger Outstandings" --ledger "<party>"`
  bill-for-bill (date, reference, pending amount, due date) once
  `dev-bill-data-snapshots` has landed and a live pull has populated the
  `bills` table.
- Focused repo/API tests cover the party filter (match, no-match) and the
  ranked aggregate (ordering, tie-breaking, empty-direction case).

Owns: `middleware/talai_middleware/api/vouchers.py` (`GET /bills` and/or a
new endpoint), `db/repo.py` (`list_bills`, new ranking query), `api/schemas.py`
(new response shape for the ranking).

Do not own: the bill request/parse shape itself (owned by
`dev-bill-data-snapshots` — this card assumes bills already pull correctly),
group-hierarchy "Group Outstandings" rollups (owned by
`co-group-classification-and-outstandings`), date-ranged/historical bill
snapshots (see `rcv-bills-date-range-history`), `/dashboard/*` formulas,
production data writes, live agent pushes to Tally, the main checkout, or
destructive operations.

Out of scope: bill-level ageing bucket changes, any write/settlement path,
reconstructing bill state for dates other than "currently open."

Depends on: `dev-bill-data-snapshots` (the `bills` table has no usable rows
until the live request/parse shape is fixed; this card's live verification
step cannot run until then).

## Outcome (2026-09-11)

Implemented in `5cb55ec`. `GET /bills` now supports an optional case-insensitive
substring `party` filter, including filtered totals. Added `GET /bills/by-party`
with direction/as-of semantics, descending pending balance ordering, deterministic
party-name tie breaking, and open-bill counts. Repository and API tests cover
matches, no match, ordering, ties, and an empty direction at the repository
boundary. Middleware Ruff and the full pytest suite passed (`397 passed`).

The optional live Tally bill-for-bill comparison was not run in this session and
remains required before production rollout.
