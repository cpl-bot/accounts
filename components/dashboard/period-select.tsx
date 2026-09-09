'use client'

import { useState } from 'react'
import { Calendar, ChevronDown, X, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

const OPTIONS = [
  'Previous Fiscal Year',
  'Current Fiscal Year',
  'This Quarter',
  'This Month',
  'May 01, 2026 – May 12, 2026',
]

export function PeriodSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-muted"
      >
        <Calendar className="size-4 text-muted-foreground" />
        <span>{value}</span>
        <span className="mx-1 h-5 w-px bg-border" />
        <X
          className="size-4 text-muted-foreground hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation()
            onChange('Current Fiscal Year')
          }}
        />
        <ChevronDown className="size-4 text-muted-foreground" />
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 z-20 mt-1 w-64 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-lg">
            {OPTIONS.map((opt) => (
              <button
                key={opt}
                onClick={() => {
                  onChange(opt)
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-muted',
                  value === opt && 'font-medium text-primary',
                )}
              >
                {opt}
                {value === opt ? <Check className="size-4" /> : null}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}
