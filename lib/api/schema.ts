// Zod schemas mirroring the middleware's `/api/v1` contract
// (docs/ENGINEERING_PLAN.md §3.6). Every response the frontend consumes is
// parsed through one of these schemas so a contract drift fails loudly in
// the browser console and in tests, instead of silently rendering garbage.

import { z } from 'zod'

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
})
export type ApiErrorBody = z.infer<typeof apiErrorSchema>

export const tallyStatusSchema = z.object({
  connected: z.boolean(),
  host: z.string(),
  port: z.number(),
  company: z.string().nullable(),
  latency_ms: z.number().nullable(),
  write_enabled: z.boolean(),
  checked_at: z.string(),
  error: z.string().nullable().optional(),
})
export type TallyStatus = z.infer<typeof tallyStatusSchema>

export const tallyCompanySchema = z.object({
  name: z.string(),
  guid: z.string().nullable().optional(),
  start_from: z.string().nullable().optional(),
  books_from: z.string().nullable().optional(),
})
export type TallyCompany = z.infer<typeof tallyCompanySchema>

export const tallyCompaniesSchema = z.object({
  companies: z.array(tallyCompanySchema),
})

export const settingsSchema = z.object({
  tally_host: z.string(),
  tally_port: z.number(),
  tally_company_name: z.string().nullable(),
  sync_interval_minutes: z.number(),
  write_enabled: z.boolean(),
})
export type Settings = z.infer<typeof settingsSchema>

export const ledgerSchema = z.object({
  name: z.string(),
  parent: z.string(),
  opening_balance: z.number().optional(),
  gstin: z.string().nullable().optional(),
})
export type Ledger = z.infer<typeof ledgerSchema>

export const groupSchema = z.object({
  name: z.string(),
  parent: z.string().nullable(),
})
export type Group = z.infer<typeof groupSchema>

export const stockItemSchema = z.object({
  name: z.string(),
  unit: z.string().optional(),
  hsn: z.string().nullable().optional(),
})
export type StockItem = z.infer<typeof stockItemSchema>

export const costCentreSchema = z.object({
  name: z.string(),
  category: z.string().nullable().optional(),
})
export type CostCentre = z.infer<typeof costCentreSchema>

export const godownSchema = z.object({
  name: z.string(),
})
export type Godown = z.infer<typeof godownSchema>

export const voucherTypeSchema = z.object({
  name: z.string(),
  parent: z.string().nullable().optional(),
})
export type VoucherType = z.infer<typeof voucherTypeSchema>

function listSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({ items: z.array(item), total: z.number() })
}

export const listLedgersSchema = listSchema(ledgerSchema)
export const listGroupsSchema = z.object({ items: z.array(groupSchema) })
export const listStockItemsSchema = z.object({ items: z.array(stockItemSchema) })
export const listCostCentresSchema = z.object({ items: z.array(costCentreSchema) })
export const listGodownsSchema = z.object({ items: z.array(godownSchema) })
export const listVoucherTypesSchema = z.object({ items: z.array(voucherTypeSchema) })

export const voucherSummarySchema = z.object({
  id: z.string(),
  voucher_type: z.string(),
  voucher_number: z.string().nullable(),
  date: z.string(),
  party: z.string().nullable(),
  amount: z.number(),
  narration: z.string().nullable().optional(),
})
export type VoucherSummary = z.infer<typeof voucherSummarySchema>

export const voucherLineSchema = z.object({
  ledger_name: z.string(),
  amount: z.number(),
  is_debit: z.boolean(),
  cost_centre: z.string().nullable().optional(),
})

export const voucherSchema = voucherSummarySchema.extend({
  lines: z.array(voucherLineSchema),
})
export type Voucher = z.infer<typeof voucherSchema>

export const agingBucketSchema = z.object({
  bucket: z.string(),
  bills: z.number(),
  amount: z.number(),
  pct: z.number(),
})
export type AgingBucket = z.infer<typeof agingBucketSchema>

export const billSchema = z.object({
  id: z.string(),
  party: z.string(),
  bill_reference: z.string().nullable(),
  bill_date: z.string(),
  due_date: z.string().nullable(),
  amount: z.number(),
  pending_amount: z.number(),
  age_days: z.number(),
})
export type Bill = z.infer<typeof billSchema>

export const billsResponseSchema = z.object({
  buckets: z.array(agingBucketSchema),
  items: z.array(billSchema),
  total_pending: z.number(),
})
export type BillsResponse = z.infer<typeof billsResponseSchema>

