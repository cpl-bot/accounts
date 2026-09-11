---
id: stk-stock-groups-categories-units-masters
owner: "@orchestrator"
type: feature
created: 2026-09-11
size: S
lane: tally-read-path
priority: 60
doc: docs/TALLY_INTEGRATION_NOTES.md
---
# No Stock Group, Stock Category, or Unit master tables

Unlike `Group`/`Ledger`/`StockItem`/`CostCentre`/`Godown`/`VoucherType`,
which all have their own table in `db/models.py`, there is **no** table for
Stock Groups, Stock Categories, or Units. `StockItem.parent` and
`StockItem.unit` (`db/models.py:108-118`) are free-text strings copied from
Tally at sync time, with nothing to join against — no group hierarchy, no
category, and no unit metadata (decimal places, symbol, base unit for
compound units).

Confirmed live against Tally for this company:
- `List of Stock Groups` and `List of Stock Categories` (via `tally
  collection`) both return **zero** entries — every stock item in this
  company sits directly under the built-in "Primary" stock group with no
  categories in use. So for this specific company, the group/category
  hierarchy gap is currently moot in practice.
- `List of Godowns` returns 1 row ("Main Location") — already fully covered
  by the existing `godowns` table and `GET /godowns` endpoint; no gap here,
  not part of this card.
- Units are genuinely in use: the built-in `List of Units` collection ID
  crashes Tally (per this skill's known-crash list), but the bundled
  `collections/list_units` custom-TDL template works and returned 20 units
  (Box, EA, Ft., kg, Km, Ltr, MON, Mtr, Nos, Pac, Pairs, Pcs, Pkt, Set, sht,
  Sqf, Sq.ft., Sqm, ton, Unit). `StockItem.unit` already stores each item's
  unit name as free text (e.g. "Sq.ft."), so the values are captured, but
  there's no master row to join against for e.g. decimal-place formatting.

Given Stock Groups/Categories are unused by this company today, this is a
lower-priority completeness gap (the product should still support a
company that does use them) rather than something blocking a live question
right now. Units has a thinner but real case: a `units` master table would
let quantity displays respect each unit's configured decimal places instead
of guessing from the raw string.

Acceptance:
- New `stock_groups` and `stock_categories` tables (mirroring the existing
  `_Lookup` pattern used by `CostCentre`/`Godown`/`VoucherType`), synced via
  `List of Stock Groups` / `List of Stock Categories` collections.
- A new `units` table capturing at least name and decimal places, synced
  via the `collections/list_units`-style custom TDL request (the built-in
  `List of Units` collection ID must not be used — it crashes TallyPrime).
- `StockItem.parent` optionally resolves against `stock_groups` (no FK
  required if the existing free-text pattern is preferred — implementer's
  call) but the master data must be queryable on its own via a new
  `GET /stock-groups`, `GET /stock-categories`, `GET /units` endpoint set
  (mirroring `GET /cost-centres`/`GET /godowns`).
- Sync handles the zero-rows case cleanly (this company will sync 0 stock
  groups and 0 stock categories today — must not be treated as an error).
- Focused sync/API tests cover parsing and the zero-rows case.

Owns: `middleware/talai_middleware/db/models.py` (new tables),
`middleware/talai_middleware/tally/client.py` /
`middleware/talai_middleware/tally/envelopes.py` (new collection
fetches, including the crash-avoiding Units template), `services/sync_pull.py`
(new pull loop entries alongside the existing `CostCentre`/`Godown`/
`VoucherType` loop at `sync_pull.py:225-234`), `api/masters.py` (new
routes), `api/schemas.py`, a new Alembic migration, focused tests.

Do not own: `StockItem` schema changes beyond an optional group reference,
`GET /stock-items` filtering (see `stk-stock-item-filters-api`), production
writes, live agent pushes to Tally, the main checkout, or destructive
operations.

Out of scope: retrofitting historical stock items to the new group/category
tables beyond what a normal sync upsert does; unit-conversion/compound-unit
math.
