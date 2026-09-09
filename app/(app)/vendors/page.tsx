'use client'

import { useMemo, useState } from 'react'
import { Plus, Search, Loader2, AlertTriangle, ChevronDown } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Modal } from '@/components/ui/modal'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { apiFetch, ApiError } from '@/lib/api/client'
import { useLedgers } from '@/lib/api/hooks'
import { vendorLedgerCreateSchema, vendorLedgerCreateResultSchema } from '@/lib/api/schema'

function SourceBadge({ source }: { source?: 'tally' | 'talai' }) {
  if (source === 'talai') {
    return (
      <Badge variant="outline" title="Created in Talai; not yet confirmed by a pull from Tally">
        talai
      </Badge>
    )
  }
  return <Badge variant="neutral">tally</Badge>
}

function NewVendorModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [gstType, setGstType] = useState<'regular' | 'composition' | 'unregistered'>('regular')
  const [gstin, setGstin] = useState('')
  const [state, setState] = useState('')
  const [billingAddress, setBillingAddress] = useState('')
  const [mailingName, setMailingName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ dry_run?: boolean; generated_xml?: string } | null>(null)
  const [xmlOpen, setXmlOpen] = useState(false)

  const close = () => {
    setName('')
    setGstin('')
    setState('')
    setBillingAddress('')
    setMailingName('')
    setError(null)
    setResult(null)
    setXmlOpen(false)
    onClose()
  }

  const submit = async () => {
    setError(null)
    const parsed = vendorLedgerCreateSchema.safeParse({
      name,
      gst_registration_type: gstType,
      gstin: gstin || null,
      state,
      billing_address: billingAddress,
      mailing_name: mailingName || undefined,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Fill in the required fields.')
      return
    }
    setSaving(true)
    try {
      const res = await apiFetch('ledgers', vendorLedgerCreateResultSchema, {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      })
      setResult(res)
      onCreated()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the vendor.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={close} title="New Vendor">
      {result ? (
        <div className="flex flex-col gap-3">
          {result.dry_run ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <p>Dry run: Tally write is disabled, so no ledger was created yet.</p>
            </div>
          ) : (
            <p className="text-sm text-success">Vendor ledger created.</p>
          )}
          {result.generated_xml ? (
            <div>
              <button
                type="button"
                onClick={() => setXmlOpen((v) => !v)}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                <ChevronDown className={`size-4 transition-transform ${xmlOpen ? 'rotate-180' : ''}`} />
                Generated XML
              </button>
              {xmlOpen ? (
                <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-muted p-3 text-xs">
                  {result.generated_xml}
                </pre>
              ) : null}
            </div>
          ) : null}
          <Button className="mt-2 w-full" onClick={close}>
            Done
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="GST Registration Type">
            <Select value={gstType} onChange={(e) => setGstType(e.target.value as typeof gstType)}>
              <option value="regular">Registered — Regular</option>
              <option value="composition">Registered — Composition</option>
              <option value="unregistered">Unregistered</option>
            </Select>
          </Field>
          <Field label="GSTIN">
            <Input value={gstin} onChange={(e) => setGstin(e.target.value)} />
          </Field>
          <Field label="State">
            <Input value={state} onChange={(e) => setState(e.target.value)} />
          </Field>
          <Field label="Billing Address">
            <Textarea rows={2} value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)} />
          </Field>
          <Field label="Mailing Name (optional)">
            <Input value={mailingName} onChange={(e) => setMailingName(e.target.value)} />
          </Field>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button className="w-full" size="lg" onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Create Vendor
          </Button>
        </div>
      )}
    </Modal>
  )
}

export default function VendorsPage() {
  const [query, setQuery] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const ledgersQuery = useLedgers('Sundry Creditors')

  const filtered = useMemo(() => {
    const items = ledgersQuery.data?.items ?? []
    if (!query) return items
    return items.filter((l) => l.name.toLowerCase().includes(query.toLowerCase()))
  }, [ledgersQuery.data, query])

  return (
    <>
      <PageHeader
        title="Vendors"
        actions={
          <Button size="lg" onClick={() => setModalOpen(true)}>
            <Plus className="size-4" /> New Vendor
          </Button>
        }
      />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="flex flex-col gap-4">
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search vendors..."
              className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            />
          </div>

          {ledgersQuery.loading && !ledgersQuery.data ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-border p-16 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading vendors…
            </div>
          ) : ledgersQuery.error ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-border p-16 text-center">
              <AlertTriangle className="size-6 text-destructive" />
              <p className="text-sm text-muted-foreground">
                Could not load vendors: {ledgersQuery.error.message}
              </p>
              <Button variant="outline" size="sm" onClick={ledgersQuery.refetch}>
                Retry
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">GSTIN</th>
                    <th className="px-4 py-3 font-medium">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((l) => (
                    <tr key={l.name} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-3 font-medium">{l.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{l.gstin ?? '—'}</td>
                      <td className="px-4 py-3">
                        <SourceBadge source={l.source} />
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-10 text-center text-muted-foreground">
                        No vendors match &quot;{query}&quot;.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      <NewVendorModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={() => ledgersQuery.refetch()}
      />
    </>
  )
}
