#!/usr/bin/env node
// Kanban view over the project board. DUAL MODE, decided per request:
//
//   FILE mode   - docs/board/ exists: one markdown file per card, the column
//                 IS the directory (docs/board/ready/foo.md). Card identity is
//                 the filename stem; mutators key on id + the content hash the
//                 client last saw, so a stale client gets the same 409-reload
//                 contract it already handles.
//   LEGACY mode - no docs/board/: the old single docs/backlog.md, sections as
//                 columns, cards as "- [ ] " lines matched verbatim.
//
// Both modes serve the identical HTTP shape, so one canonical server covers
// every sibling project whether or not it has migrated yet.
//
//   node scripts/kanban-board.mjs           -> http://localhost:4400
//   node scripts/kanban-board.mjs --index   -> print a one-file board snapshot
//
// No dependencies. The board is re-read on every poll (2s), so edits made by
// sessions (or git pulls) appear within seconds; board edits write to disk
// immediately and show a "dirty" badge until committed.

import { createServer } from 'node:http'
import {
  readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync,
  readdirSync, renameSync, statSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, basename, extname } from 'node:path'
import { randomBytes, createHash } from 'node:crypto'

// BOARD_ROOT lets tests point the whole data layer at a scratch directory.
const ROOT = process.env.BOARD_ROOT
  ? resolve(process.env.BOARD_ROOT)
  : join(dirname(fileURLToPath(import.meta.url)), '..')
const BOARD = join(ROOT, 'docs', 'backlog.md')
const BOARD_DIR = join(ROOT, 'docs', 'board')
const ARCHIVE = join(ROOT, 'docs', 'backlog-archive.md')
const ASSETS_DIR = join(ROOT, 'docs', 'board-assets')
// Where we publish the live bound port so another local server (e.g. the
// reporting workspace's "Board" tab) can discover it after autoPort/cascade.
const PORTFILE = join(ROOT, 'data', 'board.port')
// Port resolution, in priority order:
//   BOARD_PORT  - explicit pin (e.g. `BOARD_PORT=4410 npm run board`)
//   PORT        - injected by the Claude preview panel when launched with
//                 autoPort:true, already guaranteed free (the panel picks the
//                 next open port and passes it here, so the board binds it and
//                 shows up in the preview's active-servers list)
//   4400        - default for a lone board
// If the resolved port is busy (several boards running via plain
// `npm run board`), the listen handler below falls forward to the next port.
let PORT = Number(process.env.BOARD_PORT || process.env.PORT || 4400)

// Board title: package.json name if present, else the directory name.
let TITLE = basename(ROOT)
try {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  if (pkg.name) TITLE = pkg.name
} catch {}

// Ensure assets dir exists
mkdirSync(ASSETS_DIR, { recursive: true })

// Section heading -> column label -> file-mode directory. Order here = column
// order on the board. The heading string stays the wire protocol in both modes
// (the client posts `to: <heading>`), so file mode maps it to a directory.
const COLUMNS = [
  ['Unsorted intake', 'Intake', 'intake'],
  ['Waiting on owner (one action each)', 'Waiting on owner', 'waiting-on-owner'],
  ['Ready to start', 'Ready', 'ready'],
  ['In flight', 'In flight', 'in-flight'],
  ['Later / backlogged', 'Later', 'later'],
  ['Done (recent)', 'Done', 'done'],
]
const DIR_BY_HEADING = new Map(COLUMNS.map(([h, , d]) => [h, d]))
const COLUMN_DIRS = COLUMNS.map(([, , d]) => d)

// docs/board/ present = migrated project. Checked per call, not cached, so the
// migration can flip a running server without a restart.
function fileMode() {
  return existsSync(BOARD_DIR)
}

const MIME_TO_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
}
const MAX_BYTES = 5 * 1024 * 1024 // 5 MB

// Generate a timestamped asset filename
function genAssetName(mime) {
  const ext = MIME_TO_EXT[mime] || '.png'
  const now = new Date()
  const ts = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') + '-' +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0')
  const rand = randomBytes(2).toString('hex')
  return `${ts}-${rand}${ext}`
}

// Extract image refs from a raw card line.
// Returns { cleanLine, images } where images = ['docs/board-assets/...', ...]
function extractImageRefs(rawLine) {
  const images = []
  // Match all ![alt](path) where path starts with docs/board-assets/
  const re = /\s*!\[[^\]]*\]\((docs\/board-assets\/[^)]+)\)/g
  let m
  while ((m = re.exec(rawLine)) !== null) {
    images.push(m[1])
  }
  // Strip all image refs from line
  const cleanLine = rawLine.replace(/\s*!\[[^\]]*\]\(docs\/board-assets\/[^)]+\)/g, '').trimEnd()
  return { cleanLine, images }
}

// Parse inline status tags from card text
function parseBadges(text) {
  const badges = []
  if (/\bIN FLIGHT\b/i.test(text)) badges.push({ type: 'in-flight', label: 'IN FLIGHT' })
  if (/\bBLOCKED[:\s]/i.test(text)) badges.push({ type: 'blocked', label: 'BLOCKED' })
  if (/^DISCUSSION:/i.test(text)) badges.push({ type: 'discussion', label: 'DISCUSSION' })
  if (/\bTIME-GATED\b/i.test(text)) badges.push({ type: 'time-gated', label: 'TIME-GATED' })
  if (/\bneeds:/i.test(text)) badges.push({ type: 'needs', label: 'needs:' })
  const cap = text.match(/captured (\d{4}-\d{2}-\d{2})/)
  if (cap) badges.push({ type: 'date', label: cap[1] })
  return badges
}

// Derive title and description from card text.
// title = text up to first sentence boundary (". " / ": " / " - "), capped ~80 chars
// description = remainder after the title boundary
function splitTitleDesc(text) {
  // Try sentence boundaries in order of preference
  const patterns = [
    /^(.{1,80}?)\.\s+(.+)$/s,   // ". "
    /^(.{1,80}?):\s+(.+)$/s,    // ": "
    /^(.{1,80}?) - (.+)$/s,     // " - "
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m) {
      const title = m[1].trim()
      const desc = m[2].trim()
      if (title.length >= 8) return { title, desc }
    }
  }
  // No boundary found: truncate at 80 chars for title
  if (text.length > 80) {
    return { title: text.slice(0, 79) + '…', desc: text.slice(79) }
  }
  return { title: text, desc: '' }
}

// ---- File mode: one markdown file per card --------------------------------
//
// Card identity is the filename stem. The token the client round-trips as
// `raw` is a short content hash: mutators compare it against the file on disk
// and answer 409 on mismatch, which is the same reload contract the UI already
// implements for the legacy verbatim-line match.

const FM_ORDER = ['id', 'owner', 'type', 'created', 'size', 'lane', 'priority', 'tags', 'after', 'doc']
const OWNERS = ['claude', 'codex', 'owner']
// Optional card type. Derived best-effort at migration and left OMITTED when
// unclear, because a guessed type is worse than no type. No UI reads it yet.
const TYPES = ['bug', 'feature', 'decision', 'idea', 'chore', 'watch']

function hashOf(content) {
  return createHash('sha1').update(content).digest('hex').slice(0, 12)
}

// Minimal YAML: `key: value`, plus `[a, b]` inline lists. Anything richer is
// out of scope on purpose; cards are written by this server and by sessions
// with an editor, not by a config generator.
function parseFrontmatter(text) {
  if (!text.startsWith('---\n')) return { fm: {}, body: text }
  const lines = text.split('\n')
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { end = i; break }
  }
  if (end === -1) return { fm: {}, body: text }
  const fm = {}
  for (let i = 1; i < end; i++) {
    const m = lines[i].match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/)
    if (!m) continue
    const key = m[1]
    let val = m[2].trim()
    if (val.startsWith('[') && val.endsWith(']')) {
      fm[key] = val.slice(1, -1).split(',').map((s) => unquote(s.trim())).filter(Boolean)
    } else if (/^-?\d+$/.test(val)) {
      fm[key] = Number(val)
    } else {
      fm[key] = unquote(val)
    }
  }
  return { fm, body: lines.slice(end + 1).join('\n').replace(/^\n+/, '') }
}

function unquote(s) {
  if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) {
    return s.slice(1, -1)
  }
  return s
}

function fmScalar(v) {
  const s = String(v)
  if (typeof v === 'number') return s
  // Quote only when a bare value would re-parse as something else.
  if (s === '' || /^[\[\]{}#&*!|>%@`"']/.test(s) || /:\s/.test(s) || s !== s.trim()) {
    return JSON.stringify(s)
  }
  return s
}

function serializeFrontmatter(fm) {
  const keys = [...FM_ORDER.filter((k) => fm[k] !== undefined && fm[k] !== null && fm[k] !== '')]
  for (const k of Object.keys(fm)) {
    if (!keys.includes(k) && fm[k] !== undefined && fm[k] !== null && fm[k] !== '') keys.push(k)
  }
  const out = ['---']
  for (const k of keys) {
    const v = fm[k]
    if (Array.isArray(v)) {
      if (v.length === 0) continue
      out.push(`${k}: [${v.map((x) => fmScalar(x)).join(', ')}]`)
    } else {
      out.push(`${k}: ${fmScalar(v)}`)
    }
  }
  out.push('---')
  return out.join('\n')
}

// text = what the editor shows and saves: first line is the title, the rest is
// the body. Image refs are appended by the server and stripped from `text`,
// exactly as legacy mode does with the single card line.
function serializeCard(fm, text, images) {
  const lines = String(text).replace(/\r/g, '').split('\n')
  const title = (lines.shift() || '').replace(/^#+\s*/, '').trim()
  const rest = lines.join('\n').trim()
  const refs = (images && images.length) ? images.map((p) => `![shot](${p})`).join(' ') : ''
  const bodyParts = [`# ${title}`]
  if (rest) bodyParts.push('', rest)
  if (refs) bodyParts.push('', refs)
  return `${serializeFrontmatter(fm)}\n${bodyParts.join('\n')}\n`
}

function cardDirPath(dir) {
  return join(BOARD_DIR, dir)
}

function readCardFile(dir, file) {
  const path = join(cardDirPath(dir), file)
  let content
  try { content = readFileSync(path, 'utf8') } catch { return null }
  const { fm, body } = parseFrontmatter(content)
  const stem = file.replace(/\.md$/, '')
  const bodyLines = body.split('\n')
  let title = ''
  let restStart = 0
  for (let i = 0; i < bodyLines.length; i++) {
    if (bodyLines[i].trim() === '') { restStart = i + 1; continue }
    const h = bodyLines[i].match(/^#\s+(.*)$/)
    title = (h ? h[1] : bodyLines[i]).trim()
    restStart = i + 1
    break
  }
  if (!title) title = String(fm.title || stem)
  const restRaw = bodyLines.slice(restStart).join('\n').trim()
  const { cleanLine: restClean, images } = extractImageRefs(restRaw)
  const desc = restClean.trim()
  const text = desc ? `${title}\n\n${desc}` : title
  return {
    id: stem,
    raw: hashOf(content),
    done: dir === 'done',
    text,
    title,
    desc,
    lane: String(fm.lane || text.match(/Lane: ([a-z-]+)/i)?.[1] || '').toLowerCase(),
    badges: parseBadges(text),
    images,
    priority: typeof fm.priority === 'number' ? fm.priority : null,
    owner: fm.owner ? String(fm.owner) : '',
    type: fm.type ? String(fm.type) : '',
    size: fm.size ? String(fm.size) : '',
    doc: fm.doc ? String(fm.doc) : '',
    created: fm.created ? String(fm.created) : '',
    file,
    dir,
    path,
    fm,
    content,
  }
}

// ---- Aging: how long a card has sat in its current column -------------------
//
// A column change IS a file move, and with --no-renames git records the
// destination path as an ADDITION, so the newest add date for a path is the
// moment the card entered that column. One `git log` answers it for the whole
// board at once; per-card `git log` calls would be ~250 processes on every 2s
// poll. Cached for a minute because history only moves when someone commits.
const ADD_DATE_TTL_MS = 60_000
let addDateCache = { at: 0, map: null }

function addDatesByPath() {
  const now = Date.now()
  if (addDateCache.map && now - addDateCache.at < ADD_DATE_TTL_MS) return addDateCache.map
  const map = new Map()
  try {
    const out = execFileSync('git', [
      'log', '--no-renames', '--diff-filter=A', '--format=%x00%aI', '--name-only', '--', 'docs/board',
    ], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).toString()
    let date = null
    for (const line of out.split('\n')) {
      if (line.startsWith('\u0000')) { date = line.slice(1).trim(); continue }
      const p = line.trim()
      if (!p || !date || map.has(p)) continue
      map.set(p, date) // newest first, so the first date seen for a path is the live one
    }
  } catch {
    // No git, or a tree with no board history yet: ages fall back to created:.
  }
  addDateCache = { at: now, map }
  return map
}

function daysSince(iso) {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((Date.now() - t) / 86400000))
}

// Days in the current column. An uncommitted card (just created, or moved but
// not committed) has no add record at this path, so it falls back to created:.
function ageOf(card, addDates) {
  const rel = `docs/board/${card.dir}/${card.file}`
  const added = addDates.get(rel)
  const days = daysSince(added) ?? daysSince(card.created)
  return days === null ? null : days
}

// What the aging badge and the age filter actually read: the LARGER of "days in
// this column" and "days since created:". The cards-as-files migration wrote
// every file in one commit, so column age reads 0 board-wide and created: is
// the only clock carrying the real age across the migration; that dominance
// lasts about two weeks, after which accumulated column history takes over on
// its own with no further change here. Owner's purpose is seeing ROT, and rot
// does not reset because the storage format changed (ruled 2026-08-09).
function rotAgeOf(age, cardAge) {
  if (age === null && cardAge === null) return null
  return Math.max(age === null ? 0 : age, cardAge === null ? 0 : cardAge)
}

function listCardFiles(dir) {
  try {
    return readdirSync(cardDirPath(dir)).filter((f) => f.endsWith('.md')).sort()
  } catch {
    return []
  }
}

function sortCards(dir, cards) {
  const byCreated = (a, b) => String(a.created).localeCompare(String(b.created)) || a.id.localeCompare(b.id)
  if (dir === 'ready') {
    return cards.sort((a, b) => {
      const pa = a.priority === null ? Number.MAX_SAFE_INTEGER : a.priority
      const pb = b.priority === null ? Number.MAX_SAFE_INTEGER : b.priority
      return pa - pb || byCreated(a, b)
    })
  }
  // Intake and Done read newest-first; the working columns read oldest-first.
  if (dir === 'intake' || dir === 'done') return cards.sort((a, b) => -byCreated(a, b))
  return cards.sort(byCreated)
}

function readColumn(dir) {
  const cards = listCardFiles(dir).map((f) => readCardFile(dir, f)).filter(Boolean)
  return sortCards(dir, cards)
}

// Locate a card by id anywhere in the tree. Returns null if it is gone (moved
// or deleted by another session), which callers surface as a 409.
function findCard(id) {
  if (!id || /[\\/]/.test(id) || id.startsWith('.')) return null
  for (const dir of COLUMN_DIRS) {
    const file = `${id}.md`
    if (existsSync(join(cardDirPath(dir), file))) return readCardFile(dir, file)
  }
  return null
}

function stale(msg) {
  const err = new Error(msg || 'Card changed on disk. Please reload.')
  err.status = 409
  return err
}

// id + the hash the client last saw. Mismatch = someone else wrote the card.
function requireCard(id, raw) {
  const card = findCard(id)
  if (!card) throw stale('Card not found. The board may have changed -- please reload.')
  if (raw && raw !== card.raw) throw stale('Card changed on disk -- please reload.')
  return card
}

function slugify(title) {
  const base = String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
  return base || 'card'
}

function uniqueSlug(title) {
  const base = slugify(title)
  let slug = base
  let n = 2
  while (findCard(slug)) slug = `${base}-${n++}`
  return slug
}

function writeCard(path, fm, text, images) {
  const content = serializeCard(fm, text, images)
  writeFileSync(path, content)
  return hashOf(content)
}

// Rewrite ONLY the frontmatter block and leave the body bytes untouched. A
// reorder or a type change must not reflow a body nobody edited.
function replaceFrontmatter(content, fm) {
  const block = serializeFrontmatter(fm)
  const lines = String(content).split('\n')
  if (lines[0] !== '---') return `${block}\n${content}`
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { end = i; break }
  }
  if (end === -1) return `${block}\n${content}`
  return [block, ...lines.slice(end + 1)].join('\n')
}

function writeFrontmatterOnly(card, fm) {
  const content = replaceFrontmatter(card.content, fm)
  writeFileSync(card.path, content)
  return hashOf(content)
}

// The frontmatter the BOARD may write. Everything else on a card (id, created,
// tags, after, doc) stays the sessions' business, so a stray click can never
// break card identity or dependency wiring.
const SIZES = ['XS', 'S', 'M', 'L']
const EDITABLE_FM = {
  owner: (v) => (OWNERS.includes(v) ? v : null),
  type: (v) => (TYPES.includes(v) ? v : null),
  size: (v) => (SIZES.includes(v.toUpperCase()) ? v.toUpperCase() : null),
  lane: (v) => (/^[A-Za-z0-9][A-Za-z0-9/_-]{0,59}$/.test(v) ? v.toLowerCase() : null),
  priority: (v) => (/^-?\d{1,6}$/.test(v) ? Number(v) : null),
}

// '' clears the key, which is how the UI offers "not stated" (the normal state
// for type/size/lane). An out-of-enum value is a 400, never a silent no-op.
function applyFmPatch(fm, patch) {
  const out = { ...fm }
  for (const key of Object.keys(patch || {})) {
    if (!Object.prototype.hasOwnProperty.call(EDITABLE_FM, key)) {
      const err = new Error(`frontmatter key not editable from the board: ${key}`)
      err.status = 400
      throw err
    }
    const given = patch[key] === null || patch[key] === undefined ? '' : String(patch[key]).trim()
    if (given === '') { delete out[key]; continue }
    const val = EDITABLE_FM[key](given)
    if (val === null) {
      const err = new Error(`invalid ${key}: ${given}`)
      err.status = 400
      throw err
    }
    out[key] = val
  }
  return out
}

function parseFileMode() {
  const addDates = addDatesByPath()
  const cols = COLUMNS.map(([heading, label, dir]) => ({
    heading,
    label,
    present: existsSync(cardDirPath(dir)),
    items: readColumn(dir).map((c) => ({
      id: c.id,
      raw: c.raw,
      done: c.done,
      text: c.text,
      title: c.title,
      desc: c.desc,
      lane: c.lane,
      badges: c.badges,
      images: c.images,
      // V2 facts. Absent type/size/lane/owner is the NORMAL case (migration
      // derived type only where the marker was explicit), so every consumer
      // treats '' as "not stated", never as an error.
      owner: c.owner,
      type: c.type,
      size: c.size,
      doc: c.doc,
      created: c.created,
      priority: c.priority,
      age: ageOf(c, addDates),
      cardAge: daysSince(c.created),
      rotAge: rotAgeOf(ageOf(c, addDates), daysSince(c.created)),
    })),
  }))
  return { cols, raw: [] }
}

function parseLegacy() {
  const text = readFileSync(BOARD, 'utf8')
  const lines = text.split('\n')
  const sections = {}
  let current = null
  lines.forEach((line, i) => {
    const h = line.match(/^## (.+)$/)
    if (h) {
      current = h[1].trim()
      sections[current] = { start: i, items: [] }
      return
    }
    if (current && /^- \[[ x]\] /.test(line)) {
      sections[current].items.push({ line: i, text: line })
    }
  })
  const cols = COLUMNS.map(([heading, label]) => ({
    heading,
    label,
    present: heading in sections,
    items: (sections[heading]?.items ?? []).map((it) => {
      const { cleanLine, images } = extractImageRefs(it.text)
      const rawText = cleanLine.replace(/^- \[[ x]\] /, '')
      const { title, desc } = splitTitleDesc(rawText)
      return {
        id: String(it.line),
        // Raw line travels with move requests so the server can relocate the
        // card by content if line numbers went stale between render and drop.
        raw: it.text,
        done: it.text.startsWith('- [x]'),
        text: rawText,
        title,
        desc,
        lane: (it.text.match(/Lane: ([a-z-]+)/i)?.[1] ?? '').toLowerCase(),
        badges: parseBadges(rawText),
        images,
      }
    }),
  }))
  return { cols, raw: lines }
}

function parse() {
  return fileMode() ? parseFileMode() : parseLegacy()
}

function gitDirty() {
  const paths = fileMode()
    ? ['docs/board', 'docs/board-assets']
    : ['docs/backlog.md', 'docs/board-assets']
  try {
    const out = execFileSync('git', ['status', '--porcelain', '--', ...paths], {
      cwd: ROOT,
      // Quiet stderr: this runs on the 2s poll, and any git warning would spam
      // the server log. Adopted 2026-08-09 from kb-course's local patch.
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString()
    return out.trim().length > 0
  } catch {
    return false
  }
}

// Rewrite the file moving one item (plus its indented continuation lines,
// e.g. sub-bullets) into another section, appended after that section's last
// item or right after its heading + any prose.
function moveItemLegacy(fromLine, rawText, toHeading, makeDone) {
  const lines = readFileSync(BOARD, 'utf8').split('\n')
  const isItem = (l) => /^- \[[ x]\] /.test(l ?? '')

  // Line numbers go stale if the file changed between render and drop
  // (another session committing, an editor save). Verify the line still
  // holds the expected text; if not, relocate the card by content. Only a
  // unique content match is safe to act on.
  let idx = fromLine
  if (!isItem(lines[idx]) || (rawText && lines[idx] !== rawText)) {
    const matches = []
    lines.forEach((l, i) => {
      if (rawText && l === rawText) matches.push(i)
    })
    if (matches.length !== 1) throw new Error('stale board, refresh')
    idx = matches[0]
  }

  // Sub-bullets and notes are indented lines immediately below the item;
  // they belong to the card and must move with it.
  let end = idx + 1
  while (end < lines.length && /^\s+\S/.test(lines[end])) end++
  const block = lines.splice(idx, end - idx)

  if (makeDone === true) block[0] = block[0].replace(/^- \[ \] /, '- [x] ')
  if (makeDone === false) block[0] = block[0].replace(/^- \[x\] /, '- [ ] ')

  let headingIdx = lines.findIndex((l) => l.trim() === `## ${toHeading}`)
  if (headingIdx === -1) {
    // Create the section (Done starts life this way) before the final newline.
    lines.push('', `## ${toHeading}`, '')
    headingIdx = lines.findIndex((l) => l.trim() === `## ${toHeading}`)
  }
  // Insert after the last item in the section (including its continuation
  // lines), or after the heading block.
  let insertAt = headingIdx + 1
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) break
    if (isItem(lines[i]) || /^\s+\S/.test(lines[i])) insertAt = i + 1
    else if (lines[i].trim() !== '' && insertAt === headingIdx + 1) insertAt = i + 1
  }
  lines.splice(insertAt, 0, ...block)
  writeFileSync(BOARD, lines.join('\n'))
}

// File mode: the move IS the file move. Content is not compared, because a
// card whose text changed under you is still the card you meant to move; only
// a card that has vanished is a genuine 409.
function moveItemFile(id, toHeading) {
  const dir = DIR_BY_HEADING.get(toHeading)
  if (!dir) throw new Error(`unknown column: ${toHeading}`)
  const card = requireCard(id, null)
  if (card.dir === dir) return
  mkdirSync(cardDirPath(dir), { recursive: true })
  const target = join(cardDirPath(dir), card.file)
  if (existsSync(target)) throw stale('A card with that id already exists in the target column.')
  // Ready is the one column where order is signal: an arriving card without a
  // priority lands at the bottom rather than silently jumping the queue.
  if (dir === 'ready' && card.priority === null) {
    const maxPriority = readColumn('ready')
      .reduce((m, c) => (c.priority === null ? m : Math.max(m, c.priority)), 0)
    writeCard(card.path, { ...card.fm, priority: maxPriority + 10 }, card.text, card.images)
  }
  renameSync(card.path, target)
}

function moveItem(fromLine, rawText, toHeading, makeDone, id) {
  if (fileMode()) return moveItemFile(id, toHeading)
  return moveItemLegacy(fromLine, rawText, toHeading, makeDone)
}

function addItemLegacy(text, toHeading) {
  const clean = text.replace(/—/g, ',').trim()
  if (!clean) throw new Error('empty')
  const lines = readFileSync(BOARD, 'utf8').split('\n')
  // Default to Unsorted intake if heading not specified
  const heading = toHeading || 'Unsorted intake'
  let headingIdx = lines.findIndex((l) => l.trim() === `## ${heading}`)
  if (headingIdx === -1) throw new Error('section missing')
  let insertAt = headingIdx + 1
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) break
    if (lines[i].trim() !== '') insertAt = i + 1
  }
  const today = new Date().toISOString().slice(0, 10)
  const rawLine = `- [ ] ${clean} (captured ${today} via board)`
  lines.splice(insertAt, 0, rawLine)
  writeFileSync(BOARD, lines.join('\n'))
  // Return the created raw line so callers (e.g. the modal composer) can
  // reliably attach images against it without re-scanning the board.
  return rawLine
}

