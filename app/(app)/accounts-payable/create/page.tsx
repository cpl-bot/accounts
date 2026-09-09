import { Suspense } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { CreateBillForm } from '@/components/ap/create-bill-form'
import { buttonVariants } from '@/components/ui/button'

export default function CreateBillPage() {
  return (
    <>
      <PageHeader
        title="Create Bill"
        actions={
          <Link
            href="/accounts-payable"
            className={buttonVariants({ variant: 'outline', size: 'lg' })}
          >
            <ArrowLeft className="size-4" /> Back to Bills
          </Link>
        }
      />
      <main className="flex-1 overflow-y-auto p-6">
        <Suspense
          fallback={
            <div className="flex items-center justify-center gap-2 p-16 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </div>
          }
        >
          <CreateBillForm />
        </Suspense>
      </main>
    </>
  )
}
