from __future__ import annotations

import asyncio
import base64
import hashlib
import importlib.util
import json
import sys
from collections.abc import AsyncIterator
from pathlib import Path
from urllib.parse import urlencode

import httpx
import pytest

pytest.importorskip("itsdangerous", reason="Independent demo needs itsdangerous")

_APP_PATH = Path(__file__).resolve().parents[3] / "examples" / "app_sso_demo" / "app.py"
_SPEC = importlib.util.spec_from_file_location("octop_sso_demo", _APP_PATH)
assert _SPEC is not None and _SPEC.loader is not None
demo = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = demo
_SPEC.loader.exec_module(demo)


@pytest.fixture
def demo_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key, value in {
        "OCTOP_BASE_URL": "http://127.0.0.1:8000",
        "OCTOP_ORIGIN": "http://127.0.0.1:8000",
        "OCTOP_WEBSITE_ID": "demo-app",
        "OCTOP_CLIENT_SECRET": "confidential-client-secret-not-for-the-browser",
        "DEMO_BASE_URL": "http://127.0.0.1:5187",
        "DEMO_SESSION_SECRET": "demo-session-signing-secret-with-strong-entropy",
    }.items():
        monkeypatch.setenv(key, value)


@pytest.fixture
async def browser(demo_env: None) -> AsyncIterator[tuple[httpx.AsyncClient, list[dict]]]:
    exchanges: list[dict] = []

    def exchange(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "http://127.0.0.1:8000/api/app-sso/exchange"
        assert "authorization" not in request.headers
        exchanges.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "user": {
                    "id": 12,
                    "username": "enterprise-user",
                    "display_name": "Enterprise User",
                    "locale": "zh",
                }
            },
        )

    app = demo.create_app(exchange_transport=httpx.MockTransport(exchange))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1:5187"
    ) as client:
        yield client, exchanges


async def _bootstrap(client: httpx.AsyncClient) -> dict:
    response = await client.get("/api/sso/bootstrap")
    assert response.status_code == 200
    return response.json()


async def _sign_in(client: httpx.AsyncClient) -> dict:
    bootstrap = await _bootstrap(client)
    response = await client.get(
        "/auth/octop/callback?"
        + urlencode({"state": bootstrap["pending"]["state"], "code": "one-time-code"})
    )
    assert response.status_code == 303
    assert response.headers["location"] == "/"
    return bootstrap


async def test_protected_api_requires_an_application_session(browser: tuple) -> None:
    client, exchanges = browser

    assert (await client.get("/api/me")).status_code == 401
    assert (await client.get("/api/reports")).status_code == 401
    assert not exchanges


async def test_prepare_reuses_pending_and_does_not_expose_confidential_values(
    browser: tuple,
) -> None:
    client, _ = browser

    first = await _bootstrap(client)
    second = await _bootstrap(client)

    assert first["pending"] == second["pending"]
    assert len(first["pending"]["state"]) >= 32
    assert len(first["pending"]["code_challenge"]) == 43
    cookie = client.cookies.get("octop_demo_session")
    cookie_data = json.loads(base64.b64decode(cookie.split(".")[0]))
    exposed = json.dumps({"bootstrap": first, "cookie": cookie_data})
    assert "client_secret" not in exposed
    assert "code_verifier" not in exposed
    assert "confidential-client-secret" not in exposed


async def test_callback_exchanges_on_backend_and_establishes_real_cookie_session(
    browser: tuple,
) -> None:
    client, exchanges = browser
    bootstrap = await _sign_in(client)

    assert len(exchanges) == 1
    request = exchanges[0]
    assert request["website_id"] == "demo-app"
    assert request["state"] == bootstrap["pending"]["state"]
    assert request["client_secret"] == "confidential-client-secret-not-for-the-browser"
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(request["code_verifier"].encode("ascii")).digest())
        .decode("ascii")
        .rstrip("=")
    )
    assert challenge == bootstrap["pending"]["code_challenge"]
    assert len(request["code_verifier"]) >= 43
    me = await client.get("/api/me")
    assert me.status_code == 200
    assert me.json()["user"]["username"] == "enterprise-user"
    assert me.json()["application"]["role"] == "viewer"
    assert me.json()["application"]["subject"] == "http://127.0.0.1:8000|12"
    assert (await client.get("/api/reports")).status_code == 200
    assert (await client.get("/api/reports/export")).status_code == 403
    assert (await _bootstrap(client))["pending"] is None


async def test_callback_rejects_wrong_browser_state_without_calling_broker(browser: tuple) -> None:
    client, exchanges = browser
    await _bootstrap(client)

    response = await client.get("/auth/octop/callback?code=unused&state=wrong-state")

    assert response.status_code == 400
    assert "text/html" in response.headers["content-type"]
    assert 'href="/"' in response.text
    assert not exchanges
    assert (await client.get("/api/me")).status_code == 401


async def test_callback_rejects_another_browser_without_pending_cookie(browser: tuple) -> None:
    client, exchanges = browser
    state = (await _bootstrap(client))["pending"]["state"]
    client.cookies.clear()

    response = await client.get(
        "/auth/octop/callback?" + urlencode({"code": "code", "state": state})
    )

    assert response.status_code == 400
    assert not exchanges


async def test_callback_rejects_non_ascii_state_without_a_server_error(browser: tuple) -> None:
    client, exchanges = browser
    await _bootstrap(client)

    response = await client.get(
        "/auth/octop/callback?" + urlencode({"code": "code", "state": "错误状态"})
    )

    assert response.status_code == 400
    assert not exchanges


