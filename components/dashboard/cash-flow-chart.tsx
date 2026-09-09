'use client'

import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis, Tooltip, Legend } from 'recharts'
import { formatAxisLakh, formatLakh } from '@/lib/format'

export type CashFlowPoint = { month: string; inflow: number; outflow: number }

export function CashFlowChart({ data }: { data: CashFlowPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="inflowFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-3)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="var(--chart-3)" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="outflowFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-4)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--chart-4)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
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
          cursor={{ stroke: 'var(--border)' }}
          formatter={(v, name) => [formatLakh(Number(v)), name]}
          contentStyle={{ borderRadius: 12, border: '1px solid var(--border)', fontSize: 12 }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
        <Area
          type="monotone"
          dataKey="inflow"
          name="Inflow"
          stroke="var(--chart-3)"
          strokeWidth={2}
          fill="url(#inflowFill)"
        />
        <Area
          type="monotone"
          dataKey="outflow"
          name="Outflow"
          stroke="var(--chart-4)"
          strokeWidth={2}
          fill="url(#outflowFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
