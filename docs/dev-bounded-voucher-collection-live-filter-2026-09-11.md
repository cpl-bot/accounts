# Dispatch: live Voucher date-filter correction

## Identity

- Task ID: `dev-bounded-voucher-collection`
- Board card: `docs/board/ready/dev-bounded-voucher-collection.md`
- Harness: `opencode`
- Mode: `interactive`
- Model: `openai/gpt-5.6-luna`
- Effort: high
- Lane: `voucher-live-date-filter`
- Worktree: `/Users/admin/Documents/accounts-wt/voucher-live-date-filter`

## Verified premise

On 2026-09-11, the patched middleware made a read-only derived `TalaiVoucher` request to office Tally at `192.168.10.25:9000`. Tally returned 3,486 parsed rows even though the requested window was the current overlap period; the client-side safeguard persisted only 73 rows. The server-side TDL date filter is therefore ignored or malformed in the live request. No data was written to Tally.

## Objective and acceptance

Correct the TDL request shape so the office Tally returns only vouchers inside the supplied from/to date range. Preserve mandatory bounds and the existing Python date filter. Add a regression test that distinguishes the exact accepted live shape from the current ignored shape. Validate read-only against a narrow date known to contain vouchers and report request dates, returned count, and observed date range. Do not modify Tally data.

## Ownership boundary

### Owns

- Voucher collection request construction in `middleware/talai_middleware/tally/envelopes.py`
- Corresponding fake behavior, focused voucher tests, and lane registry row

### Does not own

- Bill request/parser behavior, dashboard/frontend code, database schema, main checkout, production writes, live agent pushes, destructive operations, or external publishing

## Execution policy

- Subagents: forbidden
- Workflows: forbidden
- Maximum child concurrency: 0
- Live authority: read-only calls to `192.168.10.25:9000` only; never send `ACTION=Alter` or `ACTION=Delete`
- Stopping condition: a live one-day request returns only that day, or the exact unresolved TDL constraint is reported

## Required process

1. Claim the lane in `docs/lanes.md` and commit before implementation.
2. Rebase onto local `main`, never only `origin/main`, before handoff.
3. Run middleware Ruff and pytest; judge exit codes directly.
4. Report live query evidence separately from test evidence.
