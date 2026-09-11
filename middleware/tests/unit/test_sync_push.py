"""Push sync: outbox → Tally (plan §3.4). Dry run by default."""
from __future__ import annotations

from datetime import date

import pytest

from talai_middleware.db import repo
from talai_middleware.db.base import Database
from talai_middleware.services import sync_push
from talai_middleware.services.sync_pull import SyncPuller
from talai_middleware.tally.client import TallyClient
from talai_middleware.tally.fake import FakeTallyTransport

PAYLOAD = {
    "voucher_type": "Purchase",
    "voucher_date": "2026-06-10",
    "bill_date": "2026-06-10",
    "due_date": "2026-07-09",
    "supplier_invoice_no": "INV/BSM/7777",
    "cost_centre": "Procurement",
    "party": {"ledger_name": "BioShield Medical & Co", "gstin": "27AAAAA0000A1Z5"},
    "purchase_ledger": "Purchase",
    "items": [
        {"stock_item": "Nitrile Gloves", "godown": "Main Store",
         "quantity": "50", "rate": "450", "hsn": "4015"}
    ],
    "tax_lines": [{"ledger_name": "IGST @ 18%", "amount": "4050.00"}],
    "totals": {"taxable_value": "22500.00", "sub_total": "22500.00",
               "gst": "4050.00", "grand_total": "26550.00"},
}


@pytest.fixture
def env(settings):
    """A replica synced from the fake Tally plus a live client onto the same fake."""
    database = Database(settings.database_url)
    database.create_all()
    transport = FakeTallyTransport()
    client = TallyClient(transport, company="Acme Foods Pvt Ltd")
    session = database.new_session()
    SyncPuller(session, client, settings).pull_masters()
    session.commit()
    yield session, client, transport, settings
    session.close()


def queue_draft(session, payload: dict | None = None) -> str:
    draft = repo.create_draft(session, payload or PAYLOAD)
    draft.status = "queued"
    session.commit()
    return draft.id


def test_dry_run_stores_xml_and_writes_nothing_to_tally(env) -> None:
    session, client, transport, settings = env
    draft_id = queue_draft(session)
    before = len(transport.state.vouchers)

    run, results = sync_push.push(session, client, settings)
    session.commit()

    assert run.kind == "push"
    assert [r.status for r in results] == ["validated"]
    assert results[0].dry_run is True
    draft = repo.get_draft(session, draft_id)
    assert draft.status == "validated"
    assert draft.dry_run is True
    assert "<REMOTEID>" in draft.generated_xml
    assert draft_id in draft.generated_xml
    assert len(transport.state.vouchers) == before, "dry run must not create a voucher"


def test_live_push_creates_a_voucher_and_reads_it_back(env) -> None:
    session, client, transport, settings = env
    settings = settings.model_copy(update={"tally_write_enabled": True})
    draft_id = queue_draft(session)

    _run, results = sync_push.push(session, client, settings)
    session.commit()

    assert results[0].status == "committed"
    assert results[0].voucher_number
    draft = repo.get_draft(session, draft_id)
    assert draft.status == "committed"
    assert draft.tally_voucher_number == results[0].voucher_number
    assert draft.tally_guid, "read-back by REMOTEID should have found the GUID"
    assert transport.state.voucher_by_remote_id(draft_id) is not None


def test_backdated_live_push_reads_back_from_its_fiscal_year(env) -> None:
    session, client, transport, settings = env
    settings = settings.model_copy(update={"tally_write_enabled": True})
    draft_id = queue_draft(
        session,
        dict(
            PAYLOAD,
            voucher_date="2025-03-31",
            bill_date="2025-03-31",
            due_date="2025-04-29",
        ),
    )

    _run, results = sync_push.push(session, client, settings)
    session.commit()

    assert results[0].status == "committed"
    draft = repo.get_draft(session, draft_id)
    assert draft.tally_guid, "backdated read-back should use the voucher's fiscal year"
    voucher_requests = [request for request in transport.requests if "TalaiVoucher" in request]
    assert voucher_requests
    assert "<SVFROMDATE>20240401</SVFROMDATE>" in voucher_requests[-1]
    assert "<SVTODATE>20250331</SVTODATE>" in voucher_requests[-1]


