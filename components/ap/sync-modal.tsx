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
  AlertTriangle,
} from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { syncItems } from '@/lib/mock-data'
import { cn } from '@/lib/utils'
import { apiFetch, ApiError } from '@/lib/api/client'
import { pushResultSchema, type PushResult } from '@/lib/api/schema'

const ICONS: Record<string, typeof ArrowLeftRight> = {
  transactions: ArrowLeftRight,
  bills: ReceiptIndianRupee,
  invoices: ReceiptText,
  vendors: Contact,
  customers: Users,
  journal_vouchers: FileText,
}

export function SyncModal({
  open,
  onClose,
  draftIds,
}: {
  open: boolean
  onClose: () => void
  /** Specific drafts to push (e.g. from a selection); omit to push all queued drafts. */
  draftIds?: string[]
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(['bills']))
  const [state, setState] = useState<'idle' | 'syncing' | 'done' | 'error'>('idle')
  const [result, setResult] = useState<PushResult | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const total = syncItems
    .filter((i) => selected.has(i.key))
    .reduce((sum, i) => sum + i.count, 0)

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  const runSync = async () => {
    setState('syncing')
    setErrorMessage(null)
    try {
      const res = await apiFetch('sync/push', pushResultSchema, {
        method: 'POST',
        body: JSON.stringify(draftIds ? { draft_ids: draftIds } : {}),
      })
      setResult(res)
      setState('done')
    } catch (err) {
      setErrorMessage(err instanceof ApiError ? err.message : 'Sync failed unexpectedly.')
      setState('error')
    }
  }

  const reset = () => {
    setState('idle')
    setResult(null)
    setErrorMessage(null)
    onClose()
  }

  if (state === 'done' && result) {
    const items = result.results
    // A push has no dry-run flag of its own — `PushResultItem.dry_run` does.
    // With TALLY_WRITE_ENABLED off every item comes back
    // `status: 'validated', dry_run: true`, which is a success, not a failure.
    const committed = items.filter((r) => r.status === 'committed')
    const failed = items.filter((r) => r.status === 'failed')
    const dryRun = items.filter((r) => r.status === 'validated' && r.dry_run)
    const allDryRun = items.length > 0 && items.every((r) => r.dry_run)
    const someDryRun = items.some((r) => r.dry_run)
    return (
      <Modal open={open} onClose={reset} title="Sync Results">
        {someDryRun ? (
          <p className="mb-4 flex items-center gap-2 rounded-lg bg-accent/40 px-3 py-2 text-sm text-foreground">
            <AlertTriangle className="size-4 shrink-0" />{' '}
            {allDryRun
              ? 'Dry run — nothing was written to Tally.'
              : 'Some records were only validated as a dry run and were not written to Tally.'}
          </p>
        ) : null}
        {result.run.status === 'failed' ? (
          <p className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <AlertTriangle className="size-4 shrink-0" /> Run #{result.run.id} failed
            {result.run.error ? `: ${result.run.error}` : '.'}
          </p>
        ) : null}
        <div className="flex flex-col gap-2">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No queued records were found to sync.</p>
          ) : (
            items.map((r) => {
              const isFailure = r.status === 'failed'
              const messages = r.errors.map((e) => e.message)
              return (
                <div
                  key={r.draft_id}
                  className={cn(
                    'flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm',
                    isFailure
                      ? 'border-destructive/30 bg-destructive/5'
                      : 'border-success/30 bg-success/5',
                  )}
                >
                  <span className="font-medium">{r.draft_id}</span>
                  {isFailure ? (
                    <span className="text-right text-destructive">
                      {messages.length > 0 ? messages.join('; ') : 'Failed'}
                    </span>
                  ) : r.status === 'committed' ? (
                    <span className="text-success">
                      Committed{r.voucher_number ? ` — ${r.voucher_number}` : ''}
                    </span>
                  ) : r.status === 'validated' && r.dry_run ? (
                    <span className="text-success">Validated (dry run)</span>
                  ) : (
                    <span className="text-muted-foreground">{r.status}</span>
                  )}
                </div>
              )
            })
          )}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {committed.length} committed, {dryRun.length} validated (dry run), {failed.length} failed.
        </p>
        <Button className="mt-5 h-11 w-full" onClick={reset}>
          Done
        </Button>
      </Modal>
    )
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

      {state === 'error' ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="size-4 shrink-0" /> {errorMessage}
        </p>
      ) : null}

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
        ) : (
          <>
            <RefreshCw className="size-4" /> Sync Selected ({total})
          </>
        )}
      </Button>
    </Modal>
  )
}
