'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  RefreshCw,
  Plus,
  Upload,
  MoreVertical,
  Search,
  SlidersHorizontal,
  Loader2,
  AlertTriangle,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { Button, buttonVariants } from '@/components/ui/button'
import { BillsTable } from '@/components/ap/bills-table'
import { UploadModal } from '@/components/ap/upload-modal'
import { SyncModal } from '@/components/ap/sync-modal'
import { AttachmentsList } from '@/components/ap/attachments-list'
import { useBills, useDrafts } from '@/lib/api/hooks'
import type { Bill } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

const TABS = [
  { key: 'all', label: 'All Bills' },
  { key: 'review', label: 'Needs Review' },
  { key: 'uploads', label: 'Bill Uploads' },
] as const

export default function AccountsPayablePage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [uploadOpen, setUploadOpen] = useState(false)
  const [syncOpen, setSyncOpen] = useState(false)

  // All Bills = replica purchase vouchers (via /bills) + drafts not yet synced.
  // Needs Review = drafts with validation errors. Bill Uploads = attachments
  // awaiting a draft (not yet surfaced by the middleware as a distinct list,
  // so it currently reuses the "uploaded" bill rows — see docs/FRONTEND_REVIEW.md).
  const billsQuery = useBills('payable')
  const draftsQuery = useDrafts()

  const loading = billsQuery.loading || draftsQuery.loading
  const error = billsQuery.error ?? draftsQuery.error

  const bills: Bill[] = useMemo(() => {
    const fromBills: Bill[] =
      billsQuery.data?.items.map((b, i) => ({
        id: i + 1,
        voucherNo: i + 1,
        fileName: null,
        vendor: b.party_ledger,
        billingDate: b.bill_date ?? '',
        voucherDate: b.due_date ?? b.bill_date ?? '',
        totalAmount: b.opening_amount,
        status: 'synced' as const,
        synced: true,
      })) ?? []

    const fromDrafts: Bill[] =
      draftsQuery.data?.items.map((d, i) => {
        // The middleware echoes payload.totals.grand_total back as a
        // Decimal-serialized string (e.g. "25875.00"); Number(...) below
        // coerces it.
        const payload = d.payload as {
          party?: { ledger_name?: string }
          totals?: { grand_total?: number | string }
        }
        const hasErrors = d.validation_issues.some((issue) => issue.severity === 'error')
        const needsReview = d.needs_review || hasErrors
        return {
          id: fromBills.length + i + 1,
          voucherNo: fromBills.length + i + 1,
          fileName: null,
          vendor: payload.party?.ledger_name ?? 'Unknown vendor',
          billingDate: d.created_at.slice(0, 10),
          voucherDate: d.updated_at.slice(0, 10),
          totalAmount: Number(payload.totals?.grand_total ?? 0),
          status: needsReview ? ('needs_review' as const) : ('uploaded' as const),
          synced: false,
        }
      }) ?? []

    return [...fromBills, ...fromDrafts]
  }, [billsQuery.data, draftsQuery.data])

  // Reasons a draft is in the Needs Review queue — validation errors and/or
  // the middleware's own `review_reasons` (typically low OCR confidence).
  // Keyed by the same 1-based index scheme `bills` uses for draft rows above.
  const reviewReasonsById = useMemo(() => {
    const map = new Map<number, string[]>()
    const offset = billsQuery.data?.items.length ?? 0
    draftsQuery.data?.items.forEach((d, i) => {
      const reasons = [
        ...d.validation_issues.filter((issue) => issue.severity === 'error').map((issue) => issue.message),
        ...(d.review_reasons ?? []),
      ]
      if (reasons.length > 0) map.set(offset + i + 1, reasons)
    })
    return map
  }, [billsQuery.data, draftsQuery.data])

  const filtered = useMemo(() => {
    return bills.filter((b) => {
      const matchesTab =
        tab === 'all' ||
        (tab === 'review' && b.status === 'needs_review') ||
        (tab === 'uploads' && b.status === 'uploaded')
      const matchesQuery =
        query === '' ||
        b.vendor.toLowerCase().includes(query.toLowerCase()) ||
        (b.fileName ?? '').toLowerCase().includes(query.toLowerCase())
      return matchesTab && matchesQuery
    })
  }, [bills, tab, query])

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const toggleAll = (checked: boolean) =>
    setSelected(checked ? new Set(filtered.map((b) => b.id)) : new Set())

  return (
    <>
      <PageHeader
        title="Accounts Payable"
        actions={
          <>
            <Button variant="outline" size="lg" onClick={() => setSyncOpen(true)}>
              <RefreshCw className="size-4" /> Sync
            </Button>
            <Link
              href="/accounts-payable/create"
              className={buttonVariants({ variant: 'outline', size: 'lg' })}
            >
              <Plus className="size-4" /> Create Bill
            </Link>
            <Button size="lg" onClick={() => setUploadOpen(true)}>
              <Upload className="size-4" /> Upload Bills
            </Button>
            <Button variant="outline" size="icon-lg" aria-label="More options">
              <MoreVertical className="size-4" />
            </Button>
          </>
        }
      />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-6 border-b border-border">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  '-mb-px border-b-2 px-1 pb-3 text-sm font-medium transition-colors',
                  tab === t.key
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search..."
                  className="h-10 w-64 rounded-lg border border-border bg-background pl-9 pr-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                />
              </div>
              <Button variant="outline" size="icon-lg" aria-label="Filter">
                <SlidersHorizontal className="size-4" />
              </Button>
            </div>
            <Button variant="outline" size="lg">
              <SlidersHorizontal className="size-4" /> View
            </Button>
          </div>

          {selected.size > 0 ? (
            <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-accent/40 px-4 py-2.5 text-sm">
              <span className="font-medium">{selected.size} selected</span>
              <Button size="sm" onClick={() => setSyncOpen(true)}>
                <RefreshCw className="size-3.5" /> Sync selected
              </Button>
            </div>
          ) : null}

          {tab === 'uploads' ? (
            <AttachmentsList />
          ) : loading && bills.length === 0 ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-border p-16 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading bills…
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-border p-16 text-center">
              <AlertTriangle className="size-6 text-destructive" />
              <p className="text-sm text-muted-foreground">Could not load bills: {error.message}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  billsQuery.refetch()
                  draftsQuery.refetch()
                }}
              >
                Retry
              </Button>
            </div>
          ) : tab === 'review' ? (
            <NeedsReviewTable bills={filtered} reasonsById={reviewReasonsById} />
          ) : (
            <BillsTable
              bills={filtered}
              selected={selected}
              onToggle={toggle}
              onToggleAll={toggleAll}
            />
          )}
        </div>
      </main>

      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <SyncModal open={syncOpen} onClose={() => setSyncOpen(false)} />
    </>
  )
}

