---
id: rcv-ledger-statement-running-balance
owner: "@orchestrator"
type: feature
created: 2026-09-11
size: S
lane: tally-read-path
doc: docs/TALLY_INTEGRATION_NOTES.md
after: [vch-point-in-time-ledger-balances, dev-bounded-voucher-collection]
---
# Per-ledger statement (transaction history + running balance) has no endpoint

Checked whether Talai can answer "ledger report for a specific ledger over a
date range" the way Tally's `Ledger` report does (2026-09-11, live against
192.168.10.25:9000, "Vigyapan Mart Pvt.Ltd. - (from 1-Apr-23)"). Note: on
this company's Tally instance, `tally report --id "Ledger" --ledger
"<party>" --from --to` did **not** return a voucher-wise statement for
either of two parties tried — it returned ledger master/alteration fields
(`SHORTPROMPT`, `LEDTAXTYPE`, `TCSAPPLICABLE`, `LEDGSTIN`, ...) instead,
suggesting a customized/overridden `Ledger` report ID on this install. Not
investigating that quirk further here — it's a live-Tally-request-shape
question orthogonal to what Talai's own replica can already do, and the
underlying question ("transaction history for one ledger over a range") is
independently answerable from data the replica already has.

**The row-level data is already there.** `GET /vouchers?party=<name>&from=&
to=` (`middleware/talai_middleware/api/vouchers.py`, `db/repo.py:
_voucher_query`) already returns every voucher against a party ledger in a
date range — this covers the transaction-list part of a ledger statement.

**What's missing: an opening balance and running balance.** A real ledger
statement (what Tally's `Ledger` report and every accounting package calls
one) needs, for the requested `from` date: an opening balance, then each
voucher's signed amount against that ledger, and a running closing balance
after each line. `GET /vouchers` returns bare voucher rows with no
per-ledger running total, and `models.Ledger` stores exactly one
`closing_balance` (current, from the last masters sync) with no way to ask
"what was it on an arbitrary past `from` date." That's the exact same
structural gap `vch-point-in-time-ledger-balances` already cards for Trial
Balance/Balance Sheet — reusing rather than re-diagnosing it here: once that
card lands (whichever direction it picks — snapshot table or guaranteed-
complete-history reconstruction), an opening balance for any covered `from`
date becomes available, and a running balance is just a cumulative sum of
`VoucherLedgerEntry.amount` for that ledger from there forward — already the
same computation shape as `aggregates.py: _entry_sum()`, just scoped to one
ledger's entries in date order instead of a group-of-ledgers window total.

Acceptance:
- A new endpoint, e.g. `GET /ledgers/{name}/statement?from=&to=`, returning:
  opening balance as of `from` (sourced from whatever
  `vch-point-in-time-ledger-balances` lands), each voucher touching that
  ledger in the range in date order with its signed amount and running
  balance, and the closing balance as of `to`.
- Returns an explicit error (not a silently wrong number) if the requested
  `from` date falls outside whatever coverage window
  `vch-point-in-time-ledger-balances` guarantees.
- A read-only live spot check for one ledger/period reconciles running and
  closing balances against Tally's own ledger data (via `tally object
  --subtype Ledger --fetch ClosingBalance` for the closing figure at
  minimum, since the live `Ledger` report ID itself misbehaves on this
  install as noted above).
- Focused repo/API tests cover a ledger with multiple vouchers in range, an
  empty-range case, and the out-of-coverage error path.

Owns: a new endpoint (`api/vouchers.py` or a new `api/ledgers.py`), a repo/
aggregate helper for the running-balance computation (may share code with
`services/aggregates.py: _entry_sum()`), associated schema.

Do not own: the opening-balance/point-in-time infrastructure itself (owned
by `vch-point-in-time-ledger-balances` — this card only consumes it),
group-hierarchy rollups (owned by `co-group-classification-and-outstandings`),
`/dashboard/*` formulas, production data writes, live agent pushes to
Tally, the main checkout, or destructive operations.

Out of scope: diagnosing or fixing the live `Ledger` report ID's unexpected
response shape on this Tally install — noted for context only, not this
card's problem to solve since the replica-based approach doesn't depend on
it; any write/import path.

Depends on: `vch-point-in-time-ledger-balances` (opening-balance
precondition), `dev-bounded-voucher-collection` (complete voucher pull for
the running-balance computation to be trustworthy).
