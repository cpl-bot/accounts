# Dashboard real-values dispatch

## Identity

- Task ID: `empry-dashboard-with-no-real-values`
- Board card: `docs/board/ready/empry-dashboard-with-no-real-values.md`
- Specification: `docs/SYNC_RELIABILITY_PLAN.md`
- Harness: `opencode`
- Mode: `interactive`
- Model: `openai/gpt-5.6-luna`
- Effort: `high`
- Lane: `dashboard-real-values`
- Worktree: `/Users/admin/Documents/accounts-wt/dashboard-real-values`

## Verified premise

- The completed Voucher and Bill prerequisites reconciled against the office Tally instance with writes disabled.
- `SyncPuller.run()` already accepts `from_date` and `to_date`, and Voucher pulls honor those bounds. `scripts/validate_db_sync.py` does not expose them, so it cannot request the selected fiscal-year backfill.
- Outside `NEXT_PUBLIC_DEMO_MODE=true`, `app/api/talai/[...path]/route.ts` proxies `dashboard/overview` to middleware. Do not change that route.
- The card's claim that Next.js is running was stale during preflight: localhost:3000 refused a connection. Middleware was reachable but direct unauthenticated access returned 401.

## Objective and acceptance

Implement the card's validation-script scope so a read-only fiscal-year pull can be explicitly bounded and reliably reconciled.

- Add explicit, validated date-bound CLI options needed to invoke the selected fiscal-year Voucher pull; pass them to `SyncPuller.run()`.
- Preserve existing default incremental behavior when bounds are omitted.
- Ensure rejected Tally responses cause a non-zero validation result; add a focused regression test that fails before the fix if a gap exists.
- Run a read-only office-Tally full pull for `2026-04-01` through `2026-09-10` only after code gates pass, using `TALLY_WRITE_ENABLED=false`, then report source/replica counts and P&L API result.
- Attempt browser verification only after starting the documented local services if needed. Report a concrete environment blocker rather than altering frontend code.

## Already true

- Tally is the system of record; SQLite is the read replica plus outbox.
- `voucher_collection()` now emits typed `SVFROMDATE` and `SVTODATE`, proven by live one-day requests. Do not edit Tally envelope builders, parsers, client, or fake transport.
- Bill snapshots reconcile exactly against live Tally.
- No live Tally writes, destructive operations, or agent pushes are authorized.

## Ownership boundary

### Owns

- `scripts/validate_db_sync.py`
- Focused tests for that script, normally `middleware/tests/integration/test_scripts.py`
- `docs/board/ready/empry-dashboard-with-no-real-values.md` status transition
- The new `dashboard-real-values` row in `docs/lanes.md`

### Does not own

- `app/api/talai/[...path]/route.ts`, frontend components, dashboard formulas, and demo fixtures
- `middleware/talai_middleware/tally/**`
- All other board cards and lane rows
- Main checkout, production data writes, live agent pushes, destructive operations, or live external publishing

## Execution policy

- Subagents: forbidden
- Workflows: forbidden
- Maximum child concurrency: 0
- Write-capable child isolation: not applicable
- Cost or time budget: one implementation and read-only validation pass
- Stopping condition: code is committed, gates pass, and live/browser evidence or a concrete service blocker is reported
- Escalation condition: any need to alter dashboard formulas, frontend proxy behavior, Tally request builders, or enable writes

## Required process

1. Claim the lane in `docs/lanes.md` and commit the claim before implementation.
2. Move the board card to `docs/board/in-flight/` in the same claim commit.
3. Work only in the named worktree and owns-list.
4. Add failing-first regression tests for defects found.
5. Run `uv run ruff check . && uv run pytest -q` from `middleware/`; run applicable frontend tests/build only if frontend files change.
6. Do not pipe any command whose result gates a later action.
7. Rebase on local `main` before reporting completion and ensure no duplicate `docs/lanes.md` rows.

## Report contract

Return the branch, worktree, commits, board/lane state, changed and excluded files, the exact CLI invocation, gate exit codes/counts, read-only live evidence, API/browser evidence or blocker, and any owner decision needed.
