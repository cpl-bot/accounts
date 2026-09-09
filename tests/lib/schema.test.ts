import { describe, expect, it } from 'vitest'
import {
  demoBills,
  demoDashboardOverview,
  demoDashboardPayables,
  demoDrafts,
  demoSettings,
  demoTallyStatus,
} from '@/lib/api/demo-fixtures'
import {
  billsResponseSchema,
  dashboardOverviewSchema,
  dashboardPayablesSchema,
  draftPurchaseBillSchema,
  draftSchema,
  settingsSchema,
  tallyStatusSchema,
} from '@/lib/api/schema'

describe('schema contract', () => {
  it('accepts the demo fixtures for every endpoint', () => {
    expect(tallyStatusSchema.safeParse(demoTallyStatus()).success).toBe(true)
    expect(settingsSchema.safeParse(demoSettings()).success).toBe(true)
    expect(dashboardOverviewSchema.safeParse(demoDashboardOverview()).success).toBe(true)
    expect(dashboardPayablesSchema.safeParse(demoDashboardPayables()).success).toBe(true)
    expect(billsResponseSchema.safeParse(demoBills()).success).toBe(true)
    for (const draft of demoDrafts().items) {
      expect(draftSchema.safeParse(draft).success).toBe(true)
    }
  })

  it('accepts the DraftPurchaseBill example from the engineering plan (§3.6)', () => {
    const example = {
      gst_registration: '27AABCN1234C1ZP',
      voucher_type: 'Purchase',
      voucher_date: '2026-06-10',
      bill_date: '2026-05-10',
      due_date: '2026-06-09',
      supplier_invoice_no: 'INV/BSM/4471',
      cost_centre: 'Procurement',
      party: {
        ledger_name: 'BioShield Medical',
        gstin: '27AAAAA0000A1Z5',
        gst_treatment: 'regular',
        billing_address: '…',
        source_of_supply: 'Maharashtra',
        destination_of_supply: 'Maharashtra',
      },
      purchase_ledger: 'Purchase',
      items: [
        {
          description: 'Surgical gloves (box)',
          stock_item: 'Nitrile Gloves',
          godown: 'Main Store',
          quantity: 50,
          rate: 450,
          hsn: '4015',
        },
      ],
      ledger_lines: [
        { ledger_name: 'DISCOUNT', cost_centre: 'Procurement', amount: -675, description: 'Discount @ 3%' },
      ],
      tax_lines: [{ ledger_name: 'IGST @ 18%', cost_centre: 'Procurement', amount: 4050 }],
      reverse_charge: false,
      narration: '…',
      totals: {
        taxable_value: 22500,
        sub_total: 21825,
        gst: 4050,
        tds: 0,
        other_taxes: 0,
        grand_total: 25875,
      },
    }

    const result = draftPurchaseBillSchema.safeParse(example)
    expect(result.success).toBe(true)
  })

  it('rejects a DraftPurchaseBill with no line items', () => {
    const result = draftPurchaseBillSchema.safeParse({
      gst_registration: '27AABCN1234C1ZP',
      voucher_type: 'Purchase',
      voucher_date: '2026-06-10',
      bill_date: '2026-05-10',
      due_date: '2026-06-09',
      supplier_invoice_no: 'INV/BSM/4471',
      party: {
        ledger_name: 'BioShield Medical',
        gst_treatment: 'regular',
        source_of_supply: 'Maharashtra',
        destination_of_supply: 'Maharashtra',
      },
      purchase_ledger: 'Purchase',
      items: [],
      totals: { taxable_value: 0, sub_total: 0, gst: 0, tds: 0, other_taxes: 0, grand_total: 0 },
    })
    expect(result.success).toBe(false)
  })
})
