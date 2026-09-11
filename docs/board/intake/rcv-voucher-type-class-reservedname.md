---
id: rcv-voucher-type-class-reservedname
owner: "@orchestrator"
type: bug
created: 2026-09-11
size: S
lane: tally-read-path
doc: docs/TALLY_INTEGRATION_NOTES.md
after: [dev-fix-group-collection-fetch]
---
# No way to tell which voucher types are functionally "Sales"/"Purchase" — RESERVEDNAME is never fetched

Checked whether Talai can build a correct Sales Register / Purchase
Register for a period (2026-09-11, live against 192.168.10.25:9000,
"Vigyapan Mart Pvt.Ltd. - (from 1-Apr-23)"). `GET /vouchers?type=&from=&to=`
already gives transaction-row-level detail (superior to Tally's own default
`Sales Register`/`Purchase Register` TYPE=Report shape, which — confirmed
live, `tally report --id "Sales Register" --from 2026-08-01 --to
2026-08-31`, with and without `--explode` — returns only a single monthly
total, `<DSPCRAMTA>39150664.84</DSPCRAMTA>`, no voucher rows at all). So the
row-level part of Sales/Purchase Register is already covered. Item-level
aggregation (qty/amount by stock item) is already carded separately
(`ana-sales-purchase-analytics-api`) — not duplicating that here.

**What's missing is more basic: there is no reliable way to know which
voucher type *name* to filter by.** `GET /vouchers`'s `type` param
(`db/repo.py: _voucher_query`) does an exact match against
`Voucher.voucher_type`, which stores whatever `VOUCHERTYPENAME` Tally sent —
this company's real sales invoices are **not** typed "Sales" at all.
Live-verified: `tally template --name collections/list_vouchers_dated
--from 2026-09-10 --to 2026-09-10` shows `VOUCHERTYPENAME` values of `GST
Invoice`, `Journal`, `Payment`, `Receipt` for that day — no voucher type
literally named "Sales" appears anywhere in `List of Voucher Types` either
(confirmed: `Attendance, Contra, Credit Note, Debit Note, Delivery Note,
Exports Sales, GST Invoice, Job Work In/Out Order, Journal, Material In/Out,
Memorandum, Payment, Payroll, Physical Stock, Purchase, Purchase Order,
Receipt, Receipt Note, Rejections In/Out, Reversing Journal, Sales Order,
Stock Journal`). `GET /vouchers?type=Sales` returns zero rows for this
company's actual Sales Register today, and nothing in the replica says why
or what to use instead.

**Tally does carry the answer, Talai just never asks for it.**
`tally object --subtype VoucherType --id "GST Invoice" --fetch
Name,Parent,AffectsStock` returns:
```
<VOUCHERTYPE NAME="GST Invoice" RESERVEDNAME="Sales" ID="38" ...>
 <PARENT TYPE="String">GST Invoice</PARENT>
 <RESERVEDNAME TYPE="String">Sales</RESERVEDNAME>
 <ISDEEMEDPOSITIVE TYPE="Logical">Yes</ISDEEMEDPOSITIVE>
 <AFFECTSSTOCK TYPE="Logical">No</AFFECTSSTOCK>
 ...
</VOUCHERTYPE>
```
`RESERVEDNAME` is Tally's own field binding a custom/renamed voucher type
back to its base class (`Sales`, `Purchase`, `Payment`, `Receipt`,
`Journal`, `Contra`, ...) — exactly what's needed to answer "give me every
voucher type that's functionally Sales" regardless of what a site renamed
it to (renaming the default sales voucher type, e.g. to "GST Invoice" or
"Tax Invoice", is common in Indian Tally deployments, not unique to this
company). Checked `middleware/talai_middleware/tally/client.py`:
`NAME_FETCH = ["NAME", "PARENT", "MASTERID", "ALTERID", "GUID"]` is used for
`voucher_types()` (also cost centres, godowns) — `RESERVEDNAME` is not in
the list, not in `models.VoucherType`/`_Lookup`, and not parsed by
`parsers.py: parse_named()`. So even once `dev-fix-group-collection-fetch`'s
sibling check fixes `voucher_types()`'s bare-ID FETCHLIST issue (if it
turns out to be affected — same bug class, different symptom), the field
still wouldn't be requested, because it was never in the fetch list to begin
with.

Acceptance:
- `models.VoucherType` gains a `reserved_name` column (nullable — Tally
  leaves it blank for the ~9 true base types themselves) with a migration.
- `client.py`'s voucher-type fetch list includes `RESERVEDNAME`;
  `parsers.py` parses it into the new column; `api/schemas.py`'s voucher
  type output model exposes it.
- `GET /vouchers` (or `GET /voucher-types`) supports resolving/filtering by
  base class — e.g. a `voucher_class` param on `GET /vouchers` that expands
  to every `voucher_type` whose name equals the class OR whose
  `reserved_name` equals the class, so `voucher_class=Sales` correctly
  includes "GST Invoice" for this company. Exact shape (new param vs a
  helper that resolves class → type names for the caller to pass into the
  existing `type` filter) is the implementer's call.
- A read-only live check: resolving `voucher_class=Sales` for this company
  includes "GST Invoice" and excludes "Journal"/"Payment"/"Receipt",
  matching the live `RESERVEDNAME` values above.
- `fake.py`'s voucher-type fixture covers a renamed type with a non-null
  `RESERVEDNAME`; focused parser/client/repo/API tests cover the
  class-resolution path.

Owns: `middleware/talai_middleware/tally/client.py` (voucher-type fetch
list), `parsers.py` (`parse_named` or a dedicated voucher-type parser),
`db/models.py` (`VoucherType.reserved_name`, migration), `api/schemas.py`,
`api/vouchers.py` and/or `api/masters.py` (class resolution/filter),
`fake.py`, focused tests.

Do not own: item-wise/party-wise aggregation endpoints (owned by
`ana-sales-purchase-analytics-api`), the bare-collection FETCHLIST bug
mechanism itself (owned by `dev-fix-group-collection-fetch` — this card
only adds a field to the fetch list, coordinate rather than duplicate if
both land close together), `/dashboard/*` formulas, production data
writes, live agent pushes to Tally, the main checkout, or destructive
operations.

Out of scope: changing how `GET /vouchers?type=` behaves for an exact,
already-correct type name (unchanged, additive only); reclassifying
existing rows retroactively beyond a normal re-sync.
