import { PageHeader } from '@/components/layout/page-header'
import { Construction } from 'lucide-react'

export function ComingSoon({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <main className="flex flex-1 items-center justify-center overflow-y-auto p-6">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <Construction className="size-6" />
          </div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground text-pretty">
            This module is part of the roadmap. The Dashboard and Accounts Payable flows are wired
            up in this MVP scaffold.
          </p>
        </div>
      </main>
    </>
  )
}
