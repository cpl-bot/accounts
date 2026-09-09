'use client'

import { useTallyStatus } from '@/lib/api/hooks'
import { cn } from '@/lib/utils'

export function TallyStatusPill() {
  const { data, loading, error } = useTallyStatus()

  let color = 'bg-muted-foreground'
  let label = 'Checking Tally…'

  if (!loading) {
    if (error || !data) {
      color = 'bg-destructive'
      label = 'Tally unreachable'
    } else if (data.breaker_open) {
      color = 'bg-destructive'
      label = 'Tally circuit open'
    } else if (!data.reachable) {
      color = 'bg-destructive'
      label = data.error ? `Tally unreachable — ${data.error}` : 'Tally unreachable'
    } else if (!data.company_match) {
      color = 'bg-amber-500'
      label = data.expected_company
        ? `Wrong company open — expected ${data.expected_company}`
        : 'Wrong company open'
    } else {
      color = 'bg-success'
      label = data.active_company ? `Connected — ${data.active_company}` : 'Connected'
    }
  }

  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground"
      role="status"
    >
      <span className={cn('size-2 rounded-full', color)} aria-hidden="true" />
      {label}
    </span>
  )
}
