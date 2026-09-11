# Dispatch: bill data snapshots

## Identity

- Task ID: `dev-bill-data-snapshots`
- Board card: `docs/board/ready/dev-bill-data-snapshots.md`
- Specification: `docs/TALLY_INTEGRATION_NOTES.md`
- Harness: `opencode`
- Mode: `interactive`
- Model: `openai/gpt-5.6-luna`
- Effort: high
- Lane: `bill-data-snapshots`
- Worktree: `/Users/admin/Documents/accounts-wt/bill-data-snapshots`

## Verified premise

`TallyClient.bills()` still sends rejected `Report/Bills Payable` and `Report/Bills Receivable` requests. Owner-provided, anonymized successful response fixtures are committed at `docs/board/fixtures/fixture2_bills_payable_anon.xml` and `docs/board/fixtures/fixture2_bills_receivable_anon.xml`. They use `BILLFIXED` records with sibling `BILLCL`, `BILLDUE`, and `BILLOVERDUE` fields; the current parser expects a different nested shape.

## Objective and acceptance

Replace bill pulls with validated `TYPE=Data` envelopes, including an explicit as-of date without a lower date bound. Parse the captured fixture structure into party, reference, bill date, due date, pending amount, and requested direction. Preserve prior direction snapshots if that pull fails. The fake must reject the old report shape and accept the Data shape. Add failing-first focused request, parser, client, and sync coverage.

Run `cd middleware && uv run ruff check . && uv run pytest -q`; judge direct exit codes. Do not make production writes, live agent pushes, destructive changes, or external publishing.

## Ownership boundary

### Owns

- Bill-scoped changes in `middleware/talai_middleware/tally/{envelopes,client,parsers,fake}.py`
- Bill fixtures and focused middleware tests
- The `bill-data-snapshots` row in `docs/lanes.md`

### Does not own

- Voucher collection behavior and its already-landed files/semantics
- Dashboard/frontend files and aggregate formulas
- Database schema, main checkout, production data writes, live agent pushes, destructive operations, and live external publishing

## Execution policy

- Subagents: forbidden
- Workflows: forbidden
- Maximum child concurrency: 0
- Write-capable child isolation: none
- Stopping condition: committed lane result with direct gate evidence, or an exact fixture-to-Data-contract ambiguity.

## Required process

1. Claim the lane in `docs/lanes.md` and commit before implementation.
2. Work only in the named worktree and owned files.
3. Reconcile with current `origin/main` before edits and handoff.
4. Add failing-first reproduction tests for each corrected behavior.
5. Do not pipe gate commands or perform live Tally calls unless the owner explicitly requests a read-only verification.

## Report contract

Return branch/worktree/commit, lane status, changed and excluded files, mechanism, direct gate exit codes/counts, unrun checks, known residue, and remaining owner-side verification.
