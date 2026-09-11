---
id: ana-sales-purchase-analytics-api
owner: "@orchestrator"
type: feature
created: 2026-09-11
size: M
lane: tally-read-path
priority: 30
doc: docs/TALLY_INTEGRATION_NOTES.md
after: [dev-bounded-voucher-collection]
---
# No aggregation endpoint for party/item/month sales & purchase totals

The schema already carries enough to answer "total sales to party X",
"sales of item Y across all parties", "party + item combo", and "month-wise
breakdown" — but nothing in the API computes these; a caller is left to
page through raw voucher rows and sum client-side, and for item-level
questions that degrades into an impractical N+1 call pattern.

What exists (`middleware/talai_middleware/db/models.py`):
- `Voucher`: `party_ledger`, `amount`, `date`, `voucher_type`,
  `is_cancelled`/`is_deleted` — enough for party totals on its own.
- `VoucherInventoryEntry`: `stock_item`, `qty`, `rate`, `amount`, joined to
  its voucher by `voucher_id` — enough for item and party+item totals once
  joined to `Voucher.party_ledger`/`date`.

Confirmed live against 192.168.10.25:9000 / "Vigyapan Mart Pvt.Ltd. -
(from 1-Apr-23)" (2026-09-11), `tally template --name
collections/list_vouchers_with_items --vouchertype "GST Invoice" --from
2025-04-01 --to 2025-04-07`: a real sales voucher (VMPL/25-26/1, dated
2025-04-03, party "Baazi Networks Pvt.Ltd.") carries
`ALLINVENTORYENTRIES.LIST` lines like `STOCKITEMNAME=Wooden Trophy,
RATE=1050.00/Nos, AMOUNT=13650.00, ACTUALQTY=13.00 Nos` — these map
cleanly onto `VoucherInventoryEntry.stock_item/rate/amount/qty`, so the
replica's shape is sufficient. (Note in passing: this company's sales
voucher type is named "GST Invoice", not "Sales" — a company-specific
naming quirk for whoever picks a default `voucher_type` filter, not a bug.)

What's missing (`middleware/talai_middleware/api/vouchers.py`,
`db/repo.py`):
- `GET /vouchers` filters only by `type`/`from`/`to`/`party`
  (`_voucher_query` in `db/repo.py`) — no `stock_item` filter of any kind.
- `VoucherSummary` (the `/vouchers` list shape) does not include
  `inventory_entries` — only `VoucherDetail` (`GET /vouchers/{id}`, one
  voucher at a time) does. So today, "sales of item Y across all parties"
  requires listing every voucher in range (paginated, max 500/page) and
  then fetching `/vouchers/{id}` **for each one** to inspect its inventory
  lines — impractical beyond a handful of vouchers.
- There is no server-side `SUM`/`COUNT` anywhere for vouchers: party totals
  and "summary totals" both require the client to page through raw rows
  and add them up itself.
- `services/aggregates.py`'s `overview()` does compute a month-wise
  `trends` series, but only for the dashboard's fixed, configured
  `revenue_groups`/`cost_of_sales_groups` (A8, settled) — there is no
  month-wise breakdown scoped to an arbitrary party or stock item.
- Listing known parties/items (the sixth original question) is **not** a
  gap: `GET /ledgers` (optionally `group=Sundry Debtors`/`Sundry
  Creditors`) and `GET /stock-items` already list everything the replica
  knows.

Acceptance:
- A new aggregation capability (repo function(s) plus endpoint(s), e.g.
  `GET /vouchers/summary` or a small `api/analytics.py`) computable
  entirely from the existing `vouchers` + `voucher_inventory_entries`
  tables — no schema change expected; flag during implementation if this
  turns out false. It answers, for a `from`/`to` window and optional
  `voucher_type`:
  - total amount + voucher count for a given `party` (exact or substring,
    matching `_voucher_query`'s existing `ilike` convention).
  - total qty + amount for a given `stock_item`, across all parties, with
    at least case-insensitive substring matching (`*`-glob translated to
    SQL `LIKE`, mirroring the `tally query --stock` semantics, is a
    nice-to-have but not blocking).
  - total qty + amount for a specific `party` + `stock_item` combination.
  - the same three, optionally grouped by month (`YYYY-MM`) instead of
    collapsed to one total for the window.
- Responses return aggregated numbers (sum/count), never raw voucher rows,
  so the N+1 pattern above has no reason to recur.
- Cancelled/deleted vouchers are excluded, consistent with
  `aggregates.py`'s existing `_entry_sum()` convention.
- Focused repo/API tests cover: party-only, item-only (incl. a
  no-match/empty case), party+item combo, and month-grouped output.

Owns: `middleware/talai_middleware/api/vouchers.py` (or a new
`api/analytics.py`), `middleware/talai_middleware/db/repo.py` (new
aggregation query function(s)), `middleware/talai_middleware/api/schemas.py`
(new response models). May add the aggregation logic to
`services/aggregates.py` instead of `repo.py` if that reads cleaner
alongside the existing `_entry_sum`/`_credits`/`_debits` helpers — implementer's
call.

Do not own: `/dashboard/overview` or `/dashboard/payables` and A8's
gross-profit formula (settled, do not touch), physical stock
quantity/movement analytics (see `stk-stock-movement-history`), stock-item
master listing/filtering (see `stk-stock-item-filters-api`), bill/AR-AP
aggregates, production writes, live agent pushes to Tally, the main
checkout, destructive operations.

Depends on: `dev-bounded-voucher-collection` — that card's acceptance
("Fetches include every field consumed by `parse_vouchers()`, including
nested ledger and inventory entries") is the precondition for
`voucher_inventory_entries` landing completely and reliably; item-wise
sums built before it ships would be built on data known to be incomplete.

Out of scope: a generic ad-hoc filter query language (arbitrary field/
operator/value combinations) — see the cross-cutting investigation notes
for why that's judged unnecessary for the questions this card answers;
live/unsynced queries against Tally for any of this.