export const dashboardOverviewSchema = z.object({
  gross_profit: z.object({ value: z.number(), change_pct: z.number() }),
  cash_bank: z.object({
    value: z.number(),
    change_pct: z.number(),
    as_on: z.string(),
    today: z.number(),
    yesterday: z.number(),
    accounts: z.array(z.object({ name: z.string(), value: z.number() })),
  }),
  pnl: z.object({
    revenue: z.number(),
    cost_of_sales: z.number(),
    gross_profit: z.number(),
    gross_margin: z.number(),
    indirect_income: z.number(),
    indirect_expense: z.number(),
    net_profit: z.number(),
  }),
  income_vs_expense: z.object({ value: z.number(), change_pct: z.number() }),
  trends: z.object({
    gross_profit: z.array(z.object({ month: z.string(), value: z.number() })),
    income_vs_expense: z.array(
      z.object({ month: z.string(), income: z.number(), expense: z.number() }),
    ),
    cash_flow: z.array(z.object({ month: z.string(), inflow: z.number(), outflow: z.number() })),
  }),
})
export type DashboardOverview = z.infer<typeof dashboardOverviewSchema>

const outstandingSchema = z.object({
  outstanding: z.number(),
  on_account: z.number(),
  change_pct: z.number(),
  total_amount: z.number(),
  buckets: z.array(agingBucketSchema),
  open_bills: z.array(
    z.object({
      vendor: z.string(),
      bill_no: z.string(),
      amount: z.number(),
      due: z.string(),
    }),
  ),
})

export const dashboardPayablesSchema = z.object({
  as_on: z.string(),
  payables: outstandingSchema.extend({ days_payable_outstanding: z.number() }),
  receivables: outstandingSchema.extend({ days_sales_outstanding: z.number() }),
})
export type DashboardPayables = z.infer<typeof dashboardPayablesSchema>

export const validationIssueSchema = z.object({
  code: z.string(),
  field: z.string().nullable(),
  message: z.string(),
  severity: z.enum(['error', 'warning']),
})
export type ValidationIssue = z.infer<typeof validationIssueSchema>

export const draftSchema = z.object({
  id: z.string(),
  status: z.enum(['draft', 'validated', 'queued', 'synced', 'failed']),
  payload: z.record(z.string(), z.unknown()),
  validation_issues: z.array(validationIssueSchema),
  created_at: z.string(),
  updated_at: z.string(),
})
export type Draft = z.infer<typeof draftSchema>

export const syncRunSchema = z.object({
  id: z.string(),
  kind: z.enum(['pull', 'push']),
  status: z.enum(['pending', 'running', 'succeeded', 'failed', 'partial']),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  dry_run: z.boolean(),
  summary: z.string().nullable().optional(),
})
export type SyncRun = z.infer<typeof syncRunSchema>

export const pushResultItemSchema = z.object({
  draft_id: z.string(),
  status: z.enum(['committed', 'failed']),
  voucher_number: z.string().nullable().optional(),
  errors: z.array(z.string()).optional(),
})
export type PushResultItem = z.infer<typeof pushResultItemSchema>

export const pushResultSchema = z.object({
  run: syncRunSchema,
  results: z.array(pushResultItemSchema),
})
export type PushResult = z.infer<typeof pushResultSchema>

export const attachmentSchema = z.object({
  id: z.string(),
  file_name: z.string(),
  content_type: z.string(),
  size_bytes: z.number(),
  uploaded_at: z.string(),
  ocr: z
    .object({
      vendor_guess: z.string().nullable(),
      total_guess: z.number().nullable(),
      confidence: z.number(),
    })
    .nullable()
    .optional(),
})
export type Attachment = z.infer<typeof attachmentSchema>

// --- DraftPurchaseBill request payload (mirrors §3.6 example) --------------

export const draftPartySchema = z.object({
  ledger_name: z.string().min(1),
  gstin: z.string().nullable().optional(),
  gst_treatment: z.enum(['regular', 'composition', 'unregistered']),
  billing_address: z.string().optional(),
  source_of_supply: z.string(),
  destination_of_supply: z.string(),
})

export const draftItemSchema = z.object({
  description: z.string().min(1),
  stock_item: z.string().optional(),
  godown: z.string().optional(),
  quantity: z.number().positive(),
  rate: z.number(),
  hsn: z.string().optional(),
})

export const draftLedgerLineSchema = z.object({
  ledger_name: z.string().min(1),
  cost_centre: z.string().optional(),
  amount: z.number(),
  description: z.string().optional(),
})

export const draftTotalsSchema = z.object({
  taxable_value: z.number(),
  sub_total: z.number(),
  gst: z.number(),
  tds: z.number(),
  other_taxes: z.number(),
  grand_total: z.number(),
})

export const draftPurchaseBillSchema = z.object({
  gst_registration: z.string().min(1),
  voucher_type: z.string().min(1),
  voucher_date: z.string(),
  bill_date: z.string(),
  due_date: z.string(),
  supplier_invoice_no: z.string().min(1),
  cost_centre: z.string().optional(),
  party: draftPartySchema,
  purchase_ledger: z.string().min(1),
  items: z.array(draftItemSchema).min(1),
  ledger_lines: z.array(draftLedgerLineSchema).default([]),
  tax_lines: z.array(draftLedgerLineSchema).default([]),
  reverse_charge: z.boolean().default(false),
  narration: z.string().optional(),
  totals: draftTotalsSchema,
})
export type DraftPurchaseBill = z.infer<typeof draftPurchaseBillSchema>
