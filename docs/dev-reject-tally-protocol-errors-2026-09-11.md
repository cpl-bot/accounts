# Orchestrator dispatch brief

## Identity

- Task ID: `dev-reject-tally-protocol-errors`
- Board card: `docs/board/in-flight/dev-reject-tally-protocol-errors.md`
- Specification: `docs/TALLY_INTEGRATION_NOTES.md` plus the board card acceptance criteria
- Harness: `opencode`
- Mode: `headless`
- Model: `opencode/muse-spark-1.3-contributor-free`
- Effort: `high`
- Lane: `reject-tally-protocol-errors`
- Worktree: `/Users/admin/Documents/accounts-wt/reject-tally-protocol-errors`
- Unique dev-server port, if needed: none

## Verified premise

The current `middleware/talai_middleware/tally/parsers.py` rejects empty, HTML, malformed XML, and structured `HEADER/STATUS=0` responses, but does not reject a plain XML leaf such as `<RESPONSE>Unknown Request, cannot be processed</RESPONSE>`. `TallyClient._send()` records every transport response as `ok` before any parser runs, so parser failures are not audited as errors. `SyncPuller` already catches `TallyError`, rolls back the failing scope, preserves prior bill rows, and continues later scopes; the implementation must preserve that behavior.

## Objective and acceptance

Make unusable Tally protocol responses fail closed instead of becoming empty successful pulls.

- Plain textual Tally error responses and existing `HEADER/STATUS=0` responses raise `TallyResponseError` containing the server message.
- Parser-level rejection is audited as `error`, not `ok`; valid empty envelopes remain valid.
- Voucher and bill pull scopes become failed on this response, and a failed bill direction does not erase its previous snapshot.
- Focused parser, client/audit, fake transport, and pull-sync regression tests pass.
- No production Tally calls, writes, publishing, or live agent pushes occur.

## Already true

- `TallyResponseError` is the typed `TallyError` for unusable Tally responses.
- `FakeTallyTransport` can return structured Tally failures and can fail named requests without network access.
- Scope-level pull rollback and audit replay already protect persisted data and audit records for raised `TallyError` instances.
- `TALLY_WRITE_ENABLED=false` remains the safe default.

## Ownership boundary

### Owns

- `middleware/talai_middleware/tally/parsers.py`
- `middleware/talai_middleware/tally/client.py`
- `middleware/talai_middleware/tally/fake.py`
- Focused tests under `middleware/tests/unit/` for parsers, client/audit, fake transport, and pull sync
- `docs/board/ready/dev-reject-tally-protocol-errors.md` only if moving it to `in-flight/` is required by the lane-claim process

### Does not own

- Main checkout `/Users/admin/Documents/accounts`
- Other lanes and their files
- Request envelope shapes or replacement voucher/bill export design
- Dashboard or frontend files
- Database schema or migrations
- Production data writes, live Tally calls, live agent pushes, or destructive operations
- `docs/lanes.md` beyond the lane claim/release row required by process

## Execution policy

- Subagents: `forbidden`
- Workflows: `forbidden`
- Maximum child concurrency: `0`
- Write-capable child isolation: not applicable
- Cost or time budget: one bounded implementation pass, up to 45 minutes
- Stopping condition: stop and report if the required behavior needs envelope redesign, schema changes, a live Tally response, or files outside the owns-list
- Escalation condition: report an owner decision if the plain response format is ambiguous or if existing valid empty-envelope behavior cannot be distinguished mechanically

## Required process

1. Claim the lane in `docs/lanes.md` and commit the claim before implementation.
2. Work only in `/Users/admin/Documents/accounts-wt/reject-tally-protocol-errors` and the owns-list.
3. Reconcile with current `origin/main` before touching recently changed files and again before reporting completion.
4. Add failing-first regression tests for plain protocol errors, audit status, and failed pull scopes before the implementation.
5. Run `uv run ruff check .` and `uv run pytest -q` from `middleware/`; judge exit codes directly.
6. Do not pipe a command whose result gates a later action.
7. Stop on unexpected file, branch, or ownership changes and inspect them.

## Report contract

Return:

- Branch, worktree, and current commit
- Board card and lane status
- Files changed
- Files deliberately excluded
- Mechanism implemented and how it satisfies acceptance
- Middleware lint exit code
- Middleware test-suite exit code and counts
- Tests not run and why
- Review findings or known residue
- Production verification still required
- Any owner decision needed
