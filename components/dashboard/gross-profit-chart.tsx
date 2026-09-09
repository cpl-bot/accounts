'use client'

import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts'
import { formatAxisLakh, formatLakh } from '@/lib/format'

export type GrossProfitPoint = { month: string; value: number }

export function GrossProfitChart({ data }: { data: GrossProfitPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="gpFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
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
          formatter={(v) => [formatLakh(Number(v)), 'Gross Profit']}
          contentStyle={{
            borderRadius: 12,
            border: '1px solid var(--border)',
            fontSize: 12,
          }}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="var(--chart-1)"
          strokeWidth={2}
          fill="url(#gpFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
