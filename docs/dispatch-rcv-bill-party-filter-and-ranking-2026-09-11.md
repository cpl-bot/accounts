# Dispatch: bill party filter and ranking

## Identity

- Task ID: `rcv-bill-party-filter-and-ranking`
- Board card: `docs/board/in-flight/rcv-bill-party-filter-and-ranking.md`
- Specification: the board card and `docs/TALLY_INTEGRATION_NOTES.md`
- Harness: `codex`
- Mode: `interactive`
- Model: `openai/gpt-5.6-terra`
- Effort: `high`
- Lane: `bill-party-filter-ranking`
- Worktree: `/Users/admin/Documents/accounts-wt/bill-party-filter-ranking`
- Unique dev-server port, if needed: not needed

## Verified premise

`GET /bills` currently takes only `direction` and `as_on`
(`middleware/talai_middleware/api/vouchers.py`). `repo.list_bills()` filters
only by open status, direction, and date (`db/repo.py`), although
`Bill.party_ledger` is indexed. The settled bill snapshot prerequisite is
landed; current repo tests exercise `replace_bills()` and date semantics.

## Objective and acceptance

Implement the board card's optional case-insensitive `party` filter and a
read-replica-only party-wise outstanding ranking. Preserve existing
`direction`, `as_on`, aging buckets, and dashboard formulas. Add focused
repo/API tests for matches, no match, ordering, deterministic tie behavior,
and empty direction.

## Already true

- Tally is the system of record; this is read-replica API work only.
- Bills are snapshots of currently open bills. Do not create historical bill
  reconstruction.
- No production writes, live agent pushes, or live Tally calls are needed for
  automated tests. A live comparison is optional only when safely available.

## Ownership boundary

### Owns

- `middleware/talai_middleware/api/vouchers.py`
- `middleware/talai_middleware/db/repo.py` bill-query functions
- `middleware/talai_middleware/api/schemas.py` bill-ranking response models
- Focused middleware tests for the above
- This board card and this lane's row in `docs/lanes.md`

### Does not own

- Main checkout
- Other Ready cards, especially stock filters, analytics, company sync, and
  group outstandings
- Bill pull/parser request shapes and fixtures
- `/dashboard/*` behavior or formulas
- Production data writes, live agent pushes, destructive operations, or live
  external publishing

## Execution policy

- Subagents: forbidden
- Workflows: forbidden
- Maximum child concurrency: 0
- Write-capable child isolation: not applicable
- Cost or time budget: one bounded backend feature
- Stopping condition: acceptance and focused tests are green; stop and report
  if the ranking API shape requires an unresolved product decision
- Escalation condition: any conflict with an active lane or prerequisite
  regression

## Required process

1. Claim the lane in `docs/lanes.md` and commit the claim before implementation.
2. Work only in the named worktree and owns-list.
3. Reconcile with current `origin/main` before touching recently changed files
   and again before landing.
4. Add failing-first reproduction tests for defects.
5. Run `uv run ruff check . && uv run pytest -q` from `middleware/`; judge exit
   codes directly.
6. Do not pipe a command whose result gates a later action.
7. Stop on unexpected file, branch, or ownership changes and inspect them.

## Report contract

Return branch, worktree, current commit, board/lane status, changed and
excluded files, implemented mechanism, gate exit codes and test counts, tests
not run, known residue, production verification still required, and any owner
decision needed.
