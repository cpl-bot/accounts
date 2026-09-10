'use client'

import { useState } from 'react'
import { ChevronDown, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSyncStatus, pullSync } from '@/lib/api/hooks'
import { ApiError } from '@/lib/api/client'
import type { SyncRunList, SyncScope } from '@/lib/api/schema'
import { cn } from '@/lib/utils'

const SCOPE_LABELS: Record<SyncScope, string> = {
  masters: 'Masters',
  vouchers: 'Vouchers',
  bills: 'Bills',
  stock: 'Stock',
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return 'never'
  return new Date(value).toLocaleString()
}

export function SyncStatusPanel() {
  const { data, loading, refetch } = useSyncStatus()
  const [syncing, setSyncing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [lastRun, setLastRun] = useState<SyncRunList | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)

  const scopes = data?.scopes ?? []
  const neverSynced = scopes.length > 0 && scopes.every((s) => s.status === null)
  const failedScopes = scopes.filter((s) => s.status === 'failed')
  const anyRunning = syncing || scopes.some((s) => s.status === 'running')

  const handleSync = async () => {
    setSyncing(true)
    setSyncError(null)
    try {
      const result = await pullSync()
      setLastRun(result)
    } catch (err) {
      setSyncError(err instanceof ApiError ? err.message : 'Sync failed unexpectedly.')
    } finally {
      setSyncing(false)
      refetch()
    }
  }

  let summary = 'Checking sync status…'
  let summaryClass = 'text-muted-foreground'
  if (!loading && data) {
    if (anyRunning) {
      summary = 'Syncing…'
    } else if (neverSynced) {
      summary = 'Never synced'
    } else if (failedScopes.length > 0) {
      summary = `Partial sync — ${failedScopes.length} of ${scopes.length} failed`
      summaryClass = 'text-destructive'
    } else {
      const latest = scopes
        .map((s) => s.last_success_at)
        .filter((t): t is string => Boolean(t))
        .sort()
        .at(-1)
      summary = `Last synced ${formatTimestamp(latest)}`
    }
  }

  const failedRuns = lastRun?.items.filter((r) => r.status === 'failed') ?? []

  return (
    <div className="relative flex items-center">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className={cn(
            'flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted/50',
            summaryClass,
          )}
        >
          {summary}
          <ChevronDown className={cn('size-3.5 transition-transform', expanded && 'rotate-180')} />
        </button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSync}
          disabled={anyRunning}
          aria-label="Sync now"
        >
          {syncing ? (
            <>
              <Loader2 className="size-3.5 animate-spin" /> Syncing…
            </>
          ) : (
            <>
              <RefreshCw className="size-3.5" /> Sync now
            </>
          )}
        </Button>
      </div>

      {syncError || failedRuns.length > 0 || expanded ? (
        <div
          className="absolute right-0 top-full z-50 mt-2 flex w-72 flex-col gap-2"
          role="region"
          aria-label="Sync details"
        >
          {syncError ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {syncError}
            </p>
          ) : null}

          {failedRuns.length > 0 ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {failedRuns.map((r) => (
                <p key={`${r.id}-${r.scope}`}>
                  {SCOPE_LABELS[r.scope as SyncScope] ?? r.scope} failed
                  {r.error ? `: ${r.error}` : '.'}
                </p>
              ))}
            </div>
          ) : null}

          {expanded ? (
            <div className="rounded-lg border border-border bg-card p-3 text-xs shadow-md">
              <ul className="flex flex-col gap-2">
                {scopes.map((s) => (
                  <li key={s.scope} className="flex flex-col gap-0.5">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-foreground">
                        {SCOPE_LABELS[s.scope] ?? s.scope}
                      </span>
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[0.7rem]',
                          s.status === 'failed'
                            ? 'bg-destructive/10 text-destructive'
                            : s.status === 'success'
                              ? 'bg-success/10 text-success'
                              : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {s.status ?? 'never run'}
                      </span>
                    </div>
                    <span className="text-muted-foreground">
                      Last success: {formatTimestamp(s.last_success_at)}
                    </span>
                    {s.error ? <span className="text-destructive">{s.error}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
