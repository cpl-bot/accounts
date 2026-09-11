"""Replica vouchers and open bills (plan §3.6)."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Query

from ..db import repo
from ..services import aggregates
from .deps import SessionDep
from .errors import ApiError
from .schemas import (
    BillList,
    BillOut,
    PartyBillRanking,
    PartyBillRankingList,
    VoucherDetail,
    VoucherList,
    VoucherSummary,
)

router = APIRouter(tags=["vouchers"])


@router.get("/vouchers", response_model=VoucherList, summary="Vouchers from the replica")
def vouchers(
    session: SessionDep,
    type: str | None = None,
    from_: date | None = Query(None, alias="from"),
    to: date | None = None,
    party: str | None = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> VoucherList:
    rows = repo.list_vouchers(
        session, voucher_type=type, date_from=from_, date_to=to, party=party,
        limit=limit, offset=offset,
    )
    return VoucherList(
        items=[VoucherSummary.model_validate(r) for r in rows],
        total=repo.count_vouchers(
            session, voucher_type=type, date_from=from_, date_to=to, party=party
        ),
    )


@router.get("/vouchers/{voucher_id}", response_model=VoucherDetail, summary="One voucher")
def voucher(voucher_id: int, session: SessionDep) -> VoucherDetail:
    row = repo.get_voucher(session, voucher_id)
    if row is None:
        raise ApiError(404, "NOT_FOUND", f"Voucher {voucher_id} is not in the replica")
    return VoucherDetail.model_validate(row)


@router.get("/bills", response_model=BillList, summary="Open bills with aging buckets")
def bills(
    session: SessionDep,
    direction: str = Query("payable", pattern="^(payable|receivable)$"),
    as_on: date | None = None,
    party: str | None = None,
) -> BillList:
    as_on = as_on or date.today()
    rows = repo.list_bills(session, direction=direction, as_on=as_on, party=party)
    return BillList(
        items=[BillOut.model_validate(r) for r in rows],
        buckets=aggregates.aging_buckets(session, direction, as_on, party=party),
        total_pending=repo.sum_pending_bills(
            session, direction, as_on=as_on, party=party
        ),
    )


@router.get(
    "/bills/by-party",
    response_model=PartyBillRankingList,
    summary="Open bills ranked by party outstanding",
)
def bills_by_party(
    session: SessionDep,
    direction: str = Query("payable", pattern="^(payable|receivable)$"),
    as_on: date | None = None,
) -> PartyBillRankingList:
    as_on = as_on or date.today()
    return PartyBillRankingList(
        items=[
            PartyBillRanking(
                party_ledger=party,
                total_pending=total_pending,
                open_bill_count=open_bill_count,
            )
            for party, total_pending, open_bill_count in repo.rank_bills_by_party(
                session, direction=direction, as_on=as_on
            )
        ]
    )
