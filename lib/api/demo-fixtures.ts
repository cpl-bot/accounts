// Builds middleware-shaped fixture responses from lib/mock-data.ts.
// Used by:
//   - tests/msw/handlers.ts (unit/component tests)
//   - app/api/talai/[...path]/route.ts when NEXT_PUBLIC_DEMO_MODE=true
//     (lets the whole app run without a middleware, e.g. for a walkthrough)

import {
  apAging,
  arAging,
  bills,
  cashFlowTrend,
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
  Settings,
  SyncRun,
  TallyStatus,
} from './schema'

export function demoTallyStatus(): TallyStatus {
  return {
    connected: tallyConnection.status === 'connected',
    host: tallyConnection.ip,
    port: tallyConnection.port,
    company: tallyConnection.company,
    latency_ms: 42,
    write_enabled: false,
    checked_at: new Date().toISOString(),
  }
}

export function demoSettings(): Settings {
  return {
    tally_host: tallyConnection.ip,
    tally_port: tallyConnection.port,
    tally_company_name: tallyConnection.company,
    sync_interval_minutes: 15,
    write_enabled: false,
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
  }
}

export function demoDashboardOverview(): DashboardOverview {
  const { grossProfit, cashBank, pnl, incomeVsExpense } = dashboardOverview
  return {
    gross_profit: { value: grossProfit.value, change_pct: grossProfit.changePct },
    cash_bank: {
      value: cashBank.value,
      change_pct: cashBank.changePct,
      as_on: cashBank.asOn,
      today: cashBank.today,
      yesterday: cashBank.yesterday,
      accounts: cashBank.accounts,
    },
    pnl: {
      revenue: pnl.revenue,
      cost_of_sales: pnl.costOfSales,
      gross_profit: pnl.grossProfit,
      gross_margin: pnl.grossMargin,
      indirect_income: pnl.indirectIncome,
      indirect_expense: pnl.indirectExpense,
      net_profit: pnl.netProfit,
    },
    income_vs_expense: { value: incomeVsExpense.value, change_pct: incomeVsExpense.changePct },
    trends: {
      gross_profit: grossProfitTrend,
      income_vs_expense: incomeVsExpenseTrend,
      cash_flow: cashFlowTrend,
    },
    formula: demoDashboardFormula(),
    opening_stock: 4_20_000,
    closing_stock: 3_95_000,
    stock_adjustment_status: 'applied',
  }
}

export function demoDashboardPayables(): DashboardPayables {
  return {
    as_on: 'May 12, 2026',
    payables: {
      outstanding: apAging.outstanding,
      on_account: apAging.onAccount,
      change_pct: apAging.changePct,
      total_amount: apAging.totalAmount,
      buckets: apAging.buckets,
      open_bills: apAging.openBills.map((b) => ({
        vendor: b.vendor,
        bill_no: b.billNo,
        amount: b.amount,
        due: b.due,
      })),
      days_payable_outstanding: apAging.daysPayableOutstanding,
    },
    receivables: {
      outstanding: arAging.outstanding,
      on_account: arAging.onAccount,
      change_pct: arAging.changePct,
      total_amount: arAging.totalAmount,
      buckets: arAging.buckets,
      open_bills: arAging.openBills.map((b) => ({
        vendor: b.vendor,
        bill_no: b.billNo,
        amount: b.amount,
        due: b.due,
      })),
      days_sales_outstanding: arAging.daysSalesOutstanding,
    },
  }
}

export function demoBills(): BillsResponse {
  return {
    buckets: apAging.buckets,
    total_pending: apAging.totalAmount,
    items: bills.map((b) => ({
      id: String(b.id),
      party: b.vendor,
      bill_reference: b.fileName,
      bill_date: b.billingDate,
      due_date: b.voucherDate,
      amount: b.totalAmount,
      pending_amount: b.synced ? 0 : b.totalAmount,
      age_days: 0,
    })),
  }
}

export function demoDrafts(): { items: Draft[]; total: number } {
  const now = new Date().toISOString()
  const needsReview = bills.filter((b) => b.status === 'needs_review')
  const items: Draft[] = needsReview.map((b) => ({
    id: `draft-${b.id}`,
    status: 'validated',
    payload: { party: { ledger_name: b.vendor }, totals: { grand_total: b.totalAmount } },
    validation_issues: [
      {
        code: 'LEDGER_NOT_FOUND',
        field: 'party.ledger_name',
        message: `Ledger "${b.vendor}" was not found in Tally.`,
        severity: 'error',
      },
    ],
    review_reasons: [],
    created_at: now,
    updated_at: now,
  }))
  return { items, total: items.length }
}

export function demoLedgers(): Ledger[] {
  return [
    { name: 'BioShield Medical', parent: 'Sundry Creditors', gstin: '27AAECB1234D1Z5', source: 'tally' },
    { name: 'ZEN Manufacturing', parent: 'Sundry Creditors', gstin: '29AAECZ5678E1Z2', source: 'tally' },
    { name: 'SwiftRoute Logistics', parent: 'Sundry Creditors', gstin: null, source: 'tally' },
    { name: 'BlueMark Advisory', parent: 'Sundry Creditors', gstin: null, source: 'talai' },
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
    file_name: b.fileName as string,
    content_type: 'application/pdf',
    size_bytes: 120_000 + i * 1000,
    uploaded_at: new Date().toISOString(),
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
    ocr: { vendor_guess: b.vendor, total_guess: b.totalAmount, confidence: 0.72 },
  }))
}

export function demoSyncRun(dryRun = true): SyncRun {
  const now = new Date().toISOString()
  return {
    id: `run-${Date.now()}`,
    kind: 'push',
    status: 'succeeded',
    started_at: now,
    finished_at: now,
    dry_run: dryRun,
    summary: `${syncItems.reduce((s, i) => s + i.count, 0)} records considered`,
  }
}

export function demoCompanyName() {
  return company.name
}
