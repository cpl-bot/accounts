"""Tests for the transports (plan §3.1). No test may touch a real network."""
from __future__ import annotations

import httpx
import pytest
import respx

from talai_middleware.tally import parsers as P
from talai_middleware.tally.errors import TallyTimeout, TallyUnreachable
from talai_middleware.tally.fake import FakeTallyTransport, ForbiddenTallyAction
from talai_middleware.tally.transport import HttpxTransport

PING = "<ENVELOPE><HEADER><TALLYREQUEST>Export</TALLYREQUEST></HEADER></ENVELOPE>"


class TestHttpxTransport:
    @respx.mock
    def test_posts_xml_and_returns_body(self) -> None:
        route = respx.post("http://tally.local:9000").mock(
            return_value=httpx.Response(200, text="<ENVELOPE><A/></ENVELOPE>")
        )
        transport = HttpxTransport("tally.local", 9000)
        assert transport.send(PING) == "<ENVELOPE><A/></ENVELOPE>"
        request = route.calls.last.request
        assert request.headers["content-type"].startswith("text/xml")
        assert request.content.decode() == PING

    @respx.mock
    def test_decodes_utf16_payload(self) -> None:
        body = '<?xml version="1.0" encoding="UTF-16"?><ENVELOPE><A>₹</A></ENVELOPE>'
        respx.post("http://tally.local:9000").mock(
            return_value=httpx.Response(200, content=body.encode("utf-16"))
        )
        out = HttpxTransport("tally.local", 9000).send(PING)
        assert "₹" in P.decode_response(out)

    @respx.mock
    def test_connect_error_becomes_tally_unreachable(self) -> None:
        respx.post("http://tally.local:9000").mock(
            side_effect=httpx.ConnectError("refused")
        )
        with pytest.raises(TallyUnreachable):
            HttpxTransport("tally.local", 9000).send(PING)

    @respx.mock
    def test_timeout_becomes_tally_timeout(self) -> None:
        respx.post("http://tally.local:9000").mock(side_effect=httpx.ReadTimeout("slow"))
        with pytest.raises(TallyTimeout):
            HttpxTransport("tally.local", 9000).send(PING)

    @respx.mock
    def test_http_error_status_becomes_unreachable(self) -> None:
        respx.post("http://tally.local:9000").mock(return_value=httpx.Response(500))
        with pytest.raises(TallyUnreachable, match="500"):
            HttpxTransport("tally.local", 9000).send(PING)


class TestFakeTransportExports:
    def test_lists_seeded_companies(self, fake_transport: FakeTallyTransport) -> None:
        from talai_middleware.tally import envelopes as env

        companies = P.parse_companies(fake_transport.send(env.list_companies()))
        assert [c.name for c in companies] == [c.name for c in fake_transport.state.companies]

    def test_ledger_collection(self, fake_transport: FakeTallyTransport) -> None:
        from talai_middleware.tally import envelopes as env

        ledgers = P.parse_ledgers(fake_transport.send(env.collection("Ledger")))
        assert "BioShield Medical & Co" in [ledger.name for ledger in ledgers]

    def test_bare_group_collection_does_not_return_fetchlist_fields(
        self, fake_transport: FakeTallyTransport
    ) -> None:
        from talai_middleware.tally import envelopes as env

        bare_group_xml = env.collection("Group").replace(
            "<ID>List of Groups</ID>", "<ID>Group</ID>"
        )
        groups = P.parse_groups(fake_transport.send(bare_group_xml))
        assert groups
        assert all(not group.parent and not group.affects_gross_profit for group in groups)

    def test_unknown_collection_returns_status_zero(
        self, fake_transport: FakeTallyTransport
    ) -> None:
        from talai_middleware.tally import envelopes as env
        from talai_middleware.tally.errors import TallyResponseError

        with pytest.raises(TallyResponseError):
            P.parse_xml(P.decode_response(fake_transport.send(env.collection("Nonsense"))))

    def test_day_book_report_is_rejected(self, fake_transport: FakeTallyTransport) -> None:
        from talai_middleware.tally import envelopes as env
        from talai_middleware.tally.errors import TallyResponseError

        with pytest.raises(TallyResponseError, match="Day Book report is unsupported"):
            P.parse_xml(P.decode_response(fake_transport.send(env.report("Day Book"))))

    def test_bill_report_is_rejected_in_favour_of_data_request(
        self, fake_transport: FakeTallyTransport
    ) -> None:
        from talai_middleware.tally import envelopes as env
        from talai_middleware.tally.errors import TallyResponseError

        with pytest.raises(TallyResponseError, match="Bills Payable.*Data"):
            P.parse_xml(P.decode_response(fake_transport.send(env.report("Bills Payable"))))

    def test_bounded_voucher_collection_is_filtered_by_fake(self) -> None:
        from datetime import date

        from talai_middleware.tally import envelopes as env

        transport = FakeTallyTransport()
        vouchers = P.parse_vouchers(
            transport.send(env.voucher_collection(date(2026, 6, 1), date(2026, 6, 30)))
        )
        assert vouchers
        assert all(v.date and date(2026, 6, 1) <= v.date <= date(2026, 6, 30) for v in vouchers)

    def test_records_requests(self, fake_transport: FakeTallyTransport) -> None:
        from talai_middleware.tally import envelopes as env

        fake_transport.send(env.list_companies())
        assert len(fake_transport.requests) == 1


class TestFakeTransportSafety:
    def test_rejects_alter_action(self, fake_transport: FakeTallyTransport) -> None:
        with pytest.raises(ForbiddenTallyAction, match="Alter"):
            fake_transport.send('<ENVELOPE><VOUCHER ACTION="Alter"/></ENVELOPE>')

    def test_rejects_delete_action(self, fake_transport: FakeTallyTransport) -> None:
        with pytest.raises(ForbiddenTallyAction, match="Delete"):
            fake_transport.send('<ENVELOPE><LEDGER ACTION="Delete"/></ENVELOPE>')

    def test_can_simulate_an_unreachable_tally(self) -> None:
        transport = FakeTallyTransport(reachable=False)
        with pytest.raises(TallyUnreachable):
            transport.send(PING)
