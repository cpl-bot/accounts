import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { CreateBillForm } from '@/components/ap/create-bill-form'
import { server } from '../msw/server'

describe('CreateBillForm', () => {
  it('saves a draft and shows the Queue for sync button once validated clean', async () => {
    render(<CreateBillForm />)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /save as draft/i }))

    expect(await screen.findByText(/validated with no issues/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /queue for sync/i }))
    expect(await screen.findByText('Queued for sync')).toBeInTheDocument()
  })

  it('renders inline validation issues returned by the middleware', async () => {
    server.use(
      http.post('/api/talai/drafts', () =>
        HttpResponse.json({
          id: 'draft-bad',
          status: 'validated',
          payload: {},
          validation_issues: [
            {
              code: 'LEDGER_NOT_FOUND',
              field: 'party.ledger_name',
              message: 'Ledger "BioShield Medical" was not found in Tally.',
              severity: 'error',
            },
          ],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      ),
    )

    render(<CreateBillForm />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /save as draft/i }))

    expect(await screen.findByText('LEDGER_NOT_FOUND')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /queue for sync/i })).toBeDisabled()
  })
})
