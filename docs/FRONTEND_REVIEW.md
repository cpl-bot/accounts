# Talai frontend — review and changes (Phase 0)

This documents the state of the v0.app-generated scaffold as received, what
was found, and what changed while building the frontend half of Phase 0
(rename, API layer, demo mode, Configuration page, test harness, and wiring
the existing screens to real data). Owner: frontend (this document, `app/`,
`components/`, `lib/`, `tests/`). See `docs/ENGINEERING_PLAN.md` §4 for the
target architecture this review is measured against.

## What existed

**Routes** (`app/`, App Router, one route group `(app)` with a shared
`Sidebar`):

- `/dashboard` — Overview and Payables & Receivables tabs, entirely from
  `lib/mock-data.ts`.
- `/accounts-payable` and `/accounts-payable/create` — bills table + Create
  Bill form, both against mock data.
- `/configuration`, `/banking`, `/journal-voucher`, `/accounts-receivable`,
  `/vendors`, `/customers`, `/gstr-2b`, `/user-access` — all rendered
  `ComingSoon` (a placeholder card), including Configuration, which the PRD
  treats as core.
- `/` redirects to `/dashboard`.

**Components**: `components/dashboard/*` (Recharts wrappers + primitives),
`components/ap/*` (bills table, sync modal, upload modal, create-bill form),
`components/layout/*` (Sidebar, PageHeader, ComingSoon, Modal), `components/
ui/*` (shadcn/base-ui primitives: Button, Card, Badge, Field/Input/Select/
Textarea).

**Data**: `lib/mock-data.ts` — one file holding company info, dashboard
figures, chart trends, AP/AR aging, a `bills` array, sync items, and a fake
Tally connection object. `lib/format.ts` — Indian-numbering formatters
(`formatINR`, `formatLakh`, `formatAxisLakh`, `formatPercent`) — the only
already-testable, dependency-free unit in the codebase.

## Quality findings (ranked, most important first)

1. **`typescript.ignoreBuildErrors: true` in `next.config.mjs`.** This was
   hiding real type errors: `recharts` `Tooltip formatter` signatures
   (`gross-profit-chart.tsx`, `income-expense-chart.tsx`,
   `cash-flow-chart.tsx`) and a structural mismatch in `AgingPanel`'s prop
   type (`payables-tab.tsx` passed `arAging`, which lacks
   `daysPayableOutstanding`, into a component typed as `typeof apAging`).
   **Fixed**: flag set to `false`, all three call sites corrected, and
   `AgingPanel`'s prop type narrowed to the fields it actually uses instead
   of aliasing a mock object's shape.
2. **No API layer at all.** Every screen imported `lib/mock-data.ts`
   directly; there was no fetch wrapper, no schema validation, no server
   proxy, and no notion of loading or error states. This was the biggest gap
   against the engineering plan and the main body of this phase's work (see
   "What changed" below).
3. **`Modal` (`components/ui/modal.tsx`) had no focus management.** No
   Escape-to-close, no focus moved into the dialog on open, no focus trap, no
   `aria-labelledby`, and focus wasn't restored to the trigger on close — a
   real problem given the app is modal-heavy (Sync, Upload). **Fixed**.
4. **`BillsTable` pagination was fake.** The rows-per-page `<select>` had no
   `onChange`, the Prev/Next buttons had no handlers, and the footer always
   read "1 - N of 40" with a hard-coded total. **Fixed**: pagination is now
   real and client-side over whatever rows the parent passes in.
5. **`SyncModal` simulated success with `setTimeout(…, 1600)`** and never
   called any endpoint — clicking "Sync" always "succeeded" after a fixed
   delay regardless of what was selected. **Fixed**: now calls `POST
   /sync/push` and renders the actual per-record results, including a
   dry-run notice when the middleware reports `dry_run: true`.
6. **Hard-coded dates and a hard-coded company.** `dashboard/page.tsx` passed
   a literal `"May 01, 2026 – May 12, 2026"` range to `PayablesTab`
   regardless of the period selector; `mock-data.ts`'s `company` object was
   the only source of the org name and user shown in the sidebar, with an
   email domain (`aiaccountant.io`) that didn't match the product name
   either. **Partially fixed**: the Overview tab's period selector now maps
   to real ISO `from`/`to` dates (see the open question on FY semantics
   below); the Payables tab's `range` label is still a hard-coded display
   string passed to `AgingPanel`, since the plan's `/dashboard/payables`
   contract doesn't return a range label — flagged as an open item.
   `mock-data.ts` is now explicitly framed as test/demo fixture data (see
   below), and its email domain was changed to `talai.local`.
