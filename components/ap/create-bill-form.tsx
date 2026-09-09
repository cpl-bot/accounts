'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Plus, Trash2, Sparkles, AlertTriangle, Loader2, CheckCircle2, CircleCheck } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Field, Input, Select, Textarea, Label } from '@/components/ui/field'
import { formatINR } from '@/lib/format'
import { apiFetch, ApiError } from '@/lib/api/client'
import { draftPurchaseBillSchema, draftSchema, type Draft, type DraftPurchaseBill } from '@/lib/api/schema'
import { useAttachment, useDraft, useLedgerLookup } from '@/lib/api/hooks'
import { OCR_MIN_CONFIDENCE } from '@/lib/api/schema'

type LineItem = {
  id: number
  description: string
  item: string
  godown: string
  quantity: number
  rate: number
  hsn: string
}

type LedgerLine = {
  id: number
  description: string
  ledger: string
  costCenter: string
  amount: number
}

function Section({
  title,
  description,
  children,
  action,
}: {
  title: string
  description?: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </Card>
  )
}

let nextId = 100

const STOCK_ITEM_REQUIRED = 'Choose a stock item on every line item before saving.'

export function CreateBillForm() {
  const searchParams = useSearchParams()
  const draftId = searchParams?.get('draft') ?? null
  const existingDraftQuery = useDraft(draftId)
  const prefilledRef = useRef<string | null>(null)

  const [voucherDate, setVoucherDate] = useState('2026-06-10')
  const [billDate, setBillDate] = useState('2026-05-10')
  const [dueDate, setDueDate] = useState('2026-06-09')
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('INV/BSM/4471')
  const [gstRegistration, setGstRegistration] = useState('27AABCN1234C1ZP')
  const [voucherType, setVoucherType] = useState('Purchase')
  const [costCentre, setCostCentre] = useState('Procurement')
  const [purchaseLedger, setPurchaseLedger] = useState('Purchase')
  const [reverseCharge, setReverseCharge] = useState(false)
  const [narration, setNarration] = useState('')

  const [vendorName, setVendorName] = useState('BioShield Medical')
  const [gstTreatment, setGstTreatment] = useState<'regular' | 'composition' | 'unregistered'>(
    'regular',
  )
  const [billingAddress, setBillingAddress] = useState(
    '14 Industrial Estate, Andheri East, Mumbai 400093',
  )
  const [gstin, setGstin] = useState('27AAECB1234D1Z5')
  const [sourceOfSupply, setSourceOfSupply] = useState('Maharashtra')
  const [destinationOfSupply, setDestinationOfSupply] = useState('Maharashtra')
  const [createIfMissing, setCreateIfMissing] = useState(false)

  const [items, setItems] = useState<LineItem[]>([
    {
      id: 1,
      description: 'Surgical gloves (box)',
      item: 'Nitrile Gloves',
      godown: 'Main Store',
      quantity: 50,
      rate: 450,
      hsn: '4015',
    },
  ])
  const [ledgers, setLedgers] = useState<LedgerLine[]>([
    { id: 1, description: 'Discount @ 3%', ledger: 'DISCOUNT', costCenter: 'Procurement', amount: -675 },
  ])
  const [taxLines, setTaxLines] = useState<LedgerLine[]>([
    { id: 1, description: 'IGST', ledger: 'IGST @ 18%', costCenter: 'Procurement', amount: 4050 },
  ])

  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState<'idle' | 'saving' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [queueState, setQueueState] = useState<'idle' | 'queuing' | 'queued' | 'error'>('idle')
  // Line ids whose stock item is still blank. `ItemPayload.stock_item` is
  // required on the backend (a blank one 422s with an opaque error), so the
  // form blocks the save itself and says which line is at fault.
  const [missingStockItems, setMissingStockItems] = useState<Set<number>>(new Set())

  const ledgerLookup = useLedgerLookup(vendorName)
  const attachmentId = draft?.attachment_id ?? existingDraftQuery.data?.attachment_id ?? null
  const attachmentQuery = useAttachment(attachmentId ?? null)
  const confidence = attachmentQuery.data?.ocr_result?.confidence ?? {}

  // Prefill every field from a loaded draft the first (and only the first)
  // time it arrives, so a later refetch (e.g. after Save) doesn't clobber
  // edits the user has since made.
  useEffect(() => {
    const loaded = existingDraftQuery.data
    if (!loaded || prefilledRef.current === loaded.id) return
    prefilledRef.current = loaded.id
    setDraft(loaded)
    // `DraftOut.payload` is nullable — a draft created from an attachment
    // before OCR has nothing to prefill from, so fall back to an empty object
    // and leave the form's defaults in place.
    const payload = (loaded.payload ?? {}) as Partial<DraftPurchaseBill> & Record<string, unknown>
    /* eslint-disable react-hooks/set-state-in-effect -- intentional: prefills the form's editable state from a draft fetched via ?draft=<id>, once. */
    if (payload.voucher_date) setVoucherDate(String(payload.voucher_date))
    if (payload.bill_date) setBillDate(String(payload.bill_date))
    if (payload.due_date) setDueDate(String(payload.due_date))
    if (payload.supplier_invoice_no) setSupplierInvoiceNo(String(payload.supplier_invoice_no))
    if (payload.gst_registration) setGstRegistration(String(payload.gst_registration))
    if (payload.voucher_type) setVoucherType(String(payload.voucher_type))
    if (payload.cost_centre) setCostCentre(String(payload.cost_centre))
    if (payload.purchase_ledger) setPurchaseLedger(String(payload.purchase_ledger))
    if (typeof payload.reverse_charge === 'boolean') setReverseCharge(payload.reverse_charge)
    if (payload.narration) setNarration(String(payload.narration))
    const party = payload.party as DraftPurchaseBill['party'] | undefined
    if (party) {
      if (party.ledger_name) setVendorName(party.ledger_name)
      if (party.gst_treatment) setGstTreatment(party.gst_treatment)
      if (party.billing_address) setBillingAddress(party.billing_address)
      if (party.gstin) setGstin(party.gstin)
      if (party.source_of_supply) setSourceOfSupply(party.source_of_supply)
      if (party.destination_of_supply) setDestinationOfSupply(party.destination_of_supply)
    }
    const loadedItems = payload.items as DraftPurchaseBill['items'] | undefined
    if (loadedItems && loadedItems.length > 0) {
      setItems(
        loadedItems.map((it) => ({
          id: ++nextId,
          description: it.description ?? '',
          item: it.stock_item,
          godown: it.godown ?? '',
          // The middleware echoes these back as Decimal-serialized strings
          // (e.g. "50.00"); coerce so downstream arithmetic and the
          // <input type="number"> stay numeric.
          quantity: Number(it.quantity),
          rate: Number(it.rate),
          hsn: it.hsn ?? '',
        })),
      )
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [existingDraftQuery.data])

  const taxableValue = useMemo(
    () => items.reduce((s, i) => s + i.quantity * i.rate, 0),
    [items],
  )
  const ledgerTotal = useMemo(() => ledgers.reduce((s, l) => s + l.amount, 0), [ledgers])
  const taxTotal = useMemo(() => taxLines.reduce((s, t) => s + t.amount, 0), [taxLines])
  const subTotal = taxableValue + ledgerTotal
  const grandTotal = subTotal + taxTotal

  const addItem = () =>
    setItems((p) => [
      ...p,
      { id: ++nextId, description: '', item: '', godown: '', quantity: 1, rate: 0, hsn: '' },
    ])
  const addLedger = () =>
    setLedgers((p) => [
      ...p,
      { id: ++nextId, description: '', ledger: '', costCenter: '', amount: 0 },
    ])
  const addTax = () =>
    setTaxLines((p) => [
      ...p,
      { id: ++nextId, description: '', ledger: '', costCenter: '', amount: 0 },
    ])

  function buildPayload(): DraftPurchaseBill {
    return {
      gst_registration: gstRegistration,
      voucher_type: voucherType,
      voucher_date: voucherDate,
      bill_date: billDate,
      due_date: dueDate,
      supplier_invoice_no: supplierInvoiceNo,
      cost_centre: costCentre,
      party: {
        ledger_name: vendorName,
        gstin,
        gst_treatment: gstTreatment,
        billing_address: billingAddress,
        source_of_supply: sourceOfSupply,
        destination_of_supply: destinationOfSupply,
        // No `gst_registration_type` / `mailing_name` here: `PartyPayload`
        // has no such fields and the middleware derives both itself from
        // gst_treatment/gstin and the ledger name (services/sync_push.py).
        create_if_missing: createIfMissing,
      },
      purchase_ledger: purchaseLedger,
      items: items.map((i) => ({
        description: i.description || undefined,
        stock_item: i.item,
        godown: i.godown || undefined,
        quantity: i.quantity,
        rate: i.rate,
        hsn: i.hsn || undefined,
      })),
      ledger_lines: ledgers.map((l) => ({
        ledger_name: l.ledger,
        cost_centre: l.costCenter || undefined,
        amount: l.amount,
        description: l.description || undefined,
      })),
      tax_lines: taxLines.map((t) => ({
        ledger_name: t.ledger,
        cost_centre: t.costCenter || undefined,
        amount: t.amount,
        description: t.description || undefined,
      })),
      reverse_charge: reverseCharge,
      narration: narration || undefined,
      totals: {
        taxable_value: taxableValue,
        sub_total: subTotal,
        gst: taxTotal,
        tds: 0,
        other_taxes: 0,
        grand_total: grandTotal,
      },
    }
  }

  async function saveDraft() {
    setSaving('saving')
    setSaveError(null)
    setQueueState('idle')
    const blankStockItems = items.filter((i) => i.item.trim() === '')
    if (blankStockItems.length > 0) {
      setMissingStockItems(new Set(blankStockItems.map((i) => i.id)))
      setSaveError(STOCK_ITEM_REQUIRED)
      setSaving('error')
      return
    }
    setMissingStockItems(new Set())
    const payload = buildPayload()
    const parsed = draftPurchaseBillSchema.safeParse(payload)
    if (!parsed.success) {
      setSaveError(parsed.error.issues[0]?.message ?? 'This bill has invalid fields.')
      setSaving('error')
      return
    }
    try {
      const created = draftId
        ? await apiFetch(`drafts/${draftId}`, draftSchema, {
            method: 'PUT',
            body: JSON.stringify(parsed.data),
          })
        : await apiFetch('drafts', draftSchema, {
            method: 'POST',
            body: JSON.stringify(parsed.data),
          })
      setDraft(created)
      setSaving('idle')
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Could not save the draft.')
      setSaving('error')
    }
  }

  async function queueForSync() {
    if (!draft) return
    setQueueState('queuing')
    try {
      const queued = await apiFetch(`drafts/${draft.id}/queue`, draftSchema, { method: 'POST' })
      setDraft(queued)
      setQueueState('queued')
    } catch {
      setQueueState('error')
    }
  }

  // `DraftOut.errors` carries both blocking errors and advisory warnings.
  const blockingIssues = draft?.errors.filter((i) => i.severity === 'error') ?? []
  const warnings = draft?.errors.filter((i) => i.severity === 'warning') ?? []
  const canQueue = draft != null && blockingIssues.length === 0 && draft.status !== 'queued'

  const needsReview = draft?.needs_review || existingDraftQuery.data?.needs_review
  const reviewReasons = draft?.review_reasons?.length
    ? draft.review_reasons
    : (existingDraftQuery.data?.review_reasons ?? [])

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
      {needsReview ? (
        <div className="xl:col-span-3">
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-medium">Needs review</p>
              {reviewReasons.length > 0 ? (
                <p className="text-amber-700/90 dark:text-amber-400/90">{reviewReasons.join('; ')}</p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      <div className="flex flex-col gap-5 xl:col-span-2">
        {/* Details */}
        <Section
          title="Details"
          action={
            <Badge variant="default">
              <Sparkles className="size-3" /> OCR extracted
            </Badge>
          }
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="GST Registration (my branch)">
              <Select value={gstRegistration} onChange={(e) => setGstRegistration(e.target.value)}>
                <option value="27AABCN1234C1ZP">Maharashtra — 27AABCN1234C1ZP</option>
                <option value="29AABCN1234C1ZK">Karnataka — 29AABCN1234C1ZK</option>
              </Select>
            </Field>
            <Field label="Voucher Type">
              <Select value={voucherType} onChange={(e) => setVoucherType(e.target.value)}>
                <option value="Purchase">Purchase</option>
                <option value="Debit Note">Debit Note</option>
              </Select>
            </Field>
            <Field label="Voucher No (auto)">
              <Input defaultValue="Assigned by Tally on sync" disabled />
            </Field>
            <Field label="Voucher Date">
              <Input type="date" value={voucherDate} onChange={(e) => setVoucherDate(e.target.value)} />
            </Field>
            <Field label="Bill Date">
              <Input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
            </Field>
            <Field label="Due Date">
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
            <Field label="Supplier Invoice No">
              <Input value={supplierInvoiceNo} onChange={(e) => setSupplierInvoiceNo(e.target.value)} />
            </Field>
            <Field label="Cost Centre">
              <Select value={costCentre} onChange={(e) => setCostCentre(e.target.value)}>
                <option value="Procurement">Procurement</option>
                <option value="Administration">Administration</option>
              </Select>
            </Field>
          </div>
        </Section>

        {/* Vendor details */}
        <Section title="Vendor Details">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Name">
                <Input value={vendorName} onChange={(e) => setVendorName(e.target.value)} />
              </Field>
              <ConfidenceBadge field="supplier_name" confidence={confidence} />
              {ledgerLookup.data?.found ? (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-success">
                  <CircleCheck className="size-3.5" /> Matches Tally ledger
                </p>
              ) : null}
              {ledgerLookup.data && !ledgerLookup.data.found ? (
                <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
                  <p className="font-medium text-amber-700 dark:text-amber-400">
                    Tally has no ledger named &quot;{vendorName}&quot;
                  </p>
                  {ledgerLookup.data.suggestions.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {ledgerLookup.data.suggestions.map((s) => (
                        <button
                          key={s.name}
                          type="button"
                          onClick={() => setVendorName(s.name)}
                          className="rounded-full border border-border bg-background px-2.5 py-1 text-xs hover:bg-accent"
                        >
                          {s.name}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <label className="mt-2.5 flex items-center gap-2 text-foreground">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={createIfMissing}
                      onChange={(e) => setCreateIfMissing(e.target.checked)}
                    />
                    Create this vendor ledger in Tally with this bill
                  </label>
                  {createIfMissing ? (
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {/* No Mailing Name input: the middleware sets the new
                          ledger's mailing name to the ledger name itself and
                          derives its GST registration type from the GST
                          treatment above (services/sync_push.py). */}
                      <Field label="State">
                        <Input value={sourceOfSupply} onChange={(e) => setSourceOfSupply(e.target.value)} />
                      </Field>
                      <Field label="GSTIN" className="sm:col-span-2">
                        <Input value={gstin} onChange={(e) => setGstin(e.target.value)} />
                      </Field>
                      <Field label="Billing Address" className="sm:col-span-2">
                        <Textarea
                          rows={2}
                          value={billingAddress}
                          onChange={(e) => setBillingAddress(e.target.value)}
                        />
                      </Field>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            <Field label="GST Treatment">
              <Select
                value={gstTreatment}
                onChange={(e) => setGstTreatment(e.target.value as typeof gstTreatment)}
              >
                <option value="regular">Registered — Regular</option>
                <option value="composition">Registered — Composition</option>
                <option value="unregistered">Unregistered</option>
              </Select>
            </Field>
            <Field label="Billing Address" className="sm:col-span-2">
              <Textarea rows={2} value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)} />
            </Field>
            <Field label="GSTIN">
              <Input value={gstin} onChange={(e) => setGstin(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Source of Supply">
                <Select value={sourceOfSupply} onChange={(e) => setSourceOfSupply(e.target.value)}>
                  <option value="Maharashtra">Maharashtra</option>
                  <option value="Karnataka">Karnataka</option>
                </Select>
              </Field>
              <Field label="Destination of Supply">
                <Select
                  value={destinationOfSupply}
                  onChange={(e) => setDestinationOfSupply(e.target.value)}
                >
                  <option value="Maharashtra">Maharashtra</option>
                  <option value="Karnataka">Karnataka</option>
                </Select>
              </Field>
            </div>
          </div>
        </Section>

        {/* Item details */}
        <Section
          title="Item Details"
          action={
            <div className="w-56">
              <Label>Purchase Ledger</Label>
              <Select value={purchaseLedger} onChange={(e) => setPurchaseLedger(e.target.value)}>
                <option value="Purchase">Purchase</option>
                <option value="Purchase — Import">Purchase — Import</option>
              </Select>
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-2 py-2 font-medium">Description</th>
                  <th className="px-2 py-2 font-medium">Item (HSN/SAC)</th>
                  <th className="px-2 py-2 font-medium">Godown/Location</th>
                  <th className="px-2 py-2 text-right font-medium">Qty</th>
                  <th className="px-2 py-2 text-right font-medium">Rate</th>
                  <th className="px-2 py-2 text-right font-medium">Amount</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {items.map((it, index) => (
                  <tr key={it.id} className="border-b border-border/60 align-top">
                    <td className="px-2 py-2">
                      <Input
                        value={it.description}
                        onChange={(e) =>
                          setItems((p) =>
                            p.map((x) => (x.id === it.id ? { ...x, description: e.target.value } : x)),
                          )
                        }
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Select
                        value={it.item}
                        aria-invalid={missingStockItems.has(it.id) || undefined}
                        aria-label={`Item for line ${index + 1}`}
                        onChange={(e) => {
                          const value = e.target.value
                          if (value !== '') {
                            setMissingStockItems((prev) => {
                              if (!prev.has(it.id)) return prev
                              const next = new Set(prev)
                              next.delete(it.id)
                              return next
                            })
                          }
                          setItems((p) =>
                            p.map((x) =>
                              x.id === it.id
                                ? {
                                    ...x,
                                    item: value,
                                    hsn: value === 'Nitrile Gloves' ? '4015' : '9018',
                                  }
                                : x,
                            ),
                          )
                        }}
                      >
                        <option value="">Select item</option>
                        <option value="Nitrile Gloves">Nitrile Gloves — 4015</option>
                        <option value="Syringes">Syringes — 9018</option>
                      </Select>
                      {missingStockItems.has(it.id) ? (
                        <p role="alert" className="mt-1 text-xs text-destructive">
                          Stock item is required
                        </p>
                      ) : null}
                    </td>
                    <td className="px-2 py-2">
                      <Select
                        value={it.godown}
                        onChange={(e) =>
                          setItems((p) =>
                            p.map((x) => (x.id === it.id ? { ...x, godown: e.target.value } : x)),
                          )
                        }
                      >
                        <option value="">Select</option>
                        <option value="Main Store">Main Store</option>
                        <option value="Cold Storage">Cold Storage</option>
                      </Select>
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        type="number"
                        className="text-right"
                        value={it.quantity}
                        onChange={(e) =>
                          setItems((p) =>
                            p.map((x) =>
                              x.id === it.id ? { ...x, quantity: Number(e.target.value) } : x,
                            ),
                          )
                        }
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        type="number"
                        className="text-right"
                        value={it.rate}
                        onChange={(e) =>
                          setItems((p) =>
                            p.map((x) =>
                              x.id === it.id ? { ...x, rate: Number(e.target.value) } : x,
                            ),
                          )
                        }
                      />
                    </td>
                    <td className="px-2 py-2 pt-4 text-right tabular-nums">
                      {formatINR(it.quantity * it.rate)}
                    </td>
                    <td className="px-2 py-2 pt-3.5 text-right">
                      <button
                        onClick={() => setItems((p) => p.filter((x) => x.id !== it.id))}
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                        aria-label="Remove item"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={addItem} className="text-primary">
              <Plus className="size-4" /> Add line item
            </Button>
            <div className="flex items-center gap-6 pr-10 text-sm">
              <span className="text-muted-foreground">Taxable Value</span>
              <span className="font-semibold tabular-nums">{formatINR(taxableValue)}</span>
            </div>
          </div>
        </Section>

        {/* Ledgers */}
        <Section title="Ledgers">
          <LedgerTable
            rows={ledgers}
            setRows={setLedgers}
            ledgerLabel="Ledger (e.g. Discount)"
            total={ledgerTotal}
            totalLabel="Total"
            onAdd={addLedger}
          />
        </Section>

        {/* Taxes */}
        <Section title="Taxes">
          <div className="mb-4 w-64">
            <Label>Reverse Charges</Label>
            <Select
              value={reverseCharge ? 'yes' : 'no'}
              onChange={(e) => setReverseCharge(e.target.value === 'yes')}
            >
              <option value="no">Not Applicable</option>
              <option value="yes">Applicable</option>
            </Select>
          </div>
          <LedgerTable
            rows={taxLines}
            setRows={setTaxLines}
            ledgerLabel="Tax Ledger"
            total={taxTotal}
            totalLabel="Total Tax"
            onAdd={addTax}
          />
        </Section>

        {/* Narration */}
        <Section title="Narration (optional)">
          <Textarea
            rows={3}
            placeholder="Add a note for this voucher..."
            value={narration}
            onChange={(e) => setNarration(e.target.value)}
          />
        </Section>

        {draft && draft.errors.length > 0 ? (
          <Section title="Validation Issues">
            <div className="flex flex-col gap-2">
              {draft.errors.map((issue, i) => {
                // `details.suggestions` is a list of ledger *names*
                // (services/validation.py), not ledger objects.
                const suggestions = issue.details?.suggestions ?? []
                const isPartyIssue = issue.field.startsWith('party.')
                return (
                  <div key={i} className={cnIssue(issue.severity)}>
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    <div>
                      <p className="font-medium">{issue.code}</p>
                      <p className="text-muted-foreground">
                        {issue.field ? `${issue.field}: ` : ''}
                        {issue.message}
                      </p>
                      {suggestions.length > 0 ? (
                        <div className="mt-2">
                          <p className="text-xs text-muted-foreground">Did you mean:</p>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {suggestions.map((name) =>
                              isPartyIssue ? (
                                <button
                                  key={name}
                                  type="button"
                                  onClick={() => setVendorName(name)}
                                  className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-foreground hover:bg-accent"
                                >
                                  {name}
                                </button>
                              ) : (
                                <span
                                  key={name}
                                  className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-foreground"
                                >
                                  {name}
                                </span>
                              ),
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          </Section>
        ) : null}
      </div>

      {/* Calculation Summary */}
      <div className="xl:col-span-1">
        <Card className="sticky top-6 p-5">
          <h2 className="text-sm font-semibold">Calculation Summary</h2>
          <div className="mt-4 flex flex-col divide-y divide-border">
            <SummaryRow label="Sub Total" value={formatINR(subTotal)} />
            <SummaryRow label="GST" value={formatINR(taxTotal)} />
            <SummaryRow label="TDS" value={formatINR(0)} />
            <SummaryRow label="Other Taxes" value={formatINR(0)} />
            <div className="flex items-center justify-between py-3">
              <span className="text-sm font-semibold">Grand Total</span>
              <span className="text-lg font-bold tabular-nums">{formatINR(grandTotal)}</span>
            </div>
          </div>

          {saveError ? (
            <p className="mt-2 flex items-center gap-1.5 text-sm text-destructive">
              <AlertTriangle className="size-4 shrink-0" /> {saveError}
            </p>
          ) : null}

          {draft && blockingIssues.length === 0 && warnings.length === 0 ? (
            <p className="mt-2 flex items-center gap-1.5 text-sm text-success">
              <CheckCircle2 className="size-4 shrink-0" /> Draft validated with no issues.
            </p>
          ) : null}

          <div className="mt-4 flex flex-col gap-2">
            <Button className="w-full" size="lg" onClick={saveDraft} disabled={saving === 'saving'}>
              {saving === 'saving' ? <Loader2 className="size-4 animate-spin" /> : null}
              {draft ? 'Re-validate' : 'Save as Draft'}
            </Button>
            <Button
              variant="outline"
              className="w-full"
              size="lg"
              onClick={queueForSync}
              disabled={!canQueue || queueState === 'queuing'}
            >
              {queueState === 'queuing' ? <Loader2 className="size-4 animate-spin" /> : null}
              {queueState === 'queued' || draft?.status === 'queued'
                ? 'Queued for sync'
                : 'Queue for sync'}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}

function ConfidenceBadge({
  field,
  confidence,
}: {
  field: string
  confidence: Record<string, number>
}) {
  const score = confidence[field]
  if (score === undefined) return null
  const low = score < OCR_MIN_CONFIDENCE
  return (
    <span
      className={
        'mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ' +
        (low
          ? 'bg-amber-500/12 text-amber-700 dark:text-amber-400'
          : 'bg-muted text-muted-foreground')
      }
    >
      OCR confidence {Math.round(score * 100)}%
    </span>
  )
}

function cnIssue(severity: 'error' | 'warning') {
  return (
    'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ' +
    (severity === 'error'
      ? 'border-destructive/30 bg-destructive/5 text-destructive'
      : 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400')
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm tabular-nums">{value}</span>
    </div>
  )
}

function LedgerTable({
  rows,
  setRows,
  ledgerLabel,
  total,
  totalLabel,
  onAdd,
}: {
  rows: LedgerLine[]
  setRows: React.Dispatch<React.SetStateAction<LedgerLine[]>>
  ledgerLabel: string
  total: number
  totalLabel: string
  onAdd: () => void
}) {
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-2 py-2 font-medium">Description</th>
              <th className="px-2 py-2 font-medium">{ledgerLabel}</th>
              <th className="px-2 py-2 font-medium">Cost Centre</th>
              <th className="px-2 py-2 text-right font-medium">Amount</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border/60">
                <td className="px-2 py-2">
                  <Input
                    value={row.description}
                    onChange={(e) =>
                      setRows((p) =>
                        p.map((x) => (x.id === row.id ? { ...x, description: e.target.value } : x)),
                      )
                    }
                  />
                </td>
                <td className="px-2 py-2">
                  <Select
                    value={row.ledger}
                    onChange={(e) =>
                      setRows((p) =>
                        p.map((x) => (x.id === row.id ? { ...x, ledger: e.target.value } : x)),
                      )
                    }
                  >
                    <option value="">Select ledger</option>
                    <option value="DISCOUNT">Discount</option>
                    <option value="IGST @ 18%">IGST @ 18%</option>
                    <option value="CGST @ 9%">CGST @ 9%</option>
                    <option value="SGST @ 9%">SGST @ 9%</option>
                    <option value="Freight">Freight</option>
                  </Select>
                </td>
                <td className="px-2 py-2">
                  <Select
                    value={row.costCenter}
                    onChange={(e) =>
                      setRows((p) =>
                        p.map((x) => (x.id === row.id ? { ...x, costCenter: e.target.value } : x)),
                      )
                    }
                  >
                    <option value="">Select</option>
                    <option value="Procurement">Procurement</option>
                    <option value="Administration">Administration</option>
                  </Select>
                </td>
                <td className="px-2 py-2">
                  <Input
                    type="number"
                    className="text-right"
                    value={row.amount}
                    onChange={(e) =>
                      setRows((p) =>
                        p.map((x) => (x.id === row.id ? { ...x, amount: Number(e.target.value) } : x)),
                      )
                    }
                  />
                </td>
                <td className="px-2 py-2 text-right">
                  <button
                    onClick={() => setRows((p) => p.filter((x) => x.id !== row.id))}
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                    aria-label="Remove ledger"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onAdd} className="text-primary">
          <Plus className="size-4" /> Add Ledger
        </Button>
        <div className="flex items-center gap-6 pr-10 text-sm">
          <span className="text-muted-foreground">{totalLabel}</span>
          <span className="font-semibold tabular-nums">{formatINR(total)}</span>
        </div>
      </div>
    </>
  )
}
