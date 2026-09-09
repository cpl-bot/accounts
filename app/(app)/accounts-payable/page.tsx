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
} from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { Button, buttonVariants } from '@/components/ui/button'
import { BillsTable } from '@/components/ap/bills-table'
import { UploadModal } from '@/components/ap/upload-modal'
import { SyncModal } from '@/components/ap/sync-modal'
import { bills as allBills } from '@/lib/mock-data'
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

  const filtered = useMemo(() => {
    return allBills.filter((b) => {
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
  }, [tab, query])

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

          <BillsTable
            bills={filtered}
            selected={selected}
            onToggle={toggle}
            onToggleAll={toggleAll}
          />
        </div>
      </main>

      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <SyncModal open={syncOpen} onClose={() => setSyncOpen(false)} />
    </>
  )
}
