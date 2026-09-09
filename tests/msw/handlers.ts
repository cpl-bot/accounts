// MSW request handlers used by frontend tests. Built from the same fixtures
// that back NEXT_PUBLIC_DEMO_MODE (lib/api/demo-fixtures.ts) so a contract
// change only needs updating in one place.

import { http, HttpResponse } from 'msw'
import {
  demoAttachments,
  demoBills,
  demoDashboardOverview,
  demoDashboardPayables,
  demoDrafts,
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
]
