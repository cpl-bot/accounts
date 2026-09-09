'use client'

import { ChevronRight, Loader2, AlertTriangle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { GrossProfitChart } from './gross-profit-chart'
import { IncomeExpenseChart } from './income-expense-chart'
import { CashFlowChart } from './cash-flow-chart'
import { WidgetLabel, AsOnPill, VsPrevious, StatValue } from './primitives'
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

  const { gross_profit, cash_bank, pnl, income_vs_expense, trends } = data

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      {/* Gross Profit */}
      <Card>
        <CardContent className="flex flex-col gap-4 p-5">
          <WidgetLabel>Gross Profit</WidgetLabel>
          <StatValue>{formatLakh(gross_profit.value)}</StatValue>
          <VsPrevious pct={gross_profit.change_pct} />
          <GrossProfitChart data={trends.gross_profit} />
        </CardContent>
      </Card>

      {/* Cash & Bank Balance */}
      <Card>
        <CardContent className="flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between">
            <WidgetLabel>Cash &amp; Bank Balance</WidgetLabel>
            <AsOnPill date={cash_bank.as_on} />
          </div>
          <StatValue>{formatLakh(cash_bank.value)}</StatValue>
          <VsPrevious pct={cash_bank.change_pct} />
          <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-border">
            <div className="border-r border-border p-3">
              <p className="text-xs text-muted-foreground">Today</p>
              <p className="mt-1 text-sm font-semibold tabular-nums">{formatLakh(cash_bank.today)}</p>
            </div>
            <div className="border-r border-border p-3">
              <p className="text-xs text-muted-foreground">Yesterday</p>
              <p className="mt-1 text-sm font-semibold tabular-nums">
                {formatLakh(cash_bank.yesterday)}
              </p>
            </div>
            <div className="flex items-center justify-center bg-muted/50 p-3">
              <span className="text-sm font-semibold text-primary tabular-nums">₹0 K</span>
            </div>
          </div>
          <div className="flex items-center justify-between pt-1">
            <span className="text-sm font-semibold">Account Breakdown</span>
            <button className="flex items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground">
              View More <ChevronRight className="size-4" />
            </button>
          </div>
          <div className="flex flex-col divide-y divide-border">
            {cash_bank.accounts.map((a) => (
              <div key={a.name} className="flex items-center justify-between py-2.5">
                <span className="text-sm text-muted-foreground">{a.name}</span>
                <span className="text-sm font-semibold tabular-nums">{formatLakh(a.value)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* P&L Summary */}
      <Card>
        <CardContent className="flex flex-col p-5">
          <WidgetLabel>P&amp;L Summary</WidgetLabel>
          <div className="mt-3 flex flex-col divide-y divide-border">
            <PnlRow label="Revenue" value={formatLakh(pnl.revenue)} />
            <PnlRow label="Cost of Sales" value={formatLakh(pnl.cost_of_sales)} />
            <PnlRow
              label="Gross Profit"
              value={formatLakh(pnl.gross_profit)}
              bold
              badge={`${pnl.gross_margin}% Margin`}
            />
            <PnlRow label="Indirect Income" value={formatLakh(pnl.indirect_income)} />
            <PnlRow label="Indirect Expense" value={formatLakh(pnl.indirect_expense)} />
            <PnlRow label="Net Profit" value={formatLakh(pnl.net_profit)} bold />
          </div>
        </CardContent>
      </Card>

      {/* Income vs Expense */}
      <Card className="lg:col-span-2">
        <CardContent className="flex flex-col gap-4 p-5">
          <WidgetLabel>Income vs Expense</WidgetLabel>
          <StatValue>{formatLakh(income_vs_expense.value)}</StatValue>
          <VsPrevious pct={income_vs_expense.change_pct} />
          <IncomeExpenseChart data={trends.income_vs_expense} />
        </CardContent>
      </Card>

      {/* Cash Inflow vs Outflow */}
      <Card>
        <CardContent className="flex h-full flex-col gap-4 p-5">
          <WidgetLabel>Cash Inflow vs Outflow</WidgetLabel>
          <div className="mt-auto">
            <CashFlowChart data={trends.cash_flow} />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