function addItemFile(text, toHeading, fmPatch) {
  const clean = String(text).replace(/—/g, ',').trim()
  if (!clean) throw new Error('empty')
  const dir = DIR_BY_HEADING.get(toHeading)
  if (!dir) throw new Error('section missing')
  const firstLine = clean.split('\n')[0].trim()
  const id = uniqueSlug(firstLine)
  const today = new Date().toISOString().slice(0, 10)
  let fm = { id, created: today }
  if (dir === 'ready') {
    const maxPriority = readColumn('ready')
      .reduce((m, c) => (c.priority === null ? m : Math.max(m, c.priority)), 0)
    fm.priority = maxPriority + 10
  }
  // The structured composer sends owner/type/size; each one is optional and is
  // simply absent when the owner left the select on "not stated".
  if (fmPatch && Object.keys(fmPatch).length) fm = applyFmPatch(fm, fmPatch)
  mkdirSync(cardDirPath(dir), { recursive: true })
  const raw = writeCard(join(cardDirPath(dir), `${id}.md`), fm, clean, [])
  return { id, raw }
}

// Returns { id, raw } so the modal composer can attach images to the card it
// just created without re-scanning the board.
function addItem(text, toHeading, fmPatch) {
  if (fileMode()) return addItemFile(text, toHeading, fmPatch)
  if (fmPatch && Object.keys(fmPatch).length) {
    // Legacy cards are single lines with no frontmatter: silently dropping the
    // fields would look like they saved. The V2 composer only sends them in
    // file mode, so this is a contract guard, not a path the UI can reach.
    const err = new Error('card fields need the cards-as-files board (docs/board/)')
    err.status = 400
    throw err
  }
  return { id: null, raw: addItemLegacy(text, toHeading) }
}

// Edit an existing card line in-place. Locates by rawLine (verbatim match).
// Returns { ok: true } or throws with a message.
function editItemLegacy(rawLine, newText) {
  if (!rawLine) throw new Error('rawLine required')
  if (!newText || !newText.trim()) throw new Error('text cannot be empty')
  const lines = readFileSync(BOARD, 'utf8').split('\n')
  const matches = []
  lines.forEach((l, i) => { if (l === rawLine) matches.push(i) })
  if (matches.length === 0) {
    const err = new Error('Card not found verbatim. The board may have changed -- please reload.')
    err.status = 409
    throw err
  }
  if (matches.length > 1) {
    const err = new Error('Ambiguous match (multiple identical lines). Please reload.')
    err.status = 409
    throw err
  }
  const idx = matches[0]
  // Preserve the checkbox state ([ ] or [x]) from the original line
  const checkboxMatch = lines[idx].match(/^- \[([ x])\] /)
  const checkbox = checkboxMatch ? checkboxMatch[1] : ' '
  // Preserve existing image refs from the original line
  const { images } = extractImageRefs(lines[idx])
  // Strip any leading "- [ ] " or "- [x] " from newText in case user included it
  const cleanNew = newText.trim().replace(/^- \[[ x]\] /, '')
  const imgSuffix = images.length > 0 ? ' ' + images.map(p => `![shot](${p})`).join(' ') : ''
  lines[idx] = `- [${checkbox}] ${cleanNew}${imgSuffix}`
  writeFileSync(BOARD, lines.join('\n'))
}

// newText === null is a frontmatter-only edit (a type chip changed, a reorder):
// the body is left byte-identical rather than round-tripped through the editor
// shape. Returns the fresh content hash so a client can keep editing.
function editItemFile(id, raw, newText, fmPatch) {
  const textGiven = newText !== null && newText !== undefined
  if (textGiven && !String(newText).trim()) throw new Error('text cannot be empty')
  const card = requireCard(id, raw)
  const fm = fmPatch && Object.keys(fmPatch).length ? applyFmPatch(card.fm, fmPatch) : card.fm
  if (!textGiven) return writeFrontmatterOnly(card, fm)
  // Attachments are not shown in the editor, so they are preserved here rather
  // than being silently dropped by a body rewrite. Same rule as legacy mode.
  const { cleanLine } = extractImageRefs(String(newText))
  return writeCard(card.path, fm, cleanLine.trim(), card.images)
}

function editItem(rawLine, newText, id, fmPatch) {
  if (fileMode()) return editItemFile(id, rawLine, newText, fmPatch)
  if (fmPatch && Object.keys(fmPatch).length) {
    const err = new Error('card fields need the cards-as-files board (docs/board/)')
    err.status = 400
    throw err
  }
  return editItemLegacy(rawLine, newText)
}

// Ready is the one column where ORDER is signal, so a drag inside it must
// change exactly ONE card: the moved one takes a priority midway between its
// new neighbours. `prevId`/`nextId` are the cards the drop landed between, as
// the client saw them. Only when that gap is used up does the column get
// restated at 10, 20, 30..., which buys the next hundred drags a single-file
// write each. A drop at the very top walks below 10 (0, -10, ...) rather than
// renumbering 100 files for the most common promote-to-top gesture.
function reorderReady(id, prevId, nextId) {
  if (!fileMode()) {
    const err = new Error('reorder needs the cards-as-files board (docs/board/)')
    err.status = 400
    throw err
  }
  const card = requireCard(id, null)
  if (card.dir !== 'ready') {
    const err = new Error('reorder applies to Ready only')
    err.status = 400
    throw err
  }
  const rest = readColumn('ready').filter((c) => c.id !== card.id)
  const prevIdx = prevId ? rest.findIndex((c) => c.id === prevId) : -1
  const nextIdx = nextId ? rest.findIndex((c) => c.id === nextId) : -1
  if (prevId && prevIdx === -1) throw stale('The card above the drop is gone -- please reload.')
  if (nextId && nextIdx === -1) throw stale('The card below the drop is gone -- please reload.')
  const at = prevIdx >= 0 ? prevIdx + 1 : (nextIdx >= 0 ? nextIdx : rest.length)
  const prev = at > 0 ? rest[at - 1] : null
  const next = at < rest.length ? rest[at] : null
  const pp = prev ? prev.priority : null
  const np = next ? next.priority : null

  let target = null
  if (prev && pp === null) target = null            // an unnumbered neighbour has no gap to split
  else if (!prev && !next) target = 10
  else if (!prev) target = np - 10
  else if (!next || np === null) target = pp + 10
  else if (np - pp >= 2) target = Math.floor((pp + np) / 2)

  if (target !== null && (pp === null || target > pp) && (np === null || target < np)) {
    const fresh = writeFrontmatterOnly(card, { ...card.fm, priority: target })
    return { renumbered: 0, priority: target, raw: fresh }
  }

  const order = [...rest]
  order.splice(at, 0, card)
  let p = 10
  let renumbered = 0
  for (const c of order) {
    if (c.priority !== p) {
      writeFrontmatterOnly(c, { ...c.fm, priority: p })
      renumbered++
    }
    p += 10
  }
  return { renumbered, priority: null, raw: null }
}

// Read-only per-card history. --follow crosses the migration rename, so a
// migrated card still shows the commit that created it as a file.
function cardHistory(id) {
  if (!fileMode()) {
    const err = new Error('history needs the cards-as-files board (docs/board/)')
    err.status = 400
    throw err
  }
  const card = findCard(id)
  if (!card) throw stale('Card not found -- please reload.')
  const rel = `docs/board/${card.dir}/${card.file}`
  try {
    const out = execFileSync('git', [
      'log', '--follow', '-n', '50', '--format=%x00%aI%x1f%h%x1f%s', '--', rel,
    ], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 8 * 1024 * 1024 }).toString()
    return out.split('\u0000').map((s) => s.trim()).filter(Boolean).map((entry) => {
      const [date, sha, subject] = entry.split('\u001f')
      return { date: String(date || '').slice(0, 10), sha: sha || '', subject: subject || '' }
    })
  } catch {
    return [] // uncommitted card, or no git here at all
  }
}

// Delete a card line. Locates by rawLine (verbatim match).
function deleteItemLegacy(rawLine) {
  if (!rawLine) throw new Error('rawLine required')
  const lines = readFileSync(BOARD, 'utf8').split('\n')
  const matches = []
  lines.forEach((l, i) => { if (l === rawLine) matches.push(i) })
  if (matches.length === 0) {
    const err = new Error('Card not found verbatim. The board may have changed -- please reload.')
    err.status = 409
    throw err
  }
  if (matches.length > 1) {
    const err = new Error('Ambiguous match (multiple identical lines). Please reload.')
    err.status = 409
    throw err
  }
  const idx = matches[0]
  // Also remove any continuation/sub-bullet lines
  let end = idx + 1
  while (end < lines.length && /^\s+\S/.test(lines[end])) end++
  lines.splice(idx, end - idx)
  writeFileSync(BOARD, lines.join('\n'))
}

function deleteItemFile(id, raw) {
  const card = requireCard(id, raw)
  unlinkSync(card.path)
}

function deleteItem(rawLine, id) {
  if (fileMode()) return deleteItemFile(id, rawLine)
  return deleteItemLegacy(rawLine)
}

// Attach an image to a card. Verifies the raw line exists, writes the file,
// appends the ref. Returns the new image path.
function decodeImage(mime, dataB64) {
  if (!MIME_TO_EXT[mime]) {
    const err = new Error('Unsupported image type: ' + mime)
    err.status = 400
    throw err
  }
  const buf = Buffer.from(dataB64, 'base64')
  if (buf.length > MAX_BYTES) {
    const err = new Error('Image too large (max 5 MB)')
    err.status = 400
    throw err
  }
  return buf
}

function attachImageLegacy(rawLine, name, mime, dataB64) {
  const buf = decodeImage(mime, dataB64)

  const lines = readFileSync(BOARD, 'utf8').split('\n')
  const matches = []
  lines.forEach((l, i) => { if (l === rawLine) matches.push(i) })
  if (matches.length === 0) {
    const err = new Error('Card not found verbatim. The board may have changed -- please reload.')
    err.status = 409
    throw err
  }
  if (matches.length > 1) {
    const err = new Error('Ambiguous match (multiple identical lines). Please reload.')
    err.status = 409
    throw err
  }
  const idx = matches[0]

  const fileName = genAssetName(mime)
  const filePath = join(ASSETS_DIR, fileName)
  const relPath = `docs/board-assets/${fileName}`

  writeFileSync(filePath, buf)

  lines[idx] = lines[idx].trimEnd() + ` ![shot](${relPath})`
  writeFileSync(BOARD, lines.join('\n'))

  // The updated token goes back to the client so a multi-image attach loop
  // never has to reconstruct it by hand.
  return { path: relPath, raw: lines[idx] }
}

function attachImageFile(id, raw, mime, dataB64) {
  const buf = decodeImage(mime, dataB64)
  const card = requireCard(id, raw)
  const fileName = genAssetName(mime)
  const relPath = `docs/board-assets/${fileName}`
  writeFileSync(join(ASSETS_DIR, fileName), buf)
  const newRaw = writeCard(card.path, card.fm, card.text, [...card.images, relPath])
  return { path: relPath, raw: newRaw }
}

function attachImage(rawLine, name, mime, dataB64, id) {
  if (fileMode()) return attachImageFile(id, rawLine, mime, dataB64)
  return attachImageLegacy(rawLine, name, mime, dataB64)
}

