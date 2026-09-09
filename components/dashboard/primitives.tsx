import { Info, Clock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export function WidgetLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-sm font-semibold text-foreground">{children}</span>
      <Info className="size-4 text-muted-foreground" aria-hidden="true" />
    </div>
  )
}

export function AsOnPill({ date }: { date: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
      <Clock className="size-3.5" aria-hidden="true" />
      As on {date}
    </span>
  )
}

export function ChangePill({ pct }: { pct: number }) {
  if (pct === 0) {
    return (
      <Badge variant="neutral" className="tabular-nums">
        0%
      </Badge>
    )
  }
  const up = pct > 0
  return (
    <Badge variant={up ? 'success' : 'destructive'} className="tabular-nums">
      {up ? '↑' : '↓'} {Math.abs(pct).toFixed(2)}%
    </Badge>
  )
}

export function VsPrevious({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-2">
      <ChangePill pct={pct} />
      <span className="text-sm text-muted-foreground">
        vs <span className="underline decoration-dotted underline-offset-2">Previous period</span>
      </span>
    </div>
  )
}

export function StatValue({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn('text-3xl font-bold tracking-tight tabular-nums text-foreground', className)}>
      {children}
    </p>
  )
}
