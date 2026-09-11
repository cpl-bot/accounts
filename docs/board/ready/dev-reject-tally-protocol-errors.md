---
id: dev-reject-tally-protocol-errors
owner: "@orchestrator"
type: bug
created: 2026-09-10
size: S
lane: tally-read-path
priority: 10
tags: [parallel-safe]
doc: docs/TALLY_INTEGRATION_NOTES.md
---
# Reject Tally protocol errors instead of recording empty success

Tally can return HTTP 200 with a plain leaf response such as `<RESPONSE>Unknown Request, cannot be processed</RESPONSE>`. The client currently audits the transport as successful before parsing, and row parsers silently return empty lists.

Acceptance:
- Plain textual Tally error responses and existing `HEADER/STATUS=0` responses raise `TallyResponseError` with the server message.
- Parser-level rejection is audited as `error`, not `ok`, while valid empty envelopes remain valid.
- Voucher and bill pull scopes become failed on this response, and a failed bill direction does not erase the previous snapshot.
- Focused parser, client/audit, fake transport, and pull-sync regression tests pass.

Owns: `middleware/talai_middleware/tally/parsers.py`, `middleware/talai_middleware/tally/client.py`, and focused tests under `middleware/tests/unit/`.

Do not own: request envelope shapes, dashboard/frontend files, database schema, production data, live Tally calls, live agent pushes, the main checkout, or destructive operations.

Out of scope: selecting the replacement voucher or bill export, changing API schemas, or treating every legitimate zero-row result as an error.

Depends on: none.