// Remove an image attachment from a card.
// Verifies the raw line, removes the ref from the line, deletes the file.
function assetAbsPath(imagePath) {
  if (!imagePath) throw new Error('imagePath required')
  // Must be under docs/board-assets/ and must not escape it.
  if (!imagePath.startsWith('docs/board-assets/')) {
    const err = new Error('Invalid image path')
    err.status = 400
    throw err
  }
  const absPath = resolve(ROOT, imagePath)
  if (!absPath.startsWith(ASSETS_DIR + '/')) {
    const err = new Error('Path traversal rejected')
    err.status = 400
    throw err
  }
  return absPath
}

function removeAttachmentLegacy(rawLine, imagePath) {
  if (!rawLine) throw new Error('rawLine required')
  const absPath = assetAbsPath(imagePath)

  const lines = readFileSync(BOARD, 'utf8').split('\n')
  const matches = []
  lines.forEach((l, i) => { if (l === rawLine) matches.push(i) })
  if (matches.length === 0) {
    const err = new Error('Card not found verbatim. The board may have changed -- please reload.')
    err.status = 409
    throw err
  }
  if (matches.length > 1) {
    const err = new Error('Ambiguous match (multiple identical lines). Please reload.')
    err.status = 409
    throw err
  }
  const idx = matches[0]

  // Remove the specific image ref from the line
  const escapedPath = imagePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const refPattern = new RegExp('\\s*!\\[[^\\]]*\\]\\(' + escapedPath + '\\)', 'g')
  lines[idx] = lines[idx].replace(refPattern, '').trimEnd()
  writeFileSync(BOARD, lines.join('\n'))

  // Delete the file
  if (existsSync(absPath)) {
    try { unlinkSync(absPath) } catch { /* ignore */ }
  }
}

function removeAttachmentFile(id, raw, imagePath) {
  const absPath = assetAbsPath(imagePath)
  const card = requireCard(id, raw)
  writeCard(card.path, card.fm, card.text, card.images.filter((p) => p !== imagePath))
  if (existsSync(absPath)) {
    try { unlinkSync(absPath) } catch { /* ignore */ }
  }
}

function removeAttachment(rawLine, imagePath, id) {
  if (fileMode()) return removeAttachmentFile(id, rawLine, imagePath)
  return removeAttachmentLegacy(rawLine, imagePath)
}

// File mode: keep the 10 newest Done cards in place, move the rest into
// docs/board/archive/<YYYY-MM>/. docs/backlog-archive.md is frozen history and
// is never written again.
function rotateDoneFile() {
  const done = readColumn('done') // newest first
  const KEEP = 10
  if (done.length <= KEEP) return { rotated: 0, kept: done.length }
  const stamp = new Date().toISOString().slice(0, 7)
  const targetDir = join(BOARD_DIR, 'archive', stamp)
  mkdirSync(targetDir, { recursive: true })
  const toArchive = done.slice(KEEP)
  for (const card of toArchive) {
    let target = join(targetDir, card.file)
    let n = 2
    while (existsSync(target)) target = join(targetDir, `${card.id}-${n++}.md`)
    renameSync(card.path, target)
  }
  return { rotated: toArchive.length, kept: KEEP }
}

