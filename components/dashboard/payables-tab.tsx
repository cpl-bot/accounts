'use client'

import { useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { WidgetLabel, AsOnPill, VsPrevious, StatValue } from './primitives'
import { AgingBar } from './aging-bar'
import { AgingPanel } from './aging-panel'
import { formatLakh } from '@/lib/format'
import { useDashboardPayables } from '@/lib/api/hooks'
import type { AgingBucket } from '@/lib/api/schema'

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
  buckets: AgingBucket[]
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
  const { data, loading, error, refetch } = useDashboardPayables()

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-border p-16 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading payables &amp; receivables…
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border p-16 text-center">
        <AlertTriangle className="size-6 text-destructive" />
        <p className="text-sm text-muted-foreground">
          Could not load payables &amp; receivables{error ? `: ${error.message}` : '.'}
        </p>
        <Button variant="outline" size="sm" onClick={refetch}>
          Retry
        </Button>
      </div>
    )
  }

  const { payables, receivables } = data

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">Payables</h2>
          <AsOnPill date={data.as_on} />
        </div>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <OutstandingCard
            label="AP Outstanding"
            value={payables.outstanding}
            onAccount={payables.on_account}
            changePct={payables.change_pct}
          />
          <DaysCard
            label="Days Payable Outstanding"
            days={payables.days_payable_outstanding}
            changePct={0}
          />
          <AgingCard
            label="AP Aging"
            total={payables.total_amount}
            buckets={payables.buckets}
            onOpen={() => setPanel('ap')}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">Receivables</h2>
          <AsOnPill date={data.as_on} />
        </div>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <OutstandingCard
            label="AR Outstanding"
            value={receivables.outstanding}
            onAccount={receivables.on_account}
            changePct={receivables.change_pct}
          />
          <DaysCard
            label="Days Sales Outstanding"
            days={receivables.days_sales_outstanding}
            changePct={0}
          />
          <AgingCard
            label="AR Aging"
            total={receivables.total_amount}
            buckets={receivables.buckets}
            onOpen={() => setPanel('ar')}
          />
        </div>
      </section>

      <AgingPanel
        open={panel === 'ap'}
        onClose={() => setPanel(null)}
        title="AP Aging"
        range={range}
        data={{
          buckets: payables.buckets,
          totalAmount: payables.total_amount,
          openBills: payables.open_bills.map((b) => ({
            vendor: b.vendor,
            billNo: b.bill_no,
            amount: b.amount,
            due: b.due,
          })),
        }}
      />
      <AgingPanel
        open={panel === 'ar'}
        onClose={() => setPanel(null)}
        title="AR Aging"
        range={range}
        data={{
          buckets: receivables.buckets,
          totalAmount: receivables.total_amount,
          openBills: receivables.open_bills.map((b) => ({
            vendor: b.vendor,
            billNo: b.bill_no,
            amount: b.amount,
            due: b.due,
          })),
        }}
      />
    </div>
  )
}
