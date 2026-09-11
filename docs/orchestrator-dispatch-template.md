# Orchestrator dispatch brief

Copy this template into `docs/<task>-<date>.md` or a task-specific dispatch file. Remove instructional placeholders before dispatch.

## Identity

- Task ID:
- Board card:
- Specification:
- Harness: `claude | codex | prime-agent`
- Mode: `interactive | headless | daemon`
- Model:
- Effort:
- Lane:
- Worktree:
- Unique dev-server port, if needed:

## Verified premise

State what was independently checked before dispatch. If the card contains guesses such as "probably" or "most likely," resolve them first.

## Objective and acceptance

State the concrete outcome and observable acceptance criteria.

## Already true

List settled implementation facts, owner rulings, shipped prerequisites, and mechanisms the builder must preserve.

## Ownership boundary

### Owns

- Exact files, directories, or scoped hunks

### Does not own

- Adjacent active lanes and their files
- Main checkout
- Prod data writes
- Live agent pushes
- Destructive operations
- Live external publishing
- Any additional task-specific exclusions

## Execution policy

- Subagents: `forbidden | allowed | required`
- Workflows: `forbidden | allowed | required`
- Maximum child concurrency:
- Write-capable child isolation:
- Cost or time budget:
- Stopping condition:
- Escalation condition:

For a top-tier model dispatch, include the premium-model gate result (or written justification) and why the default tier is insufficient.

## Required process

1. Claim the lane in `docs/lanes.md` and commit the claim before implementation.
2. Work only in the named worktree and owns-list.
3. Reconcile with current `origin/main` before touching recently changed files and again before landing.
4. Add failing-first reproduction tests when fixing defects.
5. Run `pnpm build` and `pnpm test`; judge exit codes directly.
6. Do not pipe a command whose result gates a later action.
7. Stop on unexpected file, branch, or ownership changes and inspect them.

## Report contract

Return:

- Branch, worktree, and current commit
- Board card and lane status
- Files changed
- Files deliberately excluded
- Mechanism implemented and how it satisfies acceptance
- Build exit code
- Test-suite exit code and counts
- Tests not run and why
- Review findings or known residue
- Production verification still required
- Any owner decision needed
