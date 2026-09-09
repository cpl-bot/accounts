"""In-memory seed data for :class:`~talai_middleware.tally.fake.FakeTallyTransport`.

The shapes mirror what the parsers expect from a real TallyPrime, so the same
fixtures drive unit tests, route tests and ``scripts/seed_demo_data.py``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

COMPANY = "Acme Foods Pvt Ltd"


@dataclass
class FakeCompany:
    name: str
    guid: str
    starting_from: date
    books_from: date


@dataclass
class FakeGroup:
    name: str
    parent: str = ""
    primary_group: str = ""
    is_revenue: bool = False
    affects_gross_profit: bool = False
    alter_id: int = 1


@dataclass
class FakeLedger:
    name: str
    parent: str
    closing_balance: Decimal = Decimal("0")
    opening_balance: Decimal = Decimal("0")
    gstin: str | None = None
    state: str | None = None
    is_bill_wise: bool = False
    master_id: str = "0"
    alter_id: int = 1


@dataclass
class FakeStockItem:
    name: str
    parent: str = ""
    unit: str = "Nos"
    hsn: str | None = None
    gst_rate: Decimal | None = None
    closing_qty: Decimal = Decimal("0")
    closing_value: Decimal = Decimal("0")
    alter_id: int = 1


@dataclass
class FakeNamed:
    name: str
    parent: str = ""
    alter_id: int = 1


@dataclass
class FakeLedgerEntry:
    ledger_name: str
    amount: Decimal
    is_deemed_positive: bool
    cost_centre: str | None = None


@dataclass
class FakeInventoryEntry:
    stock_item: str
    quantity: Decimal
    rate: Decimal
    amount: Decimal
    godown: str | None = None
    hsn: str | None = None


@dataclass
class FakeVoucher:
    voucher_number: str
    voucher_type: str
    date: date
    party_ledger: str = ""
    narration: str = ""
    reference: str = ""
    remote_id: str | None = None
    guid: str = ""
    alter_id: int = 1000
    is_cancelled: bool = False
    ledger_entries: list[FakeLedgerEntry] = field(default_factory=list)
    inventory_entries: list[FakeInventoryEntry] = field(default_factory=list)


@dataclass
class FakeBill:
    party_ledger: str
    bill_name: str
    direction: str
    bill_date: date
    due_date: date
    opening_amount: Decimal
    pending_amount: Decimal


@dataclass
class FakeState:
    """Everything the fake Tally 'knows'."""

    companies: list[FakeCompany] = field(default_factory=list)
    groups: list[FakeGroup] = field(default_factory=list)
    ledgers: list[FakeLedger] = field(default_factory=list)
    stock_items: list[FakeStockItem] = field(default_factory=list)
    cost_centres: list[FakeNamed] = field(default_factory=list)
    godowns: list[FakeNamed] = field(default_factory=list)
    voucher_types: list[FakeNamed] = field(default_factory=list)
    vouchers: list[FakeVoucher] = field(default_factory=list)
    bills: list[FakeBill] = field(default_factory=list)
    next_alter_id: int = 2000

    def ledger(self, name: str) -> FakeLedger | None:
        return next((led for led in self.ledgers if led.name == name), None)

    def voucher_by_remote_id(self, remote_id: str) -> FakeVoucher | None:
        return next((v for v in self.vouchers if v.remote_id == remote_id), None)


def _purchase(
    number: str, day: int, month: int, party: str, base: str, tax: str, total: str
) -> FakeVoucher:
    return FakeVoucher(
        voucher_number=number,
        voucher_type="Purchase",
        date=date(2026, month, day),
        party_ledger=party,
        reference=f"INV/{number.split('/')[-1]}",
        narration="Goods purchased",
        guid=f"4f9d0e3a-0003-0000-0000-{number.split('/')[-1]:>012}",
        alter_id=1500 + day + month,
        ledger_entries=[
            FakeLedgerEntry(party, Decimal(total), False),
            FakeLedgerEntry("Purchase", -Decimal(base), True, "Procurement"),
            FakeLedgerEntry("IGST @ 18%", -Decimal(tax), True),
        ],
        inventory_entries=[
            FakeInventoryEntry("Nitrile Gloves", Decimal("10"), Decimal("450"),
                               -Decimal(base), "Main Store", "4015")
        ],
    )


def _sales(number: str, day: int, month: int, party: str, base: str, total: str) -> FakeVoucher:
    return FakeVoucher(
        voucher_number=number,
        voucher_type="Sales",
        date=date(2026, month, day),
        party_ledger=party,
        guid=f"4f9d0e3a-0004-0000-0000-{number.split('/')[-1]:>012}",
        alter_id=1600 + day + month,
        ledger_entries=[
            FakeLedgerEntry(party, -Decimal(total), True),
            FakeLedgerEntry("Sales", Decimal(base), False),
        ],
    )


def default_state() -> FakeState:
    """A small but realistic company: two months of trading."""
    return FakeState(
        companies=[
            FakeCompany(COMPANY, "4f9d0e3a-0001-0000-0000-000000000001",
                        date(2025, 4, 1), date(2025, 4, 1)),
            FakeCompany(f"{COMPANY} (Test)", "4f9d0e3a-0001-0000-0000-000000000002",
                        date(2025, 4, 1), date(2025, 4, 1)),
        ],
        groups=[
            FakeGroup("Current Liabilities", "", "Current Liabilities"),
            FakeGroup("Sundry Creditors", "Current Liabilities", "Current Liabilities"),
            # A nested creditor sub-group: the ledger lookup must walk into it.
            FakeGroup("Local Suppliers", "Sundry Creditors", "Current Liabilities"),
            FakeGroup("Current Assets", "", "Current Assets"),
            FakeGroup("Sundry Debtors", "Current Assets", "Current Assets"),
            FakeGroup("Cash-in-Hand", "Current Assets", "Current Assets"),
            FakeGroup("Bank Accounts", "Current Assets", "Current Assets"),
            FakeGroup("Duties & Taxes", "Current Liabilities", "Current Liabilities"),
            FakeGroup("Sales Accounts", "", "Sales Accounts", True, True),
            FakeGroup("Purchase Accounts", "", "Purchase Accounts", True, True),
            FakeGroup("Direct Expenses", "", "Direct Expenses", True, True),
            FakeGroup("Indirect Expenses", "", "Indirect Expenses", True, False),
            FakeGroup("Indirect Incomes", "", "Indirect Incomes", True, False),
        ],
        ledgers=[
            FakeLedger("BioShield Medical & Co", "Sundry Creditors", Decimal("-29875.00"),
                       Decimal("-12000.00"), "27AAAAA0000A1Z5", "Maharashtra", True, "412", 908),
            FakeLedger("Sunrise Packaging", "Sundry Creditors", Decimal("-18800.00"),
                       Decimal("0"), "27BBBBB1111B1Z6", "Maharashtra", True, "413", 909),
            FakeLedger("Deccan Traders Private Limited", "Local Suppliers", Decimal("-4200.00"),
                       Decimal("0"), "27DDDDD3333D1Z8", "Maharashtra", True, "415", 911),
            FakeLedger("Metro Hospital", "Sundry Debtors", Decimal("59000.00"),
                       Decimal("0"), "27CCCCC2222C1Z7", "Maharashtra", True, "414", 910),
            FakeLedger("Purchase", "Purchase Accounts", Decimal("41000.00"),
                       master_id="77", alter_id=121),
            FakeLedger("Sales", "Sales Accounts", Decimal("-95000.00"),
                       master_id="78", alter_id=122),
            FakeLedger("Freight Inward", "Direct Expenses", Decimal("3500.00"),
                       master_id="79", alter_id=123),
            FakeLedger("Office Rent", "Indirect Expenses", Decimal("24000.00"),
                       master_id="80", alter_id=124),
            FakeLedger("Interest Received", "Indirect Incomes", Decimal("-1500.00"),
                       master_id="81", alter_id=125),
            FakeLedger("IGST @ 18%", "Duties & Taxes", Decimal("7380.00"),
                       master_id="82", alter_id=126),
            FakeLedger("CGST @ 9%", "Duties & Taxes", Decimal("0"), master_id="83", alter_id=127),
            FakeLedger("SGST @ 9%", "Duties & Taxes", Decimal("0"), master_id="84", alter_id=128),
            FakeLedger("DISCOUNT", "Indirect Expenses", Decimal("0"),
                       master_id="85", alter_id=129),
            FakeLedger("Cash", "Cash-in-Hand", Decimal("18500.00"), master_id="86", alter_id=130),
            FakeLedger("HDFC Current A/c", "Bank Accounts", Decimal("412300.00"),
                       master_id="87", alter_id=131),
        ],
        stock_items=[
            FakeStockItem("Nitrile Gloves", "Consumables", "Box", "4015", Decimal("18"),
                          Decimal("120"), Decimal("54000.00"), 404),
            FakeStockItem("Corrugated Carton", "Packaging", "Nos", "4819", Decimal("12"),
                          Decimal("800"), Decimal("16000.00"), 405),
        ],
        cost_centres=[FakeNamed("Procurement"), FakeNamed("Administration")],
        godowns=[FakeNamed("Main Store"), FakeNamed("Cold Storage")],
        voucher_types=[
            FakeNamed("Purchase", "Purchase"),
            FakeNamed("Sales", "Sales"),
            FakeNamed("Payment", "Payment"),
            FakeNamed("Receipt", "Receipt"),
            FakeNamed("Journal", "Journal"),
        ],
        vouchers=[
            _purchase("PUR/26-27/0041", 12, 5, "BioShield Medical & Co",
                      "10000.00", "1800.00", "11800.00"),
            _purchase("PUR/26-27/0042", 10, 6, "BioShield Medical & Co",
                      "21825.00", "4050.00", "25875.00"),
            _purchase("PUR/26-27/0043", 18, 6, "Sunrise Packaging",
                      "16000.00", "2880.00", "18880.00"),
            _sales("SAL/26-27/0110", 20, 5, "Metro Hospital", "36000.00", "42480.00"),
            _sales("SAL/26-27/0111", 12, 6, "Metro Hospital", "50000.00", "59000.00"),
        ],
        bills=[
            FakeBill("BioShield Medical & Co", "INV/0041", "payable", date(2026, 5, 12),
                     date(2026, 6, 11), Decimal("11800.00"), Decimal("4000.00")),
            FakeBill("BioShield Medical & Co", "INV/0042", "payable", date(2026, 6, 10),
                     date(2026, 7, 9), Decimal("25875.00"), Decimal("25875.00")),
            FakeBill("Sunrise Packaging", "INV/0043", "payable", date(2026, 6, 18),
                     date(2026, 7, 18), Decimal("18880.00"), Decimal("18880.00")),
            FakeBill("Metro Hospital", "SAL/0110", "receivable", date(2026, 5, 20),
                     date(2026, 6, 19), Decimal("42480.00"), Decimal("12480.00")),
            FakeBill("Metro Hospital", "SAL/0111", "receivable", date(2026, 6, 12),
                     date(2026, 7, 12), Decimal("59000.00"), Decimal("59000.00")),
        ],
    )
