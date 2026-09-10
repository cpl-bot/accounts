import { PanelLeft } from 'lucide-react'
import { TallyStatusPill } from '@/components/layout/tally-status-pill'
import { SyncStatusPanel } from '@/components/layout/sync-status-panel'

export function PageHeader({
  title,
  actions,
}: {
  title: string
  actions?: React.ReactNode
}) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border bg-background px-6">
      <div className="flex items-center gap-3">
        <PanelLeft className="size-5 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
      </div>
      <div className="flex items-center gap-3">
        <TallyStatusPill />
        <SyncStatusPanel />
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  )
}
