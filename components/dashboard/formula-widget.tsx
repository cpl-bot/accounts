'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { useDashboardFormula } from '@/lib/api/hooks'
import type { DashboardFormula } from '@/lib/api/schema'

const MODE_COPY: Record<DashboardFormula['gross_profit_mode'], string> = {
  simple: 'Gross Profit = Revenue − Cost of Sales for the period.',
  trading: 'Gross Profit = Revenue − (Opening Stock + Cost of Sales − Closing Stock).',
}

export function StockStatusLine({
  status,
}: {
  status?: 'applied' | 'manual' | 'unavailable'
}) {
  if (!status) return null
  if (status === 'applied') {
    return (
      <p className="flex items-center gap-1.5 text-xs text-success">
        <CheckCircle2 className="size-3.5" /> Stock adjustment applied from Tally
      </p>
    )
  }
  if (status === 'manual') {
    return <p className="text-xs text-muted-foreground">Using manual stock values</p>
  }
  return (
    <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
      <AlertTriangle className="size-3.5" /> Stock value unavailable — enter manual values
    </p>
  )
}

/**
 * Sidebar widget for the configurable gross-profit formula (§3.9). Collapses
 * to a summary row on small screens; `onSaved` lets the caller (the
 * Dashboard Overview tab) refetch the overview once the formula changes.
 */
export function FormulaWidget({
  onSaved,
  stockAdjustmentStatus,
}: {
  onSaved?: () => void
  stockAdjustmentStatus?: 'applied' | 'manual' | 'unavailable'
}) {
  const { data, loading, error, save } = useDashboardFormula()
  const [open, setOpen] = useState(true)
  const [mode, setMode] = useState<DashboardFormula['gross_profit_mode']>('simple')
  const [stockSource, setStockSource] = useState<DashboardFormula['stock_source']>('tally')
  const [openingStock, setOpeningStock] = useState('')
  const [closingStock, setClosingStock] = useState('')
  const [revenueGroups, setRevenueGroups] = useState('')
  const [costGroups, setCostGroups] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveWarnings, setSaveWarnings] = useState<string[]>([])

  useEffect(() => {
    if (!data) return
    /* eslint-disable react-hooks/set-state-in-effect -- intentional: seeds local editable state from the fetched formula once, on load. */
    setMode(data.gross_profit_mode)
    setStockSource(data.stock_source)
    setOpeningStock(data.manual_opening_stock ?? '')
    setClosingStock(data.manual_closing_stock ?? '')
    setRevenueGroups(data.revenue_groups.join(', '))
    setCostGroups(data.cost_of_sales_groups.join(', '))
    setSaveWarnings([])
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [data])

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      // `warnings` is server-reported (advisory complaints about the stored
      // formula) and must not be echoed back in the PUT body.
      const result = await save({
        gross_profit_mode: mode,
        stock_source: stockSource,
        manual_opening_stock: stockSource === 'manual' ? openingStock || null : null,
        manual_closing_stock: stockSource === 'manual' ? closingStock || null : null,
        revenue_groups: revenueGroups
          .split(',')
          .map((g) => g.trim())
          .filter(Boolean),
        cost_of_sales_groups: costGroups
          .split(',')
          .map((g) => g.trim())
          .filter(Boolean),
      })
      setSaveWarnings(result.warnings ?? [])
      onSaved?.()
    } catch {
      setSaveError('Could not save the formula.')
    } finally {
      setSaving(false)
    }
  }

  const warnings = saveWarnings.length > 0 ? saveWarnings : data?.warnings ?? []

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center justify-between text-left sm:pointer-events-none sm:cursor-default"
        >
          <span className="text-sm font-semibold">Gross Profit Formula</span>
          <ChevronDown className={`size-4 text-muted-foreground transition-transform sm:hidden ${open ? 'rotate-180' : ''}`} />
        </button>

        <div className={open ? 'flex flex-col gap-4' : 'hidden sm:flex sm:flex-col sm:gap-4'}>
          {loading && !data ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">Could not load the formula.</p>
          ) : (
            <>
              <fieldset className="flex flex-col gap-2">
                {(['simple', 'trading'] as const).map((m) => (
                  <div key={m} className="flex items-start gap-2 text-sm">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="gross-profit-mode"
                        className="accent-primary"
                        checked={mode === m}
                        onChange={() => setMode(m)}
                      />
                      <span className="font-medium capitalize">{m}</span>
                    </label>
                    <p className="-mt-0.5 text-xs text-muted-foreground">{MODE_COPY[m]}</p>
                  </div>
                ))}
              </fieldset>

              <fieldset className="flex flex-col gap-2">
                <Label>Stock Source</Label>
                <div className="flex gap-4">
                  {(['tally', 'manual'] as const).map((s) => (
                    <label key={s} className="flex items-center gap-1.5 text-sm capitalize">
                      <input
                        type="radio"
                        name="stock-source"
                        className="accent-primary"
                        checked={stockSource === s}
                        onChange={() => setStockSource(s)}
                      />
                      {s}
                    </label>
                  ))}
                </div>
              </fieldset>

              {stockSource === 'manual' ? (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Opening Stock">
                    <Input value={openingStock} onChange={(e) => setOpeningStock(e.target.value)} />
                  </Field>
                  <Field label="Closing Stock">
                    <Input value={closingStock} onChange={(e) => setClosingStock(e.target.value)} />
                  </Field>
                </div>
              ) : null}

              <Field label="Revenue Groups (comma-separated)">
                <Input value={revenueGroups} onChange={(e) => setRevenueGroups(e.target.value)} />
              </Field>
              <Field label="Cost of Sales Groups (comma-separated)">
                <Input value={costGroups} onChange={(e) => setCostGroups(e.target.value)} />
              </Field>

              {warnings.length > 0 ? (
                <div className="flex flex-col gap-1 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                  {warnings.map((w) => (
                    <p key={w} className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {w}
                    </p>
                  ))}
                </div>
              ) : null}

              <StockStatusLine status={stockAdjustmentStatus} />

              {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}

              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                Save
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-medium text-muted-foreground">{children}</span>
}
