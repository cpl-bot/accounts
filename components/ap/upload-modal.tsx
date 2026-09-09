'use client'

import { useRef, useState } from 'react'
import { FilePlus2, CheckCircle2, Loader2, AlertTriangle } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { apiFetch, ApiError } from '@/lib/api/client'
import { attachmentSchema, type Attachment } from '@/lib/api/schema'

type UploadState = {
  name: string
  status: 'pending' | 'uploading' | 'done' | 'error'
  attachment?: Attachment
  error?: string
}

export function UploadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploads, setUploads] = useState<UploadState[]>([])
  const [dragging, setDragging] = useState(false)

  // The middleware processes one bill at a time via OCR (PRD MVP), so files
  // are uploaded sequentially even when several are dropped at once.
  const addFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return
    const files = Array.from(list)
    setUploads((prev) => [...prev, ...files.map((f) => ({ name: f.name, status: 'pending' as const }))])

    for (const file of files) {
      setUploads((prev) =>
        prev.map((u) => (u.name === file.name && u.status === 'pending' ? { ...u, status: 'uploading' } : u)),
      )
      try {
        const formData = new FormData()
        formData.append('file', file)
        const attachment = await apiFetch('attachments', attachmentSchema, {
          method: 'POST',
          body: formData,
        })
        setUploads((prev) =>
          prev.map((u) => (u.name === file.name ? { ...u, status: 'done', attachment } : u)),
        )
      } catch (err) {
        setUploads((prev) =>
          prev.map((u) =>
            u.name === file.name
              ? { ...u, status: 'error', error: err instanceof ApiError ? err.message : 'Upload failed.' }
              : u,
          ),
        )
      }
    }
  }

  const close = () => {
    setUploads([])
    onClose()
  }

  return (
    <Modal open={open} onClose={close} title="Bulk Upload Bills">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          addFiles(e.dataTransfer.files)
        }}
        className={`flex min-h-64 flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          dragging ? 'border-primary bg-accent/40' : 'border-border'
        }`}
      >
        <div className="flex size-14 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <FilePlus2 className="size-6" />
        </div>
        <div>
          <p className="text-base font-medium">
            Drop your files or{' '}
            <button
              onClick={() => inputRef.current?.click()}
              className="text-primary underline underline-offset-2"
            >
              browse
            </button>
          </p>
          <p className="mt-1 text-sm text-muted-foreground">Upload up to 20 MB per file</p>
          <p className="text-sm text-muted-foreground">Supported formats: PDF/PNG/JPG/JPEG</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg"
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
      </div>

      {uploads.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-2">
          {uploads.map((u) => (
            <li key={u.name} className="flex items-center gap-2 text-sm">
              {u.status === 'uploading' ? (
                <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
              ) : u.status === 'done' ? (
                <CheckCircle2 className="size-4 shrink-0 text-success" />
              ) : u.status === 'error' ? (
                <AlertTriangle className="size-4 shrink-0 text-destructive" />
              ) : (
                <span className="size-4 shrink-0" />
              )}
              <span className="truncate">{u.name}</span>
              {u.status === 'error' ? (
                <span className="ml-auto text-xs text-destructive">{u.error}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          Files are uploaded and queued for OCR extraction one at a time.
        </p>
      )}
    </Modal>
  )
}
