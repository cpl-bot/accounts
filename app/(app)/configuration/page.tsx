import { PageHeader } from '@/components/layout/page-header'
import { ConnectionForm } from '@/components/configuration/connection-form'

export default function ConfigurationPage() {
  return (
    <>
      <PageHeader title="Configuration" />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl">
          <ConnectionForm />
        </div>
      </main>
    </>
  )
}
