import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import AccountsPayablePage from '@/app/(app)/accounts-payable/page'
import { server } from '../msw/server'

describe('AccountsPayablePage — Bill Uploads tab (§3.10)', () => {
  it('lists attachments with an OCR confidence summary and a create-bill action', async () => {
    const user = userEvent.setup()
    render(<AccountsPayablePage />)
    await screen.findByText('BioShield Medical')

    await user.click(screen.getByRole('button', { name: 'Bill Uploads' }))

    expect(await screen.findByText('SwiftRoute.pdf')).toBeInTheDocument()
    expect(screen.getAllByText(/supplier 0\.92/i).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: /create bill from this file/i }).length).toBeGreaterThan(0)
  })

  it('shows a failed pill with Retry, and a skipped hint', async () => {
    server.use(
      http.get('/api/talai/attachments', () =>
        HttpResponse.json({
          items: [
            {
              id: 'att-failed',
              file_name: 'bad.pdf',
              mime: 'application/pdf',
              size_bytes: 1000,
              created_at: new Date().toISOString(),
              ocr_status: 'failed',
              ocr_error: 'Ollama timed out',
            },
            {
              id: 'att-skipped',
              file_name: 'skipped.pdf',
              mime: 'application/pdf',
              size_bytes: 1000,
              created_at: new Date().toISOString(),
              ocr_status: 'skipped',
            },
          ],
          total: 2,
        }),
      ),
    )

    const user = userEvent.setup()
    render(<AccountsPayablePage />)
    await screen.findByText('BioShield Medical')
    await user.click(screen.getByRole('button', { name: 'Bill Uploads' }))

    expect(await screen.findByText(/ollama timed out/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    expect(screen.getByText(/ocr disabled/i)).toBeInTheDocument()
  })
})
