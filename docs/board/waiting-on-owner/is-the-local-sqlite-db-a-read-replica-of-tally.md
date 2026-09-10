---
id: is-the-local-sqlite-db-a-read-replica-of-tally
owner: owner
type: chore
created: 2026-09-10
---
# Confirm SQLite replica completeness and offline dashboard behavior

Confirm whether the current sync process maintains a complete read replica so the dashboard works while the Tally machine is offline, and whether data is stored in the format consumed by the Next.js application.

Unblock: choose the intended deliverable: an architecture/code audit, a LAN data reconciliation, or implementation fixes. The current request mixes these scopes and does not define a single observable outcome.
