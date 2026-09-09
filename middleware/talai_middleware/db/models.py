"""The replica + outbox schema (plan §3.3).

Money is ``NUMERIC(18,2)``, dates are ``DATE``. Every Tally-sourced row carries
``tally_guid``/``tally_master_id``/``tally_alter_id``/``company_name``/``synced_at``
so a pull can upsert by GUID and a delta pull can filter by ALTERID.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

MONEY = Numeric(18, 2)
QTY = Numeric(18, 4)


def utcnow() -> datetime:
    return datetime.now(UTC)


def new_uuid() -> str:
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    pass


class TallySourced:
    """Mixin for rows that mirror a Tally object."""

    tally_guid: Mapped[str | None] = mapped_column(String(64), index=True)
    tally_master_id: Mapped[str | None] = mapped_column(String(32))
    tally_alter_id: Mapped[int | None] = mapped_column(Integer, index=True)
    company_name: Mapped[str | None] = mapped_column(String(255))
    synced_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class SyncRun(Base):
    __tablename__ = "sync_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(16))  # pull | push
    scope: Mapped[str] = mapped_column(String(64), default="")
    status: Mapped[str] = mapped_column(String(16), default="running")
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime)
    records_seen: Mapped[int] = mapped_column(Integer, default=0)
    records_changed: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text)


class Group(Base, TallySourced):
    __tablename__ = "groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    parent: Mapped[str] = mapped_column(String(255), default="")
    primary_group: Mapped[str] = mapped_column(String(255), default="")
    is_revenue: Mapped[bool] = mapped_column(Boolean, default=False)
    is_deemed_positive: Mapped[bool] = mapped_column(Boolean, default=False)
    affects_gross_profit: Mapped[bool] = mapped_column(Boolean, default=False)


class Ledger(Base, TallySourced):
    __tablename__ = "ledgers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    parent_group: Mapped[str] = mapped_column(String(255), default="", index=True)
    opening_balance: Mapped[Decimal | None] = mapped_column(MONEY)
    closing_balance: Mapped[Decimal | None] = mapped_column(MONEY)
    gstin: Mapped[str | None] = mapped_column(String(20))
    mailing_name: Mapped[str | None] = mapped_column(String(255))
    address: Mapped[str | None] = mapped_column(Text)
    state: Mapped[str | None] = mapped_column(String(64))
    gst_registration_type: Mapped[str | None] = mapped_column(String(32))
    is_bill_wise: Mapped[bool] = mapped_column(Boolean, default=False)
    #: ``tally`` once a pull has seen the ledger in Tally, ``talai`` while it is
    #: only known to us because we created it (plan §3.8.5).
    source: Mapped[str] = mapped_column(String(16), default="tally", index=True)


class StockItem(Base, TallySourced):
    __tablename__ = "stock_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    parent: Mapped[str] = mapped_column(String(255), default="")
    unit: Mapped[str] = mapped_column(String(32), default="")
    hsn: Mapped[str | None] = mapped_column(String(16))
    gst_rate: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    closing_qty: Mapped[Decimal | None] = mapped_column(QTY)
    closing_value: Mapped[Decimal | None] = mapped_column(MONEY)


class StockValuation(Base):
    """Closing stock value as on a date, for the trading gross-profit formula.

    Filled by the pull sync from Tally's Stock Summary report at the period
    boundaries the dashboard needs (plan §3.9).
    """

    __tablename__ = "stock_valuations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    as_on: Mapped[date] = mapped_column(Date, unique=True, index=True)
    closing_value: Mapped[Decimal] = mapped_column(MONEY, default=Decimal("0"))
    source: Mapped[str] = mapped_column(String(16), default="tally")
    synced_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class _Lookup(TallySourced):
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    parent: Mapped[str] = mapped_column(String(255), default="")


class CostCentre(Base, _Lookup):
    __tablename__ = "cost_centres"


class Godown(Base, _Lookup):
    __tablename__ = "godowns"


class VoucherType(Base, _Lookup):
    __tablename__ = "voucher_types"


class Voucher(Base, TallySourced):
    __tablename__ = "vouchers"
    __table_args__ = (Index("ix_vouchers_type_date", "voucher_type", "date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    voucher_number: Mapped[str] = mapped_column(String(64), default="", index=True)
    voucher_type: Mapped[str] = mapped_column(String(64), default="", index=True)
    date: Mapped[date | None] = mapped_column(Date, index=True)
    party_ledger: Mapped[str] = mapped_column(String(255), default="", index=True)
    narration: Mapped[str] = mapped_column(Text, default="")
    amount: Mapped[Decimal] = mapped_column(MONEY, default=Decimal("0"))
    reference: Mapped[str] = mapped_column(String(128), default="")
    remote_id: Mapped[str | None] = mapped_column(String(64), index=True)
    is_cancelled: Mapped[bool] = mapped_column(Boolean, default=False)

    ledger_entries: Mapped[list[VoucherLedgerEntry]] = relationship(
        back_populates="voucher", cascade="all, delete-orphan", lazy="selectin"
    )
    inventory_entries: Mapped[list[VoucherInventoryEntry]] = relationship(
        back_populates="voucher", cascade="all, delete-orphan", lazy="selectin"
    )


class VoucherLedgerEntry(Base):
    __tablename__ = "voucher_ledger_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    voucher_id: Mapped[int] = mapped_column(
        ForeignKey("vouchers.id", ondelete="CASCADE"), index=True
    )
    ledger_name: Mapped[str] = mapped_column(String(255), default="", index=True)
    amount: Mapped[Decimal] = mapped_column(MONEY, default=Decimal("0"))
    is_deemed_positive: Mapped[bool] = mapped_column(Boolean, default=False)
    cost_centre: Mapped[str | None] = mapped_column(String(255))

    voucher: Mapped[Voucher] = relationship(back_populates="ledger_entries")


class VoucherInventoryEntry(Base):
    __tablename__ = "voucher_inventory_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    voucher_id: Mapped[int] = mapped_column(
        ForeignKey("vouchers.id", ondelete="CASCADE"), index=True
    )
    stock_item: Mapped[str] = mapped_column(String(255), default="")
    godown: Mapped[str | None] = mapped_column(String(255))
    qty: Mapped[Decimal | None] = mapped_column(QTY)
    rate: Mapped[Decimal | None] = mapped_column(MONEY)
    amount: Mapped[Decimal | None] = mapped_column(MONEY)
    hsn: Mapped[str | None] = mapped_column(String(16))

    voucher: Mapped[Voucher] = relationship(back_populates="inventory_entries")


class Bill(Base, TallySourced):
    __tablename__ = "bills"
    __table_args__ = (
        UniqueConstraint("party_ledger", "bill_name", "direction", name="uq_bill_identity"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    party_ledger: Mapped[str] = mapped_column(String(255), index=True)
    bill_name: Mapped[str] = mapped_column(String(128))
    bill_date: Mapped[date | None] = mapped_column(Date)
    due_date: Mapped[date | None] = mapped_column(Date, index=True)
    opening_amount: Mapped[Decimal] = mapped_column(MONEY, default=Decimal("0"))
    pending_amount: Mapped[Decimal] = mapped_column(MONEY, default=Decimal("0"))
    direction: Mapped[str] = mapped_column(String(16), index=True)


class VoucherDraft(Base):
    """The outbox: what the UI wants Tally to create."""

    __tablename__ = "voucher_drafts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    payload_json: Mapped[str] = mapped_column(Text, default="{}")
    status: Mapped[str] = mapped_column(String(16), default="draft", index=True)
    validation_errors_json: Mapped[str] = mapped_column(Text, default="[]")
    generated_xml: Mapped[str | None] = mapped_column(Text)
    generated_ledger_xml: Mapped[str | None] = mapped_column(Text)
    dry_run: Mapped[bool] = mapped_column(Boolean, default=False)
    tally_voucher_number: Mapped[str | None] = mapped_column(String(64))
    tally_guid: Mapped[str | None] = mapped_column(String(64))
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    allow_duplicate: Mapped[bool] = mapped_column(Boolean, default=False)
    #: Set when a draft was pre-filled from OCR and a human should look at it
    #: before it is queued (plan §3.10).
    needs_review: Mapped[bool] = mapped_column(Boolean, default=False)
    review_reasons_json: Mapped[str] = mapped_column(Text, default="[]")
    created_by: Mapped[str | None] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class Attachment(Base):
    __tablename__ = "attachments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    draft_id: Mapped[str | None] = mapped_column(
        ForeignKey("voucher_drafts.id", ondelete="SET NULL"), index=True
    )
    file_name: Mapped[str] = mapped_column(String(255))
    mime: Mapped[str] = mapped_column(String(128), default="")
    path: Mapped[str] = mapped_column(String(512))
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    #: pending | running | done | failed | skipped (plan §3.10)
    ocr_status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    ocr_result_json: Mapped[str | None] = mapped_column(Text)
    ocr_model: Mapped[str | None] = mapped_column(String(128))
    ocr_duration_ms: Mapped[int | None] = mapped_column(Integer)
    ocr_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    direction: Mapped[str] = mapped_column(String(8), default="out")
    operation: Mapped[str] = mapped_column(String(64), default="")
    request_hash: Mapped[str] = mapped_column(String(32), default="")
    request_xml: Mapped[str | None] = mapped_column(Text)
    response_xml: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="ok")
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
