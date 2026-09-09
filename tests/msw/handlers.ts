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
  demoDrafts,
  demoLedgerLookup,
  demoLedgers,
  demoSettings,
  demoSyncRun,
  demoTallyStatus,
} from '@/lib/api/demo-fixtures'

const API = '/api/talai'

export const handlers = [
  http.get(`${API}/tally/status`, () => HttpResponse.json(demoTallyStatus())),
  http.post(`${API}/tally/test-connection`, () => HttpResponse.json(demoTallyStatus())),
  http.get(`${API}/tally/companies`, () =>
    HttpResponse.json({ companies: [{ name: demoTallyStatus().company ?? 'Demo Co' }] }),
  ),
  http.get(`${API}/settings`, () => HttpResponse.json(demoSettings())),
  http.put(`${API}/settings`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    return HttpResponse.json({ ...demoSettings(), ...body })
  }),
  http.get(`${API}/dashboard/overview`, () => HttpResponse.json(demoDashboardOverview())),
  http.get(`${API}/dashboard/payables`, () => HttpResponse.json(demoDashboardPayables())),
  http.get(`${API}/bills`, () => HttpResponse.json(demoBills())),
  http.get(`${API}/drafts`, () => HttpResponse.json(demoDrafts())),
  http.post(`${API}/drafts`, async ({ request }) => {
    const payload = await request.json()
    return HttpResponse.json({
      id: 'draft-new',
      status: 'validated',
      payload,
      validation_issues: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
  }),
  http.post(`${API}/drafts/:id/queue`, ({ params }) =>
    HttpResponse.json({
      id: params.id,
      status: 'queued',
      payload: {},
      validation_issues: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  ),
  http.post(`${API}/sync/push`, () =>
    HttpResponse.json({
      run: demoSyncRun(true),
      results: [
        { draft_id: 'draft-1', status: 'committed', voucher_number: 'PB-2026-0041' },
      ],
    }),
  ),
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
    HttpResponse.json({
      id: `draft-from-${params.id}`,
      status: 'validated',
      payload: {},
      validation_issues: [],
      needs_review: true,
      review_reasons: ['Low OCR confidence on invoice number'],
      attachment_id: params.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  ),
  http.get(`${API}/drafts/:id`, ({ params }) =>
    HttpResponse.json({
      id: params.id,
      status: 'validated',
      payload: { party: { ledger_name: 'BioShield Medical' }, totals: { grand_total: 617308 } },
      validation_issues: [],
      needs_review: true,
      review_reasons: ['Low OCR confidence on invoice number'],
      attachment_id: 'att-9',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  ),
  http.put(`${API}/drafts/:id`, async ({ params, request }) => {
    const payload = await request.json()
    return HttpResponse.json({
      id: params.id,
      status: 'validated',
      payload,
      validation_issues: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
  }),
  http.get(`${API}/ledgers/lookup`, ({ request }) => {
    const name = new URL(request.url).searchParams.get('name') ?? ''
    return HttpResponse.json(demoLedgerLookup(name))
  }),
  http.get(`${API}/ledgers`, () => HttpResponse.json({ items: demoLedgers(), total: demoLedgers().length })),
  http.post(`${API}/ledgers`, async ({ request }) => {
    const body = (await request.json()) as { name: string }
    return HttpResponse.json({
      dry_run: true,
      generated_xml: `<ENVELOPE><LEDGER NAME="${body.name}"/></ENVELOPE>`,
      ledger: { name: body.name, parent: 'Sundry Creditors', source: 'talai' },
    })
  }),
  http.get(`${API}/settings/dashboard`, () => HttpResponse.json(demoDashboardFormula())),
  http.put(`${API}/settings/dashboard`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    return HttpResponse.json({ ...demoDashboardFormula(), ...body })
  }),
]
