"""Master-data lookups served from the replica (plan §3.6)."""

from __future__ import annotations

import logging
from decimal import Decimal

from fastapi import APIRouter, Query

from ..db import models, repo
from ..services import ledger_lookup
from ..tally import envelopes as env
from .deps import SessionDep, SettingsDep, TallyDep
from .errors import ApiError
from .schemas import (
    GroupList,
    GroupOut,
    LedgerList,
    LedgerLookupResponse,
    LedgerOut,
    NamedList,
    NamedOut,
    StockItemList,
    StockItemOut,
    VendorLedgerCreate,
    VendorLedgerCreated,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["masters"])


@router.get("/ledgers", response_model=LedgerList, summary="Ledgers")
def ledgers(
    session: SessionDep,
    group: str | None = None,
    q: str | None = None,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> LedgerList:
    rows = repo.list_ledgers(session, group=group, q=q, limit=limit, offset=offset)
    return LedgerList(
        items=[LedgerOut.model_validate(r) for r in rows],
        total=repo.count_ledgers(session, group=group, q=q),
    )


@router.get("/ledgers/lookup", response_model=LedgerLookupResponse, summary="Find a vendor")
def lookup_ledger(
    session: SessionDep, name: str = Query(..., min_length=1)
) -> LedgerLookupResponse:
    """Exact match plus near-matches under Sundry Creditors (plan §3.8.1)."""
    result = ledger_lookup.lookup(session, name)
    return LedgerLookupResponse(
        query=name,
        found=result.found,
        ledger=LedgerOut.model_validate(result.ledger) if result.ledger else None,
        suggestions=[LedgerOut.model_validate(row) for row in result.suggestions],
        best_ratio=result.best_ratio,
        can_create=result.can_create,
    )


@router.post("/ledgers", response_model=VendorLedgerCreated, status_code=201,
             summary="Create a vendor ledger")
def create_ledger(
    payload: VendorLedgerCreate,
    session: SessionDep,
    tally: TallyDep,
    settings: SettingsDep,
) -> VendorLedgerCreated:
    """Create a Sundry Creditors ledger in Tally (plan §3.8.4).

    With ``TALLY_WRITE_ENABLED=false`` nothing is sent: the generated envelope
    comes back so it can be reviewed, exactly like a dry-run push.
    """
    name = payload.name.strip()
    result = ledger_lookup.lookup(session, name)
    if result.found:
        raise ApiError(409, "LEDGER_EXISTS", f"Ledger '{name}' already exists in Tally")
    if result.is_probable_duplicate and not payload.allow_duplicate:
        raise ApiError(
            409,
            "LEDGER_POSSIBLE_DUPLICATE",
            f"'{name}' looks like the existing vendor '{result.suggestions[0].name}'",
            {
                "suggestions": [row.name for row in result.suggestions],
                "best_ratio": result.best_ratio,
            },
        )

    fields = {
        "name": name,
        "parent": payload.parent or ledger_lookup.CREDITOR_GROUP,
        "gstin": payload.gstin or None,
        "gst_registration_type": payload.gst_registration_type
        or ("Regular" if payload.gstin else None),
        "mailing_name": payload.mailing_name or name,
        "address": [line for line in payload.address if line.strip()],
        "state": payload.state or None,
        "is_bill_wise": payload.is_bill_wise,
    }
    xml = env.import_ledger(company=tally.company, **fields)
    if not settings.tally_write_enabled:
        logger.info("dry run: ledger %r not sent to Tally", name)
        return VendorLedgerCreated(dry_run=True, generated_xml=xml, ledger=None)

    import_result = tally.import_ledger(**fields)
    if not import_result.ok or import_result.created < 1:
        raise ApiError(
            502,
            "LEDGER_IMPORT_FAILED",
            "; ".join(import_result.line_errors) or f"Tally did not create '{name}'",
        )
    row = repo.upsert_ledger(
        session,
        name=name,
        parent_group=fields["parent"],
        gstin=fields["gstin"],
        mailing_name=fields["mailing_name"],
        address=", ".join(fields["address"]) or None,
        state=fields["state"],
        gst_registration_type=fields["gst_registration_type"],
        is_bill_wise=fields["is_bill_wise"],
        opening_balance=Decimal("0"),
        closing_balance=Decimal("0"),
        source="talai",
        company_name=tally.company,
    )
    session.flush()
    return VendorLedgerCreated(
        dry_run=False, generated_xml=xml, ledger=LedgerOut.model_validate(row)
    )


@router.get("/groups", response_model=GroupList, summary="Groups")
def groups(session: SessionDep) -> GroupList:
    return GroupList(
        items=[
            GroupOut.model_validate(r) for r in repo.list_simple(session, models.Group)
        ]
    )


@router.get("/stock-items", response_model=StockItemList, summary="Stock items")
def stock_items(session: SessionDep) -> StockItemList:
    return StockItemList(
        items=[
            StockItemOut.model_validate(r)
            for r in repo.list_simple(session, models.StockItem)
        ]
    )


def _named(session, model) -> NamedList:
    return NamedList(
        items=[NamedOut.model_validate(r) for r in repo.list_simple(session, model)]
    )


@router.get("/cost-centres", response_model=NamedList, summary="Cost centres")
def cost_centres(session: SessionDep) -> NamedList:
    return _named(session, models.CostCentre)


@router.get("/godowns", response_model=NamedList, summary="Godowns")
def godowns(session: SessionDep) -> NamedList:
    return _named(session, models.Godown)


@router.get("/voucher-types", response_model=NamedList, summary="Voucher types")
def voucher_types(session: SessionDep) -> NamedList:
    return _named(session, models.VoucherType)
