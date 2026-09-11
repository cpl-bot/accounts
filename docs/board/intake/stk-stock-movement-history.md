---
id: stk-stock-movement-history
owner: "@orchestrator"
type: feature
created: 2026-09-11
size: L
lane: tally-read-path
doc: docs/TALLY_INTEGRATION_NOTES.md
after: [dev-bounded-voucher-collection]
---
# No historical/per-item/per-godown stock data — only point-in-time totals

Three related asks all hit the same wall: **Stock Summary for a date
range**, **Godown Summary**, and **Movement Analysis (item-wise in/out) for
a period**. None can be answered from the replica today because:

- `models.StockValuation` (`db/models.py:121-134`) has one row per `as_on`
  date with a single `closing_value` — company-total only, no per-item, no
  per-godown breakdown, and `as_on` is `unique`, so it's a handful of
  snapshot rows, not a range.
- `sync_pull.pull_stock_valuations()` (`services/sync_pull.py:311-330`)
  only ever calls `self.client.stock_valuation(as_on)` for the boundary
  dates from `stock_boundaries()` (FY-start, month boundaries, today) — it
  is wired for the dashboard's gross-profit formula, not general querying.
- `models.StockItem` (`db/models.py:108-118`) is a single mutable row per
  item overwritten on every sync — "closing now," not "closing as of any
  date," and has no godown split at all.
- There is no API surface for any of Stock Summary / Godown Summary /
  Movement Analysis today (not in `masters.py`, not in `dashboard.py`).

Confirmed live against Tally (company has 198 items with non-zero closing
balance, 1 godown "Main Location", Stock Groups and Stock Categories both
empty for this company):

- `tally report --id "Stock Summary" --from 2026-08-01 --to 2026-08-31`
  (`TYPE=Report`) returns one `DSPACCNAME`/`DSPSTKINFO` pair per stock item
  with `DSPCLQTY`/`DSPCLRATE`/`DSPCLAMTA` — closing qty/rate/value **as of
  `--to`**, for every item in the company, unscoped. This is item-wise but
  still just one date's closing figures, not a real opening→closing range
  (no `DSPOPXXX` fields appear in the default display).
- `tally report --id "Godown Summary" --from ... --to ...` returns
  per-godown totals only (`DSPCLQTY`/`DSPCLRATE`/`DSPCLAMTA` per godown);
  adding `--explode` flattens it to per-godown-per-item lines (order-implied
  grouping, not nested XML). Only one godown exists in this company today,
  so the multi-godown case is unverified against live data — the schema
  should still support it since the `godowns` table already allows for more
  than one.
- `tally report --id "Movement Analysis" --from ... --to ...` returns, per
  item, `STKMIN` (`STKINQTY`/`STKINCOST`/`STKINVALUE`) and `STKMOUT`
  (`STKOUTQTY`/`STKOUTPRICE`/`STKOUTVALUE`) for the period — this is a
  clean, direct answer to "item-wise in/out for a period," no drill-down
  needed.
- All three are `TYPE=Report` exports (no crash-prone collection IDs
  involved), and all three return the **full item/godown list unscoped** —
  there is no `--parent`/`--filter` narrowing built into the report
  templates today, so a large company's Stock Summary/Movement Analysis
  response could be large (this company's Stock Summary alone was ~8.6k
  lines of pretty-printed XML for ~200+ items).

Design note for the implementer (flagging, not deciding): Movement Analysis
may be derivable **without any new Tally calls** by aggregating the
already-synced `voucher_inventory_entries` (qty/rate/amount/godown per
stock item per voucher, landed once `dev-bounded-voucher-collection` ships)
over a date range, if the inward/outward sign convention on `qty` can be
confirmed to match Tally's own Movement Analysis split. That would avoid a
second live-data path entirely for movement, leaving only Stock
Summary/Godown Summary as true new point-in-time-snapshot needs. Verify
this against a live Movement Analysis pull before committing to either
approach.

Acceptance:
- A new table (or extension of `stock_valuations`) captures stock valuation
  at a **caller-chosen `as_on` date**, broken down by stock item and
  (nullable) godown — not just the fixed FY-start/month-boundary/today set.
- A new pull path fetches Stock Summary / Godown Summary for an arbitrary
  date, item-wise and godown-wise, and upserts into that table.
- Movement-analysis-for-a-period is answerable from the replica, either via
  a synced Movement Analysis snapshot or via aggregation over
  `voucher_inventory_entries` — whichever the live-data check above
  supports — with in-qty/out-qty/in-value/out-value per item for a given
  date range.
- Existing dashboard boundary-date snapshots (`pull_stock_valuations`,
  `stock_boundaries`) keep working unchanged; this is additive.
- Focused sync tests cover: item-wise snapshot parsing, godown-wise
  snapshot parsing, and movement aggregation for a period, against
  anonymized live fixtures.

Owns: `middleware/talai_middleware/db/models.py` (new table/columns),
`middleware/talai_middleware/tally/envelopes.py` (Stock Summary/Godown
Summary/Movement Analysis request builders — note the existing
`stock_valuation()` envelope at `envelopes.py:147-153` already does the
single-date Stock Summary case and can be a starting point),
`middleware/talai_middleware/tally/client.py`,
`middleware/talai_middleware/tally/parsers.py`,
`middleware/talai_middleware/services/sync_pull.py`, a new Alembic
migration, focused envelope/parser/sync tests.

Do not own: `GET /stock-items` filters (see
`stk-stock-item-filters-api`), FY-start opening qty/rate/value on the
`StockItem` object itself (see `stk-stock-item-opening-detail`), the
dashboard gross-profit formula (settled, see `docs/DECISIONS.md` A8, not
touched here), new API endpoints to expose this data (see
`stk-stock-summary-api`), production writes, live agent pushes to Tally,
the main checkout, or destructive operations.

Out of scope: real-time/live (non-synced) stock queries, stock valuation
methods other than what Tally's Stock Summary already applies, multi-godown
verification beyond what this company's single godown allows (revisit if/
when a multi-godown company is available).
