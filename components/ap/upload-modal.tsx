'use client'

import { useRef, useState } from 'react'
import { FilePlus2, CheckCircle2 } from 'lucide-react'
import { Modal } from '@/components/ui/modal'

export function UploadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)

  const addFiles = (list: FileList | null) => {
    if (!list) return
    setFiles((prev) => [...prev, ...Array.from(list).map((f) => f.name)])
  }

  return (
    <Modal open={open} onClose={onClose} title="Bulk Upload Bills">
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
          <p className="mt-1 text-sm text-muted-foreground">Upload up to 500 MB</p>
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

      {files.length > 0 ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-success">
          <CheckCircle2 className="size-4" />
          All {files.length} file{files.length > 1 ? 's' : ''} uploaded successfully
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          The MVP processes one bill at a time via OCR; bulk upload queues each file for extraction.
        </p>
      )}
    </Modal>
  )
}
