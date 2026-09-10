# Backlog (pointer)

The board is not one file. It is one markdown file per card:

- `docs/board/ground-truth.md` - settled decisions. Supersedes CLAUDE.md (or your project's equivalent) and any older session context. READ THIS FIRST.
- `docs/board/in-flight/` - what is being worked right now. Read these in full.
- `docs/board/ready/` `waiting-on-owner/` `intake/` `later/` `done/` - the other columns. Column membership IS the directory.
- `docs/board/conventions.md` - card conventions.
- `docs/board/archive/<YYYY-MM>/` - rotated Done cards, once the board has run long enough to rotate.

Read it surgically, never whole: `cat docs/board/ground-truth.md docs/board/in-flight/*.md`,
`ls docs/board/ready | wc -l`, `grep -rl <topic> docs/board/ready/`.

Kanban view: `npm run board`, then open the URL it logs (it defaults to http://localhost:4400 and falls forward to the next free port).
One-file snapshot for anything that still wants the old shape: `npm run board:index` (generated on demand, never committed).
