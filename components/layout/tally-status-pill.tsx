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
    } else if (data.connected) {
      color = 'bg-success'
      label = data.company ? `Connected — ${data.company}` : 'Connected'
    } else {
      color = 'bg-amber-500'
      label = 'Not connected'
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