// Rotate Done cards: keep the 10 most recent, move the rest to docs/backlog-archive.md
// Prepends the rotated cards under a dated heading in the archive.
function rotateDoneLegacy() {
  const lines = readFileSync(BOARD, 'utf8').split('\n')
  const isItem = (l) => /^- \[[ x]\] /.test(l ?? '')
  const doneHeading = 'Done (recent)'
  const headingIdx = lines.findIndex((l) => l.trim() === `## ${doneHeading}`)
  if (headingIdx === -1) throw new Error('Done section not found')

  // Collect all done items (with their continuation lines)
  const doneItems = [] // array of { startIdx, lines: string[] }
  let i = headingIdx + 1
  while (i < lines.length) {
    if (/^## /.test(lines[i])) break
    if (isItem(lines[i])) {
      const block = [lines[i]]
      let j = i + 1
      while (j < lines.length && /^\s+\S/.test(lines[j])) {
        block.push(lines[j])
        j++
      }
      doneItems.push({ startIdx: i, lines: block })
      i = j
    } else {
      i++
    }
  }

  const KEEP = 10
  if (doneItems.length <= KEEP) return { rotated: 0, kept: doneItems.length }

  // Items to archive = everything beyond the first KEEP (oldest items at bottom of done)
  const toArchive = doneItems.slice(KEEP)

  // Remove them from the backlog (remove from bottom to top to keep indices valid)
  const archiveBlocks = []
  for (let k = toArchive.length - 1; k >= 0; k--) {
    const item = toArchive[k]
    // Find current index in lines (may have shifted; find by content)
    const firstLine = item.lines[0]
    const idx = lines.findIndex((l) => l === firstLine)
    if (idx === -1) continue
    // Remove block
    let end = idx + 1
    while (end < lines.length && /^\s+\S/.test(lines[end])) end++
    const removed = lines.splice(idx, end - idx)
    archiveBlocks.unshift(...removed)
  }

  writeFileSync(BOARD, lines.join('\n'))

  // Prepend to archive file
  const today = new Date().toISOString().slice(0, 10)
  let archiveText = ''
  try {
    archiveText = readFileSync(ARCHIVE, 'utf8')
  } catch {
    archiveText = '# Backlog archive\n\nClosed cards rotated off `docs/backlog.md`.\n'
  }

  // Insert after the first heading (header block)
  const archiveLines = archiveText.split('\n')
  const firstH2 = archiveLines.findIndex((l) => /^## /.test(l))
  const insertPoint = firstH2 === -1 ? archiveLines.length : firstH2
  const section = ['', `## Rotated ${today}`, '', ...archiveBlocks, '']
  archiveLines.splice(insertPoint, 0, ...section)
  writeFileSync(ARCHIVE, archiveLines.join('\n'))

  return { rotated: toArchive.length, kept: KEEP }
}

function rotateDone() {
  return fileMode() ? rotateDoneFile() : rotateDoneLegacy()
}

// One-file snapshot of the whole board, rendered on demand. Never committed:
// a checked-in generated index would recreate the single-file merge hotspot
// that per-card files exist to remove.
function renderIndex() {
  const { cols } = parse()
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const out = [
    `# ${TITLE} board snapshot`,
    '',
    `Generated ${stamp} by \`npm run board:index\`. NOT the source of truth and never committed: ` +
      (fileMode() ? 'the board lives in `docs/board/`.' : 'the board lives in `docs/backlog.md`.'),
    '',
  ]
  for (const col of cols) {
    out.push(`## ${col.heading} (${col.items.length})`, '')
    for (const it of col.items) {
      // A migrated card's body is the original one-line card verbatim, so it
      // already opens with the derived title (minus the "@agent" tag, which
      // moved to frontmatter). Print the body alone in that case rather than
      // doubling the title.
      const stem = it.title.replace(/…$/, '').trim()
      const flat = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean).join(' ')
      const descStem = it.desc.replace(/^@(?:claude|codex|owner)\s+/i, '')
      const body = it.desc && stem && descStem.startsWith(stem)
        ? flat(it.desc)
        : flat(it.text)
      out.push(`- [${it.done ? 'x' : ' '}] ${body}`)
    }
    out.push('')
  }
  return out.join('\n')
}

function commit() {
  const run = (args) => execFileSync('git', args, { cwd: ROOT }).toString()
  run(['add', fileMode() ? 'docs/board' : 'docs/backlog.md', 'docs/board-assets'])
  try {
    // Trailer derives from the board title so the one canonical server file
    // deploys to any project without carrying another project's identity.
    const trailer = process.env.BOARD_COMMIT_TRAILER || `Co-Authored-By: ${TITLE} board <board@${TITLE.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}.local>`
    run(['commit', '-m', `docs(board): board update\n\n${trailer}`])
  } catch {
    return { ok: false, msg: 'nothing to commit' }
  }
  try {
    run(['pull', '--rebase', '--autostash'])
    run(['push'])
    return { ok: true, msg: 'committed and pushed' }
  } catch (e) {
    return { ok: false, msg: 'committed locally; push failed (another session mid-operation?). Retry in a moment.' }
  }
}

// V2 UI is FILE MODE ONLY. Legacy single-file projects (every sibling that has
// not migrated) get exactly the markup and behavior they had before: the extra
// controls are not rendered, and the client's V2 branches are gated on the same
// flag. One canonical server, two honest surfaces.
const V2 = fileMode()
const opts = (vals, none) =>
  `<option value="">${none}</option>` + vals.map((v) => `<option value="${v}">${v}</option>`).join('')

const V2_FILTER_ROW = V2 ? `
<div id="v2filters">
  <select id="fType" title="Filter by card type">${opts(TYPES, 'type: any')}</select>
  <select id="fOwner" title="Filter by owner">${opts(OWNERS, 'owner: any')}</select>
  <select id="fAge" title="Filter by age: the older of days-in-column and days-since-created">
    <option value="">age: any</option>
    <option value="14">14 days+</option>
    <option value="30">30 days+</option>
  </select>
  <button id="waitingBtn" title="Every card waiting on you, from any column (w)">&#9679; Waiting on you</button>
  <button id="clearFilters" title="Clear filters (Esc)">clear</button>
  <span id="filterNote"></span>
</div>` : ''

const V2_COMPOSER_FIELDS = V2 ? `
      <div>
        <label class="modal-label" for="modalTitle">Title (required, this is all a column shows)</label>
        <input id="modalTitle" class="text title" placeholder="What is this card, in one line" autocomplete="off" spellcheck="false"/>
      </div>
      <div>
        <label class="modal-label" for="modalText">Body (optional, as long as it needs to be)</label>
        <textarea id="modalText" placeholder="Context that makes it startable cold." autocomplete="off" spellcheck="false"></textarea>
      </div>
      <div class="field-row">
        <div>
          <label class="modal-label" for="modalType">Type</label>
          <select id="modalType" class="text">${opts(TYPES, 'not stated')}</select>
        </div>
        <div>
          <label class="modal-label" for="modalOwner">Owner</label>
          <select id="modalOwner" class="text">${opts(OWNERS, 'not stated')}</select>
        </div>
      </div>` : `
      <div>
        <label class="modal-label" for="modalText">Card line (title, then details on one line)</label>
        <textarea id="modalText" placeholder="Short title. Then any details after a period, colon, or dash..." autocomplete="off" spellcheck="false"></textarea>
      </div>`

const V2_MODALS = V2 ? `
<div id="detail-overlay" class="v2-overlay">
  <div class="modal wide" role="dialog" aria-modal="true" aria-label="Card detail">
    <div class="modal-head">
      <div style="min-width:0">
        <h2 id="detailTitle" style="font-size:15px; letter-spacing:0; text-transform:none; font-family:inherit; color:var(--txt); line-height:1.4;"></h2>
        <div class="modal-sub" id="detailSub"></div>
      </div>
      <button class="modal-close" id="detailClose" title="Close (Esc)">&times;</button>
    </div>
    <div class="modal-body">
      <div class="facts" id="detailFacts"></div>
      <div class="detail-body" id="detailBody"></div>
      <div id="detailImages" class="card-images"></div>
      <div class="detail-sec">
        <h3>History</h3>
        <div class="hist" id="detailHistory"></div>
      </div>
    </div>
    <div class="modal-foot">
      <span class="modal-hint"><kbd>Esc</kbd> closes. History is git, read-only.</span>
      <div class="modal-actions">
        <select id="detailMove" class="text" style="width:auto" title="Move to column"></select>
        <button id="detailKickoff">Copy kickoff</button>
        <button id="detailEdit" style="background:var(--cyan); color:#08080c; border:0; font-weight:700; padding:7px 16px; cursor:pointer; font:inherit; font-size:12px;">Edit</button>
      </div>
    </div>
  </div>
</div>

<div id="edit-overlay" class="v2-overlay">
  <div class="modal wide" role="dialog" aria-modal="true" aria-label="Edit card">
    <div class="modal-head">
      <h2>Edit card</h2>
      <button class="modal-close" id="editClose" title="Close (Esc)">&times;</button>
    </div>
    <div class="modal-body">
      <div>
        <label class="modal-label" for="editTitle">Title</label>
        <input id="editTitle" class="text title" autocomplete="off" spellcheck="false"/>
      </div>
      <div>
        <label class="modal-label" for="editBody">Body</label>
        <textarea id="editBody" class="text" spellcheck="false"></textarea>
      </div>
      <div class="field-row">
        <div>
          <label class="modal-label" for="editType">Type</label>
          <select id="editType" class="text">${opts(TYPES, 'not stated')}</select>
        </div>
        <div>
          <label class="modal-label" for="editOwner">Owner</label>
          <select id="editOwner" class="text">${opts(OWNERS, 'not stated')}</select>
        </div>
        <div>
          <label class="modal-label" for="editSize">Size</label>
          <select id="editSize" class="text">${opts(SIZES, 'not stated')}</select>
        </div>
      </div>
      <div class="field-row">
        <div>
          <label class="modal-label" for="editLane">Lane</label>
          <input id="editLane" class="text" placeholder="not stated" autocomplete="off" spellcheck="false"/>
        </div>
        <div>
          <label class="modal-label" for="editPriority">Priority (Ready order, lower first)</label>
          <input id="editPriority" class="text" placeholder="not stated" autocomplete="off" spellcheck="false"/>
        </div>
      </div>
    </div>
    <div class="modal-foot">
      <span class="modal-hint" id="editHint">Saves against the copy you opened. <kbd>Cmd</kbd>+<kbd>Enter</kbd> to save.</span>
      <div class="modal-actions">
        <button id="editCancel">Cancel</button>
        <button id="editSave" style="background:var(--cyan); color:#08080c; border:0; font-weight:700; padding:7px 16px; cursor:pointer; font:inherit; font-size:12px;">Save</button>
      </div>
    </div>
  </div>
</div>

<div id="digest-overlay" class="v2-overlay">
  <div class="modal wide" role="dialog" aria-modal="true" aria-label="Waiting on you">
    <div class="modal-head">
      <div>
        <h2>Waiting on you</h2>
        <div class="modal-sub" id="digestSub"></div>
      </div>
      <button class="modal-close" id="digestClose" title="Close (Esc)">&times;</button>
    </div>
    <div class="modal-body" id="digestList"></div>
    <div class="modal-foot">
      <span class="modal-hint">The Waiting-on-owner column plus every card owned by you, anywhere.</span>
      <div class="modal-actions"><button id="digestDone">Close</button></div>
    </div>
  </div>
</div>` : ''

const HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${TITLE} &middot; Board</title>
<style>
  :root { --bg:#0b0b0f; --panel:#121218; --line:rgba(255,255,255,.09); --txt:#e8e8e6;
          --dim:rgba(255,255,255,.55); --cyan:#08c5ce; --amber:#f0b429;
          --red:#f04f4f; --green:#0e9f6e; --purple:#7c5ce0; --blue:#2563eb; }
  * { box-sizing:border-box; margin:0; }
  body { background:var(--bg); color:var(--txt);
         font:14px/1.45 -apple-system,'Inter',system-ui,sans-serif;
         display:flex; flex-direction:column; height:100vh; overflow:hidden; }
  header { display:flex; align-items:center; gap:10px; padding:10px 16px;
           border-bottom:1px solid var(--line); position:sticky; top:0; background:var(--bg); z-index:10;
           flex-wrap:wrap; flex:0 0 auto; }
  header h1 { font-size:12px; letter-spacing:.18em; text-transform:uppercase;
              font-family:ui-monospace,monospace; font-weight:600; white-space:nowrap; }
  header .sq { display:inline-flex; gap:3px; flex-shrink:0; }
  header .sq i { width:7px; height:7px; display:block; }

  /* Search + filter bar */
  #toolbar { display:flex; gap:8px; flex:1; min-width:0; align-items:center; flex-wrap:wrap; }
  #search { flex:1; min-width:140px; max-width:280px; background:var(--panel);
            border:1px solid var(--line); color:var(--txt); padding:7px 10px;
            font:inherit; font-size:12px; }
  #search::placeholder { color:var(--dim); }
  #search:focus { outline:1px solid var(--cyan); }
  .filter-btns { display:flex; gap:4px; flex-wrap:wrap; }
  .filter-btn { background:transparent; border:1px solid var(--line); color:var(--dim);
                padding:4px 8px; cursor:pointer; font:inherit; font-size:10px;
                letter-spacing:.1em; text-transform:uppercase; font-family:ui-monospace,monospace;
                transition:all .15s; }
  .filter-btn:hover { border-color:var(--dim); color:var(--txt); }
  .filter-btn.active { color:#08080c; border-color:transparent; }
  .filter-btn[data-tag="in-flight"].active { background:#08c5ce; }
  .filter-btn[data-tag="blocked"].active { background:var(--red); }
  .filter-btn[data-tag="discussion"].active { background:var(--purple); }
  .filter-btn[data-tag="time-gated"].active { background:var(--amber); }
  .filter-btn[data-tag="needs"].active { background:#6b7280; }

  /* Quick-add row */
  #add-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  #addText { flex:1; min-width:180px; max-width:420px; background:var(--panel);
             border:1px solid var(--line); color:var(--txt); padding:7px 10px; font:inherit; font-size:12px; }
  #addText::placeholder { color:var(--dim); }
  #addText:focus { outline:1px solid var(--cyan); }
  #addCol { background:var(--panel); border:1px solid var(--line); color:var(--txt);
            padding:7px 10px; font:inherit; font-size:12px; cursor:pointer; }
  #addBtn { background:var(--cyan); color:#08080c; border:0; font-weight:700;
            padding:7px 12px; cursor:pointer; font:inherit; font-size:12px; white-space:nowrap; }
  #addBtn:hover { opacity:.9; }

  /* Right-side controls */
  .header-right { display:flex; align-items:center; gap:8px; margin-left:auto; flex-wrap:wrap; flex-shrink:0; }
  #rotateBtn { background:transparent; border:1px solid var(--line); color:var(--dim);
               padding:7px 12px; cursor:pointer; font:inherit; font-size:11px; white-space:nowrap; }
  #rotateBtn:hover { border-color:var(--dim); color:var(--txt); }
  #commit { background:var(--cyan); color:#08080c; border:0; font-weight:700;
            padding:7px 12px; cursor:pointer; font:inherit; font-size:12px; white-space:nowrap; }
  #commit[disabled] { opacity:.35; cursor:default; }

  /* Responsive header: below ~1024px the search+filter toolbar drops to its
     own full-width row so it never collides with the logo, status, or action
     buttons. The brand (squares + title) and the action buttons stay on row 1. */
  @media (max-width: 1024px) {
    #toolbar { order:3; flex-basis:100%; }
    #search { max-width:none; }
  }
  /* Very narrow: let the action group fall to its own row too, and keep the
     brand title from getting squeezed. */
  @media (max-width: 560px) {
    .header-right { flex-basis:100%; margin-left:0; justify-content:flex-start; }
    header h1 { font-size:11px; letter-spacing:.12em; }
  }
  #status { font-family:ui-monospace,monospace; font-size:11px; color:var(--dim); white-space:nowrap; }
  #status.dirty { color:var(--amber); }

  /* Board layout */
  /* Bound the board to the viewport and scroll columns internally, so the horizontal
     scrollbar stays pinned at the bottom of the viewport (was min-height → grew with cards,
     stranding the x-scrollbar below the fold). */
  main { display:grid; grid-auto-flow:column; grid-auto-columns:minmax(270px,1fr);
         gap:12px; padding:14px 16px 14px; overflow-x:auto; overflow-y:hidden;
         flex:1 1 0; min-height:0; }

  /* Column */
  /* The owner's decision queue must be unmissable (process feedback 2026-06-12). */
  .col-owner { border-top:3px solid #f59e0b; }
  .col-owner .col-label { color:#fbbf24; }
  .col-owner .col-label::after { content:' · needs you'; font-size:10px; letter-spacing:.08em; color:#fbbf24aa; }
  .col { background:var(--panel); border:1px solid var(--line); display:flex;
         flex-direction:column; min-width:0; min-height:0; max-height:100%; }
  .col-header { display:flex; align-items:center; justify-content:space-between;
                padding:9px 12px; border-bottom:1px solid var(--line); gap:8px; cursor:pointer;
                user-select:none; }
  .col-header:hover { background:rgba(255,255,255,.03); }
  .col-label { font-size:10.5px; letter-spacing:.16em; text-transform:uppercase; color:var(--dim);
               font-family:ui-monospace,monospace; }
  .col-meta { display:flex; align-items:center; gap:6px; }
  .col-count { font-family:ui-monospace,monospace; font-size:10px; color:var(--dim);
               background:rgba(255,255,255,.06); padding:2px 6px; }
  .col-toggle { font-size:10px; color:var(--dim); transition:transform .15s; }
  .col.collapsed .col-toggle { transform:rotate(-90deg); }
  .col .cards { padding:10px; display:flex; flex-direction:column; gap:8px; flex:1; min-height:60px; overflow-y:auto; }
  .col.collapsed .cards { display:none; }
  .col.dragover { outline:2px dashed var(--cyan); outline-offset:-4px; }

  /* Cards */
  .card { background:#0e0e14; border:1px solid var(--line); border-left:3px solid var(--cyan);
          padding:9px 11px; font-size:12.5px; cursor:grab; color:var(--txt);
          transition:opacity .1s; position:relative; }
  .card:hover { border-color:rgba(255,255,255,.18); }
  .card.done { opacity:.4; border-left-color:var(--green); }
  .card.filtered-out { display:none; }
  .card.keyboard-focused { outline:2px solid var(--cyan); outline-offset:1px; }
  .card.expanded { cursor:default; }
  .card.img-dragover { outline:2px dashed var(--amber); outline-offset:-2px; }

  /* Card title (collapsed view) */
  .card-title { line-height:1.5; word-break:break-word; }

  /* Card description (expanded view) */
  .card-desc { margin-top:6px; font-size:12px; color:var(--dim); line-height:1.55;
               word-break:break-word; border-top:1px solid var(--line); padding-top:6px; }

  /* Attachment thumbnails */
  .card-images { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
  .card-img-wrap { position:relative; display:inline-block; }
  .card-img-wrap img { height:120px; max-width:160px; object-fit:cover; border-radius:3px;
                       border:1px solid var(--line); cursor:pointer; display:block; }
  .card-img-wrap img:hover { border-color:rgba(255,255,255,.3); }
  .card-img-remove { position:absolute; top:3px; right:3px; background:rgba(15,15,20,.85);
                     border:1px solid rgba(255,255,255,.2); color:var(--dim); width:18px; height:18px;
                     border-radius:2px; cursor:pointer; font-size:11px; line-height:16px;
                     text-align:center; padding:0; display:none; }
  .card-img-wrap:hover .card-img-remove { display:block; }
  .card-img-remove:hover { color:var(--red); border-color:rgba(240,79,79,.5); }

  /* Attachment count badge (collapsed) */
  .attach-badge { display:inline-flex; align-items:center; gap:3px; margin-left:5px;
                  font-family:ui-monospace,monospace; font-size:9px; color:var(--amber);
                  border:1px solid rgba(240,180,41,.3); padding:1px 5px; vertical-align:middle; }

  /* Card actions (edit/delete) - visible on hover or expanded */
  .card-actions { display:none; gap:4px; margin-top:8px; justify-content:flex-end; align-items:center; }
  .card:hover .card-actions,
  .card.expanded .card-actions { display:flex; }
  .card-btn { background:transparent; border:1px solid var(--line); color:var(--dim);
              padding:3px 8px; cursor:pointer; font:inherit; font-size:10px;
              letter-spacing:.08em; text-transform:uppercase; font-family:ui-monospace,monospace;
              transition:all .12s; }
  .card-btn:hover { color:var(--txt); border-color:rgba(255,255,255,.3); }
  .card-btn.delete:hover { color:var(--red); border-color:rgba(240,79,79,.4); }
  .card-btn.expand-toggle { color:rgba(255,255,255,.25); }
  .card-btn.expand-toggle:hover { color:var(--dim); }
  .card-btn.attach { color:var(--amber); border-color:rgba(240,180,41,.3); }
  .card-btn.attach:hover { border-color:rgba(240,180,41,.6); }
  .card-btn.move { color:#a5b4fc; border-color:rgba(165,180,252,.3); }
  .card-btn.move:hover { border-color:rgba(165,180,252,.6); }
  .card-btn.kickoff { color:var(--cyan); border-color:rgba(8,197,206,.3); }
  .card-btn.kickoff:hover { border-color:rgba(8,197,206,.6); }

  /* Inline move menu */
  .card-move-menu { display:none; position:relative; }
  .card-move-menu.open { display:block; }
  .card-move-select { background:#1a1a24; border:1px solid var(--cyan); color:var(--txt);
                      font:inherit; font-size:11px; padding:4px 8px; cursor:pointer;
                      margin-top:4px; width:100%; outline:none; }

  /* Inline edit area */
  .card-edit { display:none; margin-top:8px; }
  .card-edit.active { display:block; }
  .card-edit textarea { width:100%; background:#08080c; border:1px solid var(--cyan);
                        color:var(--txt); font:inherit; font-size:12px; padding:7px 9px;
                        resize:vertical; min-height:72px; outline:none; }
  .card-edit-actions { display:flex; gap:6px; margin-top:5px; justify-content:flex-end; }
  .card-edit-save { background:var(--cyan); color:#08080c; border:0; font-weight:700;
                    padding:4px 10px; cursor:pointer; font:inherit; font-size:11px; }
  .card-edit-cancel { background:transparent; border:1px solid var(--line); color:var(--dim);
                      padding:4px 10px; cursor:pointer; font:inherit; font-size:11px; }

  /* Badges row */
  .card-badges { display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; }
  .badge { display:inline-block; font-family:ui-monospace,monospace; font-size:9px;
           letter-spacing:.1em; text-transform:uppercase; padding:2px 5px; border:1px solid;
           border-radius:1px; }
  .badge-in-flight { color:#08c5ce; border-color:rgba(8,197,206,.35); }
  .badge-blocked { color:var(--red); border-color:rgba(240,79,79,.35); }
  .badge-discussion { color:var(--purple); border-color:rgba(124,92,224,.35); }
  .badge-time-gated { color:var(--amber); border-color:rgba(240,180,41,.35); }
  .badge-needs { color:#9ca3af; border-color:rgba(156,163,175,.3); }
  .badge-date { color:rgba(255,255,255,.3); border-color:rgba(255,255,255,.12); }

  /* Lane tag */
  .lane { display:inline-block; margin-top:6px; font-family:ui-monospace,monospace;
          font-size:9.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--dim);
          border:1px solid var(--line); padding:1px 6px; }
  .card[data-lane='chat-surfaces'] { border-left-color:var(--purple); }
  .card[data-lane='measurement'] { border-left-color:#f97316; }
  .col[data-label='Waiting on owner'] .card { border-left-color:var(--amber); }
  .col[data-label='Done'] .card { border-left-color:var(--green); }

  /* Hint text in empty columns */
  .hint { color:var(--dim); font-size:11px; padding:8px 12px; }

  /* Keyboard shortcut hint */
  #kbd-hint { position:fixed; bottom:14px; right:16px; font-family:ui-monospace,monospace;
              font-size:10px; color:rgba(255,255,255,.2); pointer-events:none; }
  kbd { background:rgba(255,255,255,.08); padding:1px 5px; border:1px solid rgba(255,255,255,.12); }

  /* Toast */
  #toast { position:fixed; bottom:40px; left:50%; transform:translateX(-50%);
           background:#1e1e28; border:1px solid var(--line); color:var(--txt);
           padding:10px 18px; font-size:12px; pointer-events:none; opacity:0;
           transition:opacity .2s; z-index:20; white-space:nowrap; }
  #toast.show { opacity:1; }

  /* + New button (modal composer trigger) */
  #newBtn { background:var(--purple); color:#fff; border:0; font-weight:700;
            padding:7px 12px; cursor:pointer; font:inherit; font-size:12px; white-space:nowrap; }
  #newBtn:hover { opacity:.9; }

  /* Pointer-drag ghost + drag state */
  body.dragging { user-select:none; cursor:grabbing; }
  body.dragging * { cursor:grabbing !important; }
  #drag-ghost { position:fixed; top:0; left:0; z-index:1000; pointer-events:none;
                width:260px; max-width:260px; background:#0e0e14; border:1px solid var(--cyan);
                border-left:3px solid var(--cyan); padding:9px 11px; font-size:12.5px;
                color:var(--txt); box-shadow:0 8px 24px rgba(0,0,0,.5); opacity:.92;
                transform:rotate(-1.5deg); will-change:transform; }
  .card.drag-source { opacity:.35; }
  .col.pointer-dragover { outline:2px solid var(--cyan); outline-offset:-4px;
                          background:rgba(8,197,206,.05); }

  /* Modal issue composer */
  #modal-overlay { position:fixed; inset:0; background:rgba(5,5,8,.72); z-index:100;
                   display:none; align-items:flex-start; justify-content:center; padding:60px 16px; }
  #modal-overlay.open { display:flex; }
  .modal { background:var(--panel); border:1px solid var(--line); width:100%; max-width:560px;
           display:flex; flex-direction:column; max-height:calc(100vh - 120px); }
  .modal-head { display:flex; align-items:center; justify-content:space-between;
                padding:12px 16px; border-bottom:1px solid var(--line); }
  .modal-head h2 { font-size:12px; letter-spacing:.16em; text-transform:uppercase;
                   font-family:ui-monospace,monospace; color:var(--dim); font-weight:600; }
  .modal-close { background:transparent; border:0; color:var(--dim); cursor:pointer;
                 font-size:18px; line-height:1; padding:2px 6px; }
  .modal-close:hover { color:var(--txt); }
  .modal-body { padding:16px; overflow-y:auto; display:flex; flex-direction:column; gap:12px; }
  .modal-label { font-size:10px; letter-spacing:.12em; text-transform:uppercase;
                 color:var(--dim); font-family:ui-monospace,monospace; margin-bottom:5px; display:block; }
  #modalText { width:100%; background:#08080c; border:1px solid var(--line); color:var(--txt);
               font:inherit; font-size:13px; padding:9px 11px; resize:vertical; min-height:84px; outline:none; }
  #modalText:focus { border-color:var(--cyan); }
  #modalCol { width:100%; background:#08080c; border:1px solid var(--line); color:var(--txt);
              font:inherit; font-size:13px; padding:8px 11px; cursor:pointer; outline:none; }
  #modalCol:focus { border-color:var(--cyan); }
  .modal-drop { border:1px dashed var(--line); padding:14px; text-align:center;
                color:var(--dim); font-size:12px; cursor:pointer; transition:all .15s; }
  .modal-drop:hover, .modal-drop.dragover { border-color:var(--amber); color:var(--txt);
                                            background:rgba(240,180,41,.05); }
  .modal-thumbs { display:flex; flex-wrap:wrap; gap:8px; }
  .modal-thumb { position:relative; }
  .modal-thumb img { height:90px; max-width:130px; object-fit:cover; border-radius:3px;
                     border:1px solid var(--line); display:block; }
  .modal-thumb-remove { position:absolute; top:3px; right:3px; background:rgba(15,15,20,.9);
                        border:1px solid rgba(255,255,255,.2); color:var(--dim); width:18px; height:18px;
                        border-radius:2px; cursor:pointer; font-size:11px; line-height:16px;
                        text-align:center; padding:0; }
  .modal-thumb-remove:hover { color:var(--red); border-color:rgba(240,79,79,.5); }
  .modal-foot { display:flex; align-items:center; justify-content:space-between; gap:8px;
                padding:12px 16px; border-top:1px solid var(--line); }
  .modal-hint { font-size:11px; color:var(--dim); }
  .modal-actions { display:flex; gap:8px; }
  #modalCancel { background:transparent; border:1px solid var(--line); color:var(--dim);
                 padding:7px 14px; cursor:pointer; font:inherit; font-size:12px; }
  #modalCancel:hover { color:var(--txt); border-color:var(--dim); }
  #modalSubmit { background:var(--cyan); color:#08080c; border:0; font-weight:700;
                 padding:7px 16px; cursor:pointer; font:inherit; font-size:12px; }
  #modalSubmit[disabled] { opacity:.4; cursor:default; }

  /* ---- V2 (cards-as-files mode only) ------------------------------------ */

  /* Filter row: type / owner / age, combining, plus the decision digest. */
  #v2filters { display:flex; gap:8px; align-items:center; flex-wrap:wrap;
               padding:8px 16px; border-bottom:1px solid var(--line); background:var(--bg); }
  #v2filters select { background:var(--panel); border:1px solid var(--line); color:var(--txt);
                      font:inherit; font-size:12px; padding:6px 9px; cursor:pointer; }
  #v2filters select:focus { outline:1px solid var(--cyan); }
  #v2filters select.on { border-color:var(--cyan); color:var(--cyan); }
  #waitingBtn { background:transparent; border:1px solid rgba(240,180,41,.5); color:var(--amber);
                padding:6px 12px; cursor:pointer; font:inherit; font-size:12px; font-weight:600;
                white-space:nowrap; }
  #waitingBtn:hover { background:rgba(240,180,41,.12); }
  #clearFilters { background:transparent; border:1px solid var(--line); color:var(--dim);
                  padding:6px 10px; cursor:pointer; font:inherit; font-size:11px; }
  #clearFilters:hover { color:var(--txt); border-color:var(--dim); }
  #filterNote { font-size:11px; color:var(--dim); }

  /* Card meta strip: type chip, owner chip, aging badge. */
  .card-meta { display:flex; flex-wrap:wrap; gap:4px; align-items:center; margin-top:6px; }
  .chip { display:inline-flex; align-items:center; gap:4px; font-family:ui-monospace,monospace;
          font-size:9px; letter-spacing:.1em; text-transform:uppercase; padding:2px 6px;
          border:1px solid; border-radius:1px; }
  .chip-type-bug { color:var(--red); border-color:rgba(240,79,79,.45); background:rgba(240,79,79,.08); }
  .chip-type-feature { color:var(--cyan); border-color:rgba(8,197,206,.45); background:rgba(8,197,206,.08); }
  .chip-type-decision { color:#a78bfa; border-color:rgba(124,92,224,.5); background:rgba(124,92,224,.12); }
  .chip-type-idea { color:#60a5fa; border-color:rgba(37,99,235,.5); background:rgba(37,99,235,.1); }
  .chip-type-chore { color:#9ca3af; border-color:rgba(156,163,175,.35); background:rgba(156,163,175,.07); }
  .chip-type-watch { color:var(--amber); border-color:rgba(240,180,41,.45); background:rgba(240,180,41,.08); }
  .chip-owner { color:rgba(255,255,255,.62); border-color:rgba(255,255,255,.14); }
  .chip-owner[data-owner="owner"] { color:#fbbf24; border-color:rgba(240,180,41,.45); }
  .chip-size { color:rgba(255,255,255,.4); border-color:rgba(255,255,255,.1); }
  /* Aging: nothing under 14 days, a whisper at 14, a shout at 30. */
  .chip-age { color:var(--amber); border-color:rgba(240,180,41,.3); }
  .chip-age.old { color:#08080c; background:var(--amber); border-color:var(--amber); font-weight:700; }

  /* Drop marker for in-column priority reorder */
  .drop-marker { height:2px; background:var(--cyan); margin:1px 0; box-shadow:0 0 6px rgba(8,197,206,.7); }

  /* Wide modal shared by detail / edit / digest */
  .modal.wide { max-width:820px; }
  .modal-sub { font-size:11px; color:var(--dim); font-family:ui-monospace,monospace; margin-top:3px;
               word-break:break-all; }
  .facts { display:flex; flex-wrap:wrap; gap:6px; }
  .fact { font-family:ui-monospace,monospace; font-size:10px; color:var(--dim);
          border:1px solid var(--line); padding:2px 7px; }
  .fact b { color:var(--txt); font-weight:600; }
  .detail-body { font-size:13.5px; line-height:1.62; color:rgba(255,255,255,.86); word-break:break-word; }
  .detail-body p { margin:0 0 10px; }
  .detail-body ul { margin:0 0 10px; padding-left:20px; }
  .detail-body li { margin:2px 0; }
  .detail-body h3 { font-size:13px; margin:14px 0 6px; color:var(--txt); }
  .detail-body a { color:var(--cyan); }
  .detail-body code { font-family:ui-monospace,monospace; font-size:12px; background:rgba(255,255,255,.07);
                      padding:1px 4px; }
  .detail-body img { max-width:100%; border:1px solid var(--line); margin:4px 0; }
  .detail-sec { border-top:1px solid var(--line); padding-top:12px; }
  .detail-sec > h3 { font-size:10px; letter-spacing:.14em; text-transform:uppercase; color:var(--dim);
                     font-family:ui-monospace,monospace; margin-bottom:8px; font-weight:600; }
  .hist { display:flex; flex-direction:column; gap:4px; max-height:210px; overflow-y:auto; }
  .hist-row { display:flex; gap:10px; font-family:ui-monospace,monospace; font-size:11px; }
  .hist-row .d { color:var(--dim); flex:0 0 auto; }
  .hist-row .s { color:rgba(255,255,255,.75); word-break:break-word; }

  /* Edit modal fields */
  .field-row { display:flex; gap:10px; flex-wrap:wrap; }
  .field-row > div { flex:1; min-width:120px; }
  .modal input.text, .modal select.text, .modal textarea.text {
    width:100%; background:#08080c; border:1px solid var(--line); color:var(--txt);
    font:inherit; font-size:13px; padding:8px 11px; outline:none; }
  .modal textarea.text { resize:vertical; min-height:300px; line-height:1.6; font-size:13px; }
  .modal input.text:focus, .modal select.text:focus, .modal textarea.text:focus { border-color:var(--cyan); }
  .modal input.title { font-size:15px; font-weight:600; }

  /* V2 overlays stack above the composer; edit sits above detail because it is
     opened from it and the card behind stays visible. */
  .v2-overlay { position:fixed; inset:0; background:rgba(5,5,8,.72); z-index:110;
                display:none; align-items:flex-start; justify-content:center; padding:48px 16px; }
  .v2-overlay.open { display:flex; }
  #edit-overlay { z-index:120; }
  .v2-overlay .modal-actions button { background:transparent; border:1px solid var(--line);
                                      color:var(--dim); padding:7px 14px; cursor:pointer;
                                      font:inherit; font-size:12px; }
  .v2-overlay .modal-actions button:hover { color:var(--txt); border-color:var(--dim); }

  /* The action row overflows a 270px column once a card has five buttons; in
     file mode it wraps instead of hiding "edit" under the next column. Scoped
     to the body class so legacy renders pixel-identically. */
  body.file-mode .card-actions { flex-wrap:wrap; }

  /* Digest ("waiting on you") list */
  .digest-row { border:1px solid var(--line); border-left:3px solid var(--amber); padding:9px 11px;
                cursor:pointer; background:#0e0e14; }
  .digest-row:hover { border-color:rgba(255,255,255,.22); border-left-color:var(--amber); }
  .digest-row .t { font-size:13px; line-height:1.45; }
  .digest-row .m { margin-top:5px; }
</style></head><body${V2 ? ' class="file-mode"' : ''}>
<header>
  <span class="sq"><i style="background:#e8590c"></i><i style="background:#7c5ce0"></i><i style="background:#2563eb"></i><i style="background:#0e9f6e"></i></span>
  <h1>${TITLE} &middot; Board</h1>

  <div id="toolbar">
    <input id="search" placeholder="Search cards... (/)" autocomplete="off" spellcheck="false"/>
    <div class="filter-btns">
      <button class="filter-btn" data-tag="in-flight">In flight</button>
      <button class="filter-btn" data-tag="blocked">Blocked</button>
      <button class="filter-btn" data-tag="discussion">Discussion</button>
      <button class="filter-btn" data-tag="time-gated">Time-gated</button>
      <button class="filter-btn" data-tag="needs">Needs</button>
    </div>
  </div>

  <div class="header-right">
    <span id="status">loading</span>
    <button id="newBtn" title="New issue (n) - full composer with screenshot paste">+ New</button>
    <button id="rotateBtn" title="Keep the 10 most recent Done entries; move the rest to backlog-archive.md">Rotate Done</button>
    <button id="commit" disabled>Commit + push</button>
  </div>
</header>

<div id="add-row" style="padding:8px 16px; border-bottom:1px solid var(--line); display:flex; gap:8px; align-items:center; flex-wrap:wrap; background:var(--bg);">
  <input id="addText" placeholder="Capture an idea..." autocomplete="off" spellcheck="false"/>
  <select id="addCol"></select>
  <button id="addBtn">+ Add</button>
  <span style="font-size:11px; color:var(--dim);">Capture date auto-appended</span>
</div>
${V2_FILTER_ROW}

<main id="board"></main>
<div id="kbd-hint"><kbd>/</kbd> search &nbsp; <kbd>n</kbd> new &nbsp; <kbd>j</kbd>/<kbd>k</kbd> navigate &nbsp; <kbd>o</kbd>/<kbd>Enter</kbd> expand &nbsp; <kbd>m</kbd> move &nbsp; <kbd>Esc</kbd> clear</div>

<div id="modal-overlay">
  <div class="modal" role="dialog" aria-modal="true" aria-label="New issue">
    <div class="modal-head">
      <h2>New issue</h2>
      <button class="modal-close" id="modalClose" title="Close (Esc)">&times;</button>
    </div>
    <div class="modal-body">${V2_COMPOSER_FIELDS}
      <div>
        <label class="modal-label" for="modalCol">Column</label>
        <select id="modalCol"></select>
      </div>
      <div>
        <label class="modal-label">Screenshots (paste anywhere in this dialog, or click to pick)</label>
        <div class="modal-drop" id="modalDrop">Paste an image, or click to choose a file</div>
        <input id="modalFile" type="file" accept="image/*" multiple style="display:none"/>
        <div class="modal-thumbs" id="modalThumbs"></div>
      </div>
    </div>
    <div class="modal-foot">
      <span class="modal-hint">Capture date auto-appended. <kbd>Esc</kbd> to close.</span>
      <div class="modal-actions">
        <button id="modalCancel">Cancel</button>
        <button id="modalSubmit">Create issue</button>
      </div>
    </div>
  </div>
</div>
${V2_MODALS}

<div id="toast"></div>

<script>
const BOARD_CONTEXT = ${JSON.stringify({ title: TITLE, root: ROOT, board: fileMode() ? 'docs/board/' : 'docs/backlog.md', fileMode: V2 })}
// Every V2 branch in this client is gated on this one flag; false = the legacy
// single-file board, which must behave exactly as it did before V2.
const FILE_MODE = BOARD_CONTEXT.fileMode === true
let state = null
let activeFilters = new Set()
let searchQuery = ''
let focusedCard = null
let collapsedCols = new Set()
let expandedCards = new Set()   // set of card raw strings that are expanded
// raw token -> card id, rebuilt on every render. Mutators post both: file mode
// keys on the id and uses the token to detect a stale client, legacy mode
// still matches the raw line verbatim and ignores the id.
let idByRaw = Object.create(null)
let editingCard = null          // raw string of card currently in edit mode

// Track which card is "active" for paste attach (raw string)
let pasteTargetCard = null
// Track which card has the move menu open (raw string)
let moveMenuCard = null

// ---- Data ----
let lastSig = null   // signature of the last-rendered server data; lets a poll skip a redundant rebuild

// True while the user is mid-interaction. A 2s background poll must not tear the
// board down and rebuild it underneath them: it would wipe in-progress edit text
// (the textarea is rebuilt from saved content), drop an active drag, or close an
// open move menu. Explicit actions call render() directly and are unaffected.
function userIsInteracting() {
  return editingCard !== null || moveMenuCard !== null || (pdrag && pdrag.active)
}

async function load(force) {
  // Background poll: leave an active interaction alone.
  if (!force && userIsInteracting()) return
  const r = await fetch('/api/board')
  const data = await r.json()
  const sig = JSON.stringify(data)
  // Nothing changed since the last render -> skip the full teardown/rebuild.
  // This is what removes the periodic every-2s flicker while the board is idle.
  if (!force && sig === lastSig) return
  lastSig = sig
  state = data
  populateColSelect()
  render()
}

function populateColSelect() {
  const sel = document.getElementById('addCol')
  const prev = sel.value
  sel.innerHTML = ''
  for (const col of state.cols) {
    const opt = document.createElement('option')
    opt.value = col.heading
    opt.textContent = col.label
    sel.appendChild(opt)
  }
  if (prev && [...sel.options].some(function(o) { return o.value === prev })) sel.value = prev
}

// ---- Filtering ----
// V2 adds three axes that COMBINE with each other, with the badge filters and
// with search. They live in plain vars, not in the DOM the poll rebuilds, so a
// 2s refresh never drops the filter the owner is reading through.
let filterType = ''
let filterOwner = ''
let filterAge = ''

function cardMatchesFilter(item) {
  const tagMatch = activeFilters.size === 0 ||
    [...activeFilters].every(function(f) { return item.badges.some(function(b) { return b.type === f }) })
  if (!tagMatch) return false
  if (filterType && item.type !== filterType) return false
  if (filterOwner && item.owner !== filterOwner) return false
  // Absent age (a card with no created: and no git record) is never "old".
  if (filterAge && !(typeof item.rotAge === 'number' && item.rotAge >= Number(filterAge))) return false
  if (!searchQuery) return true
  return item.text.toLowerCase().includes(searchQuery.toLowerCase())
}

function v2FiltersActive() {
  return !!(filterType || filterOwner || filterAge)
}

// ---- Escape HTML ----
function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}
function truncate(s, n) { return s.length > n ? s.slice(0, n) + '...' : s }
function highlightText(escaped, query) {
  if (!query) return escaped
  const safe = query.split('').map(function(c) {
    return '-.*+?^$|()[]{}'.indexOf(c) >= 0 ? '\\\\' + c : c
  }).join('')
  const re = new RegExp('(' + safe + ')', 'gi')
  return escaped.replace(re, '<mark style="background:rgba(8,197,206,.3);color:inherit">$1</mark>')
}

// ---- Kickoff copy ----
function extractLinkedDocs(text) {
  const out = []
  const seen = new Set()
  const re = new RegExp('docs/(?!board-assets/)[A-Za-z0-9._/-]+[.]md(?:#[A-Za-z0-9._-]+)?', 'g')
  let m
  while ((m = re.exec(text)) !== null) {
    if (!seen.has(m[0])) {
      seen.add(m[0])
      out.push(m[0])
    }
  }
  return out
}

function makeKickoffPrompt(item, col) {
  const docs = extractLinkedDocs(item.text)
  const docBlock = docs.length
    ? docs.map(function(d) { return '- ' + d }).join('\\n')
    : '- none detected on the card'
  return [
    'We are working in project: ' + BOARD_CONTEXT.title,
    'Repo path: ' + BOARD_CONTEXT.root,
    'Board source: ' + BOARD_CONTEXT.board,
    'Current column: ' + col.heading,
    '',
    'Ticket:',
    item.text,
    '',
    'Relevant linked docs:',
    docBlock,
    '',
    'Before acting:',
    '1. Read CLAUDE.md / AGENTS.md if present.',
    '2. Read the linked docs above before proposing implementation.',
    '3. Inspect git status and current branch.',
    '4. Treat ' + BOARD_CONTEXT.board + ' as the source of truth for ticket status.',
    "5. Do not mutate files, commit, deploy, restart services, or touch secrets without the owner's approval.",
    '6. Start by restating the task, proposed files to inspect, and verification plan.',
  ].join('\\n')
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text)
    return
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  document.body.removeChild(ta)
}

async function copyKickoff(item, col) {
  try {
    await copyText(makeKickoffPrompt(item, col))
    showToast('Kickoff copied')
  } catch (e) {
    showToast('copy failed')
  }
}

// ---- Attach image ----
async function doAttach(rawLine, file) {
  if (!file) return
  if (!file.type.startsWith('image/')) { showToast('Only image files supported'); return }
  const reader = new FileReader()
  reader.onload = async function(ev) {
    const dataUrl = ev.target.result
    // dataUrl = "data:<mime>;base64,<data>"
    const commaIdx = dataUrl.indexOf(',')
    const b64 = dataUrl.slice(commaIdx + 1)
    const r = await fetch('/api/attach', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: idByRaw[rawLine] || '', raw: rawLine, name: file.name, mime: file.type, data: b64 })
    })
    const d = await r.json().catch(function() { return {} })
    if (!r.ok) {
      showToast(d.error || 'attach failed')
      if (r.status === 409) load()
      return
    }
    expandedCards.add(rawLine)
    showToast('Screenshot attached')
    load()
  }
  reader.readAsDataURL(file)
}

async function doRemoveAttachment(rawLine, imagePath) {
  if (!confirm('Remove this attachment?')) return
  const r = await fetch('/api/remove-attachment', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: idByRaw[rawLine] || '', raw: rawLine, imagePath: imagePath })
  })
  const d = await r.json().catch(function() { return {} })
  if (!r.ok) {
    showToast(d.error || 'remove failed')
    if (r.status === 409) load()
    return
  }
  showToast('Attachment removed')
  load()
}

