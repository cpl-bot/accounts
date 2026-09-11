---
id: vch-voucher-lookup-by-number
owner: "@orchestrator"
type: feature
created: 2026-09-11
size: XS
lane: tally-read-path
doc: docs/TALLY_INTEGRATION_NOTES.md
---
# GET /vouchers has no way to look a voucher up by its Tally voucher number

Verified live against 192.168.10.25:9000 / Vigyapan Mart, and by reading the
code: most of the "voucher/day-book" question set is already covered.

- Day Book for a range, optionally by voucher type — covered:
  `GET /vouchers?type=&from=&to=&party=&limit=&offset=` (`middleware/talai_middleware/api/vouchers.py`,
  `db/repo.py:list_vouchers`/`_voucher_query`).
- List of voucher types — covered: `GET /voucher-types`
  (`middleware/talai_middleware/api/masters.py`), confirmed against
  `tally collection --id "List of Voucher Types"` (Attendance, Contra, Credit
  Note, Debit Note, GST Invoice, Journal, Payment, Purchase, Receipt, Sales,
  etc. all present).
- Inventory breakup for a specific voucher — covered: `GET /vouchers/{id}`
  returns `VoucherDetail.inventory_entries` (`VoucherInventoryEntry`: stock_item,
  godown, qty, rate, amount, hsn).
- Narration — already covered, and more fully than asked: `narration` is on
  `VoucherSummary` itself (`middleware/talai_middleware/api/schemas.py`), so it
  comes back on every row of the `/vouchers` list, not only on the detail
  endpoint. `Voucher.narration` (`db/models.py`) is a `Text` column populated
  from Tally's `NARRATION` field, confirmed present (if often empty) in a live
  Day Book pull for August 2026.

The one real gap: **looking up a specific voucher by its Tally voucher
number** (e.g. "show me voucher 938"). `GET /vouchers/{voucher_id}` takes the
replica's internal integer PK, not the Tally voucher number, and
`list_vouchers`/`_voucher_query` (`db/repo.py`) has no `voucher_number`
filter param — only `type`, `from`/`to`, `party`. `repo.voucher_by_reference()`
exists but matches on `(party_ledger, reference)` for duplicate-detection
during writes, isn't exposed via any GET route, and isn't a number lookup
anyway. Today the only way to find voucher 938 by number is to page through
`/vouchers?from=&to=&party=` and scan the list client-side.

Acceptance:
- `GET /vouchers` accepts an optional `voucher_number` query param (exact
  match, optionally combined with `type` since voucher numbers are only
  unique per voucher type/series in Tally).
- Repo layer: `list_vouchers`/`count_vouchers`/`_voucher_query` in `db/repo.py`
  grow a `voucher_number` filter.
- A single unambiguous match still returns the full list envelope (not a
  special-cased single-object shape) — consistent with how `party`/`type`
  filtering already works.
- Focused API/repo tests cover exact match, no match, and match combined with
  a `type` filter (since the same number can exist in two different voucher
  type series).

Owns: `middleware/talai_middleware/api/vouchers.py`, `middleware/talai_middleware/db/repo.py`
(voucher query functions only), focused tests.

Do not own: `services/aggregates.py`, dashboard endpoints, bill endpoints,
masters endpoints, database schema/migrations, production writes, live agent
pushes to Tally, the main checkout, destructive operations.

Out of scope: fuzzy/partial voucher-number search, cross-voucher-type
disambiguation UI, changing what `/vouchers/{id}` returns.
