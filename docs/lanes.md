# Session lanes

**PARALLEL SESSIONS.** This file is the live registry and the lock: claim a lane when you start (commit the claim), release it when done. One session = one lane worktree (/Users/admin/projects/accounts-wt/<lane>, branch `lane/<lane>`); two sessions never share a checkout. Files outside your lane's owns-list are read-only; route them through a board card.

Claims were skipped once on the origin project and sessions collided; do not skip them.

**Merge hazard:** if this file is ever set to `merge=union` in .gitattributes, a cross-lane rebase can silently DUPLICATE rows with no conflict markers. Check row counts after every rebase.

## Current lanes

| Lane | Harness | Model | Session | Worktree | Owns | Status |
|---|---|---|---|---|---|---|
| reject-tally-protocol-errors | opencode | opencode/muse-spark-1.3-contributor-free | `ses_f70c0455fffezDZSGBRrdHrW6K` | `/Users/admin/Documents/accounts-wt/reject-tally-protocol-errors` | `middleware/talai_middleware/tally/{parsers,client,fake}.py`, focused middleware tests | landed |
| fix-group-collection-fetch | opencode | openai/gpt-5.6-luna | `pending` | `/Users/admin/Documents/accounts-wt/fix-group-collection-fetch` | `middleware/talai_middleware/tally/{envelopes,client,fake}.py`, focused middleware tests | active |
