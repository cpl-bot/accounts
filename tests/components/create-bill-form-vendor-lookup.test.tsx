import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { CreateBillForm } from '@/components/ap/create-bill-form'
import { demoDraft } from '@/lib/api/demo-fixtures'
import { server } from '../msw/server'

describe('CreateBillForm vendor ledger lookup (§3.8)', () => {
  it('shows a green match hint when the vendor name resolves to a known ledger', async () => {
    render(<CreateBillForm />)
    expect(await screen.findByText(/matches tally ledger/i)).toBeInTheDocument()
  })

  it('shows suggestions and a create checkbox when the vendor is not found, and picking a suggestion replaces the name', async () => {
    const user = userEvent.setup()
    render(<CreateBillForm />)

    const nameInput = screen.getByLabelText('Name') as HTMLInputElement
    await user.clear(nameInput)
    await user.type(nameInput, 'BioShield Med Co')

    expect(await screen.findByText(/tally has no ledger named/i)).toBeInTheDocument()
    const suggestion = await screen.findByRole('button', { name: 'BioShield Medical' })
    await user.click(suggestion)

    expect(nameInput).toHaveValue('BioShield Medical')
  })

  it('sets party.create_if_missing on the saved payload when the checkbox is checked', async () => {
    let capturedBody: Record<string, unknown> | null = null
    server.use(
      http.post('/api/talai/drafts', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(demoDraft({ id: 'draft-new', payload: capturedBody }))
      }),
    )

    const user = userEvent.setup()
    render(<CreateBillForm />)

    const nameInput = screen.getByLabelText('Name') as HTMLInputElement
    await user.clear(nameInput)
    await user.type(nameInput, 'Brand New Vendor')

    const checkbox = await screen.findByLabelText(/create this vendor ledger in tally/i)
    await user.click(checkbox)

    await user.click(screen.getByRole('button', { name: /save as draft/i }))

    await waitFor(() => expect(capturedBody).not.toBeNull())
    const party = (capturedBody as unknown as { party: Record<string, unknown> }).party
    expect(party.create_if_missing).toBe(true)
    // `PartyPayload` has no gst_registration_type / mailing_name — the
    // middleware derives both — so the form must not send them.
    expect(party).not.toHaveProperty('gst_registration_type')
    expect(party).not.toHaveProperty('mailing_name')
  })

  it('does not offer a Mailing Name input, which the backend derives itself', async () => {
    const user = userEvent.setup()
    render(<CreateBillForm />)

    const nameInput = screen.getByLabelText('Name') as HTMLInputElement
    await user.clear(nameInput)
    await user.type(nameInput, 'Brand New Vendor')

    const checkbox = await screen.findByLabelText(/create this vendor ledger in tally/i)
    await user.click(checkbox)

    expect(await screen.findByLabelText('State')).toBeInTheDocument()
    expect(screen.queryByLabelText(/mailing name/i)).not.toBeInTheDocument()
  })

  it('renders a LEDGER_POSSIBLE_DUPLICATE error and offers its suggested ledger names', async () => {
    server.use(
      http.post('/api/talai/drafts', () =>
        HttpResponse.json(
          demoDraft({
            id: 'draft-dup',
            payload: {},
            errors: [
              {
                code: 'LEDGER_POSSIBLE_DUPLICATE',
                field: 'party.ledger_name',
                message: 'This looks like a near-duplicate of an existing ledger.',
                severity: 'error',
                // `details.suggestions` is a list of ledger *names*.
                details: { can_create: false, suggestions: ['BioShield Medical'], best_ratio: 0.9 },
              },
            ],
          }),
        ),
      ),
    )

    const user = userEvent.setup()
    render(<CreateBillForm />)

    const nameInput = screen.getByLabelText('Name') as HTMLInputElement
    await user.clear(nameInput)
    await user.type(nameInput, 'BioShield Medicals')

    await user.click(screen.getByRole('button', { name: /save as draft/i }))

    expect(await screen.findByText('LEDGER_POSSIBLE_DUPLICATE')).toBeInTheDocument()
    expect(screen.getByText(/did you mean/i)).toBeInTheDocument()

    // Picking the suggested name puts it in the vendor field.
    const suggestions = screen.getAllByRole('button', { name: 'BioShield Medical' })
    await user.click(suggestions[suggestions.length - 1])
    expect(nameInput).toHaveValue('BioShield Medical')
  })
})
