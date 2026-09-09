// Zod schemas mirroring the middleware's `/api/v1` contract
// (docs/ENGINEERING_PLAN.md §3.6). Every response the frontend consumes is
// parsed through one of these schemas so a contract drift fails loudly in
// the browser console and in tests, instead of silently rendering garbage.

import { z } from 'zod'

// The middleware serializes every Python `Decimal` field as a JSON string
// (e.g. `"86000.00"`) to preserve precision — plain `z.number()` rejects
// that. `money` accepts either a number or a numeric string and always
// yields a JS number, so every Decimal-backed field below uses it instead
// of `z.number()`.
export const money = z
  .union([z.string(), z.number()])
  .transform((v) => Number(v))
  .refine((n) => Number.isFinite(n), { message: 'Expected a numeric amount' })

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
})
export type ApiErrorBody = z.infer<typeof apiErrorSchema>

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

// Mirrors `TallyStatus` in talai_middleware/api/schemas.py. The host/port are
// not part of the status payload — they live on `GET /settings`.
export const tallyStatusSchema = z.object({
  reachable: z.boolean(),
  companies: z.array(tallyCompanySchema).default([]),
  active_company: z.string().nullable().optional(),
  expected_company: z.string().nullable().optional(),
  company_match: z.boolean().default(false),
  latency_ms: z.number().default(0),
  checked_at: z.string(),
  write_enabled: z.boolean().default(false),
  breaker_open: z.boolean().default(false),
  error: z.string().nullable().optional(),
})
export type TallyStatus = z.infer<typeof tallyStatusSchema>

// Mirrors `SettingsPayload`. `tally_write_enabled` is read-only over HTTP
// (it comes from the TALLY_WRITE_ENABLED env var, plan §6).
export const settingsSchema = z.object({
  tally_host: z.string(),
  tally_port: z.number(),
  tally_company_name: z.string(),
  sync_interval_minutes: z.number(),
  tally_write_enabled: z.boolean().default(false),
})
export type Settings = z.infer<typeof settingsSchema>

