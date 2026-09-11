"""Dashboard numbers, computed from the replica only (never from Tally).

Sign convention of the stored voucher lines is Tally's: a **credit is positive**
and a **debit is negative** (see ``docs/TALLY_INTEGRATION_NOTES.md``). The
aggregates below flip signs where a positive, human-facing figure is wanted.

Definitions used (documented so the numbers can be reconciled with Tally's own
Profit & Loss):

``revenue``
    Credits to ledgers under **Sales Accounts** in the period.
``cost_of_sales``
    Debits to ledgers under **Purchase Accounts** and **Direct Expenses**.
``gross_profit``
    ``revenue − cost_of_sales``.
``indirect_income`` / ``indirect_expense``
    Credits under **Indirect Incomes** / debits under **Indirect Expenses**.
``net_profit``
    ``gross_profit + indirect_income − indirect_expense``.
``cash_and_bank``
    Sum of *closing balances* of ledgers under **Cash-in-Hand** and
    **Bank Accounts** — a balance-sheet figure, so it ignores the period.
``DPO``
    ``pending payables ÷ cost of sales over the trailing window × days`` — the
    simple form; it uses cost of sales rather than purchases, which is close
    enough while inventory movements are small.
``DSO``
    ``pending receivables ÷ revenue over the trailing window × days``.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Sequence
from datetime import date, timedelta
from decimal import Decimal

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..api.schemas import (
    AgingBucket,
    DashboardFormula,
    DashboardOverview,
    DashboardPayables,
    MonthlyPoint,
)
from ..db import models, repo

logger = logging.getLogger(__name__)

ZERO = Decimal("0.00")
TRAILING_WINDOW_DAYS = 365

REVENUE_GROUPS = ("Sales Accounts",)
COST_OF_SALES_GROUPS = ("Purchase Accounts", "Direct Expenses")
INDIRECT_INCOME_GROUPS = ("Indirect Incomes",)
INDIRECT_EXPENSE_GROUPS = ("Indirect Expenses",)
CASH_GROUPS = ("Cash-in-Hand", "Bank Accounts")

#: ``settings`` row the dashboard formula is stored in as JSON (plan §3.9).
FORMULA_KEY = "dashboard_formula"

AGING_BUCKETS: tuple[tuple[str, int | None], ...] = (
    ("Current", 0),
    ("1-30", 30),
    ("31-60", 60),
    ("61-90", 90),
    ("90+", None),
)


def _money(value: Decimal | int | float | None) -> Decimal:
    return Decimal(value or 0).quantize(Decimal("0.01"))


def _descendant_groups(session: Session, roots: Sequence[str]) -> set[str]:
    """A group and everything beneath it, so sub-groups are counted too."""
    rows = list(session.scalars(select(models.Group)))
    children: dict[str, list[str]] = {}
    for row in rows:
        children.setdefault(row.parent, []).append(row.name)
    found: set[str] = set()
    stack = list(roots)
    while stack:
        name = stack.pop()
        if name in found:
            continue
        found.add(name)
        stack.extend(children.get(name, []))
    return found


def _ledger_names(session: Session, groups: Sequence[str]) -> set[str]:
    names = _descendant_groups(session, groups)
    stmt = select(models.Ledger.name).where(models.Ledger.parent_group.in_(names))
    return set(session.scalars(stmt))


def _entry_sum(
    session: Session,
    ledger_names: set[str],
    date_from: date,
    date_to: date,
) -> Decimal:
    """Signed sum of voucher lines hitting those ledgers in the window."""
    if not ledger_names:
        return ZERO
    stmt = (
        select(models.VoucherLedgerEntry.amount)
        .join(models.Voucher, models.Voucher.id == models.VoucherLedgerEntry.voucher_id)
        .where(
            models.VoucherLedgerEntry.ledger_name.in_(ledger_names),
            models.Voucher.date >= date_from,
            models.Voucher.date <= date_to,
            models.Voucher.is_cancelled.is_(False),
            models.Voucher.is_deleted.is_(False),
        )
    )
    return _money(sum(session.scalars(stmt), Decimal("0")))


def _credits(session: Session, groups: Sequence[str], f: date, t: date) -> Decimal:
    return _money(_entry_sum(session, _ledger_names(session, groups), f, t))


def _debits(session: Session, groups: Sequence[str], f: date, t: date) -> Decimal:
    return _money(-_entry_sum(session, _ledger_names(session, groups), f, t))


def cash_and_bank(session: Session) -> Decimal:
    """Closing balances of cash and bank ledgers."""
    names = _ledger_names(session, CASH_GROUPS)
    if not names:
        return ZERO
    stmt = select(models.Ledger.closing_balance).where(models.Ledger.name.in_(names))
    return _money(sum((b or ZERO for b in session.scalars(stmt)), Decimal("0")))


# --------------------------------------------------------------------------
# The configurable gross-profit formula (plan §3.9)
# --------------------------------------------------------------------------


def load_formula(session: Session) -> DashboardFormula:
    """The stored formula, or the documented defaults.

    A stored value that no longer parses (an older shape, a hand edit) is
    logged and ignored rather than raised: the dashboard must still render.
    """
    raw = repo.get_setting(session, FORMULA_KEY)
    if not raw:
        return DashboardFormula()
    try:
        return DashboardFormula.model_validate(json.loads(raw))
    except (ValueError, ValidationError) as exc:
        logger.warning("stored %s is unusable (%s); using the defaults", FORMULA_KEY, exc)
        return DashboardFormula()


def save_formula(session: Session, formula: DashboardFormula) -> DashboardFormula:
    repo.set_setting(session, FORMULA_KEY, formula.model_dump_json())
    return formula


def formula_warnings(session: Session, formula: DashboardFormula) -> list[str]:
    """Group names the replica does not know — advisory only (plan §3.9).

    Skipped entirely when the replica has no groups yet, because then every
    name would look wrong.
    """
    known = {row.name for row in session.scalars(select(models.Group))}
    if not known:
        return []
    return [
        f"Group '{name}' is not in the replica"
        for name in list(formula.revenue_groups) + list(formula.cost_of_sales_groups)
        if name not in known
    ]


def _valuation(session: Session, as_on: date) -> Decimal | None:
    row = repo.stock_valuation(session, as_on)
    return _money(row.closing_value) if row else None


def stock_figures(
    session: Session, formula: DashboardFormula, date_from: date, date_to: date
) -> tuple[Decimal, Decimal, str]:
    """``(opening, closing, status)`` for the trading formula (plan §3.9).

    ``applied``     the configured source supplied both figures;
    ``manual``      at least one figure came from ``manual_*``;
    ``unavailable`` neither source could supply a figure, so no stock
                    adjustment is made and the period behaves like ``simple``.

    In ``simple`` mode there is no stock adjustment to make, so both figures
    are zero and the status is ``applied``: the formula ran as configured.
    """
    if formula.gross_profit_mode != "trading":
        return ZERO, ZERO, "applied"

    from_tally = formula.stock_source == "tally"
    tally_opening = _valuation(session, date_from - timedelta(days=1)) if from_tally else None
    tally_closing = _valuation(session, date_to) if from_tally else None
    if tally_opening is not None and tally_closing is not None:
        return tally_opening, tally_closing, "applied"

    opening = tally_opening if tally_opening is not None else formula.manual_opening_stock
    closing = tally_closing if tally_closing is not None else formula.manual_closing_stock
    if opening is None or closing is None:
        # A boundary with neither a valuation nor a manual override cannot be
        # substituted with zero: that would overstate cost of sales by the
        # whole of the other boundary. Degrade to ``simple`` instead (§3.9).
        missing = [
            name
            for name, value in (("opening", opening), ("closing", closing))
            if value is None
        ]
        logger.warning(
            "trading gross profit requested for %s..%s but the %s stock value is "
            "unavailable; no stock adjustment applied",
            date_from, date_to, " and ".join(missing),
        )
        return ZERO, ZERO, "unavailable"
    return _money(opening), _money(closing), "manual"


def _months(date_from: date, date_to: date) -> list[tuple[date, date]]:
    months: list[tuple[date, date]] = []
    cursor = date_from.replace(day=1)
    while cursor <= date_to:
        if cursor.month == 12:
            next_month = cursor.replace(year=cursor.year + 1, month=1)
        else:
            next_month = cursor.replace(month=cursor.month + 1)
        months.append((max(cursor, date_from), min(next_month - timedelta(days=1), date_to)))
        cursor = next_month
    return months


def overview(
    session: Session,
    date_from: date,
    date_to: date,
    formula: DashboardFormula | None = None,
) -> DashboardOverview:
    """The Overview dashboard (plan §3.6), honouring the stored formula (§3.9).

    ``trends`` is always the simple month-on-month picture: a monthly stock
    adjustment would need a valuation at every month boundary and would make
    the line chart disagree with the headline figure whenever one is missing.
    """
    formula = formula or load_formula(session)
    revenue_groups = formula.revenue_groups
    cost_groups = formula.cost_of_sales_groups

    revenue = _credits(session, revenue_groups, date_from, date_to)
    purchases = _debits(session, cost_groups, date_from, date_to)
    opening_stock, closing_stock, stock_status = stock_figures(
        session, formula, date_from, date_to
    )
    cost_of_sales = purchases
    if formula.gross_profit_mode == "trading" and stock_status != "unavailable":
        cost_of_sales = _money(purchases + opening_stock - closing_stock)

    gross_profit = _money(revenue - cost_of_sales)
    indirect_income = _credits(session, INDIRECT_INCOME_GROUPS, date_from, date_to)
    indirect_expense = _debits(session, INDIRECT_EXPENSE_GROUPS, date_from, date_to)
    margin = _money(gross_profit / revenue * 100) if revenue else ZERO
    trends = [
        MonthlyPoint(
            month=f"{start.year:04d}-{start.month:02d}",
            revenue=(month_revenue := _credits(session, revenue_groups, start, end)),
            cost_of_sales=(month_cost := _debits(session, cost_groups, start, end)),
            gross_profit=_money(month_revenue - month_cost),
        )
        for start, end in _months(date_from, date_to)
    ]
    return DashboardOverview(
        period_from=date_from,
        period_to=date_to,
        revenue=revenue,
        cost_of_sales=cost_of_sales,
        gross_profit=gross_profit,
        gross_margin_pct=margin,
        indirect_income=indirect_income,
        indirect_expense=indirect_expense,
        net_profit=_money(gross_profit + indirect_income - indirect_expense),
        cash_and_bank=cash_and_bank(session),
        trends=trends,
        formula=formula,
        opening_stock=opening_stock,
        closing_stock=closing_stock,
        stock_adjustment_status=stock_status,
    )


def aging_buckets(
    session: Session, direction: str, as_on: date, party: str | None = None
) -> list[AgingBucket]:
    """Split open bills into Current / 1-30 / 31-60 / 61-90 / 90+ by due date."""
    totals: dict[str, Decimal] = {label: ZERO for label, _ in AGING_BUCKETS}
    counts: dict[str, int] = {label: 0 for label, _ in AGING_BUCKETS}
    stmt = select(models.Bill).where(
        models.Bill.direction == direction, models.Bill.pending_amount != 0
    )
    if party:
        stmt = stmt.where(models.Bill.party_ledger.ilike(f"%{party}%"))
    for bill in session.scalars(stmt):
        overdue_days = (as_on - bill.due_date).days if bill.due_date else 0
        label = _bucket_for(overdue_days)
        totals[label] = _money(totals[label] + bill.pending_amount)
        counts[label] += 1
    return [
        AgingBucket(label=label, amount=totals[label], count=counts[label])
        for label, _ in AGING_BUCKETS
    ]


def _bucket_for(overdue_days: int) -> str:
    if overdue_days <= 0:
        return "Current"
    for label, upper in AGING_BUCKETS[1:]:
        if upper is None or overdue_days <= upper:
            return label
    return "90+"


def _pending_total(session: Session, direction: str) -> Decimal:
    stmt = select(models.Bill.pending_amount).where(models.Bill.direction == direction)
    return _money(sum(session.scalars(stmt), Decimal("0")))


def payables(session: Session, as_on: date) -> DashboardPayables:
    """Payables & receivables dashboard, including DPO/DSO (see module docstring)."""
    window_from = as_on - timedelta(days=TRAILING_WINDOW_DAYS)
    total_payable = _pending_total(session, "payable")
    total_receivable = _pending_total(session, "receivable")
    cost_of_sales = _debits(session, COST_OF_SALES_GROUPS, window_from, as_on)
    revenue = _credits(session, REVENUE_GROUPS, window_from, as_on)
    return DashboardPayables(
        as_on=as_on,
        total_payable=total_payable,
        total_receivable=total_receivable,
        payable_buckets=aging_buckets(session, "payable", as_on),
        receivable_buckets=aging_buckets(session, "receivable", as_on),
        dpo_days=_ratio_days(total_payable, cost_of_sales),
        dso_days=_ratio_days(total_receivable, revenue),
    )


def _ratio_days(outstanding: Decimal, flow: Decimal) -> Decimal:
    """``outstanding ÷ flow × window`` in days; zero when there is no flow."""
    if flow <= 0:
        return ZERO
    return _money(outstanding / flow * TRAILING_WINDOW_DAYS)
