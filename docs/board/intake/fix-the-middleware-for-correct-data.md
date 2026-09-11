---
id: fix-the-middleware-for-correct-data
type: bug
created: 2026-09-11
---
# Fix the middleware for correct data

Fix the middleware for correct data so that next js app reflects the correct number in dashboard (refer attached image). actuall numbers:

  Company found: "Vigyapan Mart Pvt.Ltd. - (from 1-Apr-23)" , only one loaded.

  Pulled P&L, period assumed: FY-to-date 2026-04-01 → 2026-09-11 (no period given by you , say word if you want full FY or different range).

  Gross Profit ≈ ₹2,05,32,215.95

  Calc:
  - Sales Accounts: 45,328,937.06
  -
    - Direct Incomes: 72,132,634.42
  - − Cost of Sales (opening stock + purchases − closing stock + direct exp, net): 96,929,355.53
  - = Gross Profit: 20,532,215.95

  Net Profit (add indirect income, subtract indirect exp) works out ≈ ₹30,58,186.68 for same period, if useful.

![shot](docs/board-assets/20260911-140500-1cb8.png)
