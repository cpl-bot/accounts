'use client'

import { X, ChevronRight } from 'lucide-react'
import { formatINR, formatLakh } from '@/lib/format'
import type { apAging } from '@/lib/mock-data'

type AgingData = typeof apAging

export function AgingPanel({
  open,
  onClose,
  title,
  range,
  data,
}: {
  open: boolean
  onClose: () => void
  title: string
  range: string
  data: AgingData
}) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-foreground/20" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-label={title}
        className="relative flex h-full w-full max-w-2xl flex-col border-l border-border bg-card shadow-xl"
      >
        <div className="flex items-start justify-between border-b border-border p-6">
          <div>
            <h2 className="text-xl font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">For {range}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close panel"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <h3 className="mb-3 text-sm font-semibold">Summary</h3>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Bucket</th>
                  <th className="px-4 py-2.5 text-right font-medium">Bills</th>
                  <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-4 py-2.5 text-right font-medium">% Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.buckets.map((b) => (
                  <tr key={b.bucket}>
                    <td className="px-4 py-2.5">{b.bucket}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{b.bills}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatLakh(b.amount)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{b.pct}%</td>
                  </tr>
                ))}
                <tr className="bg-muted/50 font-semibold">
                  <td className="px-4 py-2.5">Total</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {data.buckets.reduce((s, b) => s + b.bills, 0)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {formatLakh(data.totalAmount)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">100%</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h3 className="mb-3 mt-6 text-sm font-semibold">Open Bills</h3>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Party</th>
                  <th className="px-4 py-2.5 font-medium">Bill No</th>
                  <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-4 py-2.5 text-right font-medium">Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.openBills.map((bill, i) => (
                  <tr key={i} className="hover:bg-muted/40">
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-1.5">
                        <ChevronRight className="size-3.5 text-muted-foreground" />
                        {bill.vendor}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{bill.billNo}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatINR(bill.amount)}</td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">{bill.due}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </aside>
    </div>
  )
}