// Needs Review = drafts with needs_review=true or a blocking validation
// error (see reviewReasonsById above). A dedicated table (rather than
// BillsTable) so it can carry a Reasons column.
function NeedsReviewTable({
  bills,
  reasonsById,
}: {
  bills: Bill[]
  reasonsById: Map<number, string[]>
}) {
  if (bills.length === 0) {
    return (
      <div className="rounded-xl border border-border p-16 text-center text-sm text-muted-foreground">
        Nothing needs review.
      </div>
    )
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
            <th className="px-4 py-3 font-medium">Vendor</th>
            <th className="px-4 py-3 font-medium">Bill Date</th>
            <th className="px-4 py-3 text-right font-medium">Amount</th>
            <th className="px-4 py-3 font-medium">Reasons</th>
          </tr>
        </thead>
        <tbody>
          {bills.map((b) => (
            <tr key={b.id} className="border-b border-border/60 last:border-0 align-top">
              <td className="px-4 py-3 font-medium">{b.vendor}</td>
              <td className="px-4 py-3 text-muted-foreground">{b.billingDate}</td>
              <td className="px-4 py-3 text-right tabular-nums">{b.totalAmount}</td>
              <td className="px-4 py-3 text-muted-foreground">
                {(reasonsById.get(b.id) ?? []).join('; ') || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
