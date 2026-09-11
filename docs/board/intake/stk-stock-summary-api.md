---
id: stk-stock-summary-api
owner: "@orchestrator"
type: feature
created: 2026-09-11
size: M
lane: tally-read-path
doc: docs/TALLY_INTEGRATION_NOTES.md
after: [stk-stock-movement-history]
---
# No API endpoints for Stock Summary / Godown Summary / Movement Analysis

Once `stk-stock-movement-history` lands a real per-item/per-godown,
arbitrary-date stock dataset in the replica, there is still no route
exposing it. Today's full API surface
(`GET /health`, `/tally/status`, `/tally/companies`, `/ledgers`, `/groups`,
`/stock-items`, `/cost-centres`, `/godowns`, `/voucher-types`, `/vouchers`,
`/vouchers/{id}`, `/bills`, `/dashboard/overview`, `/dashboard/payables`,
`/sync/*`) has nothing that answers "what's my stock worth on 31 Aug,
item-wise" or "what moved in/out of stock last month" — the closest is
`GET /stock-items`, which is a live-mutable current-state list, not a
dated report.

Acceptance:
- `GET /stock-items/summary` (or similar) accepts `as_on` (required) and
  optional `godown`, returning item-wise closing qty/rate/value as of that
  date, sourced from the table `stk-stock-movement-history` lands.
- `GET /godowns/summary` (or similar) accepts `as_on`, returning per-godown
  closing value, and per-item-per-godown when available.
- `GET /stock-items/movement` (or similar) accepts `from`/`to` (required),
  returning per-item in-qty/in-value/out-qty/out-value for that period.
- All three reject missing/invalid date params with a clear 4xx before
  touching the database.
- Response shapes are documented in `docs/TALLY_INTEGRATION_NOTES.md`
  alongside the existing stock-items section (`3d. List of Stock Items`).
- Focused API tests cover each endpoint with seeded replica data (no live
  Tally dependency).

Owns: `middleware/talai_middleware/api/masters.py` or a new
`api/stock.py` router, `middleware/talai_middleware/api/schemas.py` (new
response models), `middleware/talai_middleware/main.py` (router
registration if a new file), focused API tests.

Do not own: the underlying sync/schema work (`stk-stock-movement-history`
must land first — these endpoints have nothing to read otherwise),
`GET /stock-items` filter params (see `stk-stock-item-filters-api`,
independent and can land in either order), production writes, live agent
pushes to Tally, the main checkout, or destructive operations.

Out of scope: frontend consumption of these endpoints, changing the
existing `/dashboard/overview` stock-valuation figure (settled formula,
`docs/DECISIONS.md` A8).
