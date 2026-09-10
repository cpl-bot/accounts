# Card conventions (board hygiene)

## The shape

- One card = one FILE: `docs/board/<column>/<id>.md`. Column membership IS the directory, so a move is a file move and there is no status field to desync.
- The filename stem is the card's durable id and equals `id:` in the frontmatter. Editing a card never renames it; a rename is a deliberate, rare act.
- The one-line rule retires for BODIES and survives for TITLES: `# <title>` alone must say what the card is, because a column listing shows nothing else. Bodies run as long as the card genuinely needs; append updates at the bottom with dates.
- Real specs still live in `docs/*.md`. Point at them with `doc:`, do not paste them into the card.

## Frontmatter

```yaml
id: example-card-id          # equals the filename stem
owner: claude                # who works this board -- adjust the set to your project (e.g. claude | codex | owner)
type: bug                    # OPTIONAL: bug | feature | decision | idea | chore | watch
created: 2026-01-01
size: S                      # OPTIONAL: XS | S | M | L
lane: area/subarea           # OPTIONAL
priority: 20                 # sparse int, lower sorts higher; Ready only
tags: [parallel-safe, verify-prod, time-gated, discussion]
after: [some-other-card-id]  # OPTIONAL dependency ids
doc: docs/some-spec-2026-01-01.md
```

- `type` is optional and is OMITTED when unclear. A guessed type is worse than no type.
- Only the keys above are known; anything else is a note wearing a costume, so put it in the body. If the project has installed the board-doctor test (`src/__tests__/board-registry.test.ts` or equivalent), it enforces this, plus unique ids, a title line, and the owner/type enums.

## Working rules

- Waiting-on-owner cards must name the EXACT unblocking action or word. A column move is never authorization for destructive or external-facing operations.
- Intake captures move to Ready only when defined enough for a cold start; otherwise add a "needs: ..." note and move to Waiting on owner.
- `type: decision` = the deliverable is a decision, not code. A session may prepare the proposal; the owner makes the call. Column placement signals urgency, the type signals the deliverable.
- Ready is the only column where ORDER is signal: `priority` carries the groom sequence, sparse (10, 20, 30) so one card can be re-slotted without renumbering the column.
- Done keeps roughly the last 10 cards; the rest rotate to `docs/board/archive/<YYYY-MM>/`.
- Stale-card sweep: whenever a card lands in Done, scan Ready/Later for cards the work just superseded and close them with a "CLOSED as stale" note.
- Another agent's cards are read-only. With one file per card that is a path-level fact (`owner:` plus the file's own git history), not a habit.

## Reading the board

Surgically, never whole:

```bash
cat docs/board/ground-truth.md docs/board/in-flight/*.md   # what a cold session needs
ls docs/board/ready | wc -l                                # column size
grep -rl <topic> docs/board/ready/                          # find your area
npm run board:index                                         # one-file snapshot, on demand, never committed
```
