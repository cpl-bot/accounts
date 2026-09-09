'use client'

import { useState } from 'react'
import { Cloud, ArrowUpDown, MoreHorizontal, ChevronLeft, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { Bill } from '@/lib/mock-data'
import { formatINR } from '@/lib/format'
import { cn } from '@/lib/utils'

function StatusBadge({ status }: { status: Bill['status'] }) {
  if (status === 'synced') return <Badge variant="success">Synced</Badge>
  if (status === 'needs_review') return <Badge variant="destructive">Needs Review</Badge>
  return <Badge variant="neutral">Uploaded</Badge>
}

export function BillsTable({
  bills,
  selected,
  onToggle,
  onToggleAll,
}: {
  bills: Bill[]
  selected: Set<number>
  onToggle: (id: number) => void
  onToggleAll: (checked: boolean) => void
}) {
  const [pageSize, setPageSize] = useState(10)
  const [requestedPage, setPage] = useState(1)

  const pageCount = Math.max(1, Math.ceil(bills.length / pageSize))
  // Derived, not stored: keeps the page in range when the underlying data
  // set or page size changes (e.g. switching tabs, or a search narrowing the
  // results) without a render-triggering effect.
  const page = Math.min(requestedPage, pageCount)

  const startIndex = (page - 1) * pageSize
  const pageItems = bills.slice(startIndex, startIndex + pageSize)
  const allSelected = bills.length > 0 && bills.every((b) => selected.has(b.id))

  return (
    <div className="flex flex-col">
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => onToggleAll(e.target.checked)}
                  className="size-4 accent-primary"
                  aria-label="Select all bills"
                />
              </th>
              <th className="px-4 py-3 font-medium">
                <span className="inline-flex items-center gap-1">
                  Voucher No <ArrowUpDown className="size-3.5" />
                </span>
              </th>
              <th className="px-4 py-3 font-medium">File Name</th>
              <th className="px-4 py-3 font-medium">Vendor</th>
              <th className="px-4 py-3 font-medium">
                <span className="inline-flex items-center gap-1">
                  Billing Date <ArrowUpDown className="size-3.5" />
                </span>
              </th>
              <th className="px-4 py-3 font-medium">
                <span className="inline-flex items-center gap-1">
                  Voucher Date <ArrowUpDown className="size-3.5" />
                </span>
              </th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">
                <span className="inline-flex items-center gap-1">
                  Total Amount <ArrowUpDown className="size-3.5" />
                </span>
              </th>
              <th className="w-10 px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {pageItems.map((bill) => (
              <tr
                key={bill.id}
                className={cn('hover:bg-muted/30', selected.has(bill.id) && 'bg-accent/40')}
              >
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.has(bill.id)}
                    onChange={() => onToggle(bill.id)}
                    className="size-4 accent-primary"
                    aria-label={`Select bill ${bill.voucherNo}`}
                  />
                </td>
                <td className="px-4 py-3 tabular-nums">{bill.voucherNo}</td>
                <td className="px-4 py-3">
                  {bill.fileName ? (
                    <span className="text-foreground">{bill.fileName}</span>
                  ) : (
                    <Cloud className="size-4 text-primary" aria-label="Uploaded to cloud" />
                  )}
                </td>
                <td className="px-4 py-3">{bill.vendor}</td>
                <td className="px-4 py-3 text-muted-foreground">{bill.billingDate}</td>
                <td className="px-4 py-3 text-muted-foreground">{bill.voucherDate}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={bill.status} />
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{formatINR(bill.totalAmount)}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label="Row actions"
                  >
                    <MoreHorizontal className="size-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-1 py-3 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <span>Rows per page:</span>
          <select
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value))
              setPage(1)
            }}
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </select>
        </div>
        <div className="flex items-center gap-4">
          <span>
            {bills.length === 0 ? 0 : startIndex + 1} -{' '}
            {Math.min(startIndex + pageSize, bills.length)} of {bills.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              className="rounded-md p-1 hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
              aria-label="Previous page"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              className="rounded-md p-1 hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
              aria-label="Next page"
              disabled={page >= pageCount}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