// ---- Move card (click-based) ----
function toggleMoveMenu(raw) {
  if (moveMenuCard === raw) {
    moveMenuCard = null
  } else {
    moveMenuCard = raw
    expandedCards.add(raw)
  }
  render()
  // Focus the select after render so keyboard users can navigate immediately
  if (moveMenuCard === raw) {
    setTimeout(function() {
      const sel = document.querySelector('.card-move-menu.open .card-move-select')
      if (sel) sel.focus()
    }, 30)
  }
}

async function doMoveCard(id, raw, toHeading) {
  moveMenuCard = null
  const r = await fetch('/api/move', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: id, raw: raw, to: toHeading })
  })
  const d = await r.json().catch(function() { return {} })
  if (!r.ok) {
    showToast(d.error || 'move failed')
    if (r.status === 409 || r.status === 400) load()
    return
  }
  showToast('Moved')
  load()
}

// ---- Pointer-event drag (works in any browser, incl. embedded browsers
// that never fire HTML5 dragstart/drop). mousedown on a card arms a drag;
// once the pointer moves past a small threshold we lift a floating ghost,
// highlight the column under the pointer, and on mouseup POST /api/move.
// Clicks (no movement past threshold) fall through to the normal click
// handler so cards still expand. mousedown on buttons/inputs/links/textarea
// is ignored so their own handlers run. ----
var DRAG_THRESHOLD = 5
var pdrag = null   // { id, raw, startX, startY, ghost, active, srcEl, overCol }
var suppressClickUntil = 0   // swallow the click that trails a real drag

function pointerDragInteractiveTarget(t) {
  // Ignore drags starting on interactive elements inside the card.
  return !!(t.closest && t.closest('button, input, select, textarea, a, .card-edit, .card-move-menu, .card-img-wrap'))
}

function startCardPointerDrag(e, card, item) {
  if (e.button !== 0) return                       // left button only
  if (pointerDragInteractiveTarget(e.target)) return
  if (editingCard === item.raw) return
  var srcCol = card.closest ? card.closest('.col') : null
  pdrag = {
    id: item.id, raw: item.raw,
    startX: e.clientX, startY: e.clientY,
    title: item.title, ghost: null, active: false,
    srcEl: card, overCol: null,
    // Ready is the one column where order is signal, so a drag that starts AND
    // ends there is a reorder, not a move.
    fromLabel: srcCol ? srcCol.dataset.label : '',
    reorder: null,
  }
  document.addEventListener('mousemove', onPointerDragMove)
  document.addEventListener('mouseup', onPointerDragEnd)
}

function onPointerDragMove(e) {
  if (!pdrag) return
  var dx = e.clientX - pdrag.startX
  var dy = e.clientY - pdrag.startY
  if (!pdrag.active) {
    if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return
    // Threshold crossed: begin the visible drag.
    pdrag.active = true
    document.body.classList.add('dragging')
    if (pdrag.srcEl) pdrag.srcEl.classList.add('drag-source')
    var ghost = document.createElement('div')
    ghost.id = 'drag-ghost'
    ghost.textContent = pdrag.title
    document.body.appendChild(ghost)
    pdrag.ghost = ghost
  }
  if (!pdrag.active) return
  e.preventDefault()
  pdrag.ghost.style.transform = 'translate(' + (e.clientX + 12) + 'px,' + (e.clientY + 8) + 'px) rotate(-1.5deg)'
  // Hit-test the column under the pointer (ghost has pointer-events:none).
  var under = document.elementFromPoint(e.clientX, e.clientY)
  var col = under && under.closest ? under.closest('.col') : null
  if (col !== pdrag.overCol) {
    if (pdrag.overCol) pdrag.overCol.classList.remove('pointer-dragover')
    pdrag.overCol = col
    if (col) col.classList.add('pointer-dragover')
  }
  // Inside Ready, show where the card would land and remember its neighbours.
  if (FILE_MODE && col && col.dataset.label === 'Ready' && pdrag.fromLabel === 'Ready') {
    pdrag.reorder = readyDropTargets(col, e.clientY, pdrag.id)
    showDropMarker(pdrag.reorder)
  } else if (pdrag.reorder) {
    pdrag.reorder = null
    clearDropMarker()
  }
}

async function onPointerDragEnd(e) {
  document.removeEventListener('mousemove', onPointerDragMove)
  document.removeEventListener('mouseup', onPointerDragEnd)
  var d = pdrag
  pdrag = null
  if (!d) return
  document.body.classList.remove('dragging')
  if (d.srcEl) d.srcEl.classList.remove('drag-source')
  if (d.ghost && d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost)
  if (d.overCol) d.overCol.classList.remove('pointer-dragover')
  clearDropMarker()
  if (!d.active) return     // never crossed threshold: treat as a click
  suppressClickUntil = Date.now() + 300   // a real drag happened: eat the trailing click
  // Resolve the drop column from the element under the release point.
  var under = document.elementFromPoint(e.clientX, e.clientY)
  var col = under && under.closest ? under.closest('.col') : null
  if (!col) return
  var toHeading = col.dataset.heading
  if (!toHeading) return
  // Dropped back inside Ready: reprioritise instead of moving.
  if (FILE_MODE && col.dataset.label === 'Ready' && d.fromLabel === 'Ready') {
    var t = d.reorder || readyDropTargets(col, e.clientY, d.id)
    return doReorder(d.id, t.prevId, t.nextId)
  }
  var toLabel = col.dataset.label
  var r = await fetch('/api/move', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: d.id, raw: d.raw, to: toHeading, done: toLabel === 'Done' ? true : false }),
  })
  if (!r.ok) {
    var jd = await r.json().catch(function() { return {} })
    showToast(jd.error || 'move failed')
  } else {
    showToast('Moved')
  }
  load()
}

