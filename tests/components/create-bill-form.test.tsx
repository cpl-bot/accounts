import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { CreateBillForm } from '@/components/ap/create-bill-form'
import { demoDraft } from '@/lib/api/demo-fixtures'
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
        HttpResponse.json(
          demoDraft({
            id: 'draft-bad',
            payload: {},
            errors: [
              {
                code: 'LEDGER_NOT_FOUND',
                field: 'party.ledger_name',
                message: 'Ledger "BioShield Medical" was not found in Tally.',
                severity: 'error',
                details: { can_create: true, suggestions: [], best_ratio: 0 },
              },
            ],
          }),
        ),
      ),
    )

    render(<CreateBillForm />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /save as draft/i }))

    expect(await screen.findByText('LEDGER_NOT_FOUND')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /queue for sync/i })).toBeDisabled()
  })

  // `ItemPayload.stock_item` is required on the backend: a blank one 422s with
  // an opaque error, so the form has to refuse the save itself.
  it('blocks the save with an inline message when a line has no stock item', async () => {
    let posted = false
    server.use(
      http.post('/api/talai/drafts', () => {
        posted = true
        return HttpResponse.json(demoDraft({ id: 'draft-new', payload: {} }))
      }),
    )

    render(<CreateBillForm />)
    const user = userEvent.setup()

    await user.selectOptions(screen.getByLabelText('Item for line 1'), '')
    await user.click(screen.getByRole('button', { name: /save as draft/i }))

    expect(await screen.findByText(/choose a stock item on every line item/i)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Stock item is required')
    expect(posted).toBe(false)

    // Picking an item clears the inline error and lets the save through.
    await user.selectOptions(screen.getByLabelText('Item for line 1'), 'Syringes')
    expect(screen.queryByText('Stock item is required')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /save as draft/i }))
    expect(await screen.findByText(/validated with no issues/i)).toBeInTheDocument()
    expect(posted).toBe(true)
  })
})
