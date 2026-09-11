# Orchestrator dispatch brief

## Identity

- Task ID: `stk-stock-item-filters-api`
- Board card: `docs/board/in-flight/stk-stock-item-filters-api.md`
- Specification: `docs/board/in-flight/stk-stock-item-filters-api.md`
- Harness: `opencode`
- Mode: `headless`
- Model: `opencode-go/qwen3.7-plus`
- Effort: default
- Lane: `stock-item-filters-api`
- Worktree: `/Users/admin/Documents/accounts-wt/stock-item-filters-api`
- Unique dev-server port, if needed: none

## Verified premise

`middleware/talai_middleware/api/masters.py` currently exposes `GET /stock-items`
without query parameters and reads every non-deleted item through
`repo.list_simple`. The existing `GET /ledgers` endpoint and
`repo.list_ledgers`/`repo.count_ledgers` provide the established filtering,
pagination, and total-count pattern. `StockItem` has `parent` and `closing_qty`
fields, so this needs no schema or sync change.

## Objective and acceptance

Implement filtered, paginated stock-item listing.

- `GET /stock-items` accepts exact `parent`, substring `q`, numeric
  `closing_qty_gt`, `limit`, and `offset` query parameters.
- Add `repo.list_stock_items(...)` and `repo.count_stock_items(...)`, following
  the ledger equivalents and excluding deleted rows.
- The response includes the matching total and no-parameter calls retain the
  full unfiltered list behavior.
- Add focused integration tests covering every filter alone and a combined
  request.

## Already true

- `GET /ledgers` defaults `limit` to 100 and validates it between 1 and 1000;
  `offset` defaults to 0 and is non-negative.
- SQLAlchemy `ilike` is the existing name-substring mechanism.
- No stock-group hierarchy table or per-godown stock data exists; do not infer
  either from this endpoint.
- Tally is the system of record. This task only reads the middleware replica.

## Ownership boundary

### Owns

- `middleware/talai_middleware/api/masters.py`
- `middleware/talai_middleware/db/repo.py`
- `middleware/talai_middleware/api/schemas.py`
- `middleware/tests/integration/test_routes.py`

### Does not own

- `docs/board/in-flight/stk-stock-item-filters-api.md`
- `middleware/talai_middleware/db/models.py`
- Sync/pull behavior or Tally transport code
- Production data writes, live agent pushes, destructive operations, or live external publishing
- The main checkout

## Execution policy

- Subagents: `forbidden`
- Workflows: `forbidden`
- Maximum child concurrency: 0
- Write-capable child isolation: not applicable
- Cost or time budget: one bounded implementation pass
- Stopping condition: acceptance is implemented and focused plus required middleware gates pass
- Escalation condition: stop and report if a schema, migration, or sync change is required

## Required process

1. The orchestrator has already claimed this lane in `docs/lanes.md`; do not alter the lane registry.
2. Work only in the named worktree and owns-list.
3. Reconcile with current `origin/main` before touching recently changed files and again before landing.
4. Add focused reproduction tests for the new behavior.
5. From `middleware/`, run `uv run ruff check .` and `uv run pytest -q`; judge exit codes directly.
6. Do not pipe a command whose result gates a later action.
7. Stop on unexpected file, branch, or ownership changes and inspect them.

## Report contract

Return:

- Branch, worktree, and current commit
- Board card and lane status
- Files changed
- Files deliberately excluded
- Mechanism implemented and how it satisfies acceptance
- Ruff and pytest exit codes and test counts
- Tests not run and why
- Review findings or known residue
- Production verification still required
- Any owner decision needed
