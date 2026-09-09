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
  source: z.enum(['tally', 'talai']).optional(),
})
export type Ledger = z.infer<typeof ledgerSchema>

// --- Vendor ledger lookup / creation (§3.8) ---------------------------------

export const ledgerLookupResultSchema = z.object({
  found: z.boolean(),
  ledger: ledgerSchema.nullable().optional(),
  suggestions: z.array(ledgerSchema.extend({ ratio: z.number().optional() })).default([]),
  best_ratio: z.number().nullable().optional(),
})
export type LedgerLookupResult = z.infer<typeof ledgerLookupResultSchema>

export const vendorLedgerCreateSchema = z.object({
  name: z.string().min(1),
  gst_registration_type: z.enum(['regular', 'composition', 'unregistered']),
  gstin: z.string().nullable().optional(),
  state: z.string().min(1),
  billing_address: z.string().min(1),
  mailing_name: z.string().optional(),
})
export type VendorLedgerCreate = z.infer<typeof vendorLedgerCreateSchema>

export const vendorLedgerCreateResultSchema = z.object({
  dry_run: z.boolean().optional(),
  generated_xml: z.string().optional(),
  ledger: ledgerSchema.optional(),
})
export type VendorLedgerCreateResult = z.infer<typeof vendorLedgerCreateResultSchema>

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

// --- Configurable gross-profit formula (§3.9) -------------------------------

export const dashboardFormulaSchema = z.object({
  gross_profit_mode: z.enum(['simple', 'trading']),
  stock_source: z.enum(['tally', 'manual']),
  manual_opening_stock: z.string().nullable().optional(),
  manual_closing_stock: z.string().nullable().optional(),
  revenue_groups: z.array(z.string()).default([]),
  cost_of_sales_groups: z.array(z.string()).default([]),
})
export type DashboardFormula = z.infer<typeof dashboardFormulaSchema>

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
  formula: dashboardFormulaSchema.optional(),
  opening_stock: z.number().nullable().optional(),
  closing_stock: z.number().nullable().optional(),
  stock_adjustment_status: z.enum(['applied', 'manual', 'unavailable']).optional(),
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

export const validationIssueDetailsSchema = z.object({
  can_create: z.boolean().optional(),
  suggestions: z.array(ledgerSchema.extend({ ratio: z.number().optional() })).optional(),
})

export const validationIssueSchema = z.object({
  code: z.string(),
  field: z.string().nullable(),
  message: z.string(),
  severity: z.enum(['error', 'warning']),
  details: validationIssueDetailsSchema.nullable().optional(),
})
export type ValidationIssue = z.infer<typeof validationIssueSchema>

export const draftSchema = z.object({
  id: z.string(),
  status: z.enum(['draft', 'validated', 'queued', 'synced', 'failed']),
  payload: z.record(z.string(), z.unknown()),
  validation_issues: z.array(validationIssueSchema),
  created_at: z.string(),
  updated_at: z.string(),
  needs_review: z.boolean().optional(),
  review_reasons: z.array(z.string()).default([]),
  attachment_id: z.string().nullable().optional(),
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

export const ocrLineItemSchema = z.object({
  description: z.string(),
  hsn: z.string().nullable().optional(),
  quantity: z.number().nullable().optional(),
  rate: z.number().nullable().optional(),
  amount: z.number().nullable().optional(),
})

export const ocrFieldsSchema = z.object({
  supplier_name: z.string().nullable().optional(),
  supplier_gstin: z.string().nullable().optional(),
  invoice_number: z.string().nullable().optional(),
  invoice_date: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  place_of_supply: z.string().nullable().optional(),
  line_items: z.array(ocrLineItemSchema).default([]),
  taxable_value: z.number().nullable().optional(),
  cgst: z.number().nullable().optional(),
  sgst: z.number().nullable().optional(),
  igst: z.number().nullable().optional(),
  tds: z.number().nullable().optional(),
  other_charges: z.number().nullable().optional(),
  grand_total: z.number().nullable().optional(),
  narration: z.string().nullable().optional(),
})

export const ocrResultSchema = z.object({
  fields: ocrFieldsSchema,
  confidence: z.record(z.string(), z.number()),
  raw_text: z.string().optional(),
})
export type OcrResult = z.infer<typeof ocrResultSchema>

export const OCR_MIN_CONFIDENCE = 0.7

export const attachmentSchema = z.object({
  id: z.string(),
  file_name: z.string(),
  content_type: z.string(),
  size_bytes: z.number(),
  uploaded_at: z.string(),
  ocr_status: z.enum(['pending', 'running', 'done', 'failed', 'skipped']).default('pending'),
  ocr_result: ocrResultSchema.nullable().optional(),
  ocr_model: z.string().nullable().optional(),
  ocr_duration_ms: z.number().nullable().optional(),
  ocr_error: z.string().nullable().optional(),
  // Legacy summary shape kept for the demo mock/pre-OCR fixtures.
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

export const attachmentsListSchema = z.object({
  items: z.array(attachmentSchema),
  total: z.number().optional(),
})

// --- DraftPurchaseBill request payload (mirrors §3.6 example) --------------

export const draftPartySchema = z.object({
  ledger_name: z.string().min(1),
  gstin: z.string().nullable().optional(),
  gst_treatment: z.enum(['regular', 'composition', 'unregistered']),
  billing_address: z.string().optional(),
  source_of_supply: z.string(),
  destination_of_supply: z.string(),
  create_if_missing: z.boolean().default(false),
  gst_registration_type: z.enum(['regular', 'composition', 'unregistered']).optional(),
  mailing_name: z.string().optional(),
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
