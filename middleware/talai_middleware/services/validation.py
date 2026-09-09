"""Business validation for draft purchase bills (plan §3.5).

Structural validation is pydantic's job (``DraftPurchaseBill``); everything here
is a *business* rule checked against the current replica. Each rule returns a
``ValidationIssue`` with a stable ``code`` the UI can key off.

Severity: ``error`` blocks a push; ``warning`` is shown but does not block.
"""

from __future__ import annotations

import re
from decimal import Decimal

from sqlalchemy.orm import Session

from ..api.schemas import DraftPurchaseBill, ValidationIssue
from ..db import models, repo

MONEY_TOLERANCE = Decimal("0.01")
GSTIN_RE = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z][Z][0-9A-Z]$")

PARTY_GROUPS = {"Sundry Creditors"}
PURCHASE_GROUPS = {"Purchase Accounts"}
TAX_GROUPS = {"Duties & Taxes", "Duties and Taxes"}

#: GST state code → state name, for the source-of-supply cross-check. Only the
#: states we trade with are listed; an unknown code simply skips the check.
STATE_CODES = {
    "27": "Maharashtra", "29": "Karnataka", "07": "Delhi", "24": "Gujarat",
    "33": "Tamil Nadu", "36": "Telangana", "19": "West Bengal", "09": "Uttar Pradesh",
    "32": "Kerala", "08": "Rajasthan", "23": "Madhya Pradesh", "03": "Punjab",
    "06": "Haryana", "21": "Odisha", "10": "Bihar", "02": "Himachal Pradesh",
}


def has_errors(issues: list[ValidationIssue]) -> bool:
    """True when at least one issue blocks a write."""
    return any(issue.severity == "error" for issue in issues)


def _issue(code: str, field: str, message: str, severity: str = "error") -> ValidationIssue:
    return ValidationIssue(code=code, field=field, message=message, severity=severity)


def validate_draft(session: Session, payload: DraftPurchaseBill) -> list[ValidationIssue]:
    """Run every business rule against the replica, in a stable order."""
    issues: list[ValidationIssue] = []
    issues += _check_party(session, payload)
    issues += _check_purchase_ledger(session, payload)
    issues += _check_tax_and_other_ledgers(session, payload)
    issues += _check_inventory_masters(session, payload)
    issues += _check_cost_centres(session, payload)
    issues += _check_amounts(payload)
    issues += _check_dates(payload)
    issues += _check_gstin(payload)
    issues += _check_duplicate(session, payload)
    return issues


# --------------------------------------------------------------------------
# Masters
# --------------------------------------------------------------------------


def _ledger_group(session: Session, name: str) -> str | None:
    ledger = repo.ledger_by_name(session, name)
    return ledger.parent_group if ledger else None


def _check_party(session: Session, payload: DraftPurchaseBill) -> list[ValidationIssue]:
    name = payload.party.ledger_name
    group = _ledger_group(session, name)
    if group is None:
        return [
            _issue("LEDGER_NOT_FOUND", "party.ledger_name",
                   f"Ledger '{name}' does not exist in Tally")
        ]
    if group not in PARTY_GROUPS:
        return [
            _issue(
                "LEDGER_WRONG_GROUP",
                "party.ledger_name",
                f"Ledger '{name}' is under '{group}'; a purchase party must be "
                "under Sundry Creditors",
            )
        ]
    return []


def _check_purchase_ledger(
    session: Session, payload: DraftPurchaseBill
) -> list[ValidationIssue]:
    name = payload.purchase_ledger
    group = _ledger_group(session, name)
    if group is None:
        return [
            _issue("PURCHASE_LEDGER_NOT_FOUND", "purchase_ledger",
                   f"Purchase ledger '{name}' does not exist in Tally")
        ]
    if group not in PURCHASE_GROUPS:
        return [
            _issue("PURCHASE_LEDGER_WRONG_GROUP", "purchase_ledger",
                   f"Ledger '{name}' is under '{group}'; expected Purchase Accounts")
        ]
    return []


def _check_tax_and_other_ledgers(
    session: Session, payload: DraftPurchaseBill
) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for index, line in enumerate(payload.tax_lines):
        group = _ledger_group(session, line.ledger_name)
        field = f"tax_lines.{index}.ledger_name"
        if group is None:
            issues.append(
                _issue("TAX_LEDGER_NOT_FOUND", field,
                       f"Tax ledger '{line.ledger_name}' does not exist in Tally")
            )
        elif group not in TAX_GROUPS:
            issues.append(
                _issue("TAX_LEDGER_WRONG_GROUP", field,
                       f"Ledger '{line.ledger_name}' is under '{group}'; expected Duties & Taxes")
            )
    for index, line in enumerate(payload.ledger_lines):
        if _ledger_group(session, line.ledger_name) is None:
            issues.append(
                _issue("LEDGER_NOT_FOUND", f"ledger_lines.{index}.ledger_name",
                       f"Ledger '{line.ledger_name}' does not exist in Tally")
            )
    return issues


def _check_inventory_masters(
    session: Session, payload: DraftPurchaseBill
) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    items = {row.name for row in repo.list_simple(session, models.StockItem)}
    godowns = {row.name for row in repo.list_simple(session, models.Godown)}
    for index, item in enumerate(payload.items):
        if item.stock_item not in items:
            issues.append(
                _issue("STOCK_ITEM_NOT_FOUND", f"items.{index}.stock_item",
                       f"Stock item '{item.stock_item}' does not exist in Tally")
            )
        if item.godown and item.godown not in godowns:
            issues.append(
                _issue("GODOWN_NOT_FOUND", f"items.{index}.godown",
                       f"Godown '{item.godown}' does not exist in Tally")
            )
        if item.quantity <= 0:
            issues.append(
                _issue("ZERO_AMOUNT_LINE", f"items.{index}.quantity",
                       "Item quantity must be greater than zero")
            )
    return issues


