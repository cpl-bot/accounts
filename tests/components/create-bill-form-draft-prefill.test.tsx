import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { CreateBillForm } from '@/components/ap/create-bill-form'
import { demoDraft } from '@/lib/api/demo-fixtures'
import { server } from '../msw/server'

// CreateBillForm reads ?draft=<id> via next/navigation's useSearchParams,
// which is null outside an app-router tree in tests. We simulate the
// "loaded from a draft" path by mocking next/navigation directly.
vi.mock('next/navigation', async () => {
  const actual = await vi.importActual<typeof import('next/navigation')>('next/navigation')
  return {
    ...actual,
    useSearchParams: () => new URLSearchParams('draft=draft-42'),
  }
})

describe('CreateBillForm — OCR draft prefill (§3.10)', () => {
  it('prefills fields from the loaded draft and shows the needs-review banner', async () => {
    server.use(
      http.get('/api/talai/drafts/draft-42', () =>
        HttpResponse.json(
          demoDraft({
            id: 'draft-42',
            payload: {
              supplier_invoice_no: 'INV-OCR-1',
              party: { ledger_name: 'OCR Vendor Ltd' },
              items: [
                {
                  description: 'Surgical gloves (box)',
                  stock_item: 'Syringes',
                  quantity: '2.00',
                  rate: '100.00',
                },
              ],
              totals: { grand_total: '12345.00' },
            },
            needs_review: true,
            review_reasons: ['Low OCR confidence on invoice number'],
            attachment_id: 'att-9',
          }),
        ),
      ),
      http.get('/api/talai/attachments/att-9', () =>
        HttpResponse.json({
          id: 'att-9',
          draft_id: 'draft-42',
          file_name: 'ocr.pdf',
          mime: 'application/pdf',
          size_bytes: 1000,
          ocr_status: 'done',
          ocr_result: {
            fields: { supplier_name: 'OCR Vendor Ltd', line_items: [] },
            confidence: { supplier_name: 0.4, invoice_number: 0.95 },
          },
          created_at: new Date().toISOString(),
        }),
      ),
    )

    render(<CreateBillForm />)

    expect(await screen.findByDisplayValue('OCR Vendor Ltd')).toBeInTheDocument()
    expect(await screen.findByDisplayValue('INV-OCR-1')).toBeInTheDocument()
    expect(screen.getByText(/needs review/i)).toBeInTheDocument()
    expect(screen.getByText(/low ocr confidence on invoice number/i)).toBeInTheDocument()
    expect(screen.getByText(/ocr confidence 40%/i)).toBeInTheDocument()
    // `ItemPayload.stock_item` is required, so a prefilled line always has one.
    expect(screen.getByLabelText('Item for line 1')).toHaveValue('Syringes')
    // Saving an existing draft should PUT, not POST.
    expect(screen.getByRole('button', { name: /re-validate/i })).toBeInTheDocument()
  })

  // `DraftOut.payload` is nullable — a draft can exist before its payload
  // does (e.g. straight off an attachment whose OCR has not run).
  it('survives a draft with a null payload and keeps the form defaults', async () => {
    server.use(
      http.get('/api/talai/drafts/draft-42', () =>
        HttpResponse.json(
          demoDraft({
            id: 'draft-42',
            payload: null,
            needs_review: true,
            review_reasons: ['Attachment has not been read yet'],
          }),
        ),
      ),
    )

    render(<CreateBillForm />)

    expect(await screen.findByText(/attachment has not been read yet/i)).toBeInTheDocument()
    // Untouched defaults, not blanks.
    expect(screen.getByDisplayValue('BioShield Medical')).toBeInTheDocument()
    expect(screen.getByLabelText('Item for line 1')).toHaveValue('Nitrile Gloves')
  })
})
