---
id: led-fix-ledger-collection-fetch
owner: "@orchestrator"
type: bug
created: 2026-09-11
size: M
lane: tally-read-path
doc: docs/TALLY_INTEGRATION_NOTES.md
---
# Ledger masters pull drops opening balance, GSTIN, address, mailing name, state, and GUID/MASTERID/ALTERID for every ledger

Found while checking whether Talai can answer "what's ledger X's opening/
closing balance" and "what's ledger X's mailing address, GSTIN, phone,
email" (2026-09-11, live against 192.168.10.25:9000, "Vigyapan Mart
Pvt.Ltd. - (from 1-Apr-23)"). This is the same bug class as
`dev-fix-group-collection-fetch` (bare reserved-collection ID silently
ignores FETCHLIST), but for the `Ledger` collection — which that card's own
investigation asserted was "unaffected... bare `Ledger` happens to honour
FETCHLIST." That assertion is wrong for every field except `PARENT` and
`CLOSINGBALANCE`; this card corrects and fixes it for `Ledger` specifically.

`TallyClient.ledgers()` (`middleware/talai_middleware/tally/client.py`)
calls `_collection("Ledger", LEDGER_FETCH, P.parse_ledgers, since_alter_id)`
with `LEDGER_FETCH = [NAME, PARENT, OPENINGBALANCE, CLOSINGBALANCE,
PARTYGSTIN, MAILINGNAME, LEDSTATENAME, GSTREGISTRATIONTYPE, ISBILLWISEON,
MASTERID, ALTERID, GUID]`. Masters are always fetched in full
(`sync_pull.py: pull_masters()` never passes an alter-id floor for
ledgers either), so `filters` is always empty in `envelopes.py:
collection()`, which sends a bare `<ID>Ledger</ID>` export with a plain
FETCHLIST — exactly the request shape `dev-fix-group-collection-fetch`
already diagnoses as broken for `Group`.

Confirmed live (2026-09-11):
- `tally collection --id "Ledger" --fetch NAME,PARENT,OPENINGBALANCE,
  CLOSINGBALANCE,PARTYGSTIN,MAILINGNAME,LEDSTATENAME,GSTREGISTRATIONTYPE,
  ISBILLWISEON,MASTERID,ALTERID,GUID` — byte-identical in shape to what
  `client.py` sends on every full masters pull — returns **only** `PARENT`
  and `CLOSINGBALANCE` for all 1791 ledgers (and `CLOSINGBALANCE` is blank
  for some). `OPENINGBALANCE`, `PARTYGSTIN`, `MAILINGNAME`, `LEDSTATENAME`,
  `GSTREGISTRATIONTYPE`, `ISBILLWISEON`, `MASTERID`, `ALTERID`, `GUID` never
  appear — zero occurrences across the whole export. Tally instead injects
  its own fixed native shape for bare `Ledger` (`ONACCOUNTVALUE`,
  `TBALOPENING`, `CLOSINGONACCTVALUE`, `CLOSINGDRONACCTVALUE`,
  `LEDOPENINGBALANCE`) — note `TBALOPENING` and `LEDOPENINGBALANCE` are
  *not* the same value as `OPENINGBALANCE` for this dataset (e.g. Admudra
  Advertising: `TBALOPENING=-11912838.44` vs `LEDOPENINGBALANCE=
  -9412838.44`), so even reading one of the substitute native tags would be
  guessing at which "opening" Tally means.
