---
id: rcv-bills-date-range-history
owner: "@orchestrator"
type: feature
created: 2026-09-11
size: L
lane: tally-read-path
doc: docs/TALLY_INTEGRATION_NOTES.md
after: [dev-bill-data-snapshots]
---
# Bills Receivable/Payable "as of a past date" is structurally unanswerable from the replica

Checked whether Talai can answer "Bills Receivable for a date range" /
"Bills Payable for a date range" the way Tally itself does (2026-09-11, live
against 192.168.10.25:9000, "Vigyapan Mart Pvt.Ltd. - (from 1-Apr-23)"). It
cannot, and the gap is structural, not just a missing filter.

**Live-verified: Tally's own Bills Receivable report genuinely reconstructs
history.** `tally report --id "Bills Receivable" --from 2025-04-01 --to
2026-01-31` returns 798 `<BILLFIXED>` blocks; the identical call with `--to
2026-09-10` returns 1142 — Tally is correctly telling us what was
outstanding as of each different point in time, using its full transaction
history plus bill-settlement records it keeps internally.

**Talai's `bills` table cannot do this.** Read `services/sync_pull.py:
pull_bills()`: every sync calls `repo.replace_bills()` per direction — a
full replace of the table with whatever Tally currently reports as open.
There is no history of prior snapshots. `api/vouchers.py: GET /bills`'s
`as_on` param (`repo._open_bills_filter`) only does
`Bill.bill_date <= as_on` **against the current snapshot** — it filters
which of today's still-open bills were *issued* on or before a past date,
which is not the same question as "what was outstanding, as Tally itself
would report, if you asked on that past date": a bill issued before
`as_on` but fully paid off since would still be wrongly excluded from
history reconstruction (it's already gone from the snapshot), and there is
also no lower-bound (`from`) param on `GET /bills` at all today, so even a
simple "issued between two dates" filter is missing, separate from the
historical-accuracy problem.

**Bottom-up reconstruction from vouchers isn't possible either.** Checked
`models.VoucherLedgerEntry` — it stores `ledger_name`/`amount`/
`is_deemed_positive`/`cost_centre` only. Tally's voucher XML carries
`BILLALLOCATIONS.LIST` (which bill reference a payment/receipt settles,
`NAME`/`AMOUNT`/`BILLTYPE`) but none of that is captured anywhere in the
schema or `parsers.py: parse_vouchers()`. Without it, there is no way to
replay bill-by-bill settlement history from the vouchers Talai does store,
even once `dev-bounded-voucher-collection` guarantees a complete voucher
pull for a fiscal year.

This is the same class of gap `vch-point-in-time-ledger-balances` already
carded for **ledger balances** (Trial Balance/Balance Sheet as-of-a-date) —
same "replica only knows the current snapshot, not history" root cause —
but a different table (`bills`, not `ledgers`) with a different, and
arguably harder, precondition: ledger balances can in principle be
reconstructed bottom-up from `opening_balance` + summed voucher entries;
bills cannot, because bill-level settlement allocation isn't captured at
all. Not duplicating that card; noting the relationship since an
implementer solving one may want to know about the other.

Acceptance:
- A documented decision (recorded in this card body) on direction: (a)
  periodic dated bill snapshots (a new table, e.g. `bill_snapshots`, an
  analog of `stock_valuations`, populated by a scheduled/on-demand sync
  step that pulls Bills Receivable/Payable for a requested `as_on` date), or
  (b) capturing `BILLALLOCATIONS.LIST` per `VoucherLedgerEntry` so bill
  state can be replayed chronologically from vouchers, or (c) documenting
  that historical-as-of queries are out of reach for v1 and routing them to
  a live (non-replica) Tally call instead. Either of (a)/(b) needs a
  migration; (c) does not but must be explicit in the API response/docs
  rather than silently wrong.
- `GET /bills` gains a `from` param (issuance-date lower bound) regardless
  of which direction is chosen, since that gap exists even for the current
  snapshot.
- Whichever direction is chosen, a live spot check shows the new capability
  agreeing with `tally report --id "Bills Receivable"/"Bills Payable"
  --from --to` for at least one date in the past (not just "as of now").
- If a new table/column is added: Alembic migration, wired into
  `sync_runs` like other sync scopes, focused parser/repo tests.
- If routed to a live call for historical dates: the response makes clear
  it bypassed the replica (so callers don't assume replica-speed/offline
  behavior), and a timeout/failure path degrades gracefully.

Owns: schema/migration (if snapshot- or allocation-based), `services/
sync_pull.py` (new sync step if needed), `tally/envelopes.py`/`parsers.py`
(if capturing `BILLALLOCATIONS.LIST`), `api/vouchers.py` (`GET /bills`
`from` param and any new as-of-date capability), `db/repo.py`.

Do not own: the current-snapshot bill request/parse shape (owned by
`dev-bill-data-snapshots`), party filter/ranking on the current snapshot
(owned by `rcv-bill-party-filter-and-ranking`), ledger-balance point-in-time
work (owned by `vch-point-in-time-ledger-balances`), `/dashboard/*`
formulas, production data writes, live agent pushes to Tally, the main
checkout, or destructive operations.

Out of scope: historical bill data predating the company's Tally books
(1-Apr-23 per the company name), any write/settlement path, changing A8.

Depends on: `dev-bill-data-snapshots` (the current-snapshot request/parse
must work before any historical extension of it makes sense to build).
