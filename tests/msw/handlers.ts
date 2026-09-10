// MSW request handlers used by frontend tests. Built from the same fixtures
// that back NEXT_PUBLIC_DEMO_MODE (lib/api/demo-fixtures.ts) so a contract
// change only needs updating in one place.

import { http, HttpResponse } from 'msw'
import {
  demoAttachments,
  demoBills,
  demoDashboardFormula,
  demoDashboardOverview,
  demoDashboardPayables,
  demoDraft,
  demoDrafts,
  demoLedgerLookup,
  demoLedgers,
  demoPushResult,
  demoSettings,
  demoSyncRunList,
  demoSyncStatus,
  demoTallyStatus,
} from '@/lib/api/demo-fixtures'
import type { SyncScope } from '@/lib/api/schema'

const API = '/api/talai'

export const handlers = [
  http.get(`${API}/tally/status`, () => HttpResponse.json(demoTallyStatus())),
  http.post(`${API}/tally/test-connection`, () => HttpResponse.json(demoTallyStatus())),
  http.get(`${API}/tally/companies`, () =>
    HttpResponse.json({ companies: demoTallyStatus().companies }),
  ),
  http.get(`${API}/settings`, () => HttpResponse.json(demoSettings())),
  http.put(`${API}/settings`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    return HttpResponse.json({ ...demoSettings(), ...body })
  }),
  http.get(`${API}/dashboard/overview`, () => HttpResponse.json(demoDashboardOverview())),
  http.get(`${API}/dashboard/payables`, () => HttpResponse.json(demoDashboardPayables())),
  http.get(`${API}/bills`, ({ request }) => {
    const direction = new URL(request.url).searchParams.get('direction')
    return HttpResponse.json(demoBills(direction === 'receivable' ? 'receivable' : 'payable'))
  }),
  http.get(`${API}/drafts`, () => HttpResponse.json(demoDrafts())),
  http.post(`${API}/drafts`, async ({ request }) => {
    const payload = (await request.json()) as Record<string, unknown>
    return HttpResponse.json(demoDraft({ id: 'draft-new', payload }))
  }),
  http.post(`${API}/drafts/:id/queue`, ({ params }) =>
    HttpResponse.json(demoDraft({ id: String(params.id), status: 'queued', payload: {} })),
  ),
  http.post(`${API}/sync/push`, async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { draft_ids?: string[] | null }
    return HttpResponse.json(demoPushResult(body.draft_ids ?? ['draft-1']))
  }),
  http.post(`${API}/sync/pull`, async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { scopes?: SyncScope[] }
    return HttpResponse.json(demoSyncRunList(body.scopes))
  }),
  http.get(`${API}/sync/status`, () => HttpResponse.json(demoSyncStatus())),
  http.post(`${API}/attachments`, () => HttpResponse.json(demoAttachments()[0] ?? null)),
  http.get(`${API}/attachments`, () => HttpResponse.json({ items: demoAttachments(), total: demoAttachments().length })),
  http.get(`${API}/attachments/:id`, ({ params }) => {
    const found = demoAttachments().find((a) => a.id === params.id) ?? demoAttachments()[0]
    return HttpResponse.json(found)
  }),
  http.post(`${API}/attachments/:id/ocr`, ({ params }) => {
    const found = demoAttachments().find((a) => a.id === params.id) ?? demoAttachments()[0]
    return HttpResponse.json(found)
  }),
  http.post(`${API}/attachments/:id/draft`, ({ params }) =>
    HttpResponse.json(
      demoDraft({
        id: `draft-from-${params.id}`,
        payload: {},
        needs_review: true,
        review_reasons: ['Low OCR confidence on invoice number'],
        attachment_id: String(params.id),
      }),
    ),
  ),
  http.get(`${API}/drafts/:id`, ({ params }) =>
    HttpResponse.json(
      demoDraft({
        id: String(params.id),
        // Decimal fields come back from the middleware as strings.
        payload: { party: { ledger_name: 'BioShield Medical' }, totals: { grand_total: '617308.00' } },
        needs_review: true,
        review_reasons: ['Low OCR confidence on invoice number'],
        attachment_id: 'att-9',
      }),
    ),
  ),
  http.put(`${API}/drafts/:id`, async ({ params, request }) => {
    const payload = (await request.json()) as Record<string, unknown>
    return HttpResponse.json(demoDraft({ id: String(params.id), payload }))
  }),
  http.get(`${API}/ledgers/lookup`, ({ request }) => {
    const name = new URL(request.url).searchParams.get('name') ?? ''
    return HttpResponse.json(demoLedgerLookup(name))
  }),
  http.get(`${API}/ledgers`, () => HttpResponse.json({ items: demoLedgers(), total: demoLedgers().length })),
  // Mirrors the real dry-run response: `ledger` is null when nothing was
  // written to Tally (VendorLedgerCreated in api/schemas.py).
  http.post(`${API}/ledgers`, async ({ request }) => {
    const body = (await request.json()) as { name: string }
    return HttpResponse.json({
      dry_run: true,
      generated_xml: `<ENVELOPE><LEDGER NAME="${body.name}"/></ENVELOPE>`,
      ledger: null,
    })
  }),
  http.get(`${API}/settings/dashboard`, () => HttpResponse.json(demoDashboardFormula())),
  http.put(`${API}/settings/dashboard`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    return HttpResponse.json({ ...demoDashboardFormula(), ...body })
  }),
]
