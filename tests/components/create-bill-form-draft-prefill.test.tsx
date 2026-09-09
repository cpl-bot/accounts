import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { CreateBillForm } from '@/components/ap/create-bill-form'
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
        HttpResponse.json({
          id: 'draft-42',
          status: 'validated',
          payload: {
            supplier_invoice_no: 'INV-OCR-1',
            party: { ledger_name: 'OCR Vendor Ltd' },
            totals: { grand_total: 12345 },
          },
          validation_issues: [],
          needs_review: true,
          review_reasons: ['Low OCR confidence on invoice number'],
          attachment_id: 'att-9',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      ),
      http.get('/api/talai/attachments/att-9', () =>
        HttpResponse.json({
          id: 'att-9',
          file_name: 'ocr.pdf',
          content_type: 'application/pdf',
          size_bytes: 1000,
          uploaded_at: new Date().toISOString(),
          ocr_status: 'done',
          ocr_result: {
            fields: { supplier_name: 'OCR Vendor Ltd', line_items: [] },
            confidence: { supplier_name: 0.4, invoice_number: 0.95 },
          },
        }),
      ),
    )

    render(<CreateBillForm />)

    expect(await screen.findByDisplayValue('OCR Vendor Ltd')).toBeInTheDocument()
    expect(await screen.findByDisplayValue('INV-OCR-1')).toBeInTheDocument()
    expect(screen.getByText(/needs review/i)).toBeInTheDocument()
    expect(screen.getByText(/low ocr confidence on invoice number/i)).toBeInTheDocument()
    expect(screen.getByText(/ocr confidence 40%/i)).toBeInTheDocument()
    // Saving an existing draft should PUT, not POST.
    expect(screen.getByRole('button', { name: /re-validate/i })).toBeInTheDocument()
  })
})
