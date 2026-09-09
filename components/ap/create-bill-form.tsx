'use client'

import { useMemo, useState } from 'react'
import { Plus, Trash2, Sparkles } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Field, Input, Select, Textarea, Label } from '@/components/ui/field'
import { formatINR } from '@/lib/format'

type LineItem = {
  id: number
  description: string
  item: string
  godown: string
  quantity: number
  rate: number
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

export function CreateBillForm() {
  const [items, setItems] = useState<LineItem[]>([
    { id: 1, description: 'Surgical gloves (box)', item: 'Nitrile Gloves', godown: 'Main Store', quantity: 50, rate: 450 },
  ])
  const [ledgers, setLedgers] = useState<LedgerLine[]>([
    { id: 1, description: 'Discount @ 3%', ledger: 'DISCOUNT', costCenter: 'Procurement', amount: -675 },
  ])
  const [taxLines, setTaxLines] = useState<LedgerLine[]>([
    { id: 1, description: 'IGST', ledger: 'IGST @ 18%', costCenter: 'Procurement', amount: 4050 },
  ])

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
      { id: ++nextId, description: '', item: '', godown: '', quantity: 1, rate: 0 },
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

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
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
              <Select defaultValue="mh">
                <option value="mh">Maharashtra — 27AABCN1234C1ZP</option>
                <option value="ka">Karnataka — 29AABCN1234C1ZK</option>
              </Select>
            </Field>
            <Field label="Voucher Type">
              <Select defaultValue="purchase">
                <option value="purchase">Purchase</option>
                <option value="debit-note">Debit Note</option>
              </Select>
            </Field>
            <Field label="Voucher No (auto)">
              <Input defaultValue="PB-2026-0041" disabled />
            </Field>
            <Field label="Voucher Date">
              <Input type="date" defaultValue="2026-06-10" />
            </Field>
            <Field label="Bill Date">
              <Input type="date" defaultValue="2026-05-10" />
            </Field>
            <Field label="Due Date">
              <Input type="date" defaultValue="2026-06-09" />
            </Field>
            <Field label="Supplier Invoice No">
              <Input defaultValue="INV/BSM/4471" />
            </Field>
            <Field label="Cost Centre">
              <Select defaultValue="proc">
                <option value="proc">Procurement</option>
                <option value="admin">Administration</option>
              </Select>
            </Field>
          </div>
        </Section>

        {/* Vendor details */}
        <Section title="Vendor Details">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name">
              <Input defaultValue="BioShield Medical" />
            </Field>
            <Field label="GST Treatment">
              <Select defaultValue="regular">
                <option value="regular">Registered — Regular</option>
                <option value="composition">Registered — Composition</option>
                <option value="unregistered">Unregistered</option>
              </Select>
            </Field>
            <Field label="Billing Address" className="sm:col-span-2">
              <Textarea rows={2} defaultValue="14 Industrial Estate, Andheri East, Mumbai 400093" />
            </Field>
            <Field label="GSTIN">
              <Input defaultValue="27AAECB1234D1Z5" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Source of Supply">
                <Select defaultValue="mh">
                  <option value="mh">Maharashtra</option>
                  <option value="ka">Karnataka</option>
                </Select>
              </Field>
              <Field label="Destination of Supply">
                <Select defaultValue="mh">
                  <option value="mh">Maharashtra</option>
                  <option value="ka">Karnataka</option>
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
              <Select defaultValue="purchase">
                <option value="purchase">Purchase</option>
                <option value="purchase-import">Purchase — Import</option>
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
                {items.map((it) => (
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
                        onChange={(e) =>
                          setItems((p) =>
                            p.map((x) => (x.id === it.id ? { ...x, item: e.target.value } : x)),
                          )
                        }
                      >
                        <option value="">Select item</option>
                        <option value="Nitrile Gloves">Nitrile Gloves — 4015</option>
                        <option value="Syringes">Syringes — 9018</option>
                      </Select>
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
            <Select defaultValue="no">
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
          <Textarea rows={3} placeholder="Add a note for this voucher..." />
        </Section>
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
          <div className="mt-4 flex flex-col gap-2">
            <Button className="w-full" size="lg">
              Save &amp; Approve
            </Button>
            <Button variant="outline" className="w-full" size="lg">
              Save as Draft
            </Button>
          </div>
        </Card>
      </div>
    </div>
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
