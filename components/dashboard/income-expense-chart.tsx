'use client'

import {
  Bar,
  ComposedChart,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from 'recharts'
import { formatAxisLakh, formatLakh } from '@/lib/format'

export type IncomeExpensePoint = { month: string; income: number; expense: number }

export function IncomeExpenseChart({ data }: { data: IncomeExpensePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <XAxis
          dataKey="month"
          tickLine={false}
          axisLine={false}
          interval={1}
          tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={56}
          tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
          tickFormatter={(v) => formatAxisLakh(v)}
        />
        <Tooltip
          cursor={{ fill: 'var(--muted)' }}
          formatter={(v, name) => [formatLakh(Number(v)), name]}
          contentStyle={{ borderRadius: 12, border: '1px solid var(--border)', fontSize: 12 }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
        <Bar dataKey="income" name="Income" fill="var(--chart-1)" radius={[3, 3, 0, 0]} barSize={10} />
        <Bar
          dataKey="expense"
          name="Expense"
          fill="var(--chart-5)"
          radius={[3, 3, 0, 0]}
          barSize={10}
        />
        <Line
          type="monotone"
          dataKey="income"
          name="Net trend"
          stroke="var(--chart-2)"
          strokeWidth={2.5}
          dot={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