def test_invalid_draft_fails_without_touching_tally(env) -> None:
    session, client, transport, settings = env
    settings = settings.model_copy(update={"tally_write_enabled": True})
    bad = dict(PAYLOAD, party={"ledger_name": "Ghost Supplier"})
    draft_id = queue_draft(session, bad)
    before = len(transport.state.vouchers)

    _run, results = sync_push.push(session, client, settings)
    session.commit()

    assert results[0].status == "failed"
    assert "LEDGER_NOT_FOUND" in [e.code for e in results[0].errors]
    assert repo.get_draft(session, draft_id).status == "failed"
    assert len(transport.state.vouchers) == before


def test_batch_size_limits_a_run(env) -> None:
    session, client, settings = env[0], env[1], env[3]
    settings = settings.model_copy(update={"push_batch_size": 2})
    for index in range(4):
        queue_draft(session, dict(PAYLOAD, supplier_invoice_no=f"INV/BATCH/{index}"))
    _run, results = sync_push.push(session, client, settings)
    session.commit()
    assert len(results) == 2
    assert len(repo.list_drafts(session, status="queued")) == 2


def test_only_the_requested_drafts_are_pushed(env) -> None:
    session, client, settings = env[0], env[1], env[3]
    first = queue_draft(session, dict(PAYLOAD, supplier_invoice_no="INV/ONE"))
    queue_draft(session, dict(PAYLOAD, supplier_invoice_no="INV/TWO"))
    _run, results = sync_push.push(session, client, settings, draft_ids=[first])
    session.commit()
    assert [r.draft_id for r in results] == [first]


def test_repushing_a_committed_draft_is_a_no_op(env) -> None:
    session, client, transport, settings = env
    settings = settings.model_copy(update={"tally_write_enabled": True})
    draft_id = queue_draft(session)
    sync_push.push(session, client, settings)
    session.commit()
    count = len(transport.state.vouchers)

    draft = repo.get_draft(session, draft_id)
    draft.status = "queued"
    session.commit()
    _run, results = sync_push.push(session, client, settings)
    session.commit()

    assert results[0].status == "committed"
    assert len(transport.state.vouchers) == count, "REMOTEID must make the push idempotent"


def test_line_errors_from_tally_mark_the_draft_failed(env, monkeypatch) -> None:
    session, client, _transport, settings = env
    settings = settings.model_copy(update={"tally_write_enabled": True})
    queue_draft(session)

    from talai_middleware.tally.parsers import ImportResult

    monkeypatch.setattr(
        client, "import_voucher",
        lambda voucher: ImportResult(created=0, errors=1,
                                     line_errors=["Line 1: Could not find Ledger 'X'"]),
    )
    _run, results = sync_push.push(session, client, settings)
    session.commit()
    assert results[0].status == "failed"
    assert results[0].errors[0].code == "TALLY_IMPORT_FAILED"


def test_build_voucher_maps_the_payload_onto_tally_entries(env) -> None:
    from talai_middleware.api.schemas import DraftPurchaseBill

    payload = DraftPurchaseBill.model_validate(PAYLOAD)
    voucher = sync_push.build_voucher("draft-42", payload, voucher_date=date(2026, 6, 10))
    assert voucher.remote_id == "draft-42"
    assert voucher.party_ledger == "BioShield Medical & Co"
    assert voucher.purchase_ledger == "Purchase"
    assert voucher.is_balanced()
    party_line = voucher.ledger_entries[0]
    assert party_line.is_debit is False
    assert party_line.bill_allocations[0].name == "INV/BSM/7777"
    assert party_line.bill_allocations[0].bill_type == "New Ref"
    assert voucher.inventory_entries[0].stock_item == "Nitrile Gloves"


# --------------------------------------------------------------------------
# Vendor ledger creation during push (plan §3.8.3)
# --------------------------------------------------------------------------

NEW_PARTY = "Zenith Chemicals"


def new_vendor_payload(**party_extra) -> dict:
    return dict(
        PAYLOAD,
        supplier_invoice_no="INV/ZEN/0001",
        party={
            "ledger_name": NEW_PARTY,
            "create_if_missing": True,
            "gstin": "27ZZZZZ9999Z1Z9",
            "billing_address": "9 Chemical Lane, Pune",
            "source_of_supply": "Maharashtra",
            **party_extra,
        },
    )


