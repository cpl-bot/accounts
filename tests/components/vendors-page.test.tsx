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
    let capturedBody: Record<string, unknown> | null = null
    server.use(
      http.post('/api/talai/ledgers', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({
          dry_run: true,
          generated_xml: '<ENVELOPE><LEDGER NAME="Acme Corp"/></ENVELOPE>',
          // Mirrors the real dry-run response: `ledger` is null when nothing
          // was written to Tally.
          ledger: null,
        })
      }),
    )

    const user = userEvent.setup()
    render(<VendorsPage />)
    await screen.findByText('BioShield Medical')

    await user.click(screen.getByRole('button', { name: /new vendor/i }))
    await user.type(screen.getByLabelText('Name'), 'Acme Corp')
    await user.selectOptions(screen.getByLabelText(/gst registration type/i), 'composition')
    await user.type(screen.getByLabelText('State'), 'Maharashtra')
    await user.type(screen.getByLabelText(/billing address/i), '1 Main Street{enter}Suite 4{enter}Mumbai')

    await user.click(screen.getByRole('button', { name: /^create vendor$/i }))

    // Dry-run notice shows even though `ledger` came back null.
    expect(await screen.findByText(/dry run/i)).toBeInTheDocument()
    await user.click(screen.getByText(/generated xml/i))
    await waitFor(() =>
      expect(screen.getByText(/LEDGER NAME="Acme Corp"/)).toBeInTheDocument(),
    )

    await waitFor(() => expect(capturedBody).not.toBeNull())
    const body = capturedBody as unknown as { address: unknown; gst_registration_type: unknown }
    expect(Array.isArray(body.address)).toBe(true)
    expect(body.address).toEqual(['1 Main Street', 'Suite 4', 'Mumbai'])
    // Capitalised to match Tally's <GSTREGISTRATIONTYPE> enum, not the UI's
    // lowercase option value.
    expect(body.gst_registration_type).toBe('Composition')
  })
})
