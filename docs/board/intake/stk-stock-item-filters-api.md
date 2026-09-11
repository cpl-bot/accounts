---
id: stk-stock-item-filters-api
owner: "@orchestrator"
type: feature
created: 2026-09-11
size: XS
lane: tally-read-path
doc: docs/TALLY_INTEGRATION_NOTES.md
---
# GET /stock-items has no filters at all

`GET /stock-items` (`middleware/talai_middleware/api/masters.py:146-153`) takes
no query parameters whatsoever — it calls `repo.list_simple(session,
models.StockItem)`, which is a bare `SELECT ... ORDER BY name` with no
`WHERE`. Compare `GET /ledgers`, which already accepts `group`, `q`, `limit`,
`offset`.

The data needed for basic filtering already exists on the `stock_items` row
(`parent`, `closing_qty`) — this is a pure API-layer gap, not a schema or
sync gap.

Confirmed live against Tally: `tally collection --id "List of Stock Items"
--filter '$ClosingBalance > 0' --fields Name,Parent,BaseUnits,ClosingBalance,
ClosingRate,ClosingValue` returns 198 items (of the company's full item
count) cleanly — so "closing qty > 0" and group-scoped listing are both
ordinary asks a user will make and Tally itself answers them trivially.

Acceptance:
- `GET /stock-items` accepts `parent` (exact group name, mirrors `/ledgers`'
  `group` param), `q` (name substring search), `closing_qty_gt` or similar
  numeric filter (e.g. `> 0` to exclude zero/negative-balance items), and
  `limit`/`offset` pagination, matching the shape of `/ledgers`.
- `repo.list_stock_items(...)` (new, mirrors `repo.list_ledgers`) implements
  the filtering; `repo.count_stock_items(...)` mirrors `repo.count_ledgers`.
- Existing callers with no query params still get the full unfiltered list
  (backward compatible).
- Focused API tests cover each filter alone and combined.

Owns: `middleware/talai_middleware/api/masters.py` (`stock_items` route),
`middleware/talai_middleware/db/repo.py` (new `list_stock_items`/
`count_stock_items`), `middleware/talai_middleware/api/schemas.py` if
`StockItemList` needs a `total` field to match `LedgerList`.

Do not own: the `stock_items` table schema itself, sync/pull behavior,
production writes, live agent pushes to Tally, the main checkout, or
destructive operations.

Out of scope: stock-group hierarchy filtering (no Stock Group master table
exists yet — see `stk-stock-groups-categories-units-masters`), per-godown
filtering (no per-godown data in `stock_items` — see
`stk-stock-movement-history`).
