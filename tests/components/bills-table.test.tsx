import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { BillsTable } from '@/components/ap/bills-table'
import type { Bill } from '@/lib/mock-data'

function makeBills(count: number): Bill[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    voucherNo: i + 1,
    fileName: `bill-${i + 1}.pdf`,
    vendor: `Vendor ${i + 1}`,
    billingDate: '1 Jan 2026',
    voucherDate: '2 Jan 2026',
    totalAmount: 1000 * (i + 1),
    status: 'synced',
    synced: true,
  }))
}

describe('BillsTable pagination', () => {
  it('shows only the first page of rows and paginates real client-side', async () => {
    const bills = makeBills(25)
    render(
      <BillsTable bills={bills} selected={new Set()} onToggle={() => {}} onToggleAll={() => {}} />,
    )

    expect(screen.getByText('Vendor 1')).toBeInTheDocument()
    expect(screen.queryByText('Vendor 11')).not.toBeInTheDocument()
    expect(screen.getByText('1 - 10 of 25')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Next page' }))

    expect(screen.getByText('Vendor 11')).toBeInTheDocument()
    expect(screen.queryByText('Vendor 1')).not.toBeInTheDocument()
    expect(screen.getByText('11 - 20 of 25')).toBeInTheDocument()
  })

  it('disables Previous on the first page and Next on the last page', async () => {
    const bills = makeBills(5)
    render(
      <BillsTable bills={bills} selected={new Set()} onToggle={() => {}} onToggleAll={() => {}} />,
    )

    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
  })
})