7. **No tests of any kind.** No test runner, no config, nothing under
   `tests/`. **Fixed**: Vitest + RTL + MSW harness added, 36 tests written
   (unit, component, one route-handler test, one schema-contract test).
8. **Accessibility gaps beyond the Modal**: icon-only buttons generally do
   have `aria-label`s (good), but there was no live region for async state
   (loading/error), and interactive elements added during wiring (retry
   buttons, status pill) needed `role="status"` / accessible names added
   deliberately rather than inherited for free. Addressed inline as
   components were wired; not exhaustively audited beyond what this phase
   touched.
9. **Vercel Analytics (`@vercel/analytics`) shipped in `app/layout.tsx`** for
   what is explicitly a LAN-only, internal accounting tool with no public
   internet exposure planned — sending page-view telemetry to Vercel makes no
   sense here and is a needless network dependency for an app that must also
   work when the office internet is flaky. **Removed** (package uninstalled,
   `<Analytics />` deleted from the layout).
10. **Google Fonts (`next/font/google`, Geist/Geist Mono) in
    `app/layout.tsx`.** This makes `next build` fetch fonts from
    `fonts.googleapis.com` at build time — it fails outright with no network
    access, which is exactly the condition the LAN deployment (and, as it
    turned out, this very build environment) runs under. **Fixed**: swapped
    to a system-font stack (`ui-sans-serif, system-ui, ...` /
    `ui-monospace, ...`) in `app/globals.css`'s `--font-sans`/`--font-mono`
    tokens; visually near-identical on any modern OS and removes the
    build-time network dependency entirely. If a specific brand typeface is
    wanted later, self-host the font files (`next/font/local`) rather than
    reintroducing a build-time fetch.
11. **Naming**: "AI Accountant" in the sidebar and page metadata, `name:
    "my-project"` in `package.json`, `generator: 'v0.app'` in metadata.
    **Fixed** — renamed to Talai everywhere (see below).

## What changed (this phase)

- **Rename to Talai**: `package.json` name, `app/layout.tsx` metadata
  (title/description, `generator` removed), sidebar brand text (now reads
  `NEXT_PUBLIC_APP_NAME` with a `'Talai'` fallback), mock user's email domain.
- **Build hygiene**: `ignoreBuildErrors` removed and all resulting type
  errors fixed; `@vercel/analytics` removed; Google Fonts replaced with a
  system stack so `next build` succeeds fully offline.
- **API layer** (`lib/api/`):
  - `schema.ts` — zod schemas (+ inferred types) for every response shape in
    plan §3.6, plus `draftPurchaseBillSchema` mirroring the `DraftPurchaseBill`
    JSON example verbatim (covered by a contract test).
  - `client.ts` — `apiFetch<T>(path, schema, init)`: relative `/api/talai/*`
    requests from the browser, direct `MIDDLEWARE_URL` calls from the server,
    zod-validated responses, and a typed `ApiError { code, message, status }`
    thrown on any failure (network error, non-2xx, or schema mismatch).
  - `hooks.ts` — `useTallyStatus` (30s poll), `useDashboardOverview(from, to)`,
    `useDashboardPayables(asOn?)`, `useBills(direction, asOn?)`,
    `useDrafts(status?)`, `useSettings()`. No SWR/React Query — a small
    internal `useResource` hook does fetch + loading/error/refetch state; the
    query string produced by `apiPath()` already encodes every value a
    request depends on, so it doubles as the effect's dependency key.
  - `app/api/talai/[...path]/route.ts` — proxies GET/POST/PUT/DELETE
    (including multipart bodies, passed through as raw `ArrayBuffer`) to
    `${MIDDLEWARE_URL}/api/v1/<path>`, adding the bearer token server-side so
    it never reaches client JS. Returns a `502` with the `{error:{code,
    message}}` shape when the middleware is unreachable (`fetch` throws).
  - `demo-fixtures.ts` — builds middleware-shaped fixtures from
    `lib/mock-data.ts`; shared by MSW (tests) and by the proxy route in demo
    mode, so the two never drift apart.
