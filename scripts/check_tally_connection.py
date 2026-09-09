#!/usr/bin/env python
"""Check that TallyPrime is reachable and serving the expected company.

    uv run --project middleware python scripts/check_tally_connection.py
    uv run --project middleware python scripts/check_tally_connection.py \
        --host 192.168.1.24 --port 9000 --xml

Exits non-zero when Tally is unreachable or the expected company is not open,
so it can be used as a LAN deployment gate.
"""

from __future__ import annotations

import argparse
import socket
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "middleware"))

from talai_middleware.config import Settings  # noqa: E402
from talai_middleware.tally import envelopes, parsers  # noqa: E402
from talai_middleware.tally.client import TallyClient  # noqa: E402
from talai_middleware.tally.errors import TallyError  # noqa: E402
from talai_middleware.tally.transport import HttpxTransport  # noqa: E402

TCP_TIMEOUT = 3.0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    settings = Settings()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=settings.tally_host, help="Tally host or IP")
    parser.add_argument("--port", type=int, default=settings.tally_port, help="Tally XML port")
    parser.add_argument(
        "--company", default=settings.tally_company_name, help="Company that must be open"
    )
    parser.add_argument(
        "--timeout", type=float, default=settings.tally_status_timeout_seconds
    )
    parser.add_argument("--xml", action="store_true", help="Dump the raw request/response")
    return parser.parse_args(argv)


def tcp_check(host: str, port: int, timeout: float = TCP_TIMEOUT) -> tuple[bool, float, str]:
    """Plain TCP connect, to separate 'host down' from 'XML server off'."""
    started = time.perf_counter()
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True, (time.perf_counter() - started) * 1000, ""
    except OSError as exc:
        return False, (time.perf_counter() - started) * 1000, str(exc)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    print(f"Talai — Tally connection check\nTarget: http://{args.host}:{args.port}")

    reachable, tcp_ms, tcp_error = tcp_check(args.host, args.port, args.timeout)
    print(f"TCP connect:   {'ok' if reachable else 'FAILED'} ({tcp_ms:.0f} ms)")
    if not reachable:
        print(f"  {tcp_error}")
        print("\nCheck that the PC is on, the IP is right, and the Windows firewall")
        print("allows inbound TCP on this port. See middleware/README.md.")
        return 2

    transport = HttpxTransport(args.host, args.port, args.timeout)
    if args.xml:
        request_xml = envelopes.list_companies()
        print(f"\n--- request ---\n{request_xml}")
        try:
            raw = transport.send(request_xml)
        except TallyError as exc:
            print(f"\nXML request:   FAILED — {exc}")
            return 3
        print(f"\n--- response ---\n{raw}\n")
        companies = parsers.parse_companies(raw)
        status_error = None
        latency_ms = 0
    else:
        client = TallyClient(transport, company=args.company, timeout=args.timeout)
        status = client.ping()
        companies, latency_ms, status_error = (
            status.companies, status.latency_ms, status.error
        )

    if status_error:
        print(f"XML request:   FAILED — {status_error}")
        print("\nTally answered the socket but not the XML request. Enable the")
        print("XML/HTTP server (F1 → Settings → Advanced Configuration) and make")
        print("sure a company is loaded.")
        return 3

    print(f"XML request:   ok ({latency_ms} ms)")
    print(f"Companies open ({len(companies)}):")
    for company in companies:
        marker = " <- expected" if company.name == args.company else ""
        print(f"  - {company.name}{marker}")

    if not args.company:
        print("\nNo expected company configured (TALLY_COMPANY_NAME is empty).")
        return 0
    if args.company not in [c.name for c in companies]:
        print(f"\nExpected company '{args.company}' is NOT open in Tally.")
        return 4
    print(f"\nExpected company '{args.company}' is open. Connection is good.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
