// Mock data standing in for the Tally -> Supabase sync layer.
// In production these values come from the FastAPI middleware reading Tally.

export const company = {
  name: 'Nivana Healthcare Pvt. Ltd.',
  user: { name: 'Priya', email: 'priya.ca@aiaccountant.io' },
}

export const dashboardOverview = {
  grossProfit: { value: 21_70_000, changePct: 0 },
  cashBank: {
    value: 4_78_000,
    changePct: 378010.72,
    asOn: 'Mar 31, 2026',
    today: 4_78_000,
    yesterday: 4_78_000,
    accounts: [
      { name: 'HDFC BANK LTD', value: 2_56_000 },
      { name: 'Cash', value: 2_31_000 },
    ],
  },
  pnl: {
    revenue: 26_50_000,
    costOfSales: -4_80_000,
    grossProfit: 21_70_000,
    grossMargin: 81.9,
    indirectIncome: 4_23_000,
    indirectExpense: -22_26_000,
    netProfit: 3_66_000,
  },
  incomeVsExpense: { value: 3_66_000, changePct: 0 },
}

// Monthly area chart for gross profit (Apr'25 - Feb'26).
export const grossProfitTrend = [
  { month: "Apr '25", value: 20_000 },
  { month: "May '25", value: 55_000 },
  { month: "Jun '25", value: 90_000 },
  { month: "Jul '25", value: 1_70_000 },
  { month: "Aug '25", value: 1_45_000 },
  { month: "Sep '25", value: 1_50_000 },
  { month: "Oct '25", value: 1_55_000 },
  { month: "Nov '25", value: 2_60_000 },
  { month: "Dec '25", value: 3_10_000 },
  { month: "Jan '26", value: 2_90_000 },
  { month: "Feb '26", value: 4_20_000 },
  { month: "Mar '26", value: 10_000 },
]

// Income (bars) vs Expense (bars) with net line.
export const incomeVsExpenseTrend = [
  { month: "Apr '25", income: 30_000, expense: 20_000 },
  { month: "May '25", income: 3_30_000, expense: 90_000 },
  { month: "Jun '25", income: 1_10_000, expense: 1_60_000 },
  { month: "Jul '25", income: 1_20_000, expense: 1_50_000 },
  { month: "Aug '25", income: 3_05_000, expense: 2_20_000 },
  { month: "Sep '25", income: 2_80_000, expense: 1_70_000 },
  { month: "Oct '25", income: 1_70_000, expense: 1_80_000 },
  { month: "Nov '25", income: 3_10_000, expense: 2_30_000 },
  { month: "Dec '25", income: 4_60_000, expense: 2_80_000 },
  { month: "Jan '26", income: 3_05_000, expense: 2_35_000 },
  { month: "Feb '26", income: 4_60_000, expense: 2_95_000 },
  { month: "Mar '26", income: 3_10_000, expense: 1_60_000 },
]

// Cash inflow vs outflow area chart.
export const cashFlowTrend = [
  { month: "Apr '25", inflow: 7_40_000, outflow: 7_20_000 },
  { month: "May '25", inflow: 2_40_000, outflow: 1_20_000 },
  { month: "Jun '25", inflow: 3_00_000, outflow: 2_70_000 },
  { month: "Jul '25", inflow: 3_60_000, outflow: 3_00_000 },
  { month: "Aug '25", inflow: 3_20_000, outflow: 3_10_000 },
  { month: "Sep '25", inflow: 2_80_000, outflow: 2_60_000 },
  { month: "Oct '25", inflow: 3_00_000, outflow: 2_90_000 },
  { month: "Nov '25", inflow: 4_60_000, outflow: 4_50_000 },
  { month: "Dec '25", inflow: 4_70_000, outflow: 4_80_000 },
  { month: "Jan '26", inflow: 4_00_000, outflow: 4_10_000 },
  { month: "Feb '26", inflow: 1_00_000, outflow: 1_60_000 },
  { month: "Mar '26", inflow: 10_000, outflow: 30_000 },
]

export type AgingBucket = {
  bucket: string
  bills: number
  amount: number
  pct: number
}

export const apAging = {
  outstanding: -9_17_000,
  onAccount: -17_80_000,
  changePct: 0,
  daysPayableOutstanding: 0,
  totalAmount: 28_35_000,
  buckets: [
    { bucket: 'Current', bills: 12, amount: 14_83_000, pct: 52 },
    { bucket: '1-30 Days', bills: 3, amount: 5_870, pct: 0 },
    { bucket: '31-60 Days', bills: 6, amount: 5_19_000, pct: 18 },
    { bucket: '61-90 Days', bills: 4, amount: 2_10_000, pct: 7 },
    { bucket: '90+ Days', bills: 1, amount: 6_17_000, pct: 22 },
  ] as AgingBucket[],
  openBills: [
    { vendor: 'BioShield Medical', billNo: '—', amount: 6_17_000, due: 'May 10, 2026' },
    { vendor: 'ZEN Manufacturing', billNo: '—', amount: 6_17_000, due: 'May 12, 2026' },
    { vendor: 'SwiftRoute Logistics', billNo: '—', amount: 5_19_000, due: 'Apr 28, 2026' },
    { vendor: 'BlueMark Advisory', billNo: '—', amount: 4_19_000, due: 'Apr 20, 2026' },
    { vendor: 'AshtonCore Pharma', billNo: '—', amount: 1_50_000, due: 'Apr 15, 2026' },
    { vendor: 'Anchor Point Corp', billNo: '—', amount: 1_26_000, due: 'Apr 02, 2026' },
    { vendor: 'TrueNorth Partners', billNo: '—', amount: 66_725, due: 'Mar 30, 2026' },
    { vendor: 'Alpine Enterprises', billNo: '—', amount: 42_230, due: 'Mar 22, 2026' },
    { vendor: 'BlueCross Medical', billNo: '—', amount: 72_349, due: 'Mar 18, 2026' },
    { vendor: 'Crestwood Supplies', billNo: '—', amount: 38_900, due: 'Mar 10, 2026' },
  ],
}