- **Demo mode**: `NEXT_PUBLIC_DEMO_MODE=true` makes the proxy route return
  fixtures for every endpoint the app currently calls instead of forwarding,
  so the UI is fully explorable with no middleware running. `lib/mock-data.ts`
  now carries a header comment clarifying it is test/demo fixture data, not
  live application data.
- **Test harness**: Vitest (jsdom) + React Testing Library + MSW +
  `@testing-library/user-event`, configured via `vitest.config.ts` (alias
  `@` → repo root, setup file `tests/setup.ts`). Scripts: `pnpm test`,
  `pnpm test:watch`, `pnpm typecheck`, `pnpm lint` (flat-config ESLint via
  `eslint-config-next`, since `next lint` is gone in Next 16). **36 tests**
  across 11 files: `lib/format.ts` (15), zod schema contract (3), the proxy
  route with a mocked `global.fetch` (3), Modal focus/Escape behavior (3),
  BillsTable pagination (2), ConnectionForm (3), SyncModal (1), UploadModal
  (1), CreateBillForm (2), and one smoke test each for the dashboard tabs and
  the Accounts Payable page (2).
- **Configuration page** (`app/(app)/configuration/page.tsx`): now real,
  not `ComingSoon`. `components/configuration/connection-form.tsx` loads
  current settings (`GET /settings`), lets the user test host/port (`POST
  /tally/test-connection`, showing reachable/latency/error), lists companies
  found in Tally (`GET /tally/companies`) as a picker once a company set is
  known, edits the sync interval, and saves (`PUT /settings`). The
  write-enabled flag is shown read-only with an explicit note that it is
  controlled by `TALLY_WRITE_ENABLED` on the middleware, per the plan's
  security model (§6) — the UI must never be able to flip that switch itself.
  `components/layout/tally-status-pill.tsx` polls `useTallyStatus` and is now
  rendered in every `PageHeader`.
- **Modal accessibility**: Escape closes (with focus restored to whatever
  triggered the modal), focus moves into the dialog on open and is trapped
  with Tab/Shift+Tab, and `aria-labelledby` points at the title.
- **BillsTable pagination**: real, client-side, over whatever `bills` array
  the parent passes — row-per-page select and Prev/Next both work, the
  footer range is computed, and the buttons disable correctly at the ends.
- **Screens wired to the API** (with loading skeletons and an error state +
  retry button in each case):
  - Dashboard **Overview** — `useDashboardOverview(from, to)`; the period
    selector now maps to real ISO date ranges (Indian FY: Apr 1 – Mar 31);
    the three trend charts (`GrossProfitChart`, `IncomeExpenseChart`,
    `CashFlowChart`) now take a `data` prop instead of importing
    `lib/mock-data` directly.
  - Dashboard **Payables & Receivables** — `useDashboardPayables()`; the
    per-bucket detail panel (`AgingPanel`) now takes a narrowed structural
    type instead of `typeof apAging`, fixing the type error noted above and
    letting it accept either payables or receivables data safely.
  - **Accounts Payable** list — merges `useBills('payable')` (replica
    purchase vouchers → "All Bills") with `useDrafts()` (drafts with
    validation errors → "Needs Review"); see the open question on "Bill
    Uploads" below.
  - **Sync modal** — `POST /sync/push`, renders committed/failed per record
    with error text, and a dry-run banner when `run.dry_run` is true.
  - **Upload modal** — `POST /attachments`, one file at a time (sequential
    even when several are dropped), per-file status (uploading/done/error).
  - **Create Bill form** — builds a `DraftPurchaseBill` from form state,
    validates it against `draftPurchaseBillSchema` client-side before
    sending, `POST /drafts`, renders `validation_issues` inline (grouped
    visually by severity), and "Queue for sync" → `POST
    /drafts/{id}/queue`, disabled until the draft has zero blocking errors.
- **`.env.example`** added at the repo root with commented
  `MIDDLEWARE_URL`, `MIDDLEWARE_API_KEY`, `NEXT_PUBLIC_DEMO_MODE`,
  `NEXT_PUBLIC_APP_NAME`, `PORT`, `HOSTNAME=0.0.0.0` (for LAN binding).

