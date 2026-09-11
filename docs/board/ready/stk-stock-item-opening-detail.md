---
id: stk-stock-item-opening-detail
owner: "@orchestrator"
type: feature
created: 2026-09-11
size: S
lane: tally-read-path
priority: 110
doc: docs/TALLY_INTEGRATION_NOTES.md
---
# Stock item detail is missing opening qty/rate/value

`models.StockItem` (`middleware/talai_middleware/db/models.py:108-118`) only
stores `closing_qty`/`closing_value` — no `opening_qty`, `opening_rate`, or
`opening_value` columns exist, and `StockItemOut`
(`middleware/talai_middleware/api/schemas.py:184-192`) exposes nothing
opening-side either. `sync_pull.py`'s master pull
(`services/sync_pull.py:211-224`) only ever writes the closing pair to
`repo.upsert_stock_item(...)`.

This isn't a Tally limitation — confirmed live via `tally object --subtype
StockItem --id "Acp Board" --fetch Name,Parent,BaseUnits,OpeningBalance,
OpeningRate,OpeningValue,ClosingBalance,ClosingRate,ClosingValue`: Tally
returns `OPENINGBALANCE`, `OPENINGVALUE`, and `OPENINGRATE` (books-opening,
i.e. FY start) right alongside the closing fields in the same single-object
fetch, no extra request needed. `TallyClient.stock_items()` /
`P.StockItemRow` already has (or trivially can have) access to these same
fields since it's the same `List of Stock Items` collection export — this is
a "add fields, not add a new request" gap.

Note this only answers *books-opening* (FY start) vs *current closing* — a
true date-range opening/closing (i.e. "as of 1 Aug" vs "as of 31 Aug") is
the bigger point-in-time-snapshot gap covered by
`stk-stock-movement-history`; this card is just about exposing the FY-start
figures Tally already hands over with every stock item.

Acceptance:
- `models.StockItem` gains `opening_qty` (QTY), `opening_rate` (MONEY), and
  `opening_value` (MONEY) columns, with a migration.
- `P.StockItemRow` / `TallyClient.stock_items()` parse `OPENINGBALANCE`,
  `OPENINGRATE`, `OPENINGVALUE` from the existing collection export.
- `sync_pull.py`'s master pull writes the three new columns via
  `repo.upsert_stock_item(...)`.
- `StockItemOut` exposes the three new fields; `GET /stock-items` (and
  `GET /stock-items/{id}` if `stk-stock-item-filters-api` adds one) return
  them.
- A read-only live pull for a known item (e.g. "Acp Board") matches Tally's
  `OPENINGBALANCE`/`OPENINGVALUE`/`OPENINGRATE` exactly.

Owns: `middleware/talai_middleware/db/models.py` (`StockItem`),
`middleware/talai_middleware/tally/parsers.py` (`StockItemRow`),
`middleware/talai_middleware/tally/client.py` (`stock_items`),
`middleware/talai_middleware/services/sync_pull.py` (master pull loop),
`middleware/talai_middleware/api/schemas.py` (`StockItemOut`), a new Alembic
migration, focused parser/sync/API tests.

Do not own: date-range (non-FY-start) opening/closing snapshots, per-godown
splits, production writes, live agent pushes to Tally, the main checkout, or
destructive operations.

Out of scope: historical opening-as-of-arbitrary-date (see
`stk-stock-movement-history`).
