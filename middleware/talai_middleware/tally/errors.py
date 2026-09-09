"""Typed errors raised by the Tally client.

Routes translate these into ``{error: {code, message, details?}}`` responses;
services use them to decide whether to skip, retry later, or mark a draft failed.
"""

from __future__ import annotations


class TallyError(Exception):
    """Base class for every Tally-related failure."""

    code = "TALLY_ERROR"

    def __init__(self, message: str, *, details: dict | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}


class TallyUnreachable(TallyError):
    """Tally did not answer: host down, port closed, or the request timed out."""

    code = "TALLY_UNREACHABLE"


class TallyTimeout(TallyUnreachable):
    """Tally accepted the connection but did not answer within the timeout."""

    code = "TALLY_TIMEOUT"


class TallyResponseError(TallyError):
    """Tally answered with something that is not a usable XML envelope."""

    code = "TALLY_BAD_RESPONSE"


class TallyCompanyNotOpen(TallyError):
    """The expected company is not loaded in TallyPrime."""

    code = "TALLY_COMPANY_NOT_OPEN"


class TallyImportError(TallyError):
    """An ``Import Data`` request was rejected, wholly or per line."""

    code = "TALLY_IMPORT_FAILED"

    def __init__(
        self,
        message: str,
        *,
        line_errors: list[str] | None = None,
        details: dict | None = None,
    ) -> None:
        super().__init__(message, details=details)
        self.line_errors = line_errors or []


class TallyWriteDisabled(TallyError):
    """A write was attempted while ``TALLY_WRITE_ENABLED`` is false."""

    code = "TALLY_WRITE_DISABLED"
