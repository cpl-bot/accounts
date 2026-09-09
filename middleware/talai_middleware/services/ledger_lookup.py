"""Fuzzy vendor-ledger lookup (plan §3.8.1).

A bill's supplier name rarely matches a Tally ledger character for character:
"Sunrise Packaging Pvt Ltd" and "SUNRISE PACKAGING PRIVATE LIMITED" are the same
vendor. This module normalises both sides, scores them with
:class:`difflib.SequenceMatcher`, and returns the near-matches so the UI can ask
"did you mean…?" before a typo becomes a second vendor master.

Only ledgers **under Sundry Creditors** (at any depth) are candidates for a
suggestion. An *exact* match is looked up across all ledgers, so validation can
answer ``LEDGER_WRONG_GROUP`` for a name that exists but sits elsewhere, rather
than the misleading ``LEDGER_NOT_FOUND``.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import models

logger = logging.getLogger(__name__)

#: The root group a purchase party must live under.
CREDITOR_GROUP = "Sundry Creditors"
#: A suggestion is only worth showing above this similarity.
SUGGESTION_THRESHOLD = 0.8
#: At or above this, a *different* name is almost certainly the same vendor.
DUPLICATE_THRESHOLD = 0.95
MAX_SUGGESTIONS = 5

#: Legal-form and filler tokens that carry no identifying information.
NOISE_TOKENS = frozenset(
    {"pvt", "ltd", "private", "limited", "llp", "co", "company", "and"}
)
_PUNCTUATION = re.compile(r"[^0-9a-z]+")


def normalise(name: str) -> str:
    """Lower-case, drop punctuation, drop legal-form tokens, squeeze spaces.

    If a name consists of nothing *but* noise tokens the tokens are kept —
    otherwise every such name would normalise to the empty string and match
    every other one perfectly.
    """
    lowered = _PUNCTUATION.sub(" ", (name or "").lower())
    tokens = lowered.split()
    kept = [t for t in tokens if t not in NOISE_TOKENS]
    return " ".join(kept or tokens)


def ratio(left: str, right: str) -> float:
    """Similarity of two ledger names, 0.0–1.0, after normalisation."""
    a, b = normalise(left), normalise(right)
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


@dataclass
class LedgerLookupResult:
    """What ``GET /ledgers/lookup`` and the validation rules need."""

    found: bool = False
    ledger: models.Ledger | None = None
    suggestions: list[models.Ledger] = field(default_factory=list)
    best_ratio: float = 0.0

    @property
    def can_create(self) -> bool:
        """True when Talai may create this vendor (plan §3.8.2)."""
        return not self.found

    @property
    def is_probable_duplicate(self) -> bool:
        return not self.found and self.best_ratio >= DUPLICATE_THRESHOLD


def _group_children(session: Session) -> dict[str, list[str]]:
    children: dict[str, list[str]] = {}
    for row in session.scalars(select(models.Group)):
        children.setdefault(row.parent or "", []).append(row.name)
    return children


def creditor_group_names(session: Session) -> set[str]:
    """``Sundry Creditors`` and every group beneath it, however deep."""
    children = _group_children(session)
    found: set[str] = set()
    stack = [CREDITOR_GROUP]
    while stack:  # iterative, and `found` guards against a cyclic parent chain
        name = stack.pop()
        if name in found:
            continue
        found.add(name)
        stack.extend(children.get(name, []))
    return found


def creditor_ledgers(session: Session) -> list[models.Ledger]:
    """Live ledgers under Sundry Creditors, at any depth."""
    groups = creditor_group_names(session)
    stmt = select(models.Ledger).where(
        models.Ledger.is_deleted.is_(False), models.Ledger.parent_group.in_(groups)
    )
    return list(session.scalars(stmt.order_by(models.Ledger.name)))


def _exact(session: Session, name: str) -> models.Ledger | None:
    target = name.strip().lower()
    stmt = select(models.Ledger).where(models.Ledger.is_deleted.is_(False))
    return next((r for r in session.scalars(stmt) if r.name.lower() == target), None)


def lookup(session: Session, name: str) -> LedgerLookupResult:
    """Exact match plus up to five near-matches under Sundry Creditors."""
    cleaned = (name or "").strip()
    if not cleaned:
        return LedgerLookupResult()

    exact = _exact(session, cleaned)
    if exact is not None:
        return LedgerLookupResult(found=True, ledger=exact, best_ratio=1.0)

    scored = [
        (ratio(cleaned, row.name), row)
        for row in creditor_ledgers(session)
        if row.name.lower() != cleaned.lower()
    ]
    scored.sort(key=lambda pair: (-pair[0], pair[1].name))
    best = scored[0][0] if scored else 0.0
    suggestions = [row for score, row in scored if score >= SUGGESTION_THRESHOLD]
    logger.debug("ledger lookup %r: best ratio %.2f, %d suggestions", name, best, len(suggestions))
    return LedgerLookupResult(
        found=False,
        ledger=None,
        suggestions=suggestions[:MAX_SUGGESTIONS],
        best_ratio=round(best, 4),
    )
