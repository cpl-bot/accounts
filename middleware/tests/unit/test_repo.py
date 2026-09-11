"""Repository primitives that the sync and API layers both rely on."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from talai_middleware.db import repo
from talai_middleware.db.base import Database


@pytest.fixture
def session(settings):
    db = Database(settings.database_url)
    db.create_all()
    s = db.new_session()
    yield s
    s.close()


def _entries(ledger: str, amount: str) -> list[dict]:
    return [{"ledger_name": ledger, "amount": Decimal(amount), "is_deemed_positive": False}]


class TestUpsertVoucher:
    def test_same_number_in_two_financial_years_stays_two_vouchers(self, session) -> None:
        """TallyPrime restarts numbering every FY, so the fallback key needs date."""
        repo.upsert_voucher(
            session,
            voucher_number="1",
            voucher_type="Sales",
            voucher_date=date(2025, 4, 10),
            party_ledger="A",
            amount=Decimal("100.00"),
            ledger_entries=_entries("Sales Accounts", "100.00"),
        )
        session.commit()
        repo.upsert_voucher(
            session,
            voucher_number="1",
            voucher_type="Sales",
            voucher_date=date(2026, 4, 10),
            party_ledger="B",
            amount=Decimal("500.00"),
            ledger_entries=_entries("Sales Accounts", "500.00"),
        )
        session.commit()

        rows = repo.list_vouchers(session, voucher_type="Sales")
        assert len(rows) == 2
        by_date = {r.date: r for r in rows}
        assert by_date[date(2025, 4, 10)].party_ledger == "A"
        assert by_date[date(2025, 4, 10)].amount == Decimal("100.00")
        assert by_date[date(2026, 4, 10)].party_ledger == "B"
        assert by_date[date(2026, 4, 10)].amount == Decimal("500.00")
        # Neither voucher lost its child lines to the other's upsert.
        assert len(by_date[date(2025, 4, 10)].ledger_entries) == 1
        assert len(by_date[date(2026, 4, 10)].ledger_entries) == 1

    def test_same_number_type_and_date_updates_in_place(self, session) -> None:
        first = repo.upsert_voucher(
            session,
            voucher_number="7",
            voucher_type="Sales",
            voucher_date=date(2026, 4, 10),
            party_ledger="A",
            amount=Decimal("100.00"),
            ledger_entries=_entries("Sales Accounts", "100.00"),
        )
        session.commit()
        first_id = first.id

        again = repo.upsert_voucher(
            session,
            voucher_number="7",
            voucher_type="Sales",
            voucher_date=date(2026, 4, 10),
            party_ledger="A revised",
            amount=Decimal("250.00"),
            ledger_entries=_entries("Sales Accounts", "250.00"),
        )
        session.commit()

        assert again.id == first_id
        rows = repo.list_vouchers(session, voucher_type="Sales")
        assert len(rows) == 1
        assert rows[0].party_ledger == "A revised"
        assert rows[0].amount == Decimal("250.00")
        assert [e.amount for e in rows[0].ledger_entries] == [Decimal("250.00")]

    def test_guid_match_wins_over_the_natural_key(self, session) -> None:
        """A renumbered/redated voucher is still matched by its GUID."""
        row = repo.upsert_voucher(
            session,
            voucher_number="1",
            voucher_type="Sales",
            voucher_date=date(2026, 4, 10),
            party_ledger="A",
            amount=Decimal("100.00"),
            tally_guid="guid-1",
        )
        session.commit()
        row_id = row.id

        moved = repo.upsert_voucher(
            session,
            voucher_number="2",
            voucher_type="Sales",
            voucher_date=date(2026, 5, 1),
            party_ledger="A",
            amount=Decimal("100.00"),
            tally_guid="guid-1",
        )
        session.commit()

        assert moved.id == row_id
        assert len(repo.list_vouchers(session, voucher_type="Sales")) == 1


class TestPendingBills:
    def test_list_bills_filters_party_case_insensitively(self, session) -> None:
        repo.replace_bills(
            session,
            "payable",
            [
                {
                    "party_ledger": "Acme Supplies",
                    "bill_name": "ACME/1",
                    "pending_amount": Decimal("100.00"),
                },
                {
                    "party_ledger": "Other Vendor",
                    "bill_name": "OTHER/1",
                    "pending_amount": Decimal("200.00"),
                },
            ],
        )
        session.commit()

        assert [b.bill_name for b in repo.list_bills(session, "payable", party="supplies")] == [
            "ACME/1"
        ]
        assert repo.list_bills(session, "payable", party="missing") == []

    def test_rank_bills_by_party_orders_amount_then_name_and_allows_empty_direction(
        self, session
    ) -> None:
        repo.replace_bills(
            session,
            "payable",
            [
                {"party_ledger": "Zulu", "bill_name": "Z/1", "pending_amount": Decimal("300")},
                {"party_ledger": "Alpha", "bill_name": "A/1", "pending_amount": Decimal("300")},
                {"party_ledger": "Zulu", "bill_name": "Z/2", "pending_amount": Decimal("100")},
            ],
        )
        repo.replace_bills(
            session,
            "receivable",
            [{"party_ledger": "Customer", "bill_name": "C/1", "pending_amount": Decimal("500")}],
        )
        session.commit()

        assert repo.rank_bills_by_party(session, "payable") == [
            ("Zulu", Decimal("400.00"), 2),
            ("Alpha", Decimal("300.00"), 1),
        ]
        assert repo.rank_bills_by_party(session, None) == [
            ("Customer", Decimal("500.00"), 1),
            ("Zulu", Decimal("400.00"), 2),
            ("Alpha", Decimal("300.00"), 1),
        ]

    def test_sum_pending_bills_honours_as_on_like_list_bills(self, session) -> None:
        repo.replace_bills(
            session,
            "payable",
            [
                {
                    "party_ledger": "Vendor A",
                    "bill_name": "INV/1",
                    "bill_date": date(2026, 5, 1),
                    "due_date": date(2026, 6, 1),
                    "pending_amount": Decimal("100.00"),
                },
                {
                    "party_ledger": "Vendor B",
                    "bill_name": "INV/2",
                    "bill_date": date(2026, 8, 1),
                    "due_date": date(2026, 9, 1),
                    "pending_amount": Decimal("400.00"),
                },
            ],
        )
        session.commit()

        as_on = date(2026, 6, 30)
        items = repo.list_bills(session, "payable", as_on=as_on)
        assert [b.bill_name for b in items] == ["INV/1"]
        assert repo.sum_pending_bills(session, "payable", as_on=as_on) == Decimal("100.00")
        # Without as_on the sum still covers every open bill.
        assert repo.sum_pending_bills(session, "payable") == Decimal("500.00")