def _check_cost_centres(session: Session, payload: DraftPurchaseBill) -> list[ValidationIssue]:
    names = {row.name for row in repo.list_simple(session, models.CostCentre)}
    if not names:
        return []
    used = {payload.cost_centre} | {
        line.cost_centre for line in payload.ledger_lines + payload.tax_lines
    }
    return [
        _issue("COST_CENTRE_NOT_FOUND", "cost_centre",
               f"Cost centre '{name}' does not exist in Tally")
        for name in sorted(n for n in used if n)
        if name not in names
    ]


# --------------------------------------------------------------------------
# Amounts and dates
# --------------------------------------------------------------------------


def _check_amounts(payload: DraftPurchaseBill) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    totals = payload.totals
    items_total = sum((item.amount for item in payload.items), Decimal("0"))
    other_lines = sum((line.amount for line in payload.ledger_lines), Decimal("0"))
    taxes = sum((line.amount for line in payload.tax_lines), Decimal("0"))

    if not payload.items and not payload.ledger_lines and not payload.tax_lines:
        issues.append(_issue("EMPTY_VOUCHER", "items", "A voucher needs at least one line"))

    for index, line in enumerate(payload.ledger_lines):
        if line.amount == 0:
            issues.append(
                _issue("ZERO_AMOUNT_LINE", f"ledger_lines.{index}.amount",
                       f"Ledger line '{line.ledger_name}' has a zero amount")
            )
    for index, line in enumerate(payload.tax_lines):
        if line.amount == 0:
            issues.append(
                _issue("ZERO_AMOUNT_LINE", f"tax_lines.{index}.amount",
                       f"Tax line '{line.ledger_name}' has a zero amount")
            )

    if payload.items and abs(items_total - totals.taxable_value) > MONEY_TOLERANCE:
        issues.append(
            _issue("TAXABLE_VALUE_MISMATCH", "totals.taxable_value",
                   f"Item lines add up to {items_total}, but taxable value says "
                   f"{totals.taxable_value}")
        )

    expected_subtotal = totals.taxable_value + other_lines
    if abs(expected_subtotal - totals.sub_total) > MONEY_TOLERANCE:
        issues.append(
            _issue("SUBTOTAL_MISMATCH", "totals.sub_total",
                   f"Sub total should be {expected_subtotal} "
                   f"(taxable value plus other lines), not {totals.sub_total}")
        )

    expected_total = totals.sub_total + taxes + totals.tds + totals.other_taxes
    if abs(expected_total - totals.grand_total) > MONEY_TOLERANCE:
        issues.append(
            _issue("TOTAL_MISMATCH", "totals.grand_total",
                   f"Grand total should be {expected_total}, not {totals.grand_total}")
        )

    if abs(taxes - totals.gst) > MONEY_TOLERANCE:
        issues.append(
            _issue("GST_MISMATCH", "totals.gst",
                   f"Tax lines add up to {taxes}, but the GST total says {totals.gst}")
        )
    return issues


def _check_dates(payload: DraftPurchaseBill, max_future_days: int = 0) -> list[ValidationIssue]:
    from datetime import date as date_type
    from datetime import timedelta

    issues: list[ValidationIssue] = []
    latest_allowed = date_type.today() + timedelta(days=max_future_days)
    if payload.voucher_date > latest_allowed:
        issues.append(
            _issue("VOUCHER_DATE_IN_FUTURE", "voucher_date",
                   f"Voucher date {payload.voucher_date} is later than {latest_allowed}")
        )
    if payload.bill_date and payload.bill_date > payload.voucher_date:
        issues.append(
            _issue("BILL_DATE_AFTER_VOUCHER_DATE", "bill_date",
                   "Supplier bill date cannot be after the voucher date")
        )
    if payload.due_date and payload.bill_date and payload.due_date < payload.bill_date:
        issues.append(
            _issue("DUE_DATE_BEFORE_BILL_DATE", "due_date",
                   "Due date cannot be before the bill date")
        )
    return issues


def _check_gstin(payload: DraftPurchaseBill) -> list[ValidationIssue]:
    """GSTIN checks are warnings: Tally, not Talai, is the authority here."""
    gstin = (payload.party.gstin or "").strip().upper()
    if not gstin:
        return []
    if not GSTIN_RE.match(gstin):
        return [
            _issue("GSTIN_FORMAT", "party.gstin",
                   f"'{gstin}' is not a valid 15-character GSTIN", severity="warning")
        ]
    source = payload.party.source_of_supply
    expected = STATE_CODES.get(gstin[:2])
    if source and expected and expected.lower() != source.strip().lower():
        return [
            _issue("GSTIN_STATE_MISMATCH", "party.gstin",
                   f"GSTIN state code {gstin[:2]} is {expected}, but the source of supply "
                   f"is {source}", severity="warning")
        ]
    return []


def _check_duplicate(session: Session, payload: DraftPurchaseBill) -> list[ValidationIssue]:
    if payload.allow_duplicate or not payload.supplier_invoice_no:
        return []
    existing = repo.voucher_by_reference(
        session, payload.party.ledger_name, payload.supplier_invoice_no
    )
    if existing is None:
        return []
    return [
        _issue("DUPLICATE_SUPPLIER_INVOICE", "supplier_invoice_no",
               f"Invoice '{payload.supplier_invoice_no}' from "
               f"'{payload.party.ledger_name}' is already voucher "
               f"{existing.voucher_number} in Tally")
    ]