// ---- Rendering ----
function render() {
  const el = document.getElementById('board')
  el.innerHTML = ''
  idByRaw = Object.create(null)

  for (let ci = 0; ci < state.cols.length; ci++) {
    const col = state.cols[ci]
    const c = document.createElement('div')
    c.className = 'col' + (collapsedCols.has(col.label) ? ' collapsed' : '') + (col.label === 'Waiting on owner' ? ' col-owner' : '')
    c.dataset.label = col.label
    c.dataset.heading = col.heading

    const visibleCount = col.items.filter(cardMatchesFilter).length
    const countLabel = searchQuery || activeFilters.size > 0
      ? visibleCount + '/' + col.items.length
      : String(col.items.length)

    const hdr = document.createElement('div')
    hdr.className = 'col-header'
    hdr.innerHTML =
      '<span class="col-label">' + escHtml(col.label) + '</span>' +
      '<span class="col-meta">' +
        '<span class="col-count">' + countLabel + '</span>' +
        '<span class="col-toggle">&#9660;</span>' +
      '</span>'
    hdr.addEventListener('click', function() {
      if (collapsedCols.has(col.label)) collapsedCols.delete(col.label)
      else collapsedCols.add(col.label)
      render()
    })
    c.appendChild(hdr)

    const cards = document.createElement('div')
    cards.className = 'cards'

    for (let ki = 0; ki < col.items.length; ki++) {
      const it = col.items[ki]
      idByRaw[it.raw] = it.id
      const visible = cardMatchesFilter(it)
      const isExpanded = expandedCards.has(it.raw)
      const isEditing = editingCard === it.raw

      const card = document.createElement('div')
      card.className = 'card' +
        (it.done ? ' done' : '') +
        (visible ? '' : ' filtered-out') +
        (isExpanded ? ' expanded' : '')
      card.dataset.id = it.id
      card.dataset.lane = it.lane
      card.dataset.ci = ci
      card.dataset.ki = ki
      card.tabIndex = 0

      // Hidden file input for attach
      const fileInput = document.createElement('input')
      fileInput.type = 'file'
      fileInput.accept = 'image/*'
      fileInput.style.display = 'none'
      fileInput.addEventListener('change', function() {
        if (fileInput.files && fileInput.files[0]) doAttach(it.raw, fileInput.files[0])
        fileInput.value = ''
      })
      card.appendChild(fileInput)

      // Title (always shown) with optional attachment count badge
      const titleEl = document.createElement('div')
      titleEl.className = 'card-title'
      let displayTitle = isExpanded ? escHtml(it.title) : (searchQuery
        ? highlightText(escHtml(it.title), searchQuery)
        : escHtml(it.title))
      if (!isExpanded && it.images && it.images.length > 0) {
        displayTitle += ' <span class="attach-badge">&#128206; ' + it.images.length + '</span>'
      }
      titleEl.innerHTML = displayTitle
      card.appendChild(titleEl)

      // Meta strip: type, owner, size, aging. Every one of these is optional on
      // a card and simply does not render when absent - the migration derived
      // type only where the marker was explicit, so "no type" is the norm.
      const metaEl = buildCardMeta(it)
      if (metaEl) card.appendChild(metaEl)

      // Description (shown when expanded, if there is one)
      if (it.desc) {
        const descEl = document.createElement('div')
        descEl.className = 'card-desc'
        descEl.style.display = isExpanded ? 'block' : 'none'
        descEl.innerHTML = searchQuery && isExpanded
          ? highlightText(escHtml(it.desc), searchQuery)
          : escHtml(it.desc)
        card.appendChild(descEl)
      }

      // Thumbnails (shown when expanded)
      if (isExpanded && it.images && it.images.length > 0) {
        const imgsEl = document.createElement('div')
        imgsEl.className = 'card-images'
        for (let ii = 0; ii < it.images.length; ii++) {
          const imgPath = it.images[ii]
          const wrap = document.createElement('div')
          wrap.className = 'card-img-wrap'
          const img = document.createElement('img')
          img.src = '/assets/' + imgPath.replace('docs/board-assets/', '')
          img.alt = 'attachment'
          img.title = 'Click to open full size'
          img.addEventListener('click', function(e) {
            e.stopPropagation()
            window.open(img.src, '_blank')
          })
          const removeBtn = document.createElement('button')
          removeBtn.className = 'card-img-remove'
          removeBtn.title = 'Remove attachment'
          removeBtn.textContent = '\\u00d7'
          ;(function(path) {
            removeBtn.addEventListener('click', function(e) {
              e.stopPropagation()
              doRemoveAttachment(it.raw, path)
            })
          })(imgPath)
          wrap.appendChild(img)
          wrap.appendChild(removeBtn)
          imgsEl.appendChild(wrap)
        }
        card.appendChild(imgsEl)
      }

      // Badges row
      if (it.badges && it.badges.length > 0) {
        const br = document.createElement('div')
        br.className = 'card-badges'
        for (const b of it.badges) {
          const s = document.createElement('span')
          s.className = 'badge badge-' + b.type
          s.textContent = b.label
          br.appendChild(s)
        }
        card.appendChild(br)
      }

      // Lane tag
      if (it.lane) {
        const l = document.createElement('span')
        l.className = 'lane'
        l.textContent = it.lane
        card.appendChild(l)
      }

      // Inline edit area
      const editArea = document.createElement('div')
      editArea.className = 'card-edit' + (isEditing ? ' active' : '')
      const ta = document.createElement('textarea')
      ta.value = it.text
      ta.rows = 3
      // Paste in textarea: attach if image data
      ta.addEventListener('paste', function(e) {
        const items = e.clipboardData && e.clipboardData.items
        if (!items) return
        for (let i = 0; i < items.length; i++) {
          if (items[i].kind === 'file' && items[i].type.startsWith('image/')) {
            e.preventDefault()
            const file = items[i].getAsFile()
            if (file) doAttach(it.raw, file)
            return
          }
        }
      })
      editArea.appendChild(ta)
      const editActions = document.createElement('div')
      editActions.className = 'card-edit-actions'
      const saveBtn = document.createElement('button')
      saveBtn.className = 'card-edit-save'
      saveBtn.textContent = 'Save'
      const cancelEditBtn = document.createElement('button')
      cancelEditBtn.className = 'card-edit-cancel'
      cancelEditBtn.textContent = 'Cancel'
      editActions.appendChild(cancelEditBtn)
      editActions.appendChild(saveBtn)
      editArea.appendChild(editActions)
      card.appendChild(editArea)

      // Card actions (expand, edit, attach, move, delete)
      const actionsEl = document.createElement('div')
      actionsEl.className = 'card-actions'

      // File mode reads a card in the detail modal, so the inline expand toggle
      // (which squished a 3,000-char body into a column) is legacy-only.
      if (!FILE_MODE && (it.desc || (it.images && it.images.length > 0))) {
        const expandBtn = document.createElement('button')
        expandBtn.className = 'card-btn expand-toggle'
        expandBtn.textContent = isExpanded ? 'collapse' : 'expand'
        expandBtn.addEventListener('click', function(e) {
          e.stopPropagation()
          toggleExpand(it.raw)
        })
        actionsEl.appendChild(expandBtn)
      }

      const editBtn = document.createElement('button')
      editBtn.className = 'card-btn'
      editBtn.textContent = 'edit'
      editBtn.addEventListener('click', function(e) {
        e.stopPropagation()
        if (FILE_MODE) openEditModal(it.id)
        else startEdit(it.raw)
      })
      actionsEl.appendChild(editBtn)

      const kickoffBtn = document.createElement('button')
      kickoffBtn.className = 'card-btn kickoff'
      kickoffBtn.title = 'Copy an agent kickoff prompt for this card'
      kickoffBtn.textContent = 'copy kickoff'
      kickoffBtn.addEventListener('click', function(e) {
        e.stopPropagation()
        copyKickoff(it, col)
      })
      actionsEl.appendChild(kickoffBtn)

      const attachBtn = document.createElement('button')
      attachBtn.className = 'card-btn attach'
      attachBtn.title = 'Attach image (or paste / drag-drop onto expanded card)'
      attachBtn.textContent = 'attach'
      attachBtn.addEventListener('click', function(e) {
        e.stopPropagation()
        expandedCards.add(it.raw)
        pasteTargetCard = it.raw
        fileInput.click()
      })
      actionsEl.appendChild(attachBtn)

      const moveBtn = document.createElement('button')
      moveBtn.className = 'card-btn move'
      moveBtn.title = 'Move to column (keyboard: m)'
      moveBtn.textContent = 'move'
      moveBtn.addEventListener('click', function(e) {
        e.stopPropagation()
        toggleMoveMenu(it.raw)
      })
      actionsEl.appendChild(moveBtn)

      const deleteBtn = document.createElement('button')
      deleteBtn.className = 'card-btn delete'
      deleteBtn.textContent = 'delete'
      deleteBtn.addEventListener('click', function(e) {
        e.stopPropagation()
        doDelete(it.raw, it.title)
      })
      actionsEl.appendChild(deleteBtn)

      card.appendChild(actionsEl)

      // Inline move menu (hidden by default, toggled by move button or 'm' key)
      const moveMenu = document.createElement('div')
      moveMenu.className = 'card-move-menu' + (moveMenuCard === it.raw ? ' open' : '')
      const moveSel = document.createElement('select')
      moveSel.className = 'card-move-select'
      for (const mc of state.cols) {
        const opt = document.createElement('option')
        opt.value = mc.heading
        opt.textContent = mc.label
        if (mc.heading === col.heading) opt.selected = true
        moveSel.appendChild(opt)
      }
      moveSel.addEventListener('change', function(e) {
        e.stopPropagation()
        const toHeading = moveSel.value
        doMoveCard(it.id, it.raw, toHeading)
      })
      moveSel.addEventListener('click', function(e) { e.stopPropagation() })
      moveSel.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') { e.stopPropagation(); moveMenuCard = null; render() }
      })
      moveMenu.appendChild(moveSel)
      card.appendChild(moveMenu)

      // Wire up save/cancel for edit
      saveBtn.addEventListener('click', function(e) {
        e.stopPropagation()
        doSaveEdit(it.raw, ta.value)
      })
      cancelEditBtn.addEventListener('click', function(e) {
        e.stopPropagation()
        editingCard = null
        render()
      })

      // Drag-drop image files onto expanded card
      card.addEventListener('dragover', function(e) {
        // Only intercept if it's a file drag (don't interfere with card DnD)
        if (e.dataTransfer.types && [...e.dataTransfer.types].includes('Files')) {
          // File mode has no expanded state, so any card takes an image drop.
          if (isExpanded || FILE_MODE) {
            e.preventDefault()
            e.stopPropagation()
            card.classList.add('img-dragover')
          }
        }
      })
      card.addEventListener('dragleave', function(e) {
        card.classList.remove('img-dragover')
      })
      card.addEventListener('drop', function(e) {
        card.classList.remove('img-dragover')
        if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return
        const file = e.dataTransfer.files[0]
        if (!file.type.startsWith('image/')) return
        // Only attach if card is expanded; otherwise let column drop handler handle it
        if (isExpanded || FILE_MODE) {
          e.preventDefault()
          e.stopPropagation()
          doAttach(it.raw, file)
        }
      })

      // Pointer-event drag: arm on mousedown (threshold gates click vs drag).
      ;(function(itemRef, cardRef) {
        card.addEventListener('mousedown', function(e) {
          startCardPointerDrag(e, cardRef, itemRef)
        })
      })(it, card)

      // Set paste target when card is focused/expanded
      card.addEventListener('focus', function() {
        setFocus(ci, ki)
        if (isExpanded) pasteTargetCard = it.raw
      })
      card.addEventListener('click', function(e) {
        if (Date.now() < suppressClickUntil) { suppressClickUntil = 0; return }
        if (e.target.closest('.card-actions') || e.target.closest('.card-edit')) return
        setFocus(ci, ki)
        // File mode: a click OPENS THE CARD. That is the whole point of V2 -
        // the body is read in a modal, not squeezed into a 270px column.
        if (FILE_MODE) { pasteTargetCard = it.raw; openDetail(it.id); return }
        const willExpand = !expandedCards.has(it.raw)
        if (willExpand) {
          pasteTargetCard = it.raw
        }
        if ((it.desc || (it.images && it.images.length > 0)) && !isEditing) toggleExpand(it.raw)
        else if (!it.desc && !(it.images && it.images.length > 0)) {
          // No desc and no images: just track paste target
          pasteTargetCard = it.raw
        }
      })
      card.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === 'o') {
          e.preventDefault()
          e.stopPropagation()
          if (FILE_MODE) { openDetail(it.id); return }
          if ((it.desc || (it.images && it.images.length > 0)) && !isEditing) toggleExpand(it.raw)
        }
        if (e.key === 'Escape' && isExpanded) {
          e.preventDefault()
          e.stopPropagation()
          expandedCards.delete(it.raw)
          render()
        }
      })

      cards.appendChild(card)
    }

    if (col.items.length === 0) {
      const hint = document.createElement('p')
      hint.className = 'hint'
      hint.textContent = 'Empty'
      cards.appendChild(hint)
    }

    c.appendChild(cards)

    c.addEventListener('dragover', function(e) { e.preventDefault(); c.classList.add('dragover') })
    c.addEventListener('dragleave', function() { c.classList.remove('dragover') })
    c.addEventListener('drop', async function(e) {
      e.preventDefault(); c.classList.remove('dragover')
      // If it's a file drop, ignore at column level (handled by card)
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0 &&
          e.dataTransfer.types && [...e.dataTransfer.types].includes('Files')) {
        return
      }
      const rawData = e.dataTransfer.getData('text/plain')
      if (!rawData) return
      const payload = JSON.parse(rawData)
      const r = await fetch('/api/move', { method:'POST', headers:{'content-type':'application/json'},
        body: JSON.stringify({ id: payload.id, raw: payload.raw, to: col.heading, done: col.label === 'Done' ? true : false }) })
      if (!r.ok) {
        const d = await r.json().catch(function() { return {} })
        showToast(d.error || 'move failed')
      }
      load()
    })

    el.appendChild(c)
  }

  // Sync status
  const st = document.getElementById('status')
  const btn = document.getElementById('commit')
  st.textContent = state.dirty ? 'uncommitted changes' : 'in sync with git'
  st.className = state.dirty ? 'dirty' : ''
  btn.disabled = !state.dirty

  if (FILE_MODE) {
    // Filters live in JS state, so they survive the 2s poll; this line is the
    // only thing that has to be restated after a rebuild.
    const shown = state.cols.reduce(function(n, c) { return n + c.items.filter(cardMatchesFilter).length }, 0)
    const total = state.cols.reduce(function(n, c) { return n + c.items.length }, 0)
    document.getElementById('filterNote').textContent =
      (v2FiltersActive() || searchQuery || activeFilters.size) ? shown + ' of ' + total + ' cards' : total + ' cards'
    // An open detail view follows the data: a card edited elsewhere refreshes,
    // a card deleted elsewhere closes rather than lying.
    if (detailId && v2IsOpen('detail-overlay')) {
      if (findItem(detailId)) renderDetail()
      else { v2Close('detail-overlay'); detailId = null; showToast('That card is no longer on the board') }
    }
    if (v2IsOpen('digest-overlay')) renderDigest()
  }

  if (focusedCard) applyKeyboardFocusStyle()
}

// ---- Expand/collapse ----
function toggleExpand(raw) {
  if (expandedCards.has(raw)) {
    expandedCards.delete(raw)
    if (pasteTargetCard === raw) pasteTargetCard = null
  } else {
    expandedCards.add(raw)
    pasteTargetCard = raw
  }
  render()
}

// ---- Edit ----
function startEdit(raw) {
  editingCard = raw
  expandedCards.add(raw)
  pasteTargetCard = raw
  render()
  // Focus the textarea after render
  setTimeout(function() {
    const ta = document.querySelector('.card-edit.active textarea')
    if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length }
  }, 30)
}

async function doSaveEdit(rawLine, newText) {
  if (!newText.trim()) { showToast('Card text cannot be empty'); return }
  const r = await fetch('/api/edit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: idByRaw[rawLine] || '', raw: rawLine, text: newText.trim() })
  })
  const d = await r.json().catch(function() { return {} })
  if (!r.ok) {
    showToast(d.error || 'save failed')
    if (r.status === 409) { editingCard = null; load(); return }
    return
  }
  editingCard = null
  expandedCards.delete(rawLine)
  showToast('Saved')
  load()
}

// ---- Delete ----
async function doDelete(rawLine, title) {
  const label = title.length > 60 ? title.slice(0, 59) + '...' : title
  if (!confirm('Delete card?\\n\\n' + label)) return
  const r = await fetch('/api/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: idByRaw[rawLine] || '', raw: rawLine })
  })
  const d = await r.json().catch(function() { return {} })
  if (!r.ok) {
    showToast(d.error || 'delete failed')
    if (r.status === 409) { load(); return }
    return
  }
  expandedCards.delete(rawLine)
  if (editingCard === rawLine) editingCard = null
  if (pasteTargetCard === rawLine) pasteTargetCard = null
  showToast('Deleted')
  load()
}

// ---- Global paste handler (for paste on expanded card) ----
document.addEventListener('paste', function(e) {
  const tag = document.activeElement ? document.activeElement.tagName : ''
  // If in a textarea, the card's own paste handler takes over
  if (tag === 'TEXTAREA') return
  if (!pasteTargetCard) return
  const items = e.clipboardData && e.clipboardData.items
  if (!items) return
  for (let i = 0; i < items.length; i++) {
    if (items[i].kind === 'file' && items[i].type.startsWith('image/')) {
      e.preventDefault()
      const file = items[i].getAsFile()
      if (file) doAttach(pasteTargetCard, file)
      return
    }
  }
})

// ---- Keyboard focus ----
function setFocus(ci, ki) {
  focusedCard = { ci: ci, ki: ki }
}

function applyKeyboardFocusStyle() {
  document.querySelectorAll('.card.keyboard-focused').forEach(function(el) { el.classList.remove('keyboard-focused') })
  if (!focusedCard) return
  const card = document.querySelector('.card[data-ci="' + focusedCard.ci + '"][data-ki="' + focusedCard.ki + '"]')
  if (card) card.classList.add('keyboard-focused')
}

