# Sync Reliability Plan

Consolidates the investigation and decisions from the "dashboard shows zeros
after sync" thread into one implementation plan. Supersedes the earlier
"atomic whole-run rollback" idea — the direction below relies on per-scope
sync status plus a manual retry, not cross-scope transactional rollback.

## 1. Problem

After a sync where Tally became unreachable mid-run, the dashboard showed:

- Cash & Bank Balance: a real, non-zero figure.
- Gross Profit / P&L Summary / Revenue vs Cost of Sales: all ₹0.
- AP/AR Outstanding, AP/AR Aging, DPO/DSO: all zero / empty.

despite a "Stock adjustment applied from Tally" badge suggesting success.

## 2. Root causes

1. **Non-atomic, single-row sync run.** `SyncPuller.run()`
   (`middleware/talai_middleware/services/sync_pull.py:70-104`) pulls all four
   scopes (`masters, vouchers, bills, stock`, `sync_pull.py:25`) against one
   SQLAlchemy session with no intermediate commits, and records exactly **one**
   `sync_runs` row for the whole batch. On a `TallyError` mid-run it goes
   straight to `finish_sync_run(status="failed")` + `commit()`
   (`sync_pull.py:97-98`) **without rolling back** — so whatever upserts ran
   before the exception (e.g. masters) get committed anyway, alongside a run
   row marked "failed". Scopes are attempted in order, so if the failure
   happens during/before `vouchers`, `bills` and `stock` never even run —
   which is why AP/AR aging was empty too (no bill data was fetched this run,
   not a computation bug).
2. **Masters use ALTERID-delta filtering**, via `_since()` /
   `max_alter_id()` (`sync_pull.py:174-176`, `repo.py:106-107`). Tally bumps a
   ledger's AlterID when the ledger master is *edited*, not necessarily every
   time a voucher shifts its closing balance. Delta-by-AlterID can silently
   miss balance drift on otherwise-unedited ledgers.
3. **`last_successful_pull` scope-matching bug.** `repo.py:92-103` matches
   the `scope` column against a single literal (e.g. `"vouchers"`), but
   `run()` always stores the *joined* scope string
   (`"masters,vouchers,bills,stock"`, `sync_pull.py:78`). The lookup never
   matches, so `voucher_window()` (`sync_pull.py:188-197`) never finds a
   "last success" and always falls back to "since Jan 1 this year" — every
   run re-pulls the whole year's Day Book instead of an incremental delta.
4. **No frontend surface for pull-sync at all.** The only existing sync UI,
   `SyncModal` (`components/ap/sync-modal.tsx`), calls `/sync/push` (pushing
   the outbox *to* Tally) — not `/sync/pull`. There is no manual "sync now"
   button, no "last synced" indicator, and no per-scope status anywhere in
   the app. `/sync/pull` and `/sync/runs`
   (`middleware/talai_middleware/api/sync.py:23,41`) have zero callers today.

## 3. Direction (agreed)

- Do **not** make the whole four-scope run atomic/rollback-on-any-failure.
  Instead, make each **scope independent**: its own transaction, its own
  `sync_runs` row, committed on its own success or failure. A partial sync is
  not a bug to prevent — it's a state to *show correctly* and let the user
  retry.
- **Masters always do a full refresh** (drop ALTERID-delta filtering for
  groups/ledgers/stock items/lookups). Master lists are small; this trades a
  slightly bigger request for eliminating the balance-drift staleness risk.
- **Vouchers/bills/stock stay incremental/windowed** — but fixed, so the
  incremental window actually works (item 3 above).
- **Recovery is manual**: build the "Sync now" button that doesn't exist yet,
  driving `/sync/pull`. No automatic retry/backoff changes beyond what the
  scheduler already does.
- **Add visibility**: per-scope last-success timestamp and last-error,
  surfaced via API and shown in the UI, so a partial sync is never confused
  for a full one again.

