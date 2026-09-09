import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import AccountsPayablePage from '@/app/(app)/accounts-payable/page'
import { demoDraft } from '@/lib/api/demo-fixtures'
import { server } from '../msw/server'

function row(vendor: string) {
  const cell = screen.getByText(vendor)
  const tr = cell.closest('tr')
  if (!tr) throw new Error(`No row found for ${vendor}`)
  return within(tr)
}

describe('AccountsPayablePage', () => {
  it('loads bills and drafts and renders the merged table', async () => {
    render(<AccountsPayablePage />)

    expect(await screen.findByText('BioShield Medical')).toBeInTheDocument()
    // A draft carrying a blocking `errors` entry shows up as Needs Review.
    expect(screen.getAllByText('Needs Review').length).toBeGreaterThan(0)
  })

  // The backend's DraftStatus is wider than this table's three-way status.
  it('maps backend draft statuses onto the table status', async () => {
    const payload = (vendor: string) => ({
      party: { ledger_name: vendor },
      totals: { grand_total: '1000.00' },
    })
    server.use(
      // The replica bill list would otherwise fill the table's first page.
      http.get('/api/talai/bills', () =>
        HttpResponse.json({ buckets: [], total_pending: 0, items: [] }),
      ),
      http.get('/api/talai/drafts', () =>
        HttpResponse.json({
          items: [
            demoDraft({
              id: 'd-committed',
              status: 'committed',
              payload: payload('Committed Vendor'),
            }),
            demoDraft({
              id: 'd-failed',
              status: 'failed',
              payload: payload('Failed Vendor'),
              errors: [
                {
                  code: 'TALLY_IMPORT_FAILED',
                  field: '',
                  message: 'Tally rejected the voucher',
                  severity: 'error',
                  details: null,
                },
              ],
            }),
            demoDraft({ id: 'd-queued', status: 'queued', payload: payload('Queued Vendor') }),
            demoDraft({
              id: 'd-committing',
              status: 'committing',
              payload: payload('Committing Vendor'),
            }),
          ],
          total: 4,
        }),
      ),
    )

    render(<AccountsPayablePage />)

    expect(await screen.findByText('Committed Vendor')).toBeInTheDocument()
    expect(row('Committed Vendor').getByText('Synced')).toBeInTheDocument()
    expect(row('Failed Vendor').getByText('Needs Review')).toBeInTheDocument()
    expect(row('Queued Vendor').getByText('Uploaded')).toBeInTheDocument()
    expect(row('Committing Vendor').getByText('Uploaded')).toBeInTheDocument()
  })

  it('lists a failed draft in Needs Review with its error messages', async () => {
    server.use(
      // The replica bill list would otherwise fill the table's first page.
      http.get('/api/talai/bills', () =>
        HttpResponse.json({ buckets: [], total_pending: 0, items: [] }),
      ),
      http.get('/api/talai/drafts', () =>
        HttpResponse.json({
          items: [
            demoDraft({
              id: 'd-failed',
              status: 'failed',
              payload: { party: { ledger_name: 'Ghost Vendor' }, totals: { grand_total: '10.00' } },
              errors: [
                {
                  code: 'LEDGER_NOT_FOUND',
                  field: 'party.ledger_name',
                  message: 'Ledger "Ghost Vendor" was not found in Tally.',
                  severity: 'error',
                  details: { can_create: true, suggestions: [], best_ratio: 0 },
                },
              ],
            }),
          ],
          total: 1,
        }),
      ),
    )

    const { default: userEvent } = await import('@testing-library/user-event')
    render(<AccountsPayablePage />)
    await screen.findByText('Ghost Vendor')

    await userEvent.setup().click(screen.getByRole('button', { name: 'Needs Review' }))

    expect(
      await screen.findByText(/Ledger "Ghost Vendor" was not found in Tally\./),
    ).toBeInTheDocument()
  })
})