function moveFocus(dir) {
  if (!state) return
  let ci = focusedCard ? focusedCard.ci : 0
  let ki = focusedCard ? focusedCard.ki : -1

  const col = state.cols[ci]
  if (!col) return

  const visibleKis = col.items.map(function(it, i) { return { it: it, i: i } })
    .filter(function(x) { return cardMatchesFilter(x.it) })
    .map(function(x) { return x.i })

  const currentPos = visibleKis.indexOf(ki)
  const nextPos = currentPos + dir

  if (nextPos >= 0 && nextPos < visibleKis.length) {
    focusedCard = { ci: ci, ki: visibleKis[nextPos] }
  } else if (dir === 1 && ci < state.cols.length - 1) {
    for (let nci = ci + 1; nci < state.cols.length; nci++) {
      const vis = state.cols[nci].items.map(function(it, i) { return { it: it, i: i } })
        .filter(function(x) { return cardMatchesFilter(x.it) })
        .map(function(x) { return x.i })
      if (vis.length > 0) { focusedCard = { ci: nci, ki: vis[0] }; break }
    }
  } else if (dir === -1 && ci > 0) {
    for (let nci = ci - 1; nci >= 0; nci--) {
      const vis = state.cols[nci].items.map(function(it, i) { return { it: it, i: i } })
        .filter(function(x) { return cardMatchesFilter(x.it) })
        .map(function(x) { return x.i })
      if (vis.length > 0) { focusedCard = { ci: nci, ki: vis[vis.length - 1] }; break }
    }
  }

  applyKeyboardFocusStyle()

  if (focusedCard) {
    const card = document.querySelector('.card[data-ci="' + focusedCard.ci + '"][data-ki="' + focusedCard.ki + '"]')
    if (card) card.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
}

// ---- Toast ----
let toastTimer = null
function showToast(msg) {
  const el = document.getElementById('toast')
  el.textContent = msg; el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(function() { el.classList.remove('show') }, 3000)
}

// ---- Wire up controls ----

document.getElementById('search').addEventListener('input', function(e) {
  searchQuery = e.target.value
  render()
})

document.querySelectorAll('.filter-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    const tag = btn.dataset.tag
    if (activeFilters.has(tag)) { activeFilters.delete(tag); btn.classList.remove('active') }
    else { activeFilters.add(tag); btn.classList.add('active') }
    render()
  })
})

document.getElementById('addBtn').addEventListener('click', async function() {
  const input = document.getElementById('addText')
  const col = document.getElementById('addCol')
  if (!input.value.trim()) return
  const r = await fetch('/api/add', { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ text: input.value, heading: col.value }) })
  if (!r.ok) { const d = await r.json().catch(function(){return{}}); showToast(d && d.error ? d.error : 'add failed') }
  else showToast('Added to ' + col.options[col.selectedIndex].text)
  input.value = ''; load()
})
document.getElementById('addText').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('addBtn').click() }
})

document.getElementById('commit').addEventListener('click', async function() {
  const r = await fetch('/api/commit', { method:'POST' }); const d = await r.json()
  showToast(d.msg); setTimeout(load, 800)
})

document.getElementById('rotateBtn').addEventListener('click', async function() {
  const r = await fetch('/api/rotate-done', { method:'POST' })
  const d = await r.json()
  if (d.error) showToast('Error: ' + d.error)
  else showToast('Rotated ' + d.rotated + ' cards to archive, kept ' + d.kept)
  load()
})

// ---- Modal issue composer ----
// Pending images live as { name, mime, b64, dataUrl } until submit, when the
// card is created via /api/add (which returns the new raw line) and each
// image is attached against it via /api/attach.
var modalImages = []
var modalSubmitting = false

function openModal() {
  populateModalColSelect()
  modalImages = []
  document.getElementById('modalText').value = ''
  if (FILE_MODE) {
    document.getElementById('modalTitle').value = ''
    document.getElementById('modalType').value = ''
    document.getElementById('modalOwner').value = ''
  }
  renderModalThumbs()
  document.getElementById('modal-overlay').classList.add('open')
  setTimeout(function() {
    document.getElementById(FILE_MODE ? 'modalTitle' : 'modalText').focus()
  }, 30)
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open')
  modalImages = []
  renderModalThumbs()
}

function modalIsOpen() {
  return document.getElementById('modal-overlay').classList.contains('open')
}

function populateModalColSelect() {
  if (!state) return
  var sel = document.getElementById('modalCol')
  var prev = sel.value
  sel.innerHTML = ''
  for (var i = 0; i < state.cols.length; i++) {
    var opt = document.createElement('option')
    opt.value = state.cols[i].heading
    opt.textContent = state.cols[i].label
    sel.appendChild(opt)
  }
  // Default to the quick-add column choice, else first column.
  var addCol = document.getElementById('addCol').value
  if (prev && [].slice.call(sel.options).some(function(o) { return o.value === prev })) sel.value = prev
  else if (addCol) sel.value = addCol
}

function renderModalThumbs() {
  var wrap = document.getElementById('modalThumbs')
  wrap.innerHTML = ''
  for (var i = 0; i < modalImages.length; i++) {
    ;(function(idx) {
      var t = document.createElement('div')
      t.className = 'modal-thumb'
      var img = document.createElement('img')
      img.src = modalImages[idx].dataUrl
      img.alt = 'pending attachment'
      var rm = document.createElement('button')
      rm.className = 'modal-thumb-remove'
      rm.textContent = '\\u00d7'
      rm.title = 'Remove'
      rm.addEventListener('click', function() {
        modalImages.splice(idx, 1)
        renderModalThumbs()
      })
      t.appendChild(img)
      t.appendChild(rm)
      wrap.appendChild(t)
    })(i)
  }
}

function addModalFile(file) {
  if (!file || !file.type || !file.type.startsWith('image/')) { showToast('Only image files supported'); return }
  var reader = new FileReader()
  reader.onload = function(ev) {
    var dataUrl = ev.target.result
    var commaIdx = dataUrl.indexOf(',')
    modalImages.push({
      name: file.name || 'pasted-image',
      mime: file.type,
      b64: dataUrl.slice(commaIdx + 1),
      dataUrl: dataUrl,
    })
    renderModalThumbs()
  }
  reader.readAsDataURL(file)
}

async function submitModal() {
  if (modalSubmitting) return
  var text = document.getElementById('modalText').value.trim()
  var fm = null
  if (FILE_MODE) {
    // Title is the required field: it is all a column listing shows. Type and
    // owner are optional, and "not stated" writes no key at all.
    var title = document.getElementById('modalTitle').value.trim()
    if (!title) { showToast('A card needs a title'); document.getElementById('modalTitle').focus(); return }
    text = text ? title + '\\n\\n' + text : title
    fm = {
      type: document.getElementById('modalType').value,
      owner: document.getElementById('modalOwner').value,
    }
  }
  if (!text) { showToast('Card text cannot be empty'); document.getElementById('modalText').focus(); return }
  var heading = document.getElementById('modalCol').value
  modalSubmitting = true
  var submitBtn = document.getElementById('modalSubmit')
  submitBtn.disabled = true
  try {
    var r = await fetch('/api/add', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: text, heading: heading, fm: fm }),
    })
    var d = await r.json().catch(function() { return {} })
    if (!r.ok || !d.raw) {
      showToast(d.error || 'add failed')
      return
    }
    var rawLine = d.raw
    var cardId = d.id || ''
    // Attach each pending image against the freshly created card. Every attach
    // changes the card, so carry the token the server hands back into the next
    // request rather than reconstructing it here.
    var attached = 0
    for (var i = 0; i < modalImages.length; i++) {
      var ar = await fetch('/api/attach', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: cardId, raw: rawLine, name: modalImages[i].name, mime: modalImages[i].mime, data: modalImages[i].b64 }),
      })
      var ad = await ar.json().catch(function() { return {} })
      if (!ar.ok) { showToast(ad.error || 'attach failed'); break }
      rawLine = ad.raw || rawLine
      attached++
    }
    showToast('Created' + (attached > 0 ? ' with ' + attached + ' image' + (attached === 1 ? '' : 's') : ''))
    closeModal()
    load()
  } finally {
    modalSubmitting = false
    submitBtn.disabled = false
  }
}

document.getElementById('newBtn').addEventListener('click', openModal)
document.getElementById('modalClose').addEventListener('click', closeModal)
document.getElementById('modalCancel').addEventListener('click', closeModal)
document.getElementById('modalSubmit').addEventListener('click', submitModal)
document.getElementById('modal-overlay').addEventListener('mousedown', function(e) {
  if (e.target === document.getElementById('modal-overlay')) closeModal()
})
document.getElementById('modalDrop').addEventListener('click', function() {
  document.getElementById('modalFile').click()
})
document.getElementById('modalFile').addEventListener('change', function() {
  var files = document.getElementById('modalFile').files
  for (var i = 0; i < files.length; i++) addModalFile(files[i])
  document.getElementById('modalFile').value = ''
})
// Drag-drop image files onto the drop zone.
var modalDrop = document.getElementById('modalDrop')
modalDrop.addEventListener('dragover', function(e) {
  if (e.dataTransfer && e.dataTransfer.types && [].indexOf.call(e.dataTransfer.types, 'Files') >= 0) {
    e.preventDefault(); modalDrop.classList.add('dragover')
  }
})
modalDrop.addEventListener('dragleave', function() { modalDrop.classList.remove('dragover') })
modalDrop.addEventListener('drop', function(e) {
  modalDrop.classList.remove('dragover')
  if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) return
  e.preventDefault()
  for (var i = 0; i < e.dataTransfer.files.length; i++) addModalFile(e.dataTransfer.files[i])
})
// Paste images anywhere in the modal (capture phase so it wins over card paste).
document.getElementById('modal-overlay').addEventListener('paste', function(e) {
  var items = e.clipboardData && e.clipboardData.items
  if (!items) return
  var found = false
  for (var i = 0; i < items.length; i++) {
    if (items[i].kind === 'file' && items[i].type.startsWith('image/')) {
      var file = items[i].getAsFile()
      if (file) { addModalFile(file); found = true }
    }
  }
  if (found) e.preventDefault()
})
// Submit on Cmd/Ctrl+Enter from the textarea.
document.getElementById('modalText').addEventListener('keydown', function(e) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submitModal() }
})
if (FILE_MODE) {
  // Enter in the one-line title field goes to the body, Cmd+Enter still submits.
  document.getElementById('modalTitle').addEventListener('keydown', function(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submitModal(); return }
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('modalText').focus() }
  })
}

// ---- V2: chips, detail view, edit modal, digest, priority reorder ----------
// Everything below no-ops in legacy mode: FILE_MODE gates the call sites, and
// the elements these functions touch are not rendered there at all.

function chip(cls, text, title) {
  var s = document.createElement('span')
  s.className = 'chip ' + cls
  s.textContent = text
  if (title) s.title = title
  return s
}

function buildCardMeta(it) {
  if (!FILE_MODE) return null
  var bits = []
  if (it.type) bits.push(chip('chip-type-' + it.type, it.type, 'type: ' + it.type))
  if (it.owner) {
    var c = chip('chip-owner', '@' + it.owner, 'owner: ' + it.owner)
    c.dataset.owner = it.owner
    bits.push(c)
  }
  if (it.size) bits.push(chip('chip-size', it.size, 'size: ' + it.size))
  // Rot, made visible: nothing under 14 days, a whisper at 14, a shout at 30.
  // Reads rotAge (the older of the two clocks), so the migration did not reset
  // every card's age to zero.
  if (typeof it.rotAge === 'number' && it.rotAge >= 14) {
    var age = chip('chip-age' + (it.rotAge >= 30 ? ' old' : ''), it.rotAge + 'd',
      (typeof it.age === 'number' ? it.age + ' days in this column' : 'age unknown') +
      (typeof it.cardAge === 'number' ? ', card created ' + it.cardAge + ' days ago' : ''))
    bits.push(age)
  }
  if (!bits.length) return null
  var wrap = document.createElement('div')
  wrap.className = 'card-meta'
  for (var i = 0; i < bits.length; i++) wrap.appendChild(bits[i])
  return wrap
}

