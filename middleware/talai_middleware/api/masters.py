"""Master-data lookups served from the replica (plan §3.6)."""

from __future__ import annotations

from fastapi import APIRouter, Query

from ..db import models, repo
from .deps import SessionDep
from .schemas import (
    GroupList,
    GroupOut,
    LedgerList,
    LedgerOut,
    NamedList,
    NamedOut,
    StockItemList,
    StockItemOut,
)

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
