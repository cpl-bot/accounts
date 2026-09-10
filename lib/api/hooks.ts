'use client'

// Small client-side data hooks built on plain fetch + useEffect. No SWR/React
// Query dependency per the engineering plan — just enough caching per hook to
// avoid duplicate requests within a component's lifetime, plus polling where
// the plan calls for it (Tally status).

import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, apiFetch, apiPath } from './client'
import {
  attachmentSchema,
  attachmentsListSchema,
  billsResponseSchema,
  dashboardFormulaSchema,
  dashboardOverviewSchema,
  dashboardPayablesSchema,
  draftSchema,
  ledgerLookupResultSchema,
  ledgerSchema,
  settingsSchema,
  syncRunListSchema,
  syncStatusSchema,
  tallyStatusSchema,
  type Attachment,
  type BillsResponse,
  type DashboardFormula,
  type Draft,
  type DashboardOverview,
  type DashboardPayables,
  type LedgerLookupResult,
  type Settings,
  type SyncRunList,
  type SyncScope,
  type SyncStatus,
  type TallyStatus,
} from './schema'
import { z } from 'zod'

/**
 * Fired on `window` after a manual pull sync completes (see `pullSync`). Every
 * mounted `useResource` hook refetches on it, so the dashboard, bills and
 * drafts reflect the freshly pulled data without a page reload.
 */
export const SYNC_COMPLETED_EVENT = 'talai:sync-completed'

export type AsyncState<T> = {
  data: T | null
  error: ApiError | Error | null
  loading: boolean
  refetch: () => void
}

// `path` is expected to already encode every value the request depends on
// (see apiPath's query-string building below), so it alone is a sufficient
// effect dependency — no separate `deps` list needed.
function useResource<S extends z.ZodTypeAny>(
  path: string | null,
  schema: S,
): AsyncState<z.infer<S>> {
  const [data, setData] = useState<z.infer<S> | null>(null)
  const [error, setError] = useState<ApiError | Error | null>(null)
  const [loading, setLoading] = useState(path !== null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!path) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: this effect's job is the fetch itself, and loading/error are its own derived state, not react synchronizing with external state.
    setLoading(true)
    setError(null)
    apiFetch(path, schema)
      .then((result) => {
        if (!cancelled) {
          setData(result)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error('Unknown error'))
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick])

  const refetch = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    if (!path) return
    window.addEventListener(SYNC_COMPLETED_EVENT, refetch)
    return () => window.removeEventListener(SYNC_COMPLETED_EVENT, refetch)
  }, [path, refetch])

  return { data, error, loading, refetch }
}

