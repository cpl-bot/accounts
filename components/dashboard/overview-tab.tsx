'use client'

import { Loader2, AlertTriangle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { GrossProfitChart } from './gross-profit-chart'
import { IncomeExpenseChart } from './income-expense-chart'
import { FormulaWidget, StockStatusLine } from './formula-widget'
import { WidgetLabel, StatValue } from './primitives'
import { formatLakh } from '@/lib/format'
import { useDashboardOverview } from '@/lib/api/hooks'

function PnlRow({
  label,
  value,
  bold,
  badge,
}: {
  label: string
  value: string
  bold?: boolean
  badge?: string
}) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <div className="flex items-center gap-2">
        <span className={bold ? 'text-sm font-semibold text-foreground' : 'text-sm text-muted-foreground'}>
          {label}
        </span>
        {badge ? (
          <Badge variant="default" className="text-[11px]">
            {badge}
          </Badge>
        ) : null}
      </div>
      <span className={`text-sm tabular-nums ${bold ? 'font-semibold text-foreground' : 'text-foreground'}`}>
        {value}
      </span>
    </div>
  )
}

export function OverviewTab({ from, to }: { from: string; to: string }) {
  const { data, loading, error, refetch } = useDashboardOverview(from, to)

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-border p-16 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading dashboard…
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border p-16 text-center">
        <AlertTriangle className="size-6 text-destructive" />
        <p className="text-sm text-muted-foreground">
          Could not load the dashboard{error ? `: ${error.message}` : '.'}
        </p>
        <Button variant="outline" size="sm" onClick={refetch}>
          Retry
        </Button>
      </div>
    )
  }

  // This mirrors the middleware's flat `DashboardOverview` exactly (plan
  // §3.6/§3.9) — there is no "vs previous period" figure and no
  // day-by-day cash breakdown; the backend does not compute either yet.
  const {
    revenue,
    cost_of_sales,
    gross_profit,
    gross_margin_pct,
    indirect_income,
    indirect_expense,
    net_profit,
    cash_and_bank,
    trends,
    formula,
    opening_stock,
    closing_stock,
    stock_adjustment_status,
  } = data
  const modeLabel = formula?.gross_profit_mode === 'trading' ? 'Trading' : 'Simple'
  const gpTrend = trends.map((t) => ({ month: t.month, value: t.gross_profit }))
  const revenueVsCost = trends.map((t) => ({
    month: t.month,
    income: t.revenue,
    expense: t.cost_of_sales,
  }))

  return (
    <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
      <div className="grid flex-1 grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Gross Profit */}
        <Card>
          <CardContent className="flex flex-col gap-4 p-5">
            <div className="flex items-center justify-between">
              <WidgetLabel>Gross Profit</WidgetLabel>
              <Badge variant="outline">{modeLabel}</Badge>
            </div>
            <StatValue>{formatLakh(gross_profit)}</StatValue>
            <p className="text-sm text-muted-foreground">{gross_margin_pct.toFixed(2)}% margin</p>
            {formula?.gross_profit_mode === 'trading' ? (
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-border p-3">
                <div>
                  <p className="text-xs text-muted-foreground">Opening Stock</p>
                  <p className="text-sm font-semibold tabular-nums">
                    {opening_stock != null ? formatLakh(opening_stock) : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Closing Stock</p>
                  <p className="text-sm font-semibold tabular-nums">
                    {closing_stock != null ? formatLakh(closing_stock) : '—'}
                  </p>
                </div>
              </div>
            ) : null}
            <StockStatusLine status={stock_adjustment_status} />
            <GrossProfitChart data={gpTrend} />
          </CardContent>
        </Card>

        {/* Cash & Bank Balance */}
        <Card>
          <CardContent className="flex flex-col gap-4 p-5">
            <WidgetLabel>Cash &amp; Bank Balance</WidgetLabel>
            <StatValue>{formatLakh(cash_and_bank)}</StatValue>
            <p className="text-xs text-muted-foreground">
              Cash-in-hand and bank account closing balances as on {to}.
            </p>
          </CardContent>
        </Card>

        {/* P&L Summary */}
        <Card>
          <CardContent className="flex flex-col p-5">
            <WidgetLabel>P&amp;L Summary</WidgetLabel>
            <div className="mt-3 flex flex-col divide-y divide-border">
              <PnlRow label="Revenue" value={formatLakh(revenue)} />
              <PnlRow label="Cost of Sales" value={formatLakh(cost_of_sales)} />
              <PnlRow
                label="Gross Profit"
                value={formatLakh(gross_profit)}
                bold
                badge={`${gross_margin_pct.toFixed(2)}% Margin`}
              />
              <PnlRow label="Indirect Income" value={formatLakh(indirect_income)} />
              <PnlRow label="Indirect Expense" value={formatLakh(indirect_expense)} />
              <PnlRow label="Net Profit" value={formatLakh(net_profit)} bold />
            </div>
          </CardContent>
        </Card>

        {/* Revenue vs Cost of Sales */}
        <Card className="lg:col-span-3">
          <CardContent className="flex flex-col gap-4 p-5">
            <WidgetLabel>Revenue vs Cost of Sales</WidgetLabel>
            <IncomeExpenseChart data={revenueVsCost} />
          </CardContent>
        </Card>
      </div>

      <div className="w-full xl:w-80 xl:shrink-0">
        <FormulaWidget onSaved={refetch} stockAdjustmentStatus={stock_adjustment_status} />
      </div>
    </div>
  )
}
