"""Development reload supervises a fresh service without booting it in the parent."""

from pathlib import Path
from unittest.mock import AsyncMock, Mock

import pytest
from watchfiles import Change

from octop import launch


def test_reload_supervises_service_and_preserves_options(monkeypatch: pytest.MonkeyPatch) -> None:
    supervise = Mock()
    serve = AsyncMock()
    monkeypatch.setattr("watchfiles.run_process", supervise)
    monkeypatch.setattr(launch, "run_foreground", serve)
    options = {
        "host": "127.0.0.1",
        "port": 8891,
        "reload": True,
        "workers": 3,
        "log_level": "debug",
        "ssl_certfile": "test-cert",
        "ssl_keyfile": "test-key",
    }

    launch.run_foreground_blocking(**options)

    supervise.assert_called_once()
    serve.assert_not_called()
    call = supervise.call_args
    package = Path(launch.__file__).resolve().parent
    assert call.args == (package,)
    assert call.kwargs["target"] is launch.run_foreground_blocking
    child_options = call.kwargs["kwargs"]
    assert child_options == {**options, "reload": False, "workers": 1}

    watch_filter = call.kwargs["watch_filter"]
    assert watch_filter(Change.modified, str(package / "launch.py"))
    assert watch_filter(Change.modified, str(package / "i18n" / "zh.json"))
    assert not watch_filter(Change.modified, str(package / "__pycache__" / "launch.pyc"))
    assert not watch_filter(Change.modified, str(package / "dashboard" / "manifest.json"))

    call.kwargs["target"](**child_options)
    supervise.assert_called_once()
    serve.assert_awaited_once_with(**child_options)


def test_normal_start_does_not_spawn_watcher(monkeypatch: pytest.MonkeyPatch) -> None:
    supervise = Mock()
    serve = AsyncMock()
    monkeypatch.setattr("watchfiles.run_process", supervise)
    monkeypatch.setattr(launch, "run_foreground", serve)

    launch.run_foreground_blocking(reload=False, workers=2)

    supervise.assert_not_called()
    serve.assert_awaited_once_with(reload=False, workers=2)