/** Polls `/tally/status` every 30s so the header pill reflects live state. */
export function useTallyStatus(pollMs = 30_000): AsyncState<TallyStatus> {
  const [data, setData] = useState<TallyStatus | null>(null)
  const [error, setError] = useState<ApiError | Error | null>(null)
  const [loading, setLoading] = useState(true)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(() => {
    apiFetch('tally/status', tallyStatusSchema)
      .then((result) => {
        setData(result)
        setError(null)
        setLoading(false)
      })
      .catch((err) => {
        setError(err instanceof Error ? err : new Error('Unknown error'))
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    load()
    timer.current = setInterval(load, pollMs)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [load, pollMs])

  return { data, error, loading, refetch: load }
}

export function useDashboardOverview(from: string, to: string): AsyncState<DashboardOverview> {
  return useResource(apiPath('dashboard/overview', { from, to }), dashboardOverviewSchema)
}

export function useDashboardPayables(asOn?: string): AsyncState<DashboardPayables> {
  return useResource(apiPath('dashboard/payables', { as_on: asOn }), dashboardPayablesSchema)
}

export function useBills(
  direction: 'payable' | 'receivable' = 'payable',
  asOn?: string,
): AsyncState<BillsResponse> {
  return useResource(apiPath('bills', { direction, as_on: asOn }), billsResponseSchema)
}

const draftsListSchema = z.object({ items: z.array(draftSchema), total: z.number() })

export function useDrafts(status?: string): AsyncState<{ items: Draft[]; total: number }> {
  return useResource(apiPath('drafts', { status }), draftsListSchema)
}

export function useSettings(): AsyncState<Settings> {
  return useResource('settings', settingsSchema)
}

export function useDraft(id: string | null): AsyncState<Draft> {
  return useResource(id ? `drafts/${id}` : null, draftSchema)
}

const listLedgersSchema = z.object({ items: z.array(ledgerSchema), total: z.number().optional() })

export function useLedgers(group?: string): AsyncState<{ items: z.infer<typeof ledgerSchema>[] }> {
  return useResource(apiPath('ledgers', { group }), listLedgersSchema)
}

/**
 * Looks up `name` against Tally's ledger master, debounced by `delayMs` so a
 * lookup fires only once the user pauses typing (§3.8). Returns `null` while
 * `name` is empty or a lookup hasn't resolved yet.
 */
export function useLedgerLookup(name: string, delayMs = 400): AsyncState<LedgerLookupResult> {
  const [debounced, setDebounced] = useState(name)

  useEffect(() => {
    const trimmed = name.trim()
    if (trimmed === '') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: clearing the debounced query the instant the field empties (rather than waiting out delayMs) is the sync behaviour this effect exists for.
      setDebounced('')
      return
    }
    const timer = setTimeout(() => setDebounced(trimmed), delayMs)
    return () => clearTimeout(timer)
  }, [name, delayMs])

  return useResource(
    debounced ? apiPath('ledgers/lookup', { name: debounced }) : null,
    ledgerLookupResultSchema,
  )
}

export function useDashboardFormula(): AsyncState<DashboardFormula> & {
  save: (formula: DashboardFormula) => Promise<DashboardFormula>
} {
  const state = useResource('settings/dashboard', dashboardFormulaSchema)
  const save = useCallback(
    async (formula: DashboardFormula) => {
      const result = await apiFetch('settings/dashboard', dashboardFormulaSchema, {
        method: 'PUT',
        body: JSON.stringify(formula),
      })
      state.refetch()
      return result
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch is stable per useResource render
    [],
  )
  return { ...state, save }
}

const ATTACHMENT_POLL_MS = 5_000

/** Lists attachments, polling every 5s while any are pending/running OCR. */
export function useAttachments(): AsyncState<{ items: Attachment[] }> {
  const state = useResource('attachments', attachmentsListSchema)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const hasActive = state.data?.items.some(
      (a) => a.ocr_status === 'pending' || a.ocr_status === 'running',
    )
    if (!hasActive) return
    timer.current = setInterval(() => state.refetch(), ATTACHMENT_POLL_MS)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch identity is stable enough here; we only care about hasActive
  }, [state.data])

  return state
}

export function useAttachment(id: string | null): AsyncState<Attachment> {
  return useResource(id ? `attachments/${id}` : null, attachmentSchema)
}

/** Creates a voucher draft pre-filled from an attachment's OCR result. */
export async function createDraftFromAttachment(id: string): Promise<Draft> {
  return apiFetch(`attachments/${id}/draft`, draftSchema, { method: 'POST' })
}

/** Re-runs OCR on an attachment (e.g. after it failed). */
export async function rerunOcr(id: string): Promise<Attachment> {
  return apiFetch(`attachments/${id}/ocr`, attachmentSchema, { method: 'POST' })
}

/** Per-scope last-run status from `/sync/status` (masters/vouchers/bills/stock). */
export function useSyncStatus(): AsyncState<SyncStatus> {
  return useResource('sync/status', syncStatusSchema)
}

/**
 * Triggers a manual pull sync. Omit `scopes` to pull every scope. Once the
 * middleware answers (whether or not every scope succeeded — a partial sync
 * still changed data), every mounted `useResource` hook is told to refetch.
 */
export async function pullSync(scopes?: SyncScope[]): Promise<SyncRunList> {
  const result = await apiFetch('sync/pull', syncRunListSchema, {
    method: 'POST',
    body: JSON.stringify(scopes ? { scopes } : {}),
  })
  window.dispatchEvent(new Event(SYNC_COMPLETED_EVENT))
  return result
}
