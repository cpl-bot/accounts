'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { WidgetLabel, AsOnPill, StatValue } from './primitives'
import { AgingBar } from './aging-bar'
import { AgingPanel } from './aging-panel'
import { formatLakh } from '@/lib/format'
import { useDashboardPayables, useBills } from '@/lib/api/hooks'
import type { AgingBucket as ApiAgingBucket } from '@/lib/api/schema'

// AgingBar/AgingPanel render a local view-model shape (bucket label, bill
// count, amount, and a display percentage) that predates the API — this
// maps the middleware's real `{label, amount, count}` buckets into it,
// computing the percentage client-side since the backend doesn't send one.
function toDisplayBuckets(buckets: ApiAgingBucket[], total: number) {
  return buckets.map((b) => ({
    bucket: b.label,
    bills: b.count,
    amount: b.amount,
    pct: total > 0 ? Math.round((b.amount / total) * 100) : 0,
  }))
}

function OutstandingCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <WidgetLabel>{label}</WidgetLabel>
        <StatValue className={value < 0 ? 'text-destructive' : undefined}>
          {formatLakh(value)}
        </StatValue>
      </CardContent>
    </Card>
  )
}

function DaysCard({ label, days }: { label: string; days: number }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <WidgetLabel>{label}</WidgetLabel>
        <StatValue>{days.toFixed(1)} days</StatValue>
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
  buckets: ReturnType<typeof toDisplayBuckets>
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
  // Open-bill detail for the drill-down panels: `/dashboard/payables` only
  // carries totals and aging buckets, not per-bill rows.
  const payableBills = useBills('payable')
  const receivableBills = useBills('receivable')

  const payableDisplayBuckets = useMemo(
    () => (data ? toDisplayBuckets(data.payable_buckets, data.total_payable) : []),
    [data],
  )
  const receivableDisplayBuckets = useMemo(
    () => (data ? toDisplayBuckets(data.receivable_buckets, data.total_receivable) : []),
    [data],
  )
  const payableOpenBills = useMemo(
    () =>
      (payableBills.data?.items ?? []).map((b) => ({
        vendor: b.party_ledger,
        billNo: b.bill_name,
        amount: b.pending_amount,
        due: b.due_date ?? '—',
      })),
    [payableBills.data],
  )
  const receivableOpenBills = useMemo(
    () =>
      (receivableBills.data?.items ?? []).map((b) => ({
        vendor: b.party_ledger,
        billNo: b.bill_name,
        amount: b.pending_amount,
        due: b.due_date ?? '—',
      })),
    [receivableBills.data],
  )

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

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">Payables</h2>
          <AsOnPill date={data.as_on} />
        </div>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <OutstandingCard label="AP Outstanding" value={data.total_payable} />
          <DaysCard label="Days Payable Outstanding" days={data.dpo_days} />
          <AgingCard
            label="AP Aging"
            total={data.total_payable}
            buckets={payableDisplayBuckets}
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
          <OutstandingCard label="AR Outstanding" value={data.total_receivable} />
          <DaysCard label="Days Sales Outstanding" days={data.dso_days} />
          <AgingCard
            label="AR Aging"
            total={data.total_receivable}
            buckets={receivableDisplayBuckets}
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
          buckets: payableDisplayBuckets,
          totalAmount: data.total_payable,
          openBills: payableOpenBills,
        }}
      />
      <AgingPanel
        open={panel === 'ar'}
        onClose={() => setPanel(null)}
        title="AR Aging"
        range={range}
        data={{
          buckets: receivableDisplayBuckets,
          totalAmount: data.total_receivable,
          openBills: receivableOpenBills,
        }}
      />
    </div>
  )
}
