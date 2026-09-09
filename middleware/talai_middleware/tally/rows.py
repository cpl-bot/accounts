"""Typed rows the parsers produce.

Plain dataclasses, deliberately free of SQLAlchemy and pydantic: this is the
boundary type between the Tally XML layer and everything above it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal


@dataclass
class Company:
    name: str
    guid: str | None = None
    starting_from: date | None = None
    books_from: date | None = None


@dataclass
class MasterRow:
    """Fields shared by every Tally-sourced master row."""

    name: str
    parent: str = ""
    guid: str | None = None
    master_id: str | None = None
    alter_id: int | None = None


@dataclass
class LedgerRow(MasterRow):
    parent_group: str = ""
    opening_balance: Decimal | None = None
    closing_balance: Decimal | None = None
    gstin: str | None = None
    mailing_name: str | None = None
    address: str | None = None
    state: str | None = None
    gst_registration_type: str | None = None
    is_bill_wise: bool = False


@dataclass
class GroupRow(MasterRow):
    primary_group: str = ""
    is_revenue: bool = False
    is_deemed_positive: bool = False
    affects_gross_profit: bool = False


@dataclass
class StockItemRow(MasterRow):
    unit: str = ""
    hsn: str | None = None
    gst_rate: Decimal | None = None
    closing_qty: Decimal | None = None
    closing_value: Decimal | None = None


@dataclass
class VoucherLedgerEntry:
    ledger_name: str
    amount: Decimal
    is_deemed_positive: bool = False
    cost_centre: str | None = None


@dataclass
class VoucherInventoryEntry:
    stock_item: str
    quantity: Decimal | None = None
    rate: Decimal | None = None
    amount: Decimal | None = None
    godown: str | None = None
    hsn: str | None = None


@dataclass
class VoucherRow:
    voucher_number: str
    voucher_type: str
    date: date | None
    party_ledger: str = ""
    narration: str = ""
    reference: str = ""
    amount: Decimal = Decimal("0")
    guid: str | None = None
    master_id: str | None = None
    alter_id: int | None = None
    remote_id: str | None = None
    is_cancelled: bool = False
    ledger_entries: list[VoucherLedgerEntry] = field(default_factory=list)
    inventory_entries: list[VoucherInventoryEntry] = field(default_factory=list)


@dataclass
class BillRow:
    party_ledger: str
    bill_name: str
    direction: str
    bill_date: date | None = None
    due_date: date | None = None
    opening_amount: Decimal = Decimal("0")
    pending_amount: Decimal = Decimal("0")


@dataclass
class ImportResult:
    created: int = 0
    altered: int = 0
    deleted: int = 0
    combined: int = 0
    ignored: int = 0
    errors: int = 0
    last_voucher_id: str | None = None
    line_errors: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.errors == 0 and not self.line_errors
