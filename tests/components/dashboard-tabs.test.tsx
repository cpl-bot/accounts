import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { OverviewTab } from '@/components/dashboard/overview-tab'
import { PayablesTab } from '@/components/dashboard/payables-tab'

describe('OverviewTab', () => {
  it('loads dashboard overview data and renders key figures', async () => {
    render(<OverviewTab from="2026-04-01" to="2026-09-09" />)

    expect((await screen.findAllByText('Gross Profit')).length).toBeGreaterThan(0)
    expect(screen.getByText('P&L Summary')).toBeInTheDocument()
  })
})

describe('PayablesTab', () => {
  it('loads AP/AR data and renders outstanding cards', async () => {
    render(<PayablesTab range="May 01, 2026 – May 12, 2026" />)

    expect(await screen.findByText('AP Outstanding')).toBeInTheDocument()
    expect(screen.getByText('AR Outstanding')).toBeInTheDocument()
  })
})
