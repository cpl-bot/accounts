---
id: co-company-info-sync
owner: "@orchestrator"
type: bug
created: 2026-09-11
size: M
lane: tally-read-path
priority: 40
doc: docs/TALLY_INTEGRATION_NOTES.md
---
# Company info (name, financial year) is neither fetched correctly nor persisted

Two stacked gaps, found while checking whether Talai can answer "is Tally
reachable / what companies are loaded / what's the company's financial
year" (2026-09-11, live against 192.168.10.25:9000, "Vigyapan Mart
Pvt.Ltd. - (from 1-Apr-23)"):

**1. `TallyClient.list_companies()` requests a bare reserved collection ID
that silently ignores its FETCHLIST — same bug class as
`dev-fix-group-collection-fetch`, a different collection.**
`envelopes.py: list_companies()` builds `<ID>Company</ID>` with a FETCHLIST
of `NAME, COMPANYNUMBER, STARTINGFROM, BOOKSFROM, GUID`. Confirmed live:
sending that exact envelope (`tally collection --id "Company" --fetch
NAME,COMPANYNUMBER,STARTINGFROM,BOOKSFROM,GUID`) returns only `<NAME>` —
`STARTINGFROM`, `BOOKSFROM`, `GUID` are dropped. Using `List of Companies`
(the named collection) or `tally object --subtype Company` with the same
fetch list returns all of them correctly: `STARTINGFROM=20230401`,
`BOOKSFROM=20230401`, `GUID=e0ef854c-4ace-41f2-a395-63d7be36df81`. So
`GET /tally/status` and `GET /tally/companies` return `start_from: null,
books_from: null, guid: null` for every company today, live-verified — the
fields exist on `CompanyInfo` but are dead on arrival.

**2. Even once fixed, nothing persists company info — there is no
`company` table in the replica.** `GET /tally/status` and `/companies` only
return what a live Tally ping happens to answer; there's no sync step and
no way to read company name/FY/address when Tally is unreachable, and no
single place the frontend or dashboard could read it from without hitting
Tally live. Confirmed live via `tally object --subtype Company --fetch
Name,StartingFrom,BooksFrom,Address,PinCode,PANNumber,GSTRegistrationType,
Email` that the object export cleanly returns `Name`, `StartingFrom`,
`BooksFrom`, `Address` (3 lines), `PinCode`, `Email`, `GSTRegistrationType`
— Tally has no separate "financial year end" field; it's derived as
`StartingFrom + 1 year - 1 day` by convention, so no extra column is needed
for it.

Acceptance:
- `list_companies()` (or a new `company()` call) uses a FETCHLIST-respecting
  request shape (`List of Companies` collection or `object --subtype
  Company`), never the bare `Company` collection ID.
- A new `company` row (single-row table, or a `models.Company` with one
  expected record) persists name, GUID, starting_from, books_from, address,
  pincode, email, gst_registration_type, PAN if available — sourced from a
  masters-pull step.
- A `GET` endpoint (new `/company`, or company info folded into
  `/tally/status`) serves this from the replica so it survives a Tally
  outage, alongside the existing live-ping fields.
- `fake.py`'s company fixture only returns the full field set for the
  corrected request shape, so a regression back to the bare-ID request
  fails a test without live Tally.
- Focused envelope, parser, client, and repo tests cover the corrected
  request and the new table/endpoint.
- A read-only live pull followed by `GET /company` (or `/tally/status`)
  shows the same starting-from date as `tally object --subtype Company`.

Owns: `middleware/talai_middleware/tally/envelopes.py` (`list_companies()`),
`client.py`, `parsers.py` (`parse_companies`/`Company`), `fake.py` company
fixture, `db/models.py` (new company table), `db/repo.py`, a masters-pull
step in `sync_pull.py`, `api/tally.py` or a new `api/company.py`, focused
middleware tests.

Do not own: group/ledger/voucher/bill collection request shapes (owned by
`dev-fix-group-collection-fetch`, `dev-bounded-voucher-collection`,
`dev-bill-data-snapshots`), the frontend company-label decision (see
`debug-company-context-mismatch`, a separate product question about which
label to *display*, not this replica gap), production data writes, live
agent pushes to Tally, the main checkout, or destructive operations.

Out of scope: multi-company support (Talai targets one company per
`ENGINEERING_PLAN.md`); resolving the Nivana/Vigyapan label mismatch
(that's `debug-company-context-mismatch`'s product decision, not a data gap).
