// Builds middleware-shaped fixture responses from lib/mock-data.ts.
// Used by:
//   - tests/msw/handlers.ts (unit/component tests)
//   - app/api/talai/[...path]/route.ts when NEXT_PUBLIC_DEMO_MODE=true
//     (lets the whole app run without a middleware, e.g. for a walkthrough)

import {
  apAging,
  arAging,
  bills,
  company,
  dashboardOverview,
  grossProfitTrend,
  incomeVsExpenseTrend,
  syncItems,
  tallyConnection,
} from '@/lib/mock-data'
import type {
  Attachment,
  BillsResponse,
  DashboardFormula,
  DashboardOverview,
  DashboardPayables,
  Draft,
  Ledger,
  LedgerLookupResult,
  PushResult,
  Settings,
  SyncRun,
  SyncRunList,
  SyncScope,
  SyncStatus,
  TallyStatus,
} from './schema'

// Shaped like the middleware's `TallyStatus` (api/schemas.py), not the
// frontend's convenience view — the whole point of these fixtures is to
// stand in for the real backend, so they must drift with it, not with us.
export function demoTallyStatus(): TallyStatus {
  const reachable = tallyConnection.status === 'connected'
  return {
    reachable,
    companies: reachable ? [{ name: tallyConnection.company }] : [],
    active_company: reachable ? tallyConnection.company : null,
    expected_company: tallyConnection.company,
    company_match: reachable,
    latency_ms: 42,
    checked_at: new Date().toISOString(),
    write_enabled: false,
    breaker_open: false,
    error: reachable ? null : 'Connection refused',
  }
}

export function demoSettings(): Settings {
  return {
    tally_host: tallyConnection.ip,
    tally_port: tallyConnection.port,
    tally_company_name: tallyConnection.company,
    sync_interval_minutes: 15,
    tally_write_enabled: false,
  }
}

export function demoDashboardFormula(): DashboardFormula {
  return {
    gross_profit_mode: 'simple',
    stock_source: 'tally',
    manual_opening_stock: null,
    manual_closing_stock: null,
    revenue_groups: ['Sales Accounts'],
    cost_of_sales_groups: ['Purchase Accounts', 'Direct Expenses'],
    warnings: [],
  }
}

// Mirrors the middleware's flat `DashboardOverview` (talai_middleware/
// api/schemas.py). `grossProfitTrend` and `incomeVsExpenseTrend` share the
// same month keys in lib/mock-data.ts, so they're merged by index here.
export function demoDashboardOverview(): DashboardOverview {
  const { pnl } = dashboardOverview
  const trends = grossProfitTrend.map((gp, i) => ({
    month: gp.month,
    revenue: incomeVsExpenseTrend[i]?.income ?? 0,
    cost_of_sales: incomeVsExpenseTrend[i]?.expense ?? 0,
    gross_profit: gp.value,
  }))
  return {
    period_from: '2026-04-01',
    period_to: '2026-09-09',
    revenue: pnl.revenue,
    cost_of_sales: pnl.costOfSales,
    gross_profit: pnl.grossProfit,
    gross_margin_pct: pnl.grossMargin,
    indirect_income: pnl.indirectIncome,
    indirect_expense: pnl.indirectExpense,
    net_profit: pnl.netProfit,
    cash_and_bank: dashboardOverview.cashBank.value,
    trends,
    formula: demoDashboardFormula(),
    opening_stock: 4_20_000,
    closing_stock: 3_95_000,
    stock_adjustment_status: 'applied',
  }
}

// Mirrors the middleware's flat `DashboardPayables`. lib/mock-data's
// {bucket, bills, pct} aging buckets are remapped to the API's
// {label, amount, count} shape.
function toApiBucket(b: { bucket: string; bills: number; amount: number }) {
  return { label: b.bucket, amount: b.amount, count: b.bills }
}

