import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { FormulaWidget } from '@/components/dashboard/formula-widget'
import { server } from '../msw/server'

describe('FormulaWidget (§3.9)', () => {
  it('switches to Trading mode and PUTs the new formula', async () => {
    let capturedBody: Record<string, unknown> | null = null
    server.use(
      http.put('/api/talai/settings/dashboard', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(capturedBody)
      }),
    )

    const user = userEvent.setup()
    render(<FormulaWidget />)

    await screen.findByLabelText(/simple/i)
    await user.click(screen.getByLabelText(/trading/i))
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(capturedBody).not.toBeNull())
    expect((capturedBody as unknown as { gross_profit_mode: string }).gross_profit_mode).toBe('trading')
  })

  it('reveals manual stock inputs only when stock source is Manual', async () => {
    const user = userEvent.setup()
    render(<FormulaWidget />)
    await screen.findByLabelText(/simple/i)

    expect(screen.queryByLabelText(/opening stock/i)).not.toBeInTheDocument()
    await user.click(screen.getByLabelText(/^manual$/i))
    expect(screen.getByLabelText(/opening stock/i)).toBeInTheDocument()
  })

  it('shows an amber unavailable status when stock_adjustment_status is unavailable', async () => {
    server.use(
      http.get('/api/talai/settings/dashboard', () =>
        HttpResponse.json({
          gross_profit_mode: 'trading',
          stock_source: 'manual',
          manual_opening_stock: null,
          manual_closing_stock: null,
          revenue_groups: [],
          cost_of_sales_groups: [],
        }),
      ),
    )
    render(<FormulaWidget stockAdjustmentStatus="unavailable" />)
    expect(await screen.findByText(/unavailable/i)).toBeInTheDocument()
  })
})
