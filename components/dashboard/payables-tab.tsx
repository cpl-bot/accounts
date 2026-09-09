'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { WidgetLabel, AsOnPill, VsPrevious, StatValue } from './primitives'
import { AgingBar } from './aging-bar'
import { AgingPanel } from './aging-panel'
import { apAging, arAging } from '@/lib/mock-data'
import { formatLakh } from '@/lib/format'

function OutstandingCard({
  label,
  value,
  onAccount,
  changePct,
}: {
  label: string
  value: number
  onAccount: number
  changePct: number
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <WidgetLabel>{label}</WidgetLabel>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <StatValue className={value < 0 ? 'text-destructive' : undefined}>
            {formatLakh(value)}
          </StatValue>
          <span className="flex items-center gap-1.5 text-sm text-primary">
            <span className="size-1.5 rounded-full bg-primary" /> Inc. {formatLakh(onAccount)} On
            Account
          </span>
        </div>
        <VsPrevious pct={changePct} />
      </CardContent>
    </Card>
  )
}

function DaysCard({ label, days, changePct }: { label: string; days: number; changePct: number }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <WidgetLabel>{label}</WidgetLabel>
        <StatValue>{days} days</StatValue>
        <VsPrevious pct={changePct} />
      </CardContent>
    </Card>
  )
}

function AgingCard({
  label,
  total,
  buckets,
  onOpen,
}: {
  label: string
  total: number
  buckets: typeof apAging.buckets
  onOpen: () => void
}) {
  return (
    <Card className="md:col-span-2">
      <CardContent className="flex flex-col gap-3 p-5">
        <WidgetLabel>{label}</WidgetLabel>
        <p className="text-sm text-muted-foreground">
          Total {formatLakh(total)} across {buckets.length} buckets
        </p>
        <button
          onClick={onOpen}
          className="mt-1 rounded-lg text-left transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring"
          aria-label={`Open ${label} detail`}
        >
          <AgingBar buckets={buckets} />
        </button>
      </CardContent>
    </Card>
  )
}

export function PayablesTab({ range }: { range: string }) {
  const [panel, setPanel] = useState<null | 'ap' | 'ar'>(null)

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">Payables</h2>
          <AsOnPill date="May 12, 2026" />
        </div>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <OutstandingCard
            label="AP Outstanding"
            value={apAging.outstanding}
            onAccount={apAging.onAccount}
            changePct={apAging.changePct}
          />
          <DaysCard
            label="Days Payable Outstanding"
            days={apAging.daysPayableOutstanding}
            changePct={0}
          />
          <AgingCard
            label="AP Aging"
            total={apAging.totalAmount}
            buckets={apAging.buckets}
            onOpen={() => setPanel('ap')}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">Receivables</h2>
          <AsOnPill date="May 12, 2026" />
        </div>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <OutstandingCard
            label="AR Outstanding"
            value={arAging.outstanding}
            onAccount={arAging.onAccount}
            changePct={arAging.changePct}
          />
          <DaysCard label="Days Sales Outstanding" days={arAging.daysSalesOutstanding} changePct={0} />
          <AgingCard
            label="AR Aging"
            total={arAging.totalAmount}
            buckets={arAging.buckets}
            onOpen={() => setPanel('ar')}
          />
        </div>
      </section>

      <AgingPanel
        open={panel === 'ap'}
        onClose={() => setPanel(null)}
        title="AP Aging"
        range={range}
        data={apAging}
      />
      <AgingPanel
        open={panel === 'ar'}
        onClose={() => setPanel(null)}
        title="AR Aging"
        range={range}
        data={arAging}
      />
    </div>
  )
}
