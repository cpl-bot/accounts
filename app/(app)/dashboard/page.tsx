'use client'

import { useMemo, useState } from 'react'
import { PageHeader } from '@/components/layout/page-header'
import { OverviewTab } from '@/components/dashboard/overview-tab'
import { PayablesTab } from '@/components/dashboard/payables-tab'
import { PeriodSelect } from '@/components/dashboard/period-select'
import { cn } from '@/lib/utils'

const TABS = ['Overview', 'Payables & Receivables'] as const
type Tab = (typeof TABS)[number]

/**
 * Turns the period label into an ISO {from, to} pair the middleware expects.
 * "Current Fiscal Year" and friends are placeholders until the middleware
 * exposes the company's actual FY start (see docs/FRONTEND_REVIEW.md — open
 * question on period semantics); "Previous Fiscal Year" and the explicit
 * date range are computed properly.
 */
function periodToRange(period: string): { from: string; to: string } {
  const now = new Date()
  const iso = (d: Date) => d.toISOString().slice(0, 10)

  if (period === 'May 01, 2026 – May 12, 2026') {
    return { from: '2026-05-01', to: '2026-05-12' }
  }
  if (period === 'This Month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    return { from: iso(start), to: iso(now) }
  }
  if (period === 'This Quarter') {
    const qStartMonth = Math.floor(now.getMonth() / 3) * 3
    const start = new Date(now.getFullYear(), qStartMonth, 1)
    return { from: iso(start), to: iso(now) }
  }
  if (period === 'Previous Fiscal Year') {
    // Indian FY: Apr 1 – Mar 31.
    const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() - 1 : now.getFullYear() - 2
    return { from: `${fyStartYear}-04-01`, to: `${fyStartYear + 1}-03-31` }
  }
  // "Current Fiscal Year" (default)
  const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  return { from: `${fyStartYear}-04-01`, to: iso(now) }
}

export default function DashboardPage() {
  const [tab, setTab] = useState<Tab>('Overview')
  const [period, setPeriod] = useState('Current Fiscal Year')
  const range = useMemo(() => periodToRange(period), [period])

  return (
    <>
      <PageHeader title="Dashboard" />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-6 border-b border-border">
              {TABS.map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    '-mb-px border-b-2 px-1 pb-3 text-sm font-medium transition-colors',
                    tab === t
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
            <PeriodSelect value={period} onChange={setPeriod} />
          </div>

          {tab === 'Overview' ? (
            <OverviewTab from={range.from} to={range.to} />
          ) : (
            <PayablesTab range="May 01, 2026 – May 12, 2026" />
          )}
        </div>
      </main>
    </>
  )
}