export const arAging = {
  outstanding: 5_32_000,
  onAccount: -53_35_000,
  changePct: -237.65,
  daysSalesOutstanding: 0,
  totalAmount: 18_40_000,
  buckets: [
    { bucket: 'Current', bills: 8, amount: 9_60_000, pct: 52 },
    { bucket: '1-30 Days', bills: 2, amount: 1_20_000, pct: 7 },
    { bucket: '31-60 Days', bills: 4, amount: 3_30_000, pct: 18 },
    { bucket: '61-90 Days', bills: 3, amount: 2_10_000, pct: 11 },
    { bucket: '90+ Days', bills: 2, amount: 2_20_000, pct: 12 },
  ] as AgingBucket[],
  openBills: [
    { vendor: 'Metro Diagnostics', billNo: 'INV-1042', amount: 3_20_000, due: 'May 15, 2026' },
    { vendor: 'CarePlus Hospitals', billNo: 'INV-1039', amount: 2_10_000, due: 'May 08, 2026' },
    { vendor: 'Wellness Chain Ltd', billNo: 'INV-1031', amount: 1_80_000, due: 'Apr 30, 2026' },
    { vendor: 'LifeLine Clinics', billNo: 'INV-1024', amount: 1_40_000, due: 'Apr 22, 2026' },
    { vendor: 'PrimeCare Network', billNo: 'INV-1018', amount: 90_000, due: 'Apr 12, 2026' },
  ],
}

export type Bill = {
  id: number
  voucherNo: number
  fileName: string | null
  vendor: string
  billingDate: string
  voucherDate: string
  totalAmount: number
  status: 'synced' | 'needs_review' | 'uploaded'
  synced: boolean
}

export const bills: Bill[] = [
  { id: 1, voucherNo: 12, fileName: 'BioShield.pdf', vendor: 'BioShield Medical', billingDate: '10 May 2026', voucherDate: '10 Jun 2026', totalAmount: 6_17_308, status: 'synced', synced: true },
  { id: 2, voucherNo: 11, fileName: 'ZenMfg.pdf', vendor: 'ZEN Manufacturing', billingDate: '1 Jun 2026', voucherDate: '10 Jun 2026', totalAmount: 1_49_613, status: 'synced', synced: true },
  { id: 3, voucherNo: 10, fileName: 'BlueCross.pdf', vendor: 'BlueCross Medical', billingDate: '29 May 2026', voucherDate: '10 Jun 2026', totalAmount: 72_349.27, status: 'synced', synced: true },
  { id: 4, voucherNo: 9, fileName: 'Alpine.pdf', vendor: 'Alpine Enterprises', billingDate: '31 May 2026', voucherDate: '10 Jun 2026', totalAmount: 4_223, status: 'synced', synced: true },
  { id: 5, voucherNo: 6, fileName: 'AnchorPoint.pdf', vendor: 'Anchor Point Corp', billingDate: '2 May 2026', voucherDate: '24 Jun 2026', totalAmount: 1_26_100, status: 'synced', synced: true },
  { id: 6, voucherNo: 7, fileName: 'TrueNorth.pdf', vendor: 'TrueNorth Partners', billingDate: '5 May 2026', voucherDate: '10 Jun 2026', totalAmount: 66_725.55, status: 'synced', synced: true },
  { id: 7, voucherNo: 6, fileName: null, vendor: 'BlueMark Advisory', billingDate: '31 Jan 2027', voucherDate: '8 Jun 2026', totalAmount: 3_16_887, status: 'needs_review', synced: false },
  { id: 8, voucherNo: 5, fileName: null, vendor: 'TrueNorth Partners', billingDate: '21 May 2026', voucherDate: '8 Jun 2026', totalAmount: 10_000, status: 'needs_review', synced: false },
  { id: 9, voucherNo: 4, fileName: 'SwiftRoute.pdf', vendor: 'SwiftRoute Logistics', billingDate: '18 May 2026', voucherDate: '8 Jun 2026', totalAmount: 5_19_000, status: 'uploaded', synced: false },
  { id: 10, voucherNo: 3, fileName: 'Crestwood.pdf', vendor: 'Crestwood Supplies', billingDate: '11 May 2026', voucherDate: '8 Jun 2026', totalAmount: 38_900, status: 'uploaded', synced: false },
]

export const syncItems = [
  { key: 'transactions', label: 'Transactions', count: 0 },
  { key: 'bills', label: 'Bills', count: 100 },
  { key: 'invoices', label: 'Invoices', count: 0 },
  { key: 'vendors', label: 'Vendors', count: 0 },
  { key: 'customers', label: 'Customers', count: 0 },
  { key: 'journal_vouchers', label: 'Journal Vouchers', count: 0 },
] as const

export const tallyConnection = {
  status: 'connected' as 'connected' | 'disconnected',
  ip: '192.168.1.24',
  port: 9000,
  company: 'Nivana Healthcare Pvt. Ltd.',
  lastSync: 'Today, 10:42 AM',
}
