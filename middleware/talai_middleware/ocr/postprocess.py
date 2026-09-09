"""Deterministic clean-up of a model's reading (plan §3.10).

Everything here is rule-based and tested: the language model is allowed to be
approximate, this module is not. It

* normalises the date formats Indian invoices actually use;
* validates the GSTIN's format *and* its check digit, demoting the confidence
  of one that fails rather than discarding the value a human can still fix;
* cross-checks the arithmetic — taxable + GST + other charges against the grand
  total — and moves every confidence up or the grand total's confidence down;
* maps the supplier's printed name onto a Sundry Creditors ledger.
"""

from __future__ import annotations

import logging
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from sqlalchemy.orm import Session

from ..services import ledger_lookup
from .schema import OcrResult

logger = logging.getLogger(__name__)

#: Arithmetic is considered to add up within one rupee.
ARITHMETIC_TOLERANCE = Decimal("1")
#: How much a clean cross-check raises every confidence.
CONFIDENCE_BONUS = 0.1
#: The ceiling a failed cross-check puts on ``grand_total``'s confidence.
GRAND_TOTAL_PENALTY = 0.5
#: A GSTIN that fails format or checksum cannot be trusted above this.
BAD_GSTIN_CONFIDENCE = 0.3

GSTIN_RE = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z][Z][0-9A-Z]$")
GSTIN_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"

_DATE_FORMATS = (
    "%Y-%m-%d",
    "%d/%m/%Y",
    "%d-%m-%Y",
    "%d.%m.%Y",
    "%d/%m/%y",
    "%d-%m-%y",
    "%d %b %Y",
    "%d %B %Y",
    "%d-%b-%Y",
    "%d-%B-%Y",
    "%b %d %Y",
    "%B %d %Y",
)
_DATE_CLEAN = re.compile(r"[,]+")
_WHITESPACE = re.compile(r"\s+")


def normalise_date(value: str | None) -> str | None:
    """``10/06/2026``, ``10-06-26``, ``10 Jun 2026`` → ``2026-06-10``.

    Day-first throughout: Indian invoices are dd/mm/yyyy, and a wrong guess
    here would silently post a voucher into the wrong month. Returns ``None``
    when nothing parses, so the caller can leave the field blank.
    """
    if not value:
        return None
    text = _WHITESPACE.sub(" ", _DATE_CLEAN.sub(" ", str(value))).strip()
    if not text:
        return None
    for fmt in _DATE_FORMATS:
        try:
            parsed = datetime.strptime(text, fmt).date()
        except ValueError:
            continue
        return parsed.isoformat()
    logger.debug("could not normalise date %r", value)
    return None


def gstin_checksum(gstin: str) -> str | None:
    """The 15th character a GSTIN's first 14 imply, or ``None`` if unusable."""
    body = (gstin or "").strip().upper()[:14]
    if len(body) != 14 or any(ch not in GSTIN_ALPHABET for ch in body):
        return None
    total = 0
    for index, char in enumerate(body):
        product = GSTIN_ALPHABET.index(char) * (2 if index % 2 else 1)
        total += product // 36 + product % 36
    return GSTIN_ALPHABET[(36 - total % 36) % 36]


def gstin_is_valid(gstin: str | None) -> bool:
    """15 characters in the right shape, with a correct check digit."""
    value = (gstin or "").strip().upper()
    if not GSTIN_RE.match(value):
        return False
    return gstin_checksum(value) == value[14]


def _decimal(value: float | int | str | None) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def arithmetic_holds(result: OcrResult) -> bool | None:
    """``taxable + CGST + SGST + IGST + other = grand total`` within ₹1.

    Returns ``None`` when the bill did not give us enough numbers to check.
    TDS is deliberately excluded: it is a deduction from what is *paid*, not a
    component of the invoice total.
    """
    fields = result.fields
    taxable = _decimal(fields.taxable_value)
    grand = _decimal(fields.grand_total)
    if taxable is None or grand is None:
        return None
    parts = [taxable]
    for value in (fields.cgst, fields.sgst, fields.igst, fields.other_charges):
        parts.append(_decimal(value) or Decimal("0"))
    return abs(sum(parts, Decimal("0")) - grand) <= ARITHMETIC_TOLERANCE


def _apply_arithmetic(result: OcrResult) -> None:
    holds = arithmetic_holds(result)
    if holds is None:
        return
    if holds:
        result.confidence = {
            name: min(1.0, round(value + CONFIDENCE_BONUS, 4))
            for name, value in result.confidence.items()
        }
        return
    current = result.confidence_of("grand_total", 1.0)
    result.confidence["grand_total"] = min(current, GRAND_TOTAL_PENALTY)
    logger.info("OCR arithmetic does not add up; grand_total confidence capped")


def _apply_gstin(result: OcrResult) -> None:
    gstin = (result.fields.supplier_gstin or "").strip().upper()
    if not gstin:
        return
    result.fields.supplier_gstin = gstin
    if gstin_is_valid(gstin):
        return
    result.confidence["supplier_gstin"] = min(
        result.confidence_of("supplier_gstin", 1.0), BAD_GSTIN_CONFIDENCE
    )
    logger.info("OCR read an invalid GSTIN %r; confidence lowered", gstin)


def _apply_party(session: Session, result: OcrResult) -> None:
    """Map the printed supplier name onto a Sundry Creditors ledger."""
    name = (result.fields.supplier_name or "").strip()
    if not name:
        result.confidence["party_ledger"] = 0.0
        return
    match = ledger_lookup.lookup(session, name)
    if match.found and match.ledger is not None:
        result.fields.party_ledger_name = match.ledger.name
        result.confidence["party_ledger"] = 1.0
        return
    if match.suggestions:
        result.fields.party_ledger_name = match.suggestions[0].name
        result.confidence["party_ledger"] = match.best_ratio
        return
    result.fields.party_ledger_name = None
    result.confidence["party_ledger"] = 0.0


def postprocess(session: Session, result: OcrResult) -> OcrResult:
    """Run every rule, in order, and return the same (mutated) result."""
    result.fields.invoice_date = normalise_date(result.fields.invoice_date)
    result.fields.due_date = normalise_date(result.fields.due_date)
    _apply_gstin(result)
    _apply_arithmetic(result)
    _apply_party(session, result)
    return result


def as_of(result: OcrResult) -> date | None:
    """The invoice date as a ``date``, if it normalised."""
    value = result.fields.invoice_date
    return datetime.strptime(value, "%Y-%m-%d").date() if value else None
