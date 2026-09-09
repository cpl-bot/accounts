"""Transports: how an XML request actually reaches TallyPrime.

``TallyTransport`` is the seam that keeps every automated test off the network.
Production uses :class:`HttpxTransport`; tests and the ``--fake`` support
scripts use ``talai_middleware.tally.fake.FakeTallyTransport``.
"""

from __future__ import annotations

import logging
from typing import Protocol, runtime_checkable

import httpx

from .errors import TallyTimeout, TallyUnreachable

logger = logging.getLogger(__name__)

CONTENT_TYPE = "text/xml;charset=utf-8"


@runtime_checkable
class TallyTransport(Protocol):
    """Send one XML envelope and return the raw response text."""

    def send(self, xml: str, timeout: float | None = None) -> str: ...


class HttpxTransport:
    """POSTs XML to the TallyPrime XML/HTTP server over the LAN."""

    def __init__(self, host: str, port: int, timeout: float = 30.0) -> None:
        self.host = host
        self.port = port
        self.timeout = timeout

    @property
    def url(self) -> str:
        return f"http://{self.host}:{self.port}"

    def send(self, xml: str, timeout: float | None = None) -> str:
        effective = timeout or self.timeout
        try:
            response = httpx.post(
                self.url,
                content=xml.encode("utf-8"),
                headers={"Content-Type": CONTENT_TYPE},
                timeout=effective,
            )
        except httpx.TimeoutException as exc:
            raise TallyTimeout(
                f"Tally at {self.url} did not respond within {effective:g}s"
            ) from exc
        except httpx.HTTPError as exc:
            raise TallyUnreachable(f"Could not reach Tally at {self.url}: {exc}") from exc
        if response.status_code >= 400:
            raise TallyUnreachable(
                f"Tally at {self.url} returned HTTP {response.status_code}"
            )
        # Tally may answer in UTF-16 while labelling the body UTF-8, so decode
        # from the raw bytes rather than trusting ``response.text``.
        from .parsers import decode_response

        return decode_response(response.content)
