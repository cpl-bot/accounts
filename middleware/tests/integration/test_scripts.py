"""The support scripts in scripts/ (plan §5 LAN validation checklist)."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import httpx
import pytest
import respx

SCRIPTS = Path(__file__).resolve().parents[2].parent / "scripts"
if not SCRIPTS.exists():  # running from a checkout layout without the repo root
    SCRIPTS = Path(__file__).resolve().parents[3] / "scripts"

COMPANIES_XML = """<ENVELOPE><HEADER><VERSION>1</VERSION><STATUS>1</STATUS></HEADER>
<BODY><DATA><COLLECTION>
 <COMPANY NAME="Acme Foods Pvt Ltd"><NAME>Acme Foods Pvt Ltd</NAME>
 <STARTINGFROM>20250401</STARTINGFROM></COMPANY>
</COLLECTION></DATA></BODY></ENVELOPE>"""


def load(name: str):
    """Import a script by path (they are not part of the package)."""
    spec = importlib.util.spec_from_file_location(f"talai_script_{name}", SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def check_script():
    return load("check_tally_connection")


class TestCheckTallyConnection:
    @respx.mock
    def test_success_exits_zero(self, check_script, monkeypatch, capsys) -> None:
        monkeypatch.setattr(check_script, "tcp_check", lambda *a, **k: (True, 1.0, ""))
        respx.post("http://tally.local:9000").mock(
            return_value=httpx.Response(200, text=COMPANIES_XML)
        )
        code = check_script.main(
            ["--host", "tally.local", "--port", "9000", "--company", "Acme Foods Pvt Ltd"]
        )
        out = capsys.readouterr().out
        assert code == 0
        assert "Acme Foods Pvt Ltd" in out
        assert "Connection is good" in out

    def test_tcp_failure_exits_two(self, check_script, monkeypatch, capsys) -> None:
        monkeypatch.setattr(
            check_script, "tcp_check", lambda *a, **k: (False, 1.0, "connection refused")
        )
        assert check_script.main(["--host", "tally.local"]) == 2
        assert "firewall" in capsys.readouterr().out

    @respx.mock
    def test_xml_failure_exits_three(self, check_script, monkeypatch, capsys) -> None:
        monkeypatch.setattr(check_script, "tcp_check", lambda *a, **k: (True, 1.0, ""))
        respx.post("http://tally.local:9000").mock(side_effect=httpx.ConnectError("nope"))
        assert check_script.main(["--host", "tally.local"]) == 3
        assert "XML/HTTP server" in capsys.readouterr().out

    @respx.mock
    def test_wrong_company_exits_four(self, check_script, monkeypatch, capsys) -> None:
        monkeypatch.setattr(check_script, "tcp_check", lambda *a, **k: (True, 1.0, ""))
        respx.post("http://tally.local:9000").mock(
            return_value=httpx.Response(200, text=COMPANIES_XML)
        )
        assert check_script.main(["--host", "tally.local", "--company", "Other Ltd"]) == 4
        assert "is NOT open" in capsys.readouterr().out

    @respx.mock
    def test_xml_flag_dumps_the_exchange(self, check_script, monkeypatch, capsys) -> None:
        monkeypatch.setattr(check_script, "tcp_check", lambda *a, **k: (True, 1.0, ""))
        respx.post("http://tally.local:9000").mock(
            return_value=httpx.Response(200, text=COMPANIES_XML)
        )
        check_script.main(["--host", "tally.local", "--xml", "--company", "Acme Foods Pvt Ltd"])
        out = capsys.readouterr().out
        assert "--- request ---" in out and "<TALLYREQUEST>Export</TALLYREQUEST>" in out
        assert "--- response ---" in out

    def test_tcp_check_reports_a_closed_port(self, check_script) -> None:
        ok, _ms, error = check_script.tcp_check("127.0.0.1", 1, timeout=0.5)
        assert ok is False and error


class TestSeedAndValidate:
    def test_seed_then_validate_self_test(self, tmp_path, capsys) -> None:
        url = f"sqlite:///{tmp_path / 'demo.db'}"
        assert load("seed_demo_data").main(["--reset", "--database-url", url]) == 0
        seeded = capsys.readouterr().out
        assert "ledgers" in seeded

        validate = load("validate_db_sync")
        monkey_settings = validate.Settings

        class Patched(monkey_settings):
            def __init__(self, **kwargs):
                super().__init__(**{**kwargs, "database_url": url})

        validate.Settings = Patched
        try:
            assert validate.main(["--fake", "--skip-migrate"]) == 0
        finally:
            validate.Settings = monkey_settings
        assert "All checks reconciled" in capsys.readouterr().out

    def test_dry_run_push_prints_xml_and_sends_nothing(self, tmp_path, capsys) -> None:
        url = f"sqlite:///{tmp_path / 'demo.db'}"
        load("seed_demo_data").main(["--reset", "--database-url", url])
        capsys.readouterr()

        dry_run = load("dry_run_push")
        original = dry_run.Settings

        class Patched(original):
            def __init__(self, **kwargs):
                super().__init__(**{**kwargs, "database_url": url, "tally_write_enabled": True})

        dry_run.Settings = Patched
        try:
            # respx with no routes: any real HTTP call would raise, proving none happens.
            with respx.mock:
                assert dry_run.main([]) == 0
        finally:
            dry_run.Settings = original
        out = capsys.readouterr().out
        assert "<REMOTEID>" in out
        assert "Nothing was sent" in out