export const ledgerSchema = z.object({
  id: z.number().optional(),
  name: z.string(),
  parent_group: z.string(),
  opening_balance: money.nullable().optional(),
  closing_balance: money.nullable().optional(),
  gstin: z.string().nullable().optional(),
  mailing_name: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  gst_registration_type: z.string().nullable().optional(),
  is_bill_wise: z.boolean().optional(),
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

// Tally's GSTREGISTRATIONTYPE values are capitalised; the middleware writes
// whatever it receives verbatim into the Import Ledger envelope.
export const gstRegistrationTypeSchema = z.enum(['Regular', 'Composition', 'Unregistered'])
export type GstRegistrationType = z.infer<typeof gstRegistrationTypeSchema>

// Request body for `POST /ledgers` — mirrors `VendorLedgerCreate`. The
// backend takes the address as a list of lines (`address`), not a single
// `billing_address` string; unknown keys are silently dropped by pydantic,
// so the names here must match exactly.
export const vendorLedgerCreateSchema = z.object({
  name: z.string().min(1),
  parent: z.string().optional(),
  gst_registration_type: gstRegistrationTypeSchema,
  gstin: z.string().nullable().optional(),
  state: z.string().min(1),
  address: z.array(z.string()).min(1),
  mailing_name: z.string().optional(),
  is_bill_wise: z.boolean().optional(),
  allow_duplicate: z.boolean().optional(),
})
export type VendorLedgerCreate = z.infer<typeof vendorLedgerCreateSchema>

export const vendorLedgerCreateResultSchema = z.object({
  dry_run: z.boolean().optional(),
  generated_xml: z.string().nullable().optional(),
  ledger: ledgerSchema.nullable().optional(),
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

// Mirrors `VoucherSummary` / `VoucherDetail`. Not consumed by any page yet
// (Journal Voucher is a stub) but kept in step with the backend so wiring it
// up later doesn't start from a stale shape.
export const voucherSummarySchema = z.object({
  id: z.number(),
  voucher_number: z.string(),
  voucher_type: z.string(),
  date: z.string().nullable(),
  party_ledger: z.string(),
  amount: money,
  reference: z.string(),
  narration: z.string(),
  is_cancelled: z.boolean(),
})
export type VoucherSummary = z.infer<typeof voucherSummarySchema>

export const voucherLedgerEntrySchema = z.object({
  ledger_name: z.string(),
  amount: money,
  is_deemed_positive: z.boolean(),
  cost_centre: z.string().nullable().optional(),
})

export const voucherInventoryEntrySchema = z.object({
  stock_item: z.string(),
  godown: z.string().nullable().optional(),
  qty: money.nullable().optional(),
  rate: money.nullable().optional(),
  amount: money.nullable().optional(),
  hsn: z.string().nullable().optional(),
})

export const voucherSchema = voucherSummarySchema.extend({
  ledger_entries: z.array(voucherLedgerEntrySchema).default([]),
  inventory_entries: z.array(voucherInventoryEntrySchema).default([]),
})
export type Voucher = z.infer<typeof voucherSchema>

export const agingBucketSchema = z.object({
  label: z.string(),
  amount: money,
  count: z.number(),
})
export type AgingBucket = z.infer<typeof agingBucketSchema>

export const billSchema = z.object({
  id: z.number(),
  party_ledger: z.string(),
  bill_name: z.string(),
  bill_date: z.string().nullable(),
  due_date: z.string().nullable(),
  opening_amount: money,
  pending_amount: money,
  direction: z.enum(['payable', 'receivable']),
})
export type Bill = z.infer<typeof billSchema>

export const billsResponseSchema = z.object({
  items: z.array(billSchema),
  buckets: z.array(agingBucketSchema),
  total_pending: money,
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
  // `DashboardFormulaOut` adds advisory complaints about the stored formula
  // (e.g. a group name the replica doesn't know). Optional because the same
  // schema is also used for the PUT request body.
  warnings: z.array(z.string()).optional(),
})
export type DashboardFormula = z.infer<typeof dashboardFormulaSchema>

// Mirrors the middleware's flat `DashboardOverview` response exactly
// (talai_middleware/api/schemas.py `DashboardOverview`) — this has no
// "vs previous period" figures; the backend does not compute them.
export const monthlyPointSchema = z.object({
  month: z.string(),
  revenue: money,
  cost_of_sales: money,
  gross_profit: money,
})

export const dashboardOverviewSchema = z.object({
  period_from: z.string(),
  period_to: z.string(),
  revenue: money,
  cost_of_sales: money,
  gross_profit: money,
  gross_margin_pct: money,
  indirect_income: money,
  indirect_expense: money,
  net_profit: money,
  cash_and_bank: money,
  trends: z.array(monthlyPointSchema).default([]),
  formula: dashboardFormulaSchema.optional(),
  opening_stock: money.nullable().optional(),
  closing_stock: money.nullable().optional(),
  stock_adjustment_status: z.enum(['applied', 'manual', 'unavailable']).optional(),
})
export type DashboardOverview = z.infer<typeof dashboardOverviewSchema>

// Mirrors the middleware's flat `DashboardPayables` exactly. It carries
// totals, aging buckets and DPO/DSO only — the per-bill "open bills" list
// for the aging drill-down panel comes from `GET /bills?direction=` instead
// (see `useBills`), not from this endpoint.
export const dashboardPayablesSchema = z.object({
  as_on: z.string(),
  total_payable: money,
  total_receivable: money,
  payable_buckets: z.array(agingBucketSchema),
  receivable_buckets: z.array(agingBucketSchema),
  dpo_days: money,
  dso_days: money,
})
export type DashboardPayables = z.infer<typeof dashboardPayablesSchema>

// `ValidationIssue.details` is a free-form dict on the backend; the keys the
// UI cares about come from the LEDGER_NOT_FOUND / LEDGER_POSSIBLE_DUPLICATE
// rules (services/validation.py), where `suggestions` is a list of ledger
// *names*, not ledger objects.
export const validationIssueDetailsSchema = z
  .object({
    can_create: z.boolean().optional(),
    suggestions: z.array(z.string()).optional(),
    best_ratio: z.number().nullable().optional(),
  })
  .passthrough()

export const validationIssueSchema = z.object({
  code: z.string(),
  field: z.string(),
  message: z.string(),
  severity: z.enum(['error', 'warning']).default('error'),
  details: validationIssueDetailsSchema.nullable().optional(),
})
export type ValidationIssue = z.infer<typeof validationIssueSchema>

// Every state a draft can be in on the backend (`DraftStatus`). `committing`
// and `committed` are set during/after a push to Tally; there is no `synced`.
export const draftStatusSchema = z.enum([
  'draft',
  'validated',
  'queued',
  'committing',
  'committed',
  'failed',
  'cancelled',
])
export type DraftStatus = z.infer<typeof draftStatusSchema>

// Mirrors `DraftOut`. The issues array is called `errors` on the wire.
export const draftSchema = z.object({
  id: z.string(),
  status: draftStatusSchema,
  payload: z.record(z.string(), z.unknown()).nullable(),
  errors: z.array(validationIssueSchema).default([]),
  generated_xml: z.string().nullable().optional(),
  generated_ledger_xml: z.string().nullable().optional(),
  dry_run: z.boolean().default(false),
  tally_voucher_number: z.string().nullable().optional(),
  tally_guid: z.string().nullable().optional(),
  attempts: z.number().default(0),
  needs_review: z.boolean().default(false),
  review_reasons: z.array(z.string()).default([]),
  attachment_id: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type Draft = z.infer<typeof draftSchema>

// Mirrors `SyncRunOut`. A run has no dry-run flag of its own — that lives on
// each `PushResultItem` — and a failed run's reason is in `error`.
export const syncRunSchema = z.object({
  id: z.number(),
  kind: z.enum(['pull', 'push']),
  scope: z.string(),
  status: z.enum(['running', 'success', 'failed']),
  started_at: z.string(),
  finished_at: z.string().nullable().optional(),
  records_seen: z.number(),
  records_changed: z.number(),
  error: z.string().nullable().optional(),
})
export type SyncRun = z.infer<typeof syncRunSchema>

// Mirrors `PushResultItem`. With TALLY_WRITE_ENABLED off (the default) every
// item comes back `status: "validated", dry_run: true`.
export const pushResultItemSchema = z.object({
  draft_id: z.string(),
  status: draftStatusSchema,
  voucher_number: z.string().nullable().optional(),
  dry_run: z.boolean().default(false),
  errors: z.array(validationIssueSchema).default([]),
})
export type PushResultItem = z.infer<typeof pushResultItemSchema>

export const pushResultSchema = z.object({
  run: syncRunSchema,
  results: z.array(pushResultItemSchema),
})
export type PushResult = z.infer<typeof pushResultSchema>

// OCR figures are deliberately `float` on the backend (ocr/schema.py), so
// plain z.number() is correct here — no Decimal-string coercion needed.
export const ocrLineItemSchema = z.object({
  description: z.string().nullable().optional(),
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

// Mirrors `AttachmentOut`. The MIME type is `mime` and the upload time is
// `created_at` on the wire.
export const attachmentSchema = z.object({
  id: z.string(),
  draft_id: z.string().nullable().optional(),
  file_name: z.string(),
  mime: z.string(),
  size_bytes: z.number(),
  ocr_status: z.enum(['pending', 'running', 'done', 'failed', 'skipped']),
  ocr_model: z.string().nullable().optional(),
  ocr_duration_ms: z.number().nullable().optional(),
  ocr_error: z.string().nullable().optional(),
  ocr_result: ocrResultSchema.nullable().optional(),
  created_at: z.string(),
})
export type Attachment = z.infer<typeof attachmentSchema>

export const attachmentsListSchema = z.object({
  items: z.array(attachmentSchema),
  total: z.number().optional(),
})

// --- DraftPurchaseBill request payload (mirrors §3.6 example) --------------

// Mirrors `PartyPayload` exactly. The backend derives the new ledger's GST
// registration type and mailing name itself (services/sync_push.py), so
// there are no `gst_registration_type` / `mailing_name` keys here — pydantic
// would silently drop them.
export const draftPartySchema = z.object({
  ledger_name: z.string().min(1),
  gstin: z.string().nullable().optional(),
  gst_treatment: z.enum(['regular', 'composition', 'unregistered']),
  billing_address: z.string().optional(),
  source_of_supply: z.string(),
  destination_of_supply: z.string(),
  create_if_missing: z.boolean().default(false),
})

// Mirrors `ItemPayload`: `stock_item` is required on the backend (a line
// without one 422s), so it is required here too and the form must say so.
export const draftItemSchema = z.object({
  description: z.string().optional(),
  stock_item: z.string().min(1, 'Choose a stock item for every line'),
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
