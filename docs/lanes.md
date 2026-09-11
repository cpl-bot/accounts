# Session lanes

**PARALLEL SESSIONS.** This file is the live registry and the lock: claim a lane when you start (commit the claim), release it when done. One session = one lane worktree (/Users/admin/projects/accounts-wt/<lane>, branch `lane/<lane>`); two sessions never share a checkout. Files outside your lane's owns-list are read-only; route them through a board card.

Claims were skipped once on the origin project and sessions collided; do not skip them.

**Merge hazard:** if this file is ever set to `merge=union` in .gitattributes, a cross-lane rebase can silently DUPLICATE rows with no conflict markers. Check row counts after every rebase.

## Current lanes

| Lane | Worktree | Owns | Status |
|---|---|---|---|