export function demoDashboardPayables(): DashboardPayables {
  return {
    as_on: '2026-05-12',
    total_payable: apAging.totalAmount,
    total_receivable: arAging.totalAmount,
    payable_buckets: apAging.buckets.map(toApiBucket),
    receivable_buckets: arAging.buckets.map(toApiBucket),
    dpo_days: apAging.daysPayableOutstanding,
    dso_days: arAging.daysSalesOutstanding,
  }
}

export function demoBills(direction: 'payable' | 'receivable' = 'payable'): BillsResponse {
  const source = direction === 'payable' ? apAging.openBills : arAging.openBills
  const buckets = (direction === 'payable' ? apAging.buckets : arAging.buckets).map(toApiBucket)
  return {
    buckets,
    total_pending: direction === 'payable' ? apAging.totalAmount : arAging.totalAmount,
    items: source.map((b, i) => ({
      id: i + 1,
      party_ledger: b.vendor,
      bill_name: b.billNo,
      bill_date: b.due,
      due_date: b.due,
      opening_amount: b.amount,
      pending_amount: b.amount,
      direction,
    })),
  }
}

// One backend-shaped `DraftOut` with every field present, so callers that
// need a draft in a particular state only spell out what differs.
export function demoDraft(overrides: Partial<Draft> & { id: string }): Draft {
  const now = new Date().toISOString()
  return {
    status: 'validated',
    payload: null,
    errors: [],
    generated_xml: null,
    generated_ledger_xml: null,
    dry_run: false,
    tally_voucher_number: null,
    tally_guid: null,
    attempts: 0,
    needs_review: false,
    review_reasons: [],
    attachment_id: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  }
}

export function demoDrafts(): { items: Draft[]; total: number } {
  const now = new Date().toISOString()
  const needsReview = bills.filter((b) => b.status === 'needs_review')
  const items: Draft[] = needsReview.map((b) => ({
    id: `draft-${b.id}`,
    status: 'validated',
    // The real middleware echoes Decimal fields back as strings.
    payload: {
      party: { ledger_name: b.vendor },
      totals: { grand_total: b.totalAmount.toFixed(2) },
    },
    errors: [
      {
        code: 'LEDGER_NOT_FOUND',
        field: 'party.ledger_name',
        message: `Ledger "${b.vendor}" was not found in Tally.`,
        severity: 'error',
        details: { can_create: true, suggestions: [], best_ratio: 0 },
      },
    ],
    generated_xml: null,
    generated_ledger_xml: null,
    dry_run: false,
    tally_voucher_number: null,
    tally_guid: null,
    attempts: 0,
    needs_review: false,
    review_reasons: [],
    attachment_id: null,
    created_at: now,
    updated_at: now,
  }))
  return { items, total: items.length }
}

export function demoLedgers(): Ledger[] {
  return [
    { id: 1, name: 'BioShield Medical', parent_group: 'Sundry Creditors', gstin: '27AAECB1234D1Z5', source: 'tally' },
    { id: 2, name: 'ZEN Manufacturing', parent_group: 'Sundry Creditors', gstin: '29AAECZ5678E1Z2', source: 'tally' },
    { id: 3, name: 'SwiftRoute Logistics', parent_group: 'Sundry Creditors', gstin: null, source: 'tally' },
    { id: 4, name: 'BlueMark Advisory', parent_group: 'Sundry Creditors', gstin: null, source: 'talai' },
  ]
}

export function demoLedgerLookup(name: string): LedgerLookupResult {
  const normalise = (s: string) =>
    s
      .toLowerCase()
      .replace(/\b(pvt|ltd|private|limited)\b/g, '')
      .replace(/[^a-z0-9]/g, '')
      .trim()
  const target = normalise(name)
  const ledgers = demoLedgers()
  const exact = ledgers.find((l) => normalise(l.name) === target)
  if (exact) return { found: true, ledger: exact, suggestions: [], best_ratio: 1 }

  const withRatio = ledgers
    .map((l) => {
      const a = normalise(l.name)
      const b = target
      const longer = a.length > b.length ? a : b
      const shorter = a.length > b.length ? b : a
      const ratio = longer.length === 0 ? 1 : shorter.length / longer.length
      return { ...l, ratio: a.includes(b) || b.includes(a) ? Math.max(ratio, 0.85) : ratio }
    })
    .filter((l) => l.ratio >= 0.5)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 5)

  return {
    found: false,
    ledger: null,
    suggestions: withRatio,
    best_ratio: withRatio[0]?.ratio ?? null,
  }
}

