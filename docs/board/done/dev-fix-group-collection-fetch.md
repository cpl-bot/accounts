---
id: dev-fix-group-collection-fetch
type: bug
created: 2026-09-11
size: S
lane: tally-read-path
priority: 15
doc: docs/TALLY_INTEGRATION_NOTES.md
---
# Group masters pull drops PARENT/ISREVENUE/AFFECTSGROSSPROFIT

`TallyClient.groups()` (`middleware/talai_middleware/tally/client.py`) calls
`env.collection("Group", GROUP_FETCH, ..., since_alter_id=None)`. Masters are
always fetched in full (`sync_pull.py: pull_masters()` never passes an
alter-id floor), so `filters` is always empty in `envelopes.py: collection()`,
which skips the TDL-declared-collection branch and sends a bare
`<ID>Group</ID>` export. Tally treats bare `Group` as a reserved collection ID
that ignores the FETCHLIST entirely and returns a fixed native shape
(`TBALOPENING`, `GRPOPENINGBALANCE`, `LANGUAGENAME.LIST` only) — no `PARENT`,
`ISREVENUE`, `ISDEEMEDPOSITIVE`, `AFFECTSGROSSPROFIT`, `MASTERID`, `ALTERID`,
`GUID`. Same class of quirk SKILL.md already documents for bare
`List of Currencies`/`List of Units`/`List of Vouchers`, just an
undocumented instance for `Group`.

Confirmed live (2026-09-11) against 192.168.10.25:9000 / Vigyapan Mart:
- `tally collection --id "Group"` — byte-identical to what `client.py` sends
  on every full masters pull — drops every field above for all groups.
- `tally collection --id "List of Groups"` and `tally object --subtype Group`
  both return the full field set correctly with the same `--fetch` list.
- Local `data/talai.db`: all 59 rows in `groups` have `parent=''`,
  `is_revenue=0`, `is_deemed_positive=0`, `affects_gross_profit=0` — wrong for
  every non-root sub-group (e.g. `AWL AGRI BUSINESS LIMITED`, `Berger Paints`,
  `CRI Pumps Pvt.Ltd.`, `Digital Expenses`). Ledger pull is unaffected — bare
  `Ledger` happens to honour FETCHLIST; this is `Group`-specific.

Acceptance:
- `groups()` requests route through a FETCHLIST-respecting form on every
  masters pull, not only delta pulls with `since_alter_id` set — the bare
  native `Group` collection ID is never used.
- `stock_items()`, `cost_centres()`, `godowns()`, `voucher_types()` are
  checked against the same failure mode (bare TYPE name silently ignoring
  FETCHLIST) and fixed if affected; the check and result are recorded in the
  card body on completion.
- `fake.py`'s Group fixture only returns the full field set for the corrected
  request shape, so a regression back to the bare-ID request fails a test
  without needing live Tally.
- Focused envelope, parser, and client tests cover the corrected request.
- A read-only masters pull against live Tally, followed by inspecting the
  `groups` table, matches `tally object --subtype Group` for a handful of
  spot-checked groups including at least one non-root sub-group.

Owns: `middleware/talai_middleware/tally/envelopes.py` (`collection()`
builder), `client.py` (`groups()` and the other bare-ID master fetches),
`fake.py` master fixtures, focused middleware tests.

Do not own: voucher/bill collection request shapes (owned by
`dev-bounded-voucher-collection` / `dev-bill-data-snapshots`),
`services/aggregates.py`, database schema, production data writes, live
agent pushes, the main checkout, or destructive operations.

Out of scope: changing the dashboard's revenue/cost-of-sales group
definitions. `ground-truth.md` / `DECISIONS.md` A8 (decided 2026-09-09) pins
Revenue = Sales Accounts only and Cost of sales = Purchase Accounts + Direct
Expenses — deliberately narrower than Tally's own Trading-account P&L, which
also folds in Direct Incomes. That gap between Talai's gross profit and
Tally's own P&L figure is intended, not a bug; this card only fixes what
lands in the `groups` table.

## Completion note (2026-09-11)

- Full group pulls now request `List of Groups`; delta pulls continue to request the derived `TalaiGroup` collection. The fake returns incomplete native fields for bare `Group` and the full field set only for the corrected forms.
- `stock_items`, `cost_centres`, `godowns`, and `voucher_types` were checked with the same client against the LAN Tally instance. They returned 433, 0, 1, and 25 rows respectively; no corresponding bare-name field-loss symptom was observed.
- Read-only LAN masters pull succeeded: 2,309 records seen, 59 groups stored. Spot checks include nested groups `AWL AGRI BUSINESS LIMITED` -> `Sundry Debtors`, `Berger Paints` -> `Sundry Debtors`, `CRI Pumps Pvt.Ltd.` -> `Sundry Debtors`, and `Digital Expenses` -> `Indirect Expenses`.
- The validator's bill reconciliation could not run because this instance returned plain-text `Unknown Request` for both bill directions. The `tally object --subtype Group` CLI was unavailable in this environment, so the final CLI-vs-replica spot-check remains an owner-side production verification item.

---

Implementation landed. Full `groups()` pulls now use `List of Groups`; delta pulls continue to use the derived `TalaiGroup` collection. Both preserve the requested FETCHLIST rather than using the bare `<ID>Group</ID>` export.

- `stock_items`, `cost_centres`, `godowns`, `voucher_types` checked against the same failure mode — no matching field-loss symptom observed.
- No changes to dashboard group definitions, `services/aggregates.py`, or schema.
- The intended Talai-vs-Tally P&L gap is preserved; no product decisions altered.

## Owner verification

The owner completed the office-Tally group check on 2026-09-11. Acceptance criterion 5 is closed.

## Answer from owner

Advance to Employee
     Advance to Suppliers
     AWL AGRI BUSINESS LIMITED
     Bank Accounts
     Bank OD A/c
     Berger Paints
     Branch / Divisions
     Brand Nourish
     Capital Account
     Cash-in-Hand
     CRI Pumps Pvt.Ltd.
     Current Assets
     Current Liabilities
     Deposits (Asset)
     Digital Expenses
     Direct Expenses
     Direct Incomes
     Duties &amp; Taxes
     Expense Payable
     Fixed Assets
     Gst Cash Ledger
     GST LIABILITY
     GUJARAT TEA PROCESSORS &amp; PACKERS LTD
     Hard Disk
     Hella Infra Market
     HERO REALTY PVT LTD
     Indirect Expenses
     Indirect Incomes
     Interest Expenses
     Investments
     Jubliant
     KSB Limited
     Loans (Liability)
     Loans &amp; Advances (Asset)
     Lubi Industries LLP
     Luminous Power Technologies Pvt.Ltd.
     Misc. Expenses (ASSET)
     Morter
     MP Birla
     Provisions
     Purchase Accounts
     Reserves &amp; Surplus
     REVERSE CHARGE CASH LEDGER
     Salary A/c
     Salary Payable
     Sales Accounts
     SCHAEFFLER INDIA LIMITED
     Secured Loans
     SHREE CEMENT LIMITED
     Stock-in-Hand
     Sundry Creditors
     Sundry Debtors
     Suspense A/c
     TDS
     TDS 194H Payable
     Unsecured Loans
     WALKAROO INTERNATIONAL PVT LTD
     Wonder Cement Ltd
     Wonder Wallcare Pvt.Ltd.
