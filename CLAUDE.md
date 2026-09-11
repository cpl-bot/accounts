# Talai — project instructions

## Project board

- `docs/board/` is THE board and single source of truth for all work: one
  markdown file per card, column membership = directory. Read
  `docs/board/ground-truth.md` in full every session (settled decisions; if
  your context disagrees with it, your context is stale), then
  `docs/board/in-flight/*.md` in full. Read the other columns surgically:
  `ls docs/board/ready | wc -l`, `grep -rl <topic> docs/board/ready/` — not
  whole; `npm run board:index` renders a one-file snapshot on demand if you
  ever want the whole thing in one read. `docs/backlog.md` is a short
  pointer, not the board.
- Open the board from the Claude preview panel (the `board` server) or run
  `npm run board` for a browser tab. It grabs the next free port
  automatically (preferred 4400), so check the preview list / console for
  the actual URL.
- Work from Ready cards; capture new ideas as new files in
  `docs/board/intake/`; write dated outcome notes in the card body when you
  move something to Done.
- Card conventions live in `docs/board/conventions.md`. One card = one
  file; the one-line rule is for the TITLE, bodies can run long, real specs
  live in `docs/*.md` behind the card's `doc:` field.
- "Waiting on owner" cards name exactly one unblocking action. A column
  move is never authorization for destructive or external-facing
  operations.
- Capture freely (fragments are fine); run `/groom-board` to consolidate,
  right-size, and sequence the board. Do not edit cards in the board UI.

## Working model (parallel sessions)

- Parallel sessions are supported. One session = one lane worktree
  (`/Users/admin/projects/accounts-wt/<lane>`, branch `lane/<lane>`); two
  sessions never share a checkout. Lane worktrees for spawned agents may
  also appear under `.claude/worktrees/` inside the main checkout.
- Never leave uncommitted work in the main checkout, and never sweep
  another session's uncommitted work into your commit. `git status`
  immediately before `git add`; stage explicit paths, never `git add -A`.
- Claim before you code: register the lane in `docs/lanes.md` and commit
  the claim first, and move the card to `docs/board/in-flight/`. Release
  the lane honestly when done.
- Land from the lane on green gates, judged by exit code directly (never
  through a pipe): `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
  at the root, plus `uv run ruff check . && uv run pytest -q` from
  `middleware/` when the lane touches the backend.
- **The ORCHESTRATOR role is ASSIGNED, NEVER INFERRED. Default is NO.**
  You are orchestrating only if (a) the owner told you to in your own
  conversation, (b) a departing orchestrator handed you the role
  explicitly, or (c) the owner asked you to take the integrator lane. If
  none of those happened, you are a builder or an ordinary session: do not
  hold the main checkout, do not dispatch other sessions, do not review
  another lane's work uninvited. Two sessions both believing they
  orchestrate is a collision, not redundancy. The rule that binds everyone
  regardless of role: never leave uncommitted work in the main checkout,
  never sweep another session's uncommitted work into your commit. Role
  details in `docs/orchestrator-role.md`. Run `/orchestrate` only in the
  session that will coordinate, never in a builder pane.