// ---- Light markdown, enough for a card body -------------------------------
// Paragraphs, bullets, bold/italic/code, links, and the board's own image refs.
// Deliberately not a markdown engine: escape first, then re-admit a short list
// of shapes, so a card body can never inject markup.
function mdInline(s) {
  var out = escHtml(s)
  out = out.replace(/\`([^\`]+)\`/g, '<code>$1</code>')
  out = out.replace(/!\\[([^\\]]*)\\]\\((docs\\/board-assets\\/[^)\\s]+)\\)/g, function(m, alt, path) {
    return '<img src="/assets/' + path.replace('docs/board-assets/', '') + '" alt="' + alt + '"/>'
  })
  out = out.replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^)\\s]+)\\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
  out = out.replace(/(^|[\\s(])(https?:\\/\\/[^\\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noreferrer">$2</a>')
  out = out.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
  // No single-* italics on purpose: real card bodies carry unbalanced ** from
  // the single-line era, and an italic rule spans them into whole-card italics.
  return out
}

function renderMarkdown(text) {
  var blocks = String(text || '').replace(/\\r/g, '').split(/\\n{2,}/)
  var html = ''
  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i].trim()
    if (!block) continue
    var lines = block.split('\\n')
    if (lines.every(function(l) { return /^\\s*[-*]\\s+/.test(l) })) {
      html += '<ul>' + lines.map(function(l) {
        return '<li>' + mdInline(l.replace(/^\\s*[-*]\\s+/, '')) + '</li>'
      }).join('') + '</ul>'
      continue
    }
    var h = block.match(/^#{2,6}\\s+(.*)$/)
    if (h && lines.length === 1) { html += '<h3>' + mdInline(h[1]) + '</h3>'; continue }
    html += '<p>' + lines.map(mdInline).join('<br/>') + '</p>'
  }
  return html || '<p style="color:var(--dim)">No body yet. Use Edit to add one.</p>'
}

// ---- Card lookup by id (the detail/edit modals key on it, not on position) --
function findItem(id) {
  if (!state) return null
  for (var ci = 0; ci < state.cols.length; ci++) {
    var col = state.cols[ci]
    for (var ki = 0; ki < col.items.length; ki++) {
      if (col.items[ki].id === id) return { item: col.items[ki], col: col }
    }
  }
  return null
}

// ---- Detail view ----------------------------------------------------------
var detailId = null

function v2Open(overlayId) { document.getElementById(overlayId).classList.add('open') }
function v2Close(overlayId) { document.getElementById(overlayId).classList.remove('open') }
function v2IsOpen(overlayId) {
  var el = document.getElementById(overlayId)
  return !!el && el.classList.contains('open')
}

function openDetail(id) {
  if (!FILE_MODE) return
  var found = findItem(id)
  if (!found) { showToast('Card is gone from the board'); load(true); return }
  detailId = id
  renderDetail()
  v2Open('detail-overlay')
  loadHistory(id)
}

function renderDetail() {
  var found = detailId ? findItem(detailId) : null
  if (!found) return
  var it = found.item
  var col = found.col
  document.getElementById('detailTitle').textContent = it.title
  document.getElementById('detailSub').textContent = it.id
  var facts = document.getElementById('detailFacts')
  facts.innerHTML = ''
  var rows = [
    ['column', col.label],
    ['owner', it.owner || 'not stated'],
    ['type', it.type || 'not stated'],
    ['size', it.size || 'not stated'],
    ['lane', it.lane || 'not stated'],
    ['priority', it.priority === null || it.priority === undefined ? 'not stated' : String(it.priority)],
    ['created', it.created || 'not stated'],
    ['in column', typeof it.age === 'number' ? it.age + 'd' : 'unknown'],
    ['card age', typeof it.cardAge === 'number' ? it.cardAge + 'd' : 'unknown'],
  ]
  if (it.doc) rows.push(['doc', it.doc])
  for (var i = 0; i < rows.length; i++) {
    var f = document.createElement('span')
    f.className = 'fact'
    f.innerHTML = rows[i][0] + ' <b>' + escHtml(String(rows[i][1])) + '</b>'
    facts.appendChild(f)
  }
  document.getElementById('detailBody').innerHTML = renderMarkdown(it.desc)
  var imgs = document.getElementById('detailImages')
  imgs.innerHTML = ''
  for (var j = 0; j < (it.images || []).length; j++) {
    ;(function(path) {
      var wrap = document.createElement('div')
      wrap.className = 'card-img-wrap'
      var img = document.createElement('img')
      img.src = '/assets/' + path.replace('docs/board-assets/', '')
      img.alt = 'attachment'
      img.title = 'Click to open full size'
      img.addEventListener('click', function() { window.open(img.src, '_blank') })
      var rm = document.createElement('button')
      rm.className = 'card-img-remove'
      rm.title = 'Remove attachment'
      rm.textContent = '\\u00d7'
      rm.addEventListener('click', function() { doRemoveAttachment(it.raw, path) })
      wrap.appendChild(img)
      wrap.appendChild(rm)
      imgs.appendChild(wrap)
    })(it.images[j])
  }
  var mv = document.getElementById('detailMove')
  mv.innerHTML = ''
  for (var k = 0; k < state.cols.length; k++) {
    var opt = document.createElement('option')
    opt.value = state.cols[k].heading
    opt.textContent = 'move to ' + state.cols[k].label
    if (state.cols[k].heading === col.heading) { opt.selected = true; opt.textContent = 'in ' + state.cols[k].label }
    mv.appendChild(opt)
  }
}

async function loadHistory(id) {
  var box = document.getElementById('detailHistory')
  box.innerHTML = '<div class="hist-row"><span class="s" style="color:var(--dim)">reading git...</span></div>'
  try {
    var r = await fetch('/api/history?id=' + encodeURIComponent(id))
    var d = await r.json().catch(function() { return {} })
    if (detailId !== id) return              // the owner moved on while git ran
    var commits = (d && d.commits) || []
    if (!commits.length) {
      box.innerHTML = '<div class="hist-row"><span class="s" style="color:var(--dim)">No commits yet: this card is not committed.</span></div>'
      return
    }
    box.innerHTML = commits.map(function(c) {
      return '<div class="hist-row"><span class="d">' + escHtml(c.date) + ' ' + escHtml(c.sha) +
        '</span><span class="s">' + escHtml(c.subject) + '</span></div>'
    }).join('')
  } catch (e) {
    box.innerHTML = '<div class="hist-row"><span class="s" style="color:var(--dim)">History unavailable.</span></div>'
  }
}

// ---- Edit modal -----------------------------------------------------------
// Title and body are separate fields against the SAME content-hash contract the
// inline editor used: we hold the token the card had when the modal opened, and
// a stale token still answers 409 + reload.
var editState = null   // { id, raw }

function openEditModal(id) {
  if (!FILE_MODE) return
  var found = findItem(id)
  if (!found) { showToast('Card is gone from the board'); load(true); return }
  var it = found.item
  editState = { id: it.id, raw: it.raw }
  document.getElementById('editTitle').value = it.title
  document.getElementById('editBody').value = it.desc || ''
  document.getElementById('editType').value = it.type || ''
  document.getElementById('editOwner').value = it.owner || ''
  document.getElementById('editSize').value = it.size || ''
  document.getElementById('editLane').value = it.lane || ''
  document.getElementById('editPriority').value =
    it.priority === null || it.priority === undefined ? '' : String(it.priority)
  v2Open('edit-overlay')
  setTimeout(function() { document.getElementById('editTitle').focus() }, 30)
}

function closeEditModal() {
  v2Close('edit-overlay')
  editState = null
}

async function saveEditModal() {
  if (!editState) return
  var title = document.getElementById('editTitle').value.trim()
  if (!title) { showToast('A card needs a title'); document.getElementById('editTitle').focus(); return }
  var body = document.getElementById('editBody').value.replace(/\\s+$/, '')
  var priority = document.getElementById('editPriority').value.trim()
  if (priority && !/^-?\\d{1,6}$/.test(priority)) { showToast('Priority must be a whole number'); return }
  var payload = {
    id: editState.id,
    raw: editState.raw,
    text: body ? title + '\\n\\n' + body : title,
    fm: {
      type: document.getElementById('editType').value,
      owner: document.getElementById('editOwner').value,
      size: document.getElementById('editSize').value,
      lane: document.getElementById('editLane').value.trim(),
      priority: priority,
    },
  }
  var btn = document.getElementById('editSave')
  btn.disabled = true
  try {
    var r = await fetch('/api/edit', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    })
    var d = await r.json().catch(function() { return {} })
    if (!r.ok) {
      showToast(d.error || 'save failed')
      if (r.status === 409) { closeEditModal(); v2Close('detail-overlay'); detailId = null; load(true) }
      return
    }
    closeEditModal()
    showToast('Saved')
    await load(true)
    if (detailId) renderDetail()
  } finally {
    btn.disabled = false
  }
}

// ---- "Waiting on you": the live decision digest ---------------------------
// One click, one list: the Waiting-on-owner column plus every card anywhere
// whose owner IS the owner.
function waitingOnYouItems() {
  var out = []
  var seen = Object.create(null)
  for (var ci = 0; ci < state.cols.length; ci++) {
    var col = state.cols[ci]
    for (var ki = 0; ki < col.items.length; ki++) {
      var it = col.items[ki]
      if (col.label !== 'Waiting on owner' && it.owner !== 'owner') continue
      if (seen[it.id]) continue
      seen[it.id] = true
      out.push({ item: it, col: col })
    }
  }
  return out
}

function openDigest() {
  if (!FILE_MODE || !state) return
  renderDigest()
  v2Open('digest-overlay')
}

function renderDigest() {
  var rows = waitingOnYouItems()
  var decisions = rows.filter(function(r) { return r.item.type === 'decision' }).length
  document.getElementById('digestSub').textContent =
    rows.length + ' card' + (rows.length === 1 ? '' : 's') +
    (decisions ? ', ' + decisions + ' typed as a decision' : '')
  var list = document.getElementById('digestList')
  list.innerHTML = ''
  if (!rows.length) {
    var empty = document.createElement('p')
    empty.className = 'hint'
    empty.textContent = 'Nothing is waiting on you. That is the whole point of the column.'
    list.appendChild(empty)
    return
  }
  for (var i = 0; i < rows.length; i++) {
    ;(function(row) {
      var el = document.createElement('div')
      el.className = 'digest-row'
      var t = document.createElement('div')
      t.className = 't'
      t.textContent = row.item.title
      el.appendChild(t)
      var meta = buildCardMeta(row.item) || document.createElement('div')
      meta.className = 'card-meta m'
      var where = chip('chip-size', row.col.label, 'column')
      meta.insertBefore(where, meta.firstChild)
      el.appendChild(meta)
      el.addEventListener('click', function() {
        v2Close('digest-overlay')
        openDetail(row.item.id)
      })
      list.appendChild(el)
    })(rows[i])
  }
}

// ---- Priority drag-reorder inside Ready ------------------------------------
// The drop position is read off the DOM at release: the card above the drop is
// prevId, the one below is nextId, and the server turns that into a midpoint
// priority written to the ONE card that moved.
function readyDropTargets(colEl, y, dragId) {
  var cards = [].slice.call(colEl.querySelectorAll('.card')).filter(function(el) {
    return el.dataset.id !== dragId && !el.classList.contains('filtered-out')
  })
  var prevId = ''
  var nextId = ''
  var beforeEl = null
  for (var i = 0; i < cards.length; i++) {
    var r = cards[i].getBoundingClientRect()
    if (y < r.top + r.height / 2) { nextId = cards[i].dataset.id; beforeEl = cards[i]; break }
    prevId = cards[i].dataset.id
  }
  return { prevId: prevId, nextId: nextId, beforeEl: beforeEl, container: colEl.querySelector('.cards') }
}

function clearDropMarker() {
  var m = document.getElementById('drop-marker')
  if (m && m.parentNode) m.parentNode.removeChild(m)
}

function showDropMarker(t) {
  clearDropMarker()
  if (!t.container) return
  var m = document.createElement('div')
  m.id = 'drop-marker'
  m.className = 'drop-marker'
  if (t.beforeEl) t.container.insertBefore(m, t.beforeEl)
  else t.container.appendChild(m)
}

async function doReorder(id, prevId, nextId) {
  var r = await fetch('/api/reorder', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: id, prevId: prevId, nextId: nextId }),
  })
  var d = await r.json().catch(function() { return {} })
  if (!r.ok) { showToast(d.error || 'reorder failed'); load(true); return }
  showToast(d.renumbered ? 'Reordered, renumbered ' + d.renumbered + ' cards' : 'Reordered')
  load(true)
}

// ---- V2 wiring (only these elements exist in file mode) --------------------
if (FILE_MODE) {
  var markFilter = function(sel) {
    if (sel.value) sel.classList.add('on')
    else sel.classList.remove('on')
  }
  var wireFilter = function(id, apply) {
    var sel = document.getElementById(id)
    sel.addEventListener('change', function() {
      apply(sel.value)
      markFilter(sel)
      render()
    })
  }
  wireFilter('fType', function(v) { filterType = v })
  wireFilter('fOwner', function(v) { filterOwner = v })
  wireFilter('fAge', function(v) { filterAge = v })
  document.getElementById('clearFilters').addEventListener('click', function() {
    filterType = filterOwner = filterAge = ''
    ;['fType', 'fOwner', 'fAge'].forEach(function(id) {
      var s = document.getElementById(id)
      s.value = ''
      markFilter(s)
    })
    render()
  })
  document.getElementById('waitingBtn').addEventListener('click', openDigest)
  document.getElementById('digestClose').addEventListener('click', function() { v2Close('digest-overlay') })
  document.getElementById('digestDone').addEventListener('click', function() { v2Close('digest-overlay') })
  document.getElementById('digest-overlay').addEventListener('mousedown', function(e) {
    if (e.target === document.getElementById('digest-overlay')) v2Close('digest-overlay')
  })

  document.getElementById('detailClose').addEventListener('click', function() {
    v2Close('detail-overlay'); detailId = null
  })
  document.getElementById('detail-overlay').addEventListener('mousedown', function(e) {
    if (e.target === document.getElementById('detail-overlay')) { v2Close('detail-overlay'); detailId = null }
  })
  document.getElementById('detailEdit').addEventListener('click', function() { openEditModal(detailId) })
  document.getElementById('detailKickoff').addEventListener('click', function() {
    var found = detailId ? findItem(detailId) : null
    if (found) copyKickoff(found.item, found.col)
  })
  document.getElementById('detailMove').addEventListener('change', function(e) {
    var found = detailId ? findItem(detailId) : null
    if (!found) return
    doMoveCard(found.item.id, found.item.raw, e.target.value)
    v2Close('detail-overlay')
    detailId = null
  })

  document.getElementById('editClose').addEventListener('click', closeEditModal)
  document.getElementById('editCancel').addEventListener('click', closeEditModal)
  document.getElementById('editSave').addEventListener('click', saveEditModal)
  document.getElementById('edit-overlay').addEventListener('mousedown', function(e) {
    if (e.target === document.getElementById('edit-overlay')) closeEditModal()
  })
}

document.addEventListener('keydown', function(e) {
  const tag = document.activeElement.tagName
  const inInput = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA'

  // V2 overlays own Escape while open, innermost first.
  if (FILE_MODE) {
    if (v2IsOpen('edit-overlay')) {
      if (e.key === 'Escape') { e.preventDefault(); closeEditModal() }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); saveEditModal() }
      return
    }
    if (v2IsOpen('digest-overlay')) {
      if (e.key === 'Escape') { e.preventDefault(); v2Close('digest-overlay') }
      return
    }
    if (v2IsOpen('detail-overlay')) {
      if (e.key === 'Escape') { e.preventDefault(); v2Close('detail-overlay'); detailId = null }
      if (e.key === 'e' && !inInput) { e.preventDefault(); openEditModal(detailId) }
      return
    }
    if (e.key === 'w' && !inInput && !modalIsOpen()) { e.preventDefault(); openDigest(); return }
  }

  // Modal owns Escape while open.
  if (modalIsOpen()) {
    if (e.key === 'Escape') { e.preventDefault(); closeModal() }
    return
  }
  // 'n' opens the composer (not while typing).
  if (e.key === 'n' && !inInput) {
    e.preventDefault()
    openModal()
    return
  }

  if (e.key === '/' && !inInput) {
    e.preventDefault()
    document.getElementById('search').focus()
    return
  }
  if (e.key === 'Escape') {
    // Close move menu first if open
    if (moveMenuCard && !inInput) {
      moveMenuCard = null
      render()
      return
    }
    // If a card is expanded, collapse it first
    if (expandedCards.size > 0 && !inInput) {
      expandedCards.clear()
      editingCard = null
      pasteTargetCard = null
      render()
      return
    }
    document.getElementById('search').value = ''
    searchQuery = ''
    activeFilters.clear()
    document.querySelectorAll('.filter-btn.active').forEach(function(b) { b.classList.remove('active') })
    document.activeElement.blur()
    render()
    return
  }
  if (inInput) return
  if (e.key === 'j') { e.preventDefault(); if (!focusedCard) focusedCard = { ci:0, ki:-1 }; moveFocus(1) }
  if (e.key === 'k') { e.preventDefault(); if (!focusedCard) focusedCard = { ci:0, ki:0 }; moveFocus(-1) }
  if ((e.key === 'Enter' || e.key === 'o') && focusedCard) {
    // Expand/collapse the focused card if it has a description or images
    if (!state) return
    const col = state.cols[focusedCard.ci]
    if (!col) return
    const it = col.items[focusedCard.ki]
    if (it && FILE_MODE) { e.preventDefault(); openDetail(it.id); return }
    if (it && (it.desc || (it.images && it.images.length > 0))) { e.preventDefault(); toggleExpand(it.raw) }
  }
  if (e.key === 'm' && focusedCard) {
    if (!state) return
    const mCol = state.cols[focusedCard.ci]
    if (!mCol) return
    const mIt = mCol.items[focusedCard.ki]
    if (mIt) { e.preventDefault(); toggleMoveMenu(mIt.raw) }
  }
})

load(true)
setInterval(load, 2000)
</script></body></html>`

const server = createServer((req, res) => {
  const send = (code, body, type = 'application/json') => {
    res.writeHead(code, { 'content-type': type })
    res.end(typeof body === 'string' ? body : JSON.stringify(body))
  }
  try {
    if (req.method === 'GET' && req.url === '/') return send(200, HTML, 'text/html')
    if (req.method === 'GET' && req.url === '/api/board') {
      const { cols } = parse()
      return send(200, { cols, dirty: gitDirty() })
    }
    if (req.method === 'GET' && req.url === '/api/index') {
      return send(200, renderIndex(), 'text/markdown; charset=utf-8')
    }
    if (req.method === 'GET' && req.url && req.url.startsWith('/api/history')) {
      try {
        const id = new URL(req.url, 'http://board.local').searchParams.get('id') || ''
        return send(200, { commits: cardHistory(id) })
      } catch (e) {
        return send(e.status || 400, { error: String(e.message || e) })
      }
    }

    // Serve static assets from docs/board-assets/
    if (req.method === 'GET' && req.url && req.url.startsWith('/assets/')) {
      const fileName = req.url.slice('/assets/'.length)
      // Reject path traversal
      const absPath = resolve(ASSETS_DIR, fileName)
      if (!absPath.startsWith(ASSETS_DIR + '/')) {
        return send(403, { error: 'forbidden' })
      }
      // Only allow safe filenames (no slashes, no dots at start)
      if (fileName.includes('/') || fileName.startsWith('.') || !fileName.match(/^[\w\-]+\.(png|jpg|jpeg|gif|webp)$/i)) {
        return send(403, { error: 'forbidden' })
      }
      if (!existsSync(absPath)) return send(404, { error: 'not found' })
      const ext = extname(fileName).toLowerCase()
      const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }
      const ct = mimeMap[ext] || 'application/octet-stream'
      const data = readFileSync(absPath)
      res.writeHead(200, { 'content-type': ct })
      res.end(data)
      return
    }

    if (req.method === 'POST') {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        try {
          const data = body ? JSON.parse(body) : {}
          if (req.url === '/api/move') {
            try {
              const makeDone = data.to === 'Done (recent)' ? true : data.done
              moveItem(Number(data.id), String(data.raw ?? ''), data.to, makeDone, String(data.id ?? ''))
              return send(200, { ok: true })
            } catch (e) {
              return send(e.status || 400, { error: String(e.message || e) })
            }
          }
          if (req.url === '/api/add') {
            try {
              const heading = data.heading || 'Unsorted intake'
              const { id, raw } = addItem(String(data.text ?? ''), heading, data.fm)
              return send(200, { ok: true, id, raw })
            } catch (e) {
              return send(e.status || 400, { error: String(e.message || e) })
            }
          }
          if (req.url === '/api/edit') {
            try {
              // text omitted entirely = frontmatter-only edit, which leaves the
              // body bytes alone.
              const text = data.text === undefined || data.text === null ? null : String(data.text)
              const raw = editItem(String(data.raw ?? ''), text, String(data.id ?? ''), data.fm)
              return send(200, { ok: true, raw })
            } catch (e) {
              return send(e.status || 400, { error: String(e.message || e) })
            }
          }
          if (req.url === '/api/reorder') {
            try {
              return send(200, {
                ok: true,
                ...reorderReady(String(data.id ?? ''), String(data.prevId ?? ''), String(data.nextId ?? '')),
              })
            } catch (e) {
              return send(e.status || 400, { error: String(e.message || e) })
            }
          }
          if (req.url === '/api/delete') {
            try {
              deleteItem(String(data.raw ?? ''), String(data.id ?? ''))
              return send(200, { ok: true })
            } catch (e) {
              return send(e.status || 400, { error: String(e.message || e) })
            }
          }
          if (req.url === '/api/attach') {
            try {
              const mime = String(data.mime ?? '')
              const { path: relPath, raw } = attachImage(
                String(data.raw ?? ''),
                String(data.name ?? 'image'),
                mime,
                String(data.data ?? ''),
                String(data.id ?? '')
              )
              return send(200, { ok: true, path: relPath, raw })
            } catch (e) {
              return send(e.status || 400, { error: String(e.message || e) })
            }
          }
          if (req.url === '/api/remove-attachment') {
            try {
              removeAttachment(String(data.raw ?? ''), String(data.imagePath ?? ''), String(data.id ?? ''))
              return send(200, { ok: true })
            } catch (e) {
              return send(e.status || 400, { error: String(e.message || e) })
            }
          }
          if (req.url === '/api/rotate-done') {
            const result = rotateDone()
            return send(200, result)
          }
          if (req.url === '/api/commit') return send(200, commit())
          return send(404, { error: 'not found' })
        } catch (e) {
          return send(400, { error: String(e.message || e) })
        }
      })
      return
    }
    send(404, { error: 'not found' })
  } catch (e) {
    send(500, { error: String(e.message || e) })
  }
})

// Run as a script = serve (or print an index and exit). Imported (tests) =
// the data layer above with no listening socket and no side effects.
const IS_MAIN = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false

export {
  parse, parseLegacy, parseFileMode, fileMode,
  moveItem, addItem, editItem, deleteItem,
  attachImage, removeAttachment, rotateDone, renderIndex,
  parseFrontmatter, serializeCard, slugify, hashOf,
  splitTitleDesc, extractImageRefs, parseBadges,
  reorderReady, cardHistory, applyFmPatch, replaceFrontmatter,
  COLUMNS, OWNERS, TYPES, SIZES, COLUMN_DIRS, BOARD_DIR, ROOT,
}

// No process.exit() here: it truncates a piped stdout mid-write. With no
// listening socket the process ends on its own once the write drains.
const INDEX_ONLY = IS_MAIN && process.argv.includes('--index')
if (INDEX_ONLY) {
  // `npm run board:index | head` closes the pipe early; that is normal use,
  // not a crash.
  process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0) })
  process.stdout.write(renderIndex() + '\n')
}

// Auto-harden to the next free port when the chosen one is taken. The Claude
// preview panel (autoPort:true) already hands us a free PORT so this never
// fires there; it only kicks in for a plain `npm run board` started while
// another board holds the port. Capped so a truly stuck range fails loudly.
let portTries = 0
if (IS_MAIN && !INDEX_ONLY) {
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && portTries++ < 50) {
      console.log(`Board: port ${PORT} in use, trying ${PORT + 1}...`)
      PORT += 1
      setTimeout(() => server.listen(PORT), 80)
    } else {
      throw err
    }
  })
  server.listen(PORT, () => {
    const source = fileMode() ? 'docs/board/' : 'docs/backlog.md'
    console.log(`Board: http://localhost:${PORT} (source of truth: ${source})`)
    // Publish the actually-bound port for local consumers (workspace Board tab).
    try { mkdirSync(dirname(PORTFILE), { recursive: true }); writeFileSync(PORTFILE, String(PORT)) } catch {}
  })
  // Best-effort cleanup so a stale portfile doesn't point the workspace at a dead port.
  for (const sig of ['SIGINT', 'SIGTERM', 'exit']) {
    process.on(sig, () => { try { if (existsSync(PORTFILE)) unlinkSync(PORTFILE) } catch {} })
  }
}
