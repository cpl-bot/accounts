"""Vendor ledger lookup and fuzzy matching (plan §3.8.1)."""
from __future__ import annotations

import pytest

from talai_middleware.db import models, repo
from talai_middleware.db.base import Database
from talai_middleware.services import ledger_lookup


@pytest.fixture
def session(settings):
    db = Database(settings.database_url)
    db.create_all()
    with db.session() as s:
        for name, parent in (
            ("Current Liabilities", ""),
            ("Sundry Creditors", "Current Liabilities"),
            ("Local Suppliers", "Sundry Creditors"),
            ("Maharashtra Suppliers", "Local Suppliers"),
            ("Sundry Debtors", "Current Assets"),
            ("Purchase Accounts", ""),
        ):
            repo.upsert_group(s, name=name, parent=parent)
        for name, group in (
            ("BioShield Medical & Co", "Sundry Creditors"),
            ("Sunrise Packaging Pvt Ltd", "Sundry Creditors"),
            # two levels below Sundry Creditors — must still be a candidate
            ("Deccan Traders Private Limited", "Maharashtra Suppliers"),
            ("Metro Hospital", "Sundry Debtors"),
            ("Purchase", "Purchase Accounts"),
        ):
            repo.upsert_ledger(s, name=name, parent_group=group)
        s.commit()
        yield s


class TestNormalise:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("Sunrise Packaging Pvt Ltd", "sunrise packaging"),
            ("SUNRISE PACKAGING PRIVATE LIMITED", "sunrise packaging"),
            ("Sunrise Packaging (P) Ltd.", "sunrise packaging p"),
            ("BioShield Medical & Co", "bioshield medical"),
            ("BioShield Medical and Company", "bioshield medical"),
            ("Deccan  Traders   LLP", "deccan traders"),
            ("", ""),
        ],
    )
    def test_normalise(self, raw: str, expected: str) -> None:
        assert ledger_lookup.normalise(raw) == expected

    def test_a_name_made_only_of_noise_tokens_survives(self) -> None:
        # Stripping everything would make every such name match every other.
        assert ledger_lookup.normalise("Ltd") == "ltd"


class TestCreditorPool:
    def test_walks_nested_subgroups(self, session) -> None:
        names = {row.name for row in ledger_lookup.creditor_ledgers(session)}
        assert names == {
            "BioShield Medical & Co",
            "Sunrise Packaging Pvt Ltd",
            "Deccan Traders Private Limited",
        }


class TestLookup:
    def test_exact_match_is_case_insensitive(self, session) -> None:
        result = ledger_lookup.lookup(session, "sunrise packaging pvt ltd")
        assert result.found is True
        assert result.ledger.name == "Sunrise Packaging Pvt Ltd"
        assert result.best_ratio == 1.0
        assert result.suggestions == []

    def test_exact_match_outside_sundry_creditors_is_still_found(self, session) -> None:
        """So validation can say WRONG_GROUP rather than NOT_FOUND."""
        result = ledger_lookup.lookup(session, "Metro Hospital")
        assert result.found is True
        assert result.ledger.parent_group == "Sundry Debtors"

    def test_near_match_suggests_the_existing_creditor(self, session) -> None:
        result = ledger_lookup.lookup(session, "Sunrise Packaging Private Limited")
        assert result.found is False
        assert [s.name for s in result.suggestions] == ["Sunrise Packaging Pvt Ltd"]
        assert result.best_ratio == 1.0

    def test_nested_subgroup_ledger_is_suggested(self, session) -> None:
        result = ledger_lookup.lookup(session, "Deccan Traders LLP")
        assert result.found is False
        assert [s.name for s in result.suggestions] == ["Deccan Traders Private Limited"]
        assert result.best_ratio == 1.0

    def test_unrelated_name_has_no_suggestions(self, session) -> None:
        result = ledger_lookup.lookup(session, "Zenith Chemicals")
        assert result.found is False
        assert result.suggestions == []
        assert result.best_ratio < 0.8

    def test_a_debtor_is_never_suggested(self, session) -> None:
        result = ledger_lookup.lookup(session, "Metro Hospitals")
        assert result.found is False
        assert result.suggestions == []

    def test_typo_is_a_probable_duplicate(self, session) -> None:
        result = ledger_lookup.lookup(session, "Bioshild Medical")
        assert result.found is False
        assert [s.name for s in result.suggestions] == ["BioShield Medical & Co"]
        assert result.best_ratio >= 0.95
        assert result.is_probable_duplicate is True
        assert result.can_create is True

    def test_a_merely_similar_name_is_suggested_without_a_duplicate_warning(
        self, session
    ) -> None:
        result = ledger_lookup.lookup(session, "Bioshield Medicals Group")
        assert [s.name for s in result.suggestions] == ["BioShield Medical & Co"]
        assert 0.8 <= result.best_ratio < 0.95
        assert result.is_probable_duplicate is False

    def test_blank_name_returns_nothing(self, session) -> None:
        result = ledger_lookup.lookup(session, "   ")
        assert result.found is False and result.suggestions == [] and result.best_ratio == 0.0

    def test_suggestions_are_capped_at_five_and_ordered(self, session) -> None:
        for index in range(8):
            repo.upsert_ledger(
                session, name=f"Northwind Traders {index}", parent_group="Sundry Creditors"
            )
        session.commit()
        result = ledger_lookup.lookup(session, "Northwind Traders 1")
        assert result.found is True  # exact
        result = ledger_lookup.lookup(session, "Northwind Traders")
        assert len(result.suggestions) == 5
        ratios = [
            ledger_lookup.ratio("Northwind Traders", s.name) for s in result.suggestions
        ]
        assert ratios == sorted(ratios, reverse=True)

    def test_deleted_ledgers_are_ignored(self, session) -> None:
        row = repo.ledger_by_name(session, "Sunrise Packaging Pvt Ltd")
        row.is_deleted = True
        session.commit()
        assert ledger_lookup.lookup(session, "Sunrise Packaging Pvt Ltd").found is False


def test_group_ancestry_handles_a_cycle(session) -> None:
    """A malformed replica must not hang the lookup."""
    repo.upsert_group(session, name="Loop A", parent="Loop B")
    repo.upsert_group(session, name="Loop B", parent="Loop A")
    session.commit()
    assert isinstance(ledger_lookup.creditor_ledgers(session), list)
    assert models.Ledger is not None