def ledger_requests(transport) -> list[str]:
    return [xml for xml in transport.requests if "<LEDGER " in xml]


def voucher_requests(transport) -> list[str]:
    return [xml for xml in transport.requests if "<VOUCHER " in xml]


def test_dry_run_stores_the_ledger_envelope_and_sends_nothing(env) -> None:
    session, client, transport, settings = env
    draft_id = queue_draft(session, new_vendor_payload())

    _run, results = sync_push.push(session, client, settings)
    session.commit()

    draft = repo.get_draft(session, draft_id)
    assert results[0].status == "validated" and results[0].dry_run is True
    assert draft.generated_ledger_xml is not None
    assert "<PARENT>Sundry Creditors</PARENT>" in draft.generated_ledger_xml
    assert f"<REMOTEID>{draft_id}-party</REMOTEID>" in draft.generated_ledger_xml
    assert "<GSTIN>27ZZZZZ9999Z1Z9</GSTIN>" in draft.generated_ledger_xml
    assert "<ADDRESS>9 Chemical Lane, Pune</ADDRESS>" in draft.generated_ledger_xml
    assert draft.generated_xml is not None
    assert ledger_requests(transport) == [] and voucher_requests(transport) == []


def test_live_push_creates_the_ledger_before_the_voucher(env) -> None:
    session, client, transport, settings = env
    settings = settings.model_copy(update={"tally_write_enabled": True})
    draft_id = queue_draft(session, new_vendor_payload())

    _run, results = sync_push.push(session, client, settings)
    session.commit()

    assert results[0].status == "committed"
    assert transport.state.ledger(NEW_PARTY) is not None
    assert transport.state.voucher_by_remote_id(draft_id) is not None
    # order matters: the ledger request must precede the voucher request
    writes = [i for i, xml in enumerate(transport.requests) if "IMPORTDATA" in xml]
    assert "<LEDGER " in transport.requests[writes[0]]
    assert "<VOUCHER " in transport.requests[writes[1]]

    replica = repo.ledger_by_name(session, NEW_PARTY)
    assert replica is not None
    assert replica.parent_group == "Sundry Creditors"
    assert replica.source == "talai"
    assert replica.gstin == "27ZZZZZ9999Z1Z9"


def test_a_failed_ledger_create_fails_the_draft_before_any_voucher_is_sent(env) -> None:
    session, client, transport, settings = env
    settings = settings.model_copy(update={"tally_write_enabled": True})
    # Tally already has the name, but our replica does not: exactly the race
    # the ledger step exists to survive.
    transport.state.ledgers.append(
        type(transport.state.ledgers[0])(name=NEW_PARTY, parent="Sundry Creditors")
    )
    draft_id = queue_draft(session, new_vendor_payload())

    _run, results = sync_push.push(session, client, settings)
    session.commit()

    assert results[0].status == "failed"
    assert [e.code for e in results[0].errors] == ["LEDGER_IMPORT_FAILED"]
    assert "already exists" in results[0].errors[0].message
    assert repo.get_draft(session, draft_id).status == "failed"
    assert voucher_requests(transport) == []
    assert repo.ledger_by_name(session, NEW_PARTY) is None


def test_an_existing_party_never_triggers_a_ledger_import(env) -> None:
    session, client, transport, settings = env
    settings = settings.model_copy(update={"tally_write_enabled": True})
    payload = dict(PAYLOAD)
    payload["party"] = dict(PAYLOAD["party"], create_if_missing=True)
    queue_draft(session, payload)

    _run, results = sync_push.push(session, client, settings)
    session.commit()

    assert results[0].status == "committed"
    assert ledger_requests(transport) == []


def test_build_ledger_maps_the_party_onto_the_master(env) -> None:
    session = env[0]
    from talai_middleware.api.schemas import DraftPurchaseBill

    payload = DraftPurchaseBill.model_validate(new_vendor_payload())
    fields = sync_push.build_ledger("draft-77", payload)
    assert fields["name"] == NEW_PARTY
    assert fields["parent"] == "Sundry Creditors"
    assert fields["remote_id"] == "draft-77-party"
    assert fields["state"] == "Maharashtra"
    assert fields["mailing_name"] == NEW_PARTY
    assert fields["is_bill_wise"] is True
    assert session is not None