Out of scope / explicitly rejected earlier in this thread: making SQLite (or
a future Supabase replica) the source of truth instead of Tally — Tally
remains system of record per `docs/DECISIONS.md` A1.

## 4. Implementation phases

### Phase 1 — `sync_pull.py`: per-scope runs + full master refresh

- `pull_masters()` (`sync_pull.py:110-172`): stop calling `self._since(model)`
  for groups/ledgers/stock items/lookups — pass `None` so the client always
  fetches the full list. Remove `_since()` (`sync_pull.py:174-176`) once
  unused.
- `SyncPuller.run()` (`sync_pull.py:70-104`): restructure to loop over
  `selected` scopes, and for each: `start_sync_run(scope=<single scope
  name>)` → commit → attempt the pull → on success `finish_sync_run(status="success", ...)` + commit; on `TallyError`,
  `session.rollback()` (discarding only that scope's partial upserts), then
  `finish_sync_run(status="failed", error=...)` + commit. Continue to the
  next scope regardless (don't abort the rest of the run on one scope's
  failure). Return `list[models.SyncRun]` (one per attempted scope) instead
  of a single `SyncRun`.
- This also fixes root cause 3 for free: each row's `scope` column is now a
  literal single scope name, so `last_successful_pull(session, "vouchers")`
  starts matching correctly and `voucher_window()` does real incremental
  windowing.

### Phase 2 — Update callers of `SyncPuller.run()`

- `middleware/talai_middleware/api/sync.py:23-30` (`pull` route): handle the
  new `list[SyncRun]` return — return a list-shaped response (new
  `SyncRunList`-style model, reusing the existing `SyncRunList` in
  `schemas.py:443` or a dedicated response) instead of a single `SyncRunOut`.
- `middleware/talai_middleware/services/scheduler.py:57-71` (`run_once`):
  update `success = run.status == "success"` to aggregate across the
  returned list (e.g. `success = all(r.status == "success" for r in runs)`),
  since the failure counter/backoff logic depends on a single boolean.

### Phase 3 — API: status endpoint

- Add `GET /sync/status` (or equivalent) in `api/sync.py` returning, per
  scope (`masters`, `vouchers`, `bills`, `stock`), the latest run's status,
  `finished_at`, and `error` — the "what synced successfully last time"
  view. Can be built directly on `repo.latest_sync_runs()` /
  `last_successful_pull()`, grouping by scope.

### Phase 4 — Frontend: sync button + status panel

- New component (near `components/layout/tally-status-pill.tsx`, alongside
  the existing `TallyStatusPill`) with:
  - A "Sync now" button calling `/sync/pull`.
  - A per-scope status readout (last success time, last error) from
    `/sync/status`.
- Add the missing TS types/client calls: `lib/api/schema.ts` has
  `syncRunSchema` (line 342-352) and `pushResultSchema` (366-370) but no
  `SyncRunList` type or client function for `/sync/pull` / `/sync/runs` /
  `/sync/status` — add them.

### Phase 5 — Tests

- `middleware/tests/unit/test_sync_pull.py`: update for per-scope run
  behavior (one `SyncRun` row per scope, rollback scoped to the failing
  scope only, full-refresh masters no longer filtering by ALTERID).
- Add/adjust tests for the fixed `voucher_window()` incremental behavior and
  the new `/sync/status` endpoint.
- Frontend: cover the new sync button/status component if the project has
  component tests for similar UI (check existing `sync-modal` test coverage
  for the pattern to follow).

## 5. Risks / open questions

- Repeated failures will now show up as repeated "failed" rows per scope per
  run — expected and desired (visibility), but worth confirming the
  scheduler's backoff/circuit-breaker behavior (`scheduler.py`) still makes
  sense against an aggregated multi-scope result.
- Full master refresh assumes ledger/group/stock-item counts stay small
  enough that a full pull every interval is cheap; revisit if that stops
  being true for a very large chart of accounts.
