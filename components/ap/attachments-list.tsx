'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, AlertTriangle, CheckCircle2, FileText, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAttachments, createDraftFromAttachment, rerunOcr } from '@/lib/api/hooks'
import type { Attachment } from '@/lib/api/schema'

function confidenceSummary(a: Attachment): string | null {
  const conf = a.ocr_result?.confidence
  if (!conf) return null
  const parts: string[] = []
  if (conf.supplier_name !== undefined) parts.push(`supplier ${conf.supplier_name.toFixed(2)}`)
  else if (conf.supplier !== undefined) parts.push(`supplier ${conf.supplier.toFixed(2)}`)
  if (conf.total !== undefined) parts.push(`total ${conf.total.toFixed(2)}`)
  else if (conf.grand_total !== undefined) parts.push(`total ${conf.grand_total.toFixed(2)}`)
  return parts.length > 0 ? parts.join(' · ') : null
}

function OcrPill({ attachment, onRetry }: { attachment: Attachment; onRetry: (id: string) => void }) {
  switch (attachment.ocr_status) {
    case 'pending':
      return (
        <Badge variant="neutral">
          <Loader2 className="size-3 animate-spin" /> Pending
        </Badge>
      )
    case 'running':
      return (
        <Badge variant="default">
          <Loader2 className="size-3 animate-spin" /> Running
        </Badge>
      )
    case 'done': {
      const summary = confidenceSummary(attachment)
      return (
        <Badge variant="success">
          <CheckCircle2 className="size-3" /> Done{summary ? ` · ${summary}` : ''}
        </Badge>
      )
    }
    case 'failed':
      return (
        <div className="flex items-center gap-2">
          <Badge variant="destructive">
            <AlertTriangle className="size-3" /> Failed{attachment.ocr_error ? `: ${attachment.ocr_error}` : ''}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => onRetry(attachment.id)}>
            <RotateCw className="size-3.5" /> Retry
          </Button>
        </div>
      )
    case 'skipped':
      return (
        <Badge variant="neutral" title="OCR disabled (OCR_PROVIDER=none)">
          OCR disabled (OCR_PROVIDER=none)
        </Badge>
      )
    default:
      return null
  }
}

export function AttachmentsList() {
  const { data, loading, error, refetch } = useAttachments()
  // useRouter throws outside an actual Next.js app-router tree (e.g. this
  // component under test in isolation); fall back to a plain navigation so
  // both contexts work.
  let router: ReturnType<typeof useRouter> | null = null
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- see comment above; the try/catch only guards the invariant this hook throws outside an app-router tree, it still runs unconditionally on every render.
    router = useRouter()
  } catch {
    router = null
  }
  const [creating, setCreating] = useState<string | null>(null)

  const createBill = async (id: string) => {
    setCreating(id)
    try {
      const draft = await createDraftFromAttachment(id)
      const href = `/accounts-payable/create?draft=${draft.id}`
      if (router) router.push(href)
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- fallback only for tests/contexts with no app router mounted; real usage always has `router` above.
      else if (typeof window !== 'undefined') window.location.assign(href)
    } finally {
      setCreating(null)
    }
  }

  const retry = async (id: string) => {
    await rerunOcr(id)
    refetch()
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-border p-16 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading uploads…
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border p-16 text-center">
        <AlertTriangle className="size-6 text-destructive" />
        <p className="text-sm text-muted-foreground">Could not load uploads: {error.message}</p>
        <Button variant="outline" size="sm" onClick={refetch}>
          Retry
        </Button>
      </div>
    )
  }

  const items = data?.items ?? []
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-border p-16 text-center text-sm text-muted-foreground">
        No bills uploaded yet.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
            <th className="px-4 py-3 font-medium">File Name</th>
            <th className="px-4 py-3 font-medium">Uploaded At</th>
            <th className="px-4 py-3 font-medium">OCR Status</th>
            <th className="px-4 py-3 font-medium" />
          </tr>
        </thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.id} className="border-b border-border/60 last:border-0">
              <td className="px-4 py-3">
                <span className="flex items-center gap-2 font-medium">
                  <FileText className="size-4 text-muted-foreground" /> {a.file_name}
                </span>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {new Date(a.uploaded_at).toLocaleString()}
              </td>
              <td className="px-4 py-3">
                <OcrPill attachment={a} onRetry={retry} />
              </td>
              <td className="px-4 py-3 text-right">
                <Button size="sm" variant="outline" onClick={() => createBill(a.id)} disabled={creating === a.id}>
                  {creating === a.id ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  Create bill from this file
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
