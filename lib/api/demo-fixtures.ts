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
  DashboardOverview,
  DashboardPayables,
  Draft,
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
    created_at: now,
    updated_at: now,
  }))
  return { items, total: items.length }
}

export function demoAttachments(): Attachment[] {
  const uploaded = bills.filter((b) => b.status === 'uploaded' && b.fileName)
  return uploaded.map((b, i) => ({
    id: `att-${b.id}`,
    file_name: b.fileName as string,
    content_type: 'application/pdf',
    size_bytes: 120_000 + i * 1000,
    uploaded_at: new Date().toISOString(),
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
