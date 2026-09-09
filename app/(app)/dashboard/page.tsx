'use client'

import { useState } from 'react'
import { PageHeader } from '@/components/layout/page-header'
import { OverviewTab } from '@/components/dashboard/overview-tab'
import { PayablesTab } from '@/components/dashboard/payables-tab'
import { PeriodSelect } from '@/components/dashboard/period-select'
import { cn } from '@/lib/utils'

const TABS = ['Overview', 'Payables & Receivables'] as const
type Tab = (typeof TABS)[number]

export default function DashboardPage() {
  const [tab, setTab] = useState<Tab>('Overview')
  const [period, setPeriod] = useState('Previous Fiscal Year')

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
            <OverviewTab />
          ) : (
            <PayablesTab range="May 01, 2026 – May 12, 2026" />
          )}
        </div>
      </main>
    </>
  )
}