export function demoAttachments(): Attachment[] {
  const uploaded = bills.filter((b) => b.status === 'uploaded' && b.fileName)
  return uploaded.map((b, i) => ({
    id: `att-${b.id}`,
    draft_id: null,
    file_name: b.fileName as string,
    mime: 'application/pdf',
    size_bytes: 120_000 + i * 1000,
    ocr_status: 'done',
    ocr_model: 'gemma3:12b',
    ocr_duration_ms: 4200,
    ocr_error: null,
    ocr_result: {
      fields: {
        supplier_name: b.vendor,
        supplier_gstin: null,
        invoice_number: b.fileName,
        invoice_date: b.billingDate,
        due_date: null,
        place_of_supply: 'Maharashtra',
        line_items: [],
        taxable_value: b.totalAmount,
        cgst: 0,
        sgst: 0,
        igst: 0,
        tds: 0,
        other_charges: 0,
        grand_total: b.totalAmount,
        narration: null,
      },
      confidence: { supplier_name: 0.92, total: 0.88, invoice_number: 0.6 },
      raw_text: '',
    },
    created_at: new Date().toISOString(),
  }))
}

// Mirrors `SyncRunOut`: integer id, `status: "success"`, no per-run dry-run
// flag (that lives on each push result item).
export function demoSyncRun(): SyncRun {
  const now = new Date().toISOString()
  return {
    id: Math.floor(Date.now() / 1000),
    kind: 'push',
    scope: 'drafts',
    status: 'success',
    started_at: now,
    finished_at: now,
    records_seen: syncItems.reduce((s, i) => s + i.count, 0),
    records_changed: 0,
    error: null,
  }
}

// Mirrors `PushResponse` in the default write-disabled posture: every draft
// is validated as a dry run, nothing reaches Tally.
export function demoPushResult(draftIds: string[] = []): PushResult {
  return {
    run: demoSyncRun(),
    results: draftIds.map((id) => ({
      draft_id: id,
      status: 'validated',
      voucher_number: null,
      dry_run: true,
      errors: [],
    })),
  }
}

const ALL_SYNC_SCOPES: SyncScope[] = ['masters', 'vouchers', 'bills', 'stock']

// Mirrors `SyncRunList` — one successful `SyncRun` per requested scope
// (every scope, in order, when none are requested), as `POST /sync/pull`
// returns on a clean run.
export function demoSyncRunList(scopes?: SyncScope[]): SyncRunList {
  const selected = scopes && scopes.length > 0 ? scopes : ALL_SYNC_SCOPES
  return {
    items: selected.map((scope, i) => ({
      ...demoSyncRun(),
      id: Math.floor(Date.now() / 1000) + i,
      kind: 'pull',
      scope,
    })),
  }
}

// Mirrors `SyncStatusOut` — always 4 entries, in the fixed order masters,
// vouchers, bills, stock, all reporting a recent successful pull.
export function demoSyncStatus(): SyncStatus {
  const now = new Date()
  return {
    scopes: ALL_SYNC_SCOPES.map((scope, i) => {
      const finishedAt = new Date(now.getTime() - i * 60_000).toISOString()
      return {
        scope,
        status: 'success',
        last_run_at: finishedAt,
        last_finished_at: finishedAt,
        last_success_at: finishedAt,
        error: null,
      }
    }),
  }
}

export function demoCompanyName() {
  return company.name
}
