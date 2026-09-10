# Ground truth (Talai)

Settled decisions. If your context disagrees with this file, your context is stale.

- Tally is the system of record. Talai's SQLite DB is a replica plus an outbox — anything Talai shows that disagrees with Tally is a Talai bug (DECISIONS.md A1).
- Database for v1: SQLite on the LAN host. Alembic keeps the Postgres path open but Supabase migration (T-B24) is post-v1 backlog (DECISIONS.md A2, 2026-09-09).
- v1 target: ~43 engineer-days / ~83 agent-hours per `docs/TASKS.md`, phased 0-4 (Foundations → Read path → Write path dry-run → Write path live → v1 LAN release).
- LAN-validation tasks (T-L*) require a person physically at the office with the real Tally instance; they cannot be delegated to agents. These live in Waiting on owner.
- Full spec docs: `docs/ENGINEERING_PLAN.md` (architecture), `docs/DECISIONS.md` (product decisions + defaults), `docs/TASKS.md` (task backlog with acceptance tests), `docs/openapi.json` (API contract).
- Task IDs (T-B*, T-F*, T-L*) from `docs/TASKS.md` are preserved in card bodies for cross-reference.
