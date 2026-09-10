---
id: t-l02-validate-db-sync
owner: owner
type: chore
created: 2026-09-10
size: S
lane: lan-validation
doc: docs/LAN_DEPLOYMENT.md
---
# T-L02: LAN validation — validate_db_sync.py full pull, reconcile ledger counts

Unblock: run `scripts/validate_db_sync.py` against office Tally, confirm ledger counts reconcile. Depends on T-B13 (drafts outbox API — already done per TASKS.md). Cannot be delegated to an agent.
