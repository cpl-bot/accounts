import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import VendorsPage from '@/app/(app)/vendors/page'
import { server } from '../msw/server'

describe('VendorsPage', () => {
  it('lists ledgers under Sundry Creditors with a source badge', async () => {
    render(<VendorsPage />)
    expect(await screen.findByText('BioShield Medical')).toBeInTheDocument()
    expect(screen.getByText('ZEN Manufacturing')).toBeInTheDocument()
    // BlueMark Advisory is a talai-sourced (not-yet-confirmed) ledger.
    expect(screen.getAllByText(/tally/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/talai/i)).toBeInTheDocument()
  })

  it('filters the table by search', async () => {
    const user = userEvent.setup()
    render(<VendorsPage />)
    await screen.findByText('BioShield Medical')

    await user.type(screen.getByPlaceholderText(/search/i), 'Zen')
    expect(screen.getByText('ZEN Manufacturing')).toBeInTheDocument()
    expect(screen.queryByText('BioShield Medical')).not.toBeInTheDocument()
  })

  it('creates a vendor via the New Vendor modal and shows a dry-run notice', async () => {
    server.use(
      http.post('/api/talai/ledgers', () =>
        HttpResponse.json({
          dry_run: true,
          generated_xml: '<ENVELOPE><LEDGER NAME="Acme Corp"/></ENVELOPE>',
          ledger: { name: 'Acme Corp', parent: 'Sundry Creditors', source: 'talai' },
        }),
      ),
    )

    const user = userEvent.setup()
    render(<VendorsPage />)
    await screen.findByText('BioShield Medical')

    await user.click(screen.getByRole('button', { name: /new vendor/i }))
    await user.type(screen.getByLabelText('Name'), 'Acme Corp')
    await user.type(screen.getByLabelText('State'), 'Maharashtra')
    await user.type(screen.getByLabelText('Billing Address'), '1 Main Street')

    await user.click(screen.getByRole('button', { name: /^create vendor$/i }))

    expect(await screen.findByText(/dry run/i)).toBeInTheDocument()
    await user.click(screen.getByText(/generated xml/i))
    await waitFor(() =>
      expect(screen.getByText(/LEDGER NAME="Acme Corp"/)).toBeInTheDocument(),
    )
  })
})
