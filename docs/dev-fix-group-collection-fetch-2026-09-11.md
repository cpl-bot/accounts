# Dispatch brief: fix Group collection fetch (bare-ID ignores FETCHLIST)

## Identity

- Task ID: dev-fix-group-collection-fetch
- Board card: `docs/board/ready/dev-fix-group-collection-fetch.md`
- Specification: board card + `docs/TALLY_INTEGRATION_NOTES.md` (Group collection quirk section)
- Harness: `opencode`
- Mode: `headless`
- Model: `openai/gpt-5.6-luna` (owner-constrained: READY-lane work uses this model ONLY)
- Lane: `fix-group-collection-fetch`
- Worktree: `/Users/admin/Documents/accounts-wt/fix-group-collection-fetch`
- Branch: `lane/fix-group-collection-fetch` (cut from `origin/main`)
- Base commit: `origin/main` at dispatch time (record in report)

## Verified premise

Orchestrator independently checked the mechanism in the main checkout before dispatch (no guesswork):

- `middleware/talai_middleware/tally/client.py:155-177` (`_collection`): when
  `since_alter_id is None`, `filters` is `None`.
- `middleware/talai_middleware/tally/client.py:189-190` (`groups`): full masters
  pulls call `_collection("Group", GROUP_FETCH, ...)` with no alter-id floor
  (`sync_pull.py pull_masters()` never passes one), so `filters` is always empty
  on masters pulls.
- `middleware/talai_middleware/tally/envelopes.py:97-132` (`collection`): with
  `filters` empty/None the TDL-declared-collection branch is skipped and the
  request goes out as a bare `<ID>Group</ID>` export — exactly the shape the
  card says Tally treats as a reserved collection ID that ignores FETCHLIST.
- Live confirmation is recorded in the card body (2026-09-11, Vigyapan Mart):
  bare `Group` drops PARENT/ISREVENUE/AFFECTSGROSSPROFIT/MASTERID/ALTERID/GUID;
  `List of Groups` and object-subtype Group return the full set. Local
  `data/talai.db` symptom (59 group rows, all parent='' / flags 0) is consistent.
- Quantitative check live vs local was NOT re-run by the orchestrator (no live
  Tally writes/pulls from this session beyond what the card records); the
  executor must do the read-only verification pull per acceptance.

## Objective and acceptance

Fix `groups()` so every masters pull uses a FETCHLIST-respecting request form;
never send the bare native `Group` collection ID. All criteria observable:

1. `groups()` requests route through a FETCHLIST-respecting form on every
   masters pull, not only delta pulls with `since_alter_id` set — the bare
   native `Group` collection ID is never used.
2. `stock_items()`, `cost_centres()`, `godowns()`, `voucher_types()` are checked
   against the same failure mode (bare TYPE name silently ignoring FETCHLIST)
   and fixed if affected; the check and result are recorded in the card body
   (or the executor's report if the card is not to be edited from the lane —
   see process rule 1 note below) on completion.
3. `fake.py`'s Group fixture only returns the full field set for the corrected
   request shape, so a regression back to the bare-ID request fails a test
   without needing live Tally.
4. Focused envelope, parser, and client tests cover the corrected request.
5. A read-only masters pull against live Tally, followed by inspecting the
   `groups` table, matches `tally object --subtype Group` for a handful of
   spot-checked groups including at least one non-root sub-group.

## Already true

- `dev-reject-tally-protocol-errors` lane is landed (fake rejects
  `ACTION="Alter"`/`"Delete"`; protocol-error rejection in place).
- Bare-`Group`-ignores-FETCHLIST is the same class of quirk SKILL.md documents
  for bare `List of Currencies` / `List of Units` / `List of Vouchers`.
- Bare `Ledger` honours FETCHLIST (ledger pull unaffected — do not "fix" it).
- Revenue = Sales Accounts only; Cost of sales = Purchase Accounts + Direct
  Expenses per `ground-truth.md` / DECISIONS.md A8. The Talai-vs-Tally P&L gap
  is intended. Do not touch `services/aggregates.py` or dashboard group
  definitions.
- `TALLY_WRITE_ENABLED=false` default; this task is read-path only.

## Ownership boundary

### Owns

- `middleware/talai_middleware/tally/envelopes.py` (`collection()` builder)
- `middleware/talai_middleware/tally/client.py` (`groups()` and the other
  bare-ID master fetches: `stock_items`, `cost_centres`, `godowns`,
  `voucher_types`)
- `middleware/talai_middleware/tally/fake.py` master fixtures (Group + any
  other affected master)
- Focused middleware tests for the above (envelope, parser, client)

### Does not own

- Voucher/bill collection request shapes (owned by
  `dev-bounded-voucher-collection` / `dev-bill-data-snapshots` cards)
- `middleware/talai_middleware/services/aggregates.py`
- Database schema / migrations
- Dashboard / frontend files
- The main checkout (`/Users/admin/Documents/accounts`) — read-only reference
- Prod data writes, live agent pushes, destructive operations
- `docs/lanes.md` rows of other lanes; `docs/board/` cards other than a
  completion note on the owned card

## Execution policy

- Subagents: `forbidden`
- Workflows: `forbidden`
- Maximum child concurrency: 0 (single executor, no fan-out)
- Write-capable child isolation: n/a (no children)
- Cost or time budget: bounded single-card fix; stop and escalate if the live
  Tally check needs more than read-only pulls or the fix spreads beyond the
  owns-list
- Stopping condition: all five acceptance criteria met with gates green, or a
  blocking finding reported with evidence
- Escalation condition: message the orchestrator session; do NOT widen the
  owns-list, touch schema, enable writes, or push to remote on own initiative
- Model note: executor model is owner-directed (`openai/gpt-5.6-luna` ONLY for
  READY-lane cards), not a complexity pick. Task class is routine
  (bounded multi-file fix with settled mechanism), so no premium-model
  justification applies.

## Required process

1. Claim the lane in `docs/lanes.md` and commit the claim before
   implementation. NOTE: edit `docs/lanes.md` only in the lane worktree on the
   lane branch, then push the lane branch — never commit from the main
   checkout. Board-card edits from the lane are limited to a completion note.
2. Work only in the named worktree and owns-list.
3. Reconcile with current `origin/main` before touching recently changed files
   and again before finishing.
4. Add failing-first reproduction tests: the fake-fixture regression test must
   fail against the old bare-ID request shape before the fix.
5. Run from `middleware/`: `uv run ruff check . && uv run pytest -q`; judge
   exit codes directly (no pipes). Report exact codes and counts.
6. Do not pipe a command whose result gates a later action.
7. Stop on unexpected file, branch, or ownership changes and inspect them.
8. No live writes: read-only pulls only; `TALLY_WRITE_ENABLED` stays false.

## Report contract

Return:

- Branch, worktree, and current commit
- Board card and lane status
- Files changed
- Files deliberately excluded (esp. any of `stock_items`/`cost_centres`/
  `godowns`/`voucher_types` found NOT affected, with evidence)
- Mechanism implemented and how it satisfies acceptance (which request shape
  is now sent on full pulls vs delta pulls)
- Build exit code (ruff) and test-suite exit code with counts
- Tests not run and why
- Review findings or known residue
- Production verification still required (live-pull reconciliation results)
- Any owner decision needed
