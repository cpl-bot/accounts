import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { TallyStatusPill } from '@/components/layout/tally-status-pill'
import { server } from '../msw/server'

const API = '/api/talai'

function mockStatus(overrides: Record<string, unknown>) {
  server.use(
    http.get(`${API}/tally/status`, () =>
      HttpResponse.json({
        reachable: true,
        companies: [],
        active_company: null,
        expected_company: null,
        company_match: true,
        latency_ms: 42,
        checked_at: new Date().toISOString(),
        write_enabled: false,
        breaker_open: false,
        error: null,
        ...overrides,
      })
    )
  )
}

describe('TallyStatusPill', () => {
  it('shows the active company when reachable and matching', async () => {
    mockStatus({
      reachable: true,
      active_company: 'Nivana Healthcare Pvt. Ltd.',
      company_match: true,
    })

    render(<TallyStatusPill />)

    expect(await screen.findByText(/Connected — Nivana Healthcare Pvt\. Ltd\./)).toBeInTheDocument()
  })

  it('shows an unreachable state with the error message', async () => {
    mockStatus({
      reachable: false,
      active_company: null,
      company_match: false,
      error: 'Connection refused',
    })

    render(<TallyStatusPill />)

    expect(await screen.findByText(/Tally unreachable — Connection refused/)).toBeInTheDocument()
  })

  it('surfaces a company mismatch when reachable but the wrong company is open', async () => {
    mockStatus({
      reachable: true,
      active_company: 'Wrong Co Pvt. Ltd.',
      expected_company: 'Nivana Healthcare Pvt. Ltd.',
      company_match: false,
    })

    render(<TallyStatusPill />)

    expect(
      await screen.findByText(/Wrong company open — expected Nivana Healthcare Pvt\. Ltd\./)
    ).toBeInTheDocument()
  })
})