- `tally object --subtype Ledger --id "<name>" --fetch <same field list>`
  and `tally collection --id "List of Ledgers" --parent "<group>" --fields
  Name,Parent,ClosingBalance` (the `--fields`/NATIVEMETHOD form, same
  technique the Group card's fix will use) both return the full field set
  correctly, including `ADDRESS.LIST`, `PINCODE`, `MAILINGNAME`,
  `PARTYGSTIN`, `GSTREGISTRATIONTYPE`, `ISBILLWISEON`, `OPENINGBALANCE`,
  `MASTERID`. Spot-checked "Admudra Advertising" (Sundry Debtors) and "4S
  AGENCIES" (Sundry Creditors) this way.
- Local `data/talai.db`: all 1791 rows in `ledgers` have `opening_balance
  IS NULL`, `gstin=''`, `address=''`, `mailing_name=''`, `state=''`,
  `tally_guid=''`, `tally_master_id=''` — for every single row, including
  ledgers Tally confirms have this data (Admudra Advertising has GSTIN
  `09BFOPC5454E1ZE` and a two-line address in Tally; the replica has
  neither). `parent_group` and `closing_balance` are correct (they ride
  along in the fixed native shape), which is why this was easy to miss.
  The empty `tally_guid`/`tally_master_id` also means ledger upserts can
  only ever match by name (the unique constraint), and a future
  ALTERID-based delta pull for ledgers has nothing to filter on.

This directly blocks two of the six ledger questions this investigation was
asked to check: opening balance is unanswerable (always null), and mailing
address/GSTIN/state are unanswerable (always empty) even though the schema
already has columns for them and Tally already has the data.

Separately, while confirming this, live testing also showed Tally can
return `Email`, `LedgerPhone`, `LedgerMobile`, `PinCode`, and `Country` for
a ledger object (`tally object --subtype Ledger --fetch Email,LedgerPhone,
LedgerMobile,PinCode,Country`), but none of these are in `LEDGER_FETCH`,
none are columns on `models.Ledger`, and none are parsed in
`parsers.py: parse_ledgers`. For this company specifically, a live filter
sweep (`tally collection --id "List of Ledgers" --filter '$Email <> ""'`,
same for `$LedgerPhone`/`$StateName`) found **zero** ledgers in "Vigyapan
Mart Pvt.Ltd." have any of those three fields populated in Tally at all —
so this particular company's data can't verify a fix end-to-end for
Email/Phone, only for PinCode (which rides along with Address) — but the
columns/fetch/parse are still worth adding since Tally supports them and
other companies' data likely has them filled in.

Acceptance:
- `ledgers()` requests route through a FETCHLIST-respecting form on every
  masters pull (the same technique used to fix `Group`), not only delta
  pulls with `since_alter_id` set — the bare native `Ledger` collection ID
  is never used for the field-rich pull.
- After the fix, a live masters pull followed by inspecting the `ledgers`
  table shows non-null `opening_balance`, and non-empty `gstin`,
  `mailing_name`, `address`, `state`, `tally_guid`, `tally_master_id` for
  ledgers Tally confirms have that data (e.g. "Admudra Advertising"'s GSTIN
  and address match `tally object --subtype Ledger --id "Admudra
  Advertising"` exactly).
- `models.Ledger` gains `pincode`, `email`, `phone`, `mobile`, and
  `country` columns (migration included); `LEDGER_FETCH` requests
  `PINCODE`, `EMAIL`, `LEDGERPHONE`, `LEDGERMOBILE`, `COUNTRYNAME`;
  `parse_ledgers` parses them; `LedgerOut` exposes them. Verify against
  live Tally on whichever ledger(s), if any, have these fields populated in
  this company — if none do, note that explicitly rather than claiming a
  live-verified round trip for those specific fields.
- `fake.py`'s Ledger fixture only returns the full field set for the
  corrected request shape, so a regression back to the bare-ID request
  fails a test without needing live Tally.
- Focused envelope, parser, and client tests cover the corrected request
  and the new fields.

Owns: `middleware/talai_middleware/tally/envelopes.py` (`collection()`
builder, shared with the Group fix), `client.py` (`ledgers()` and
`LEDGER_FETCH`), `parsers.py` (`parse_ledgers`, `LedgerRow`),
`db/models.py` (`Ledger` new columns), `api/schemas.py` (`LedgerOut`),
`fake.py` ledger fixture, a new Alembic migration, focused middleware
tests.

Do not own: the `Group`/`StockItem`/`CostCentre`/`Godown`/`VoucherType`
fixes (owned by `dev-fix-group-collection-fetch`, though the same
`envelopes.py: collection()` builder is shared — coordinate rather than
duplicate if both land close together), group-hierarchy ledger rollups
(owned by `co-group-classification-and-outstandings`), `services/
aggregates.py`, production data writes, live agent pushes to Tally, the
main checkout, or destructive operations.

Out of scope: adding a phone/email/address validation or formatting layer;
reconstructing historical opening balances for dates other than the
current books-opening value Tally reports today.
