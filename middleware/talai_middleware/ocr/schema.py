"""The structured result an OCR provider must return (plan §3.10).

These models are also the **contract sent to the LLM**: ``ocr_json_schema()``
exports them as JSON Schema, which Ollama turns into a grammar so the model
cannot answer with prose.

Money and quantities are ``float`` rather than ``Decimal`` on purpose: the
exported schema has to be a plain ``{"type": "number"}`` that a grammar can
enforce, and a language model's output is an estimate anyway. Everything that
must be exact — draft totals, validation — converts to ``Decimal`` at the
boundary in :mod:`talai_middleware.ocr.postprocess`.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

#: Fields whose confidence decides whether a draft ``needs_review`` (§3.10).
KEY_FIELDS = ("supplier_name", "invoice_number", "invoice_date", "grand_total")

#: Set by post-processing, never by the model, so it is stripped from the
#: schema the LLM is given.
DERIVED_FIELDS = ("party_ledger_name",)


class OcrLineItem(BaseModel):
    description: str | None = None
    hsn: str | None = None
    quantity: float | None = None
    rate: float | None = None
    amount: float | None = None


class OcrFields(BaseModel):
    """What we ask the model to read off a purchase bill."""

    supplier_name: str | None = None
    supplier_gstin: str | None = None
    invoice_number: str | None = None
    invoice_date: str | None = None
    due_date: str | None = None
    place_of_supply: str | None = None
    line_items: list[OcrLineItem] = Field(default_factory=list)
    taxable_value: float | None = None
    cgst: float | None = None
    sgst: float | None = None
    igst: float | None = None
    tds: float | None = None
    other_charges: float | None = None
    grand_total: float | None = None
    narration: str | None = None
    #: Filled by post-processing from the ledger lookup, not by the model.
    party_ledger_name: str | None = None


class OcrResult(BaseModel):
    """One reading of one document."""

    fields: OcrFields = Field(default_factory=OcrFields)
    #: Per-field self-assessed confidence, 0.0–1.0.
    confidence: dict[str, float] = Field(default_factory=dict)
    raw_text: str = ""
    #: Filled by the provider, not the model.
    model: str | None = None
    duration_ms: int | None = None
    pages: int | None = None

    def confidence_of(self, field: str, default: float = 0.0) -> float:
        return float(self.confidence.get(field, default))

    def low_confidence_fields(self, minimum: float) -> list[str]:
        """Key fields the model was not sure about (plan §3.10)."""
        return [name for name in KEY_FIELDS if self.confidence_of(name) < minimum]


def ocr_json_schema() -> dict[str, Any]:
    """``OcrResult`` as JSON Schema, for Ollama's ``format`` parameter.

    Provider-side bookkeeping (``model``, ``duration_ms``, ``pages``) and the
    derived ledger name are removed: asking the model for them would only give
    it a chance to hallucinate.
    """
    schema = OcrResult.model_json_schema()
    for name in ("model", "duration_ms", "pages"):
        schema.get("properties", {}).pop(name, None)
    definitions = schema.get("$defs", {})
    for name in DERIVED_FIELDS:
        definitions.get("OcrFields", {}).get("properties", {}).pop(name, None)
    return schema
