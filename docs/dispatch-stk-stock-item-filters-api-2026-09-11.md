# Dispatch: stock item filters API

## Identity

- Task ID: `stk-stock-item-filters-api`
- Board card: `docs/board/in-flight/stk-stock-item-filters-api.md`
- Specification: the board card and `docs/TALLY_INTEGRATION_NOTES.md`
- Harness: `opencode`
- Mode: `headless`
- Model: `openai/gpt-5.6-luna`
- Effort: `medium`
- Lane: `stock-item-filters-api`
- Worktree: `/Users/admin/Documents/accounts-wt/stock-item-filters-api`

## Verified premise

The card identifies the current unfiltered `GET /stock-items` route and its
existing data columns. This is replica-only API work and needs no live Tally
call or schema change.

## Objective and acceptance

Implement every acceptance criterion in
`docs/board/in-flight/stk-stock-item-filters-api.md`: parent, name query,
positive-quantity filtering, pagination, total count, and focused tests. Keep
the unfiltered response behavior compatible.

## Already true

- Tally is the system of record; no production writes or live Tally calls.
- `rcv-bill-party-filter-and-ranking` is landed; do not modify its API code.
- The next API card is intentionally serialized because `db/repo.py` is a
  shared collision surface.

## Ownership boundary

### Owns

- `middleware/talai_middleware/api/masters.py` stock-items route
- `middleware/talai_middleware/db/repo.py` stock-item query functions only
- `middleware/talai_middleware/api/schemas.py` only if needed for total
- Focused middleware tests
- This board card and this lane's row in `docs/lanes.md`

### Does not own

- Main checkout, other Ready cards, sync/pull behavior, stock schema,
  production writes, live agent pushes, or destructive operations.

## Required process

1. Claim the lane in `docs/lanes.md` and commit it before implementation.
2. Work only in the named worktree and owns-list.
3. Reconcile with current `origin/main` before implementation and landing.
4. Add focused tests and run `uv run ruff check . && uv run pytest -q` from
   `middleware/`, judging exit codes directly.
5. Regenerate `docs/openapi.json` if the API contract changes.
6. Report branch, commit, gate exit codes, and residue.
