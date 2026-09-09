"""Pydantic models for every request and response (plan §3.6).

These are the OpenAPI contract: ``docs/openapi.json`` is exported from them and
the frontend's zod schemas mirror them.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Severity = Literal["error", "warning"]
DraftStatus = Literal[
    "draft", "validated", "queued", "committing", "committed", "failed", "cancelled"
]


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --------------------------------------------------------------------------
# Tally status & settings
# --------------------------------------------------------------------------


class CompanyInfo(BaseModel):
    name: str
    guid: str | None = None
    start_from: date | None = None
    books_from: date | None = None


class TallyStatus(BaseModel):
    reachable: bool
    companies: list[CompanyInfo] = Field(default_factory=list)
    active_company: str | None = None
    expected_company: str | None = None
    company_match: bool = False
    latency_ms: int = 0
    checked_at: datetime
    write_enabled: bool = False
    breaker_open: bool = False
    error: str | None = None


class CompanyList(BaseModel):
    companies: list[CompanyInfo]


class TestConnectionRequest(BaseModel):
    host: str
    port: int = 9000
    company_name: str | None = None


class SettingsPayload(BaseModel):
    tally_host: str
    tally_port: int
    tally_company_name: str
    sync_interval_minutes: int
    tally_write_enabled: bool = False


class SettingsUpdate(BaseModel):
    tally_host: str | None = None
    tally_port: int | None = None
    tally_company_name: str | None = None
    sync_interval_minutes: int | None = None


# --------------------------------------------------------------------------
# Masters
# --------------------------------------------------------------------------


class LedgerOut(ORMModel):
    id: int
    name: str
    parent_group: str
    opening_balance: Decimal | None = None
    closing_balance: Decimal | None = None
    gstin: str | None = None
    mailing_name: str | None = None
    address: str | None = None
    state: str | None = None
    gst_registration_type: str | None = None
    is_bill_wise: bool = False


class LedgerList(BaseModel):
    items: list[LedgerOut]
    total: int


class GroupOut(ORMModel):
    id: int
    name: str
    parent: str
    primary_group: str
    is_revenue: bool
    affects_gross_profit: bool


class StockItemOut(ORMModel):
    id: int
    name: str
    parent: str
    unit: str
    hsn: str | None = None
    gst_rate: Decimal | None = None
    closing_qty: Decimal | None = None
    closing_value: Decimal | None = None


class NamedOut(ORMModel):
    id: int
    name: str
    parent: str


class GroupList(BaseModel):
    items: list[GroupOut]


class StockItemList(BaseModel):
    items: list[StockItemOut]


class NamedList(BaseModel):
    items: list[NamedOut]


# --------------------------------------------------------------------------
# Vouchers & bills
# --------------------------------------------------------------------------


class VoucherSummary(ORMModel):
    id: int
    voucher_number: str
    voucher_type: str
    date: date | None
    party_ledger: str
    amount: Decimal
    reference: str
    narration: str
    is_cancelled: bool


class VoucherLedgerEntryOut(ORMModel):
    ledger_name: str
    amount: Decimal
    is_deemed_positive: bool
    cost_centre: str | None = None


class VoucherInventoryEntryOut(ORMModel):
    stock_item: str
    godown: str | None = None
    qty: Decimal | None = None
    rate: Decimal | None = None
    amount: Decimal | None = None
    hsn: str | None = None


class VoucherDetail(VoucherSummary):
    ledger_entries: list[VoucherLedgerEntryOut] = Field(default_factory=list)
    inventory_entries: list[VoucherInventoryEntryOut] = Field(default_factory=list)


class VoucherList(BaseModel):
    items: list[VoucherSummary]
    total: int


class BillOut(ORMModel):
    id: int
    party_ledger: str
    bill_name: str
    bill_date: date | None
    due_date: date | None
    opening_amount: Decimal
    pending_amount: Decimal
    direction: str


class AgingBucket(BaseModel):
    label: str
    amount: Decimal
    count: int


class BillList(BaseModel):
    items: list[BillOut]
    buckets: list[AgingBucket]
    total_pending: Decimal


# --------------------------------------------------------------------------
# Dashboard
# --------------------------------------------------------------------------


class MonthlyPoint(BaseModel):
    month: str
    revenue: Decimal
    cost_of_sales: Decimal
    gross_profit: Decimal


class DashboardOverview(BaseModel):
    period_from: date
    period_to: date
    revenue: Decimal
    cost_of_sales: Decimal
    gross_profit: Decimal
    gross_margin_pct: Decimal
    indirect_income: Decimal
    indirect_expense: Decimal
    net_profit: Decimal
    cash_and_bank: Decimal
    trends: list[MonthlyPoint] = Field(default_factory=list)


class DashboardPayables(BaseModel):
    as_on: date
    total_payable: Decimal
    total_receivable: Decimal
    payable_buckets: list[AgingBucket]
    receivable_buckets: list[AgingBucket]
    dpo_days: Decimal
    dso_days: Decimal


# --------------------------------------------------------------------------
# Drafts
# --------------------------------------------------------------------------


class PartyPayload(BaseModel):
    ledger_name: str
    gstin: str | None = None
    gst_treatment: str | None = None
    billing_address: str | None = None
    source_of_supply: str | None = None
    destination_of_supply: str | None = None


class ItemPayload(BaseModel):
    description: str | None = None
    stock_item: str
    godown: str | None = None
    quantity: Decimal
    rate: Decimal
    hsn: str | None = None

    @property
    def amount(self) -> Decimal:
        return (self.quantity * self.rate).quantize(Decimal("0.01"))


class LedgerLinePayload(BaseModel):
    ledger_name: str
    cost_centre: str | None = None
    amount: Decimal
    description: str | None = None


class TotalsPayload(BaseModel):
    taxable_value: Decimal = Decimal("0")
    sub_total: Decimal = Decimal("0")
    gst: Decimal = Decimal("0")
    tds: Decimal = Decimal("0")
    other_taxes: Decimal = Decimal("0")
    grand_total: Decimal = Decimal("0")


class DraftPurchaseBill(BaseModel):
    """The Create Bill form payload (plan §3.6)."""

    gst_registration: str | None = None
    voucher_type: str = "Purchase"
    voucher_date: date
    bill_date: date | None = None
    due_date: date | None = None
    supplier_invoice_no: str
    cost_centre: str | None = None
    party: PartyPayload
    purchase_ledger: str
    items: list[ItemPayload] = Field(default_factory=list)
    ledger_lines: list[LedgerLinePayload] = Field(default_factory=list)
    tax_lines: list[LedgerLinePayload] = Field(default_factory=list)
    reverse_charge: bool = False
    narration: str = ""
    totals: TotalsPayload = Field(default_factory=TotalsPayload)
    allow_duplicate: bool = False


class ValidationIssue(BaseModel):
    code: str
    field: str
    message: str
    severity: Severity = "error"


class DraftOut(BaseModel):
    id: str
    status: DraftStatus
    payload: DraftPurchaseBill | None = None
    errors: list[ValidationIssue] = Field(default_factory=list)
    generated_xml: str | None = None
    dry_run: bool = False
    tally_voucher_number: str | None = None
    tally_guid: str | None = None
    attempts: int = 0
    created_at: datetime
    updated_at: datetime


class DraftList(BaseModel):
    items: list[DraftOut]
    total: int


class ValidationResult(BaseModel):
    status: DraftStatus
    errors: list[ValidationIssue]


# --------------------------------------------------------------------------
# Sync
# --------------------------------------------------------------------------


class SyncRunOut(ORMModel):
    id: int
    kind: str
    scope: str
    status: str
    started_at: datetime
    finished_at: datetime | None = None
    records_seen: int
    records_changed: int
    error: str | None = None


class SyncRunList(BaseModel):
    items: list[SyncRunOut]


class PullRequest(BaseModel):
    scopes: list[Literal["masters", "vouchers", "bills"]] = Field(
        default_factory=lambda: ["masters", "vouchers", "bills"]
    )
    from_date: date | None = None
    to_date: date | None = None


class PushRequest(BaseModel):
    draft_ids: list[str] | None = None


class PushResultItem(BaseModel):
    draft_id: str
    status: DraftStatus
    voucher_number: str | None = None
    dry_run: bool = False
    errors: list[ValidationIssue] = Field(default_factory=list)


class PushResponse(BaseModel):
    run: SyncRunOut
    results: list[PushResultItem]


class AttachmentOut(ORMModel):
    id: str
    draft_id: str | None
    file_name: str
    mime: str
    size_bytes: int
    ocr_status: str
    created_at: datetime
