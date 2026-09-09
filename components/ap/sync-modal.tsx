'use client'

import { useState } from 'react'
import {
  ArrowLeftRight,
  ReceiptIndianRupee,
  ReceiptText,
  Contact,
  Users,
  FileText,
  RefreshCw,
  Loader2,
  Check,
} from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { syncItems } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

const ICONS: Record<string, typeof ArrowLeftRight> = {
  transactions: ArrowLeftRight,
  bills: ReceiptIndianRupee,
  invoices: ReceiptText,
  vendors: Contact,
  customers: Users,
  journal_vouchers: FileText,
}

export function SyncModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set(['bills']))
  const [state, setState] = useState<'idle' | 'syncing' | 'done'>('idle')

  const total = syncItems
    .filter((i) => selected.has(i.key))
    .reduce((sum, i) => sum + i.count, 0)

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  const runSync = () => {
    setState('syncing')
    // Middleware validates + commits to Tally in batches; simulated here.
    setTimeout(() => setState('done'), 1600)
  }

  return (
    <Modal open={open} onClose={onClose} title="Sync Financial Data">
      <p className="mb-5 text-center text-sm text-muted-foreground">
        Choose the items you want to sync
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {syncItems.map((item) => {
          const Icon = ICONS[item.key]
          const active = selected.has(item.key)
          return (
            <button
              key={item.key}
              onClick={() => toggle(item.key)}
              disabled={state !== 'idle'}
              className={cn(
                'relative flex flex-col items-center gap-3 rounded-xl border p-5 text-center transition-colors disabled:opacity-60',
                active ? 'border-primary bg-accent/30' : 'border-border hover:bg-muted/50',
              )}
            >
              <span
                className={cn(
                  'absolute right-3 top-3 flex size-4 items-center justify-center rounded border',
                  active ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                )}
              >
                {active ? <Check className="size-3" /> : null}
              </span>
              <Icon className="size-6 text-foreground" />
              <div>
                <p className="text-sm font-semibold">{item.label}</p>
                <span className="mt-1 inline-block rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {item.count} items
                </span>
              </div>
            </button>
          )
        })}
      </div>

      <p className="mt-4 text-xs text-muted-foreground text-pretty">
        Records are validated in the middleware and committed to Tally in batches to avoid
        overwhelming the upstream service.
      </p>

      <Button
        onClick={runSync}
        disabled={total === 0 || state !== 'idle'}
        variant="secondary"
        className="mt-5 h-11 w-full text-primary"
      >
        {state === 'syncing' ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Syncing…
          </>
        ) : state === 'done' ? (
          <>
            <Check className="size-4" /> Synced {total} records
          </>
        ) : (
          <>
            <RefreshCw className="size-4" /> Sync Selected ({total})
          </>
        )}
      </Button>
    </Modal>
  )
}