async def test_callback_rejects_expired_prelogin(
    browser: tuple, monkeypatch: pytest.MonkeyPatch
) -> None:
    client, exchanges = browser
    now = demo.time.time()
    state = (await _bootstrap(client))["pending"]["state"]
    monkeypatch.setattr(demo.time, "time", lambda: now + 301)

    response = await client.get(
        "/auth/octop/callback?" + urlencode({"code": "code", "state": state})
    )

    assert response.status_code == 400
    assert not exchanges
    assert (await client.get("/api/me")).status_code == 401


async def test_callback_cannot_reuse_the_pending_session(browser: tuple) -> None:
    client, exchanges = browser
    bootstrap = await _sign_in(client)

    response = await client.get(
        "/auth/octop/callback?"
        + urlencode({"code": "replay", "state": bootstrap["pending"]["state"]})
    )

    assert response.status_code == 400
    assert len(exchanges) == 1


async def test_concurrent_callbacks_only_send_one_exchange(demo_env: None) -> None:
    exchanging = asyncio.Event()
    release = asyncio.Event()
    exchanges: list[httpx.Request] = []

    async def exchange(request: httpx.Request) -> httpx.Response:
        exchanges.append(request)
        exchanging.set()
        await release.wait()
        return httpx.Response(
            200,
            json={"user": {"id": 12, "username": "user", "display_name": None, "locale": "zh"}},
        )

    app = demo.create_app(exchange_transport=httpx.MockTransport(exchange))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1:5187"
    ) as client:
        state = (await _bootstrap(client))["pending"]["state"]
        callback = "/auth/octop/callback?" + urlencode({"code": "one-code", "state": state})
        first = asyncio.create_task(client.get(callback))
        try:
            await asyncio.wait_for(exchanging.wait(), timeout=2)
            second = await client.get(callback)
            assert second.status_code == 400
        finally:
            release.set()
            response = await first
        assert response.status_code == 303
        assert len(exchanges) == 1


@pytest.mark.parametrize("failure", ["denied", "network", "invalid-identity"])
async def test_broker_failure_does_not_establish_session(demo_env: None, failure: str) -> None:
    def exchange(request: httpx.Request) -> httpx.Response:
        if failure == "network":
            raise httpx.ConnectError("unavailable", request=request)
        if failure == "invalid-identity":
            return httpx.Response(200, json={"user": {"id": 12}})
        return httpx.Response(401, json={"message": "invalid secret"})

    app = demo.create_app(exchange_transport=httpx.MockTransport(exchange))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1:5187"
    ) as client:
        bootstrap = await _bootstrap(client)
        response = await client.get(
            "/auth/octop/callback?"
            + urlencode({"code": "code", "state": bootstrap["pending"]["state"]})
        )
        assert response.status_code == 502
        assert (await client.get("/api/me")).status_code == 401
        assert (await _bootstrap(client))["pending"] is None


async def test_local_logout_revokes_session_and_does_not_automatically_restart_login(
    browser: tuple,
) -> None:
    client, _ = browser
    bootstrap = await _sign_in(client)
    logged_in_cookie = client.cookies.get("octop_demo_session")

    response = await client.post(
        "/auth/logout",
        headers={"Origin": "http://127.0.0.1:5187", "X-CSRF-Token": bootstrap["csrf_token"]},
    )

    assert response.status_code == 200
    assert (await client.get("/api/me")).status_code == 401
    assert (await _bootstrap(client))["pending"] is None
    csrf = (await _bootstrap(client))["csrf_token"]
    response = await client.post(
        "/auth/start", headers={"Origin": "http://127.0.0.1:5187", "X-CSRF-Token": csrf}
    )
    assert response.status_code == 200
    assert response.json()["pending"] is not None
    client.cookies.set("octop_demo_session", logged_in_cookie, domain="127.0.0.1", path="/")
    assert (await client.get("/api/me")).status_code == 401


async def test_mutating_endpoints_require_same_origin_and_csrf(browser: tuple) -> None:
    client, _ = browser
    bootstrap = await _bootstrap(client)

    assert (await client.post("/auth/start")).status_code == 403
    assert (
        await client.post(
            "/auth/logout",
            headers={"Origin": "https://attacker.example", "X-CSRF-Token": bootstrap["csrf_token"]},
        )
    ).status_code == 403


async def test_security_headers_and_http_only_cookie(browser: tuple) -> None:
    client, _ = browser
    response = await client.get("/api/sso/bootstrap")

    assert "httponly" in response.headers["set-cookie"].lower()
    assert (
        "frame-ancestors 'self' http://127.0.0.1:8000"
        in response.headers["content-security-policy"]
    )
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["referrer-policy"] == "no-referrer"


def test_factory_fails_without_required_security_configuration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("OCTOP_CLIENT_SECRET", raising=False)

    with pytest.raises(ValueError, match="OCTOP_CLIENT_SECRET"):
        demo.create_app()


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("DEMO_BASE_URL", "http://application.example"),
        ("OCTOP_BASE_URL", "http://octop.example"),
        ("OCTOP_ORIGIN", "http://127.0.0.1:8000/path"),
        ("DEMO_BASE_URL", "http://127.0.0.1:8000"),
        ("DEMO_SESSION_SECRET", "short"),
    ],
)
def test_factory_rejects_unsafe_configuration(
    demo_env: None, monkeypatch: pytest.MonkeyPatch, key: str, value: str
) -> None:
    monkeypatch.setenv(key, value)

    with pytest.raises(ValueError):
        demo.create_app()