## What to keep

- The visual design system as-is (Tailwind 4 tokens in `globals.css`,
  shadcn/base-ui primitives in `components/ui/`) — it's coherent and the plan
  explicitly asks to preserve it.
- The route/component split (`app/(app)/...` thin pages, `components/ap|
  dashboard/...` doing the work) — it maps cleanly onto adding real data.
- `lib/format.ts` as-is; it was already well-isolated and is now covered by
  tests.
- `lib/mock-data.ts`'s shape as a fixture source — reusing it for both demo
  mode and MSW (via `demo-fixtures.ts`) keeps the two from drifting.

## What to change next (not done in this phase)

- **`AgingBar`/`AgingPanel`/mock-data's `AgingBucket` type** is still
  imported from `lib/mock-data.ts` in two places
  (`components/dashboard/aging-bar.tsx`, `aging-panel.tsx`) even though the
  live data now comes from `lib/api/schema.ts`'s own `AgingBucket`. The two
  are structurally identical so this compiles and works, but it's a
  dependency in the wrong direction (dashboard components depending on test
  fixtures for a type) — worth pointing both at the schema type directly.
- **"Bill Uploads" tab** in Accounts Payable still approximates "attachments
  awaiting a draft" using drafts with no validation errors, because the
  middleware doesn't yet expose a distinct attachments-without-a-draft list
  through an endpoint this phase wired up (`POST /attachments` exists per
  the contract, but there's no `GET /attachments`). Once that exists, this
  tab should query it directly instead of inferring "uploaded" from draft
  status.
- **Payables tab's `range` label** passed into `AgingPanel` is still a
  literal string, not derived from `/dashboard/payables`'s response — the
  endpoint returns only `as_on`, not a range. Either add a `from`/`to` (or a
  human label) to that response, or drop the label from the panel.
- **Full accessibility audit** — this phase fixed the Modal and added
  accessible names/`role="status"` where new UI was built, but didn't
  audit the pre-existing screens (e.g. keyboard navigation through
  `BillsTable`'s row actions menu, the `PeriodSelect` dropdown's keyboard
  behavior).
- **No optimistic UI / retry-with-backoff** anywhere — every hook does a
  single fetch and a manual "Retry" button; fine for a LAN app with a human
  at the keyboard, but worth revisiting if sync becomes automatic/background.

## Open product questions

1. **Fiscal-year semantics**: `dashboard/page.tsx`'s period selector
   currently assumes an Apr 1 – Mar 31 Indian FY when computing "Current/
   Previous Fiscal Year" `from`/`to`. Is this always true for every company
   Talai will connect to, or does the middleware know the company's actual
   FY start (Tally stores this per company) and should expose it so the
   frontend doesn't hard-code the assumption?
2. **What does "Needs Review" mean without OCR running yet?** The plan's
   MVP OCR is explicitly a mock/best-effort (`(mock) OCR` in §3.6's
   `/attachments` row). Today "Needs Review" is implemented as "drafts with
   at least one `error`-severity validation issue" — is that the intended
   long-term definition, or should it also include drafts whose OCR
   confidence was low, once OCR is real? The two are different triage
   queues for a bookkeeper.
3. **Attachments lifecycle**: is there a `GET /attachments` (or
   `/attachments?linked=false`) planned for Phase 1, so "Bill Uploads" can
   be its own real list instead of inferred from draft state? See "What to
   change next" above.
4. **Multi-branch GST registrations**: the Create Bill form's "GST
   Registration (my branch)" is still a hard-coded two-option select. Should
   this come from `/settings` (the company's registered GSTINs) once that's
   modeled, rather than being a client-side constant?
5. **Sync selection granularity**: `SyncModal`'s item picker (Transactions/
   Bills/Invoices/Vendors/Customers/Journal Vouchers) doesn't map onto
   `POST /sync/push`'s actual parameter (`draft_ids?`) — today the modal
   always pushes "all queued drafts" regardless of which categories are
   checked, because the middleware's push endpoint operates on drafts, not
   on data categories. Is the categorized picker meant for a future
   `POST /sync/pull` (masters/vouchers/bills scopes), and should today's
   "push queued drafts" flow have simpler UI instead of a selector that
   doesn't currently do anything?
