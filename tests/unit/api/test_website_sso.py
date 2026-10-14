"""External app SSO security contracts against a persistent SQLite database."""

import asyncio
import base64
import hashlib
import secrets
import time
from concurrent.futures import ThreadPoolExecutor
from functools import partial

import pytest
from tests.unit.api.test_websites import websites as _websites

from octop.api.deps import current_user, is_jwt_exempt_path
from octop.infra.db.pool import SqlitePool
from octop.infra.db.repos.websites import WebsiteRepo

websites = _websites


def sso_payload(**overrides):
    return {
        "name": "External app",
        "url": "https://app.example.test/",
        "auth_mode": "octop",
        "sso_callback_url": "https://app.example.test/sso/callback",
        **overrides,
    }


def handshake():
    verifier = secrets.token_urlsafe(48)
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    )
    return secrets.token_urlsafe(32), verifier, challenge


def stored_settings(services):
    with services.db.connect() as conn:
        return {
            row["key"]: row["value"]
            for row in conn.execute("SELECT key, value FROM settings").fetchall()
        }


async def provision(websites, **overrides):
    client, app, identities, _ = websites
    app.dependency_overrides[current_user] = lambda: identities[0]
    response = await client.post("/api/admin/websites", json=sso_payload(**overrides))
    assert response.status_code == 201, response.text
    site = response.json()
    response = await client.post(f"/api/admin/websites/{site['website_id']}/sso-secret")
    assert response.status_code == 200, response.text
    return site, response.json()["client_secret"]


async def issue(websites, site):
    client, app, identities, _ = websites
    app.dependency_overrides[current_user] = lambda: identities[1]
    state, verifier, challenge = handshake()
    response = await client.post(
        f"/api/websites/{site['website_id']}/sso/code",
        json={"state": state, "code_challenge": challenge},
    )
    assert response.status_code == 200, response.text
    grant = response.json()
    assert grant["state"] == state
    assert grant["expires_in"] == 60
    assert grant["callback_url"] == site["sso_callback_url"]
    return {
        "website_id": site["website_id"],
        "code": grant["code"],
        "state": state,
        "code_verifier": verifier,
    }


async def test_sso_roundtrip_only_exposes_identity_and_code_is_single_use(websites):
    client, app, identities, services = websites
    site, secret = await provision(websites)
    body = {**await issue(websites, site), "client_secret": secret}
    for user, path in [(identities[1], "/api/websites"), (identities[0], "/api/admin/websites")]:
        app.dependency_overrides[current_user] = partial(lambda identity: identity, user)
        response = await client.get(path)
        assert response.status_code == 200
        assert secret not in response.text
        assert "client_secret" not in response.text
    assert secret not in "".join(services.website_repo.list_values())
    stored = services.secret_repo.get(f"custom.website-sso.secret.v1.{site['website_id']}")
    assert stored == hashlib.sha256(secret.encode()).digest()
    assert body["code"] not in "".join(stored_settings(services).values())
    response = await client.post("/api/app-sso/exchange", json=body)
    assert response.status_code == 200, response.text
    assert response.json() == {
        "user": {"id": identities[1].id, "username": "alice", "display_name": None, "locale": "zh"}
    }
    assert (await client.post("/api/app-sso/exchange", json=body)).status_code == 401


async def test_sensitive_responses_are_not_cached(websites):
    client, _, _, _ = websites
    site, secret = await provision(websites)
    response = await client.post(f"/api/admin/websites/{site['website_id']}/sso-secret")
    assert response.headers.get("cache-control") == "no-store"
    state, verifier, challenge = handshake()
    response = await client.post(
        f"/api/websites/{site['website_id']}/sso/code",
        json={"state": state, "code_challenge": challenge},
    )
    assert response.headers.get("cache-control") == "no-store"
    response = await client.post(
        "/api/app-sso/exchange",
        json={
            "website_id": site["website_id"],
            "code": response.json()["code"],
            "client_secret": secret,
            "state": state,
            "code_verifier": verifier,
        },
    )
    # The old secret is rejected; failures must not reveal credentials.
    assert response.status_code == 401
    assert secret not in response.text


@pytest.mark.parametrize("verifier", ["short", "a" * 129, "+" * 43, "a" * 43 + "\n"])
async def test_exchange_rejects_invalid_verifier_format(websites, verifier):
    client, _, _, _ = websites
    site, secret = await provision(websites)
    body = {**await issue(websites, site), "client_secret": secret, "code_verifier": verifier}
    assert (await client.post("/api/app-sso/exchange", json=body)).status_code == 422


@pytest.mark.parametrize("field", ["website_id", "client_secret", "state", "code_verifier", "code"])
async def test_wrong_binding_cannot_redeem_or_destroy_valid_code(websites, field):
    client, _, _, _ = websites
    site, secret = await provision(websites)
    other, other_secret = await provision(websites, name="Other app")
    body = {**await issue(websites, site), "client_secret": secret}
    wrong = {**body, field: secrets.token_urlsafe(48)}
    if field == "website_id":
        wrong.update(website_id=other["website_id"], client_secret=other_secret)
    assert (await client.post("/api/app-sso/exchange", json=wrong)).status_code == 401
    assert (await client.post("/api/app-sso/exchange", json=body)).status_code == 200


async def test_concurrent_exchange_has_one_winner(websites):
    client, _, _, _ = websites
    site, secret = await provision(websites)
    body = {**await issue(websites, site), "client_secret": secret}
    responses = await asyncio.gather(
        *(client.post("/api/app-sso/exchange", json=body) for _ in range(8))
    )
    assert sorted(r.status_code for r in responses) == [200] + [401] * 7


@pytest.mark.parametrize(
    "change", ["disabled", "deleted", "access", "callback", "auth_mode", "secret", "user_disabled"]
)
async def test_live_revocation_invalidates_outstanding_codes(websites, change):
    client, app, identities, services = websites
    site, secret = await provision(websites, visibility="selected", user_ids=[identities[1].id])
    body = {**await issue(websites, site), "client_secret": secret}
    app.dependency_overrides[current_user] = lambda: identities[0]
    if change == "secret":
        response = await client.post(f"/api/admin/websites/{site['website_id']}/sso-secret")
        new_secret = response.json()["client_secret"]
        assert new_secret != secret
        assert (
            await client.post("/api/app-sso/exchange", json={**body, "client_secret": new_secret})
        ).status_code == 401
    elif change == "user_disabled":
        services.user_repo.set_disabled(identities[1].id, True)
    elif change == "deleted":
        await client.delete(f"/api/admin/websites/{site['website_id']}")
    else:
        values = {
            "disabled": {"enabled": False},
            "access": {"user_ids": [identities[2].id]},
            "callback": {"sso_callback_url": "https://app.example.test/different"},
            "auth_mode": {"auth_mode": "none"},
        }
        response = await client.put(
            f"/api/admin/websites/{site['website_id']}",
            json={k: v for k, v in {**site, **values[change]}.items() if k != "website_id"},
        )
        assert response.status_code == 200, response.text
    assert (await client.post("/api/app-sso/exchange", json=body)).status_code == 401


async def test_expired_grants_are_rejected_and_cleaned(websites, monkeypatch):
    client, _, _, services = websites
    site, secret = await provision(websites)
    now = time.time()
    body = {**await issue(websites, site), "client_secret": secret}
    monkeypatch.setattr("octop.infra.websites.sso.time.time", lambda: now + 61)
    assert (await client.post("/api/app-sso/exchange", json=body)).status_code == 401
    assert not any(k.startswith("custom.website-sso.code.v1.") for k in stored_settings(services))


@pytest.mark.parametrize(
    "override",
    [
        {"url": "http://app.example.test/", "sso_callback_url": "http://app.example.test/callback"},
        {"sso_callback_url": "https://other.example.test/callback"},
        {"sso_callback_url": "https://user:secret@app.example.test/callback"},
        {"sso_callback_url": "https://app.example.test/callback#fragment"},
        {"sso_callback_url": None},
    ],
)
async def test_invalid_sso_configuration_is_rejected(websites, override):
    client, _, _, _ = websites
    assert (
        await client.post("/api/admin/websites", json=sso_payload(**override))
    ).status_code == 422


async def test_loopback_http_and_original_website_defaults(websites):
    client, _, _, _ = websites
    response = await client.post(
        "/api/admin/websites", json={"name": "Original", "url": "http://intranet.example.test/"}
    )
    assert response.status_code == 201
    assert response.json()["auth_mode"] == "none"
    assert response.json()["sso_callback_url"] is None
    await provision(
        websites,
        url="http://127.0.0.1:5186/",
        sso_callback_url="http://127.0.0.1:5186/sso/callback",
    )


async def test_same_origin_app_cannot_receive_grant(websites):
    client, app, identities, _ = websites
    site, _ = await provision(
        websites, url="http://127.0.0.1:5186/", sso_callback_url="http://127.0.0.1:5186/callback"
    )
    app.dependency_overrides[current_user] = lambda: identities[1]
    state, _, challenge = handshake()
    response = await client.post(
        f"http://127.0.0.1:5186/api/websites/{site['website_id']}/sso/code",
        json={"state": state, "code_challenge": challenge},
    )
    assert response.status_code == 422


@pytest.mark.parametrize(
    "app_url,public_base",
    [
        ("https://%74est/", "https://test"),
        ("https://t\u00e9st.example/", "https://xn--tst-bma.example"),
    ],
)
async def test_same_origin_canonical_host_spellings_are_rejected(websites, app_url, public_base):
    client, _, _, _ = websites
    site, _ = await provision(websites, url=app_url, sso_callback_url=app_url + "callback")
    state, _, challenge = handshake()
    response = await client.post(
        f"{public_base}/api/websites/{site['website_id']}/sso/code",
        json={"state": state, "code_challenge": challenge},
    )
    assert response.status_code == 422


@pytest.mark.parametrize(
    "state,challenge",
    [
        ("short", "a" * 43),
        ("a" * 32, "short"),
        ("+" * 32, "a" * 43),
        ("a" * 129, "a" * 43),
        ("a" * 32, "=" * 43),
    ],
)
async def test_issue_strictly_validates_state_and_challenge(websites, state, challenge):
    client, _, _, _ = websites
    site, _ = await provision(websites)
    response = await client.post(
        f"/api/websites/{site['website_id']}/sso/code",
        json={"state": state, "code_challenge": challenge},
    )
    assert response.status_code == 422


async def test_secret_requires_admin_and_issue_requires_access_and_initialized_secret(websites):
    client, app, identities, services = websites
    site, _ = await provision(websites, visibility="selected", user_ids=[identities[1].id])
    app.dependency_overrides[current_user] = lambda: identities[2]
    assert (
        await client.post(f"/api/admin/websites/{site['website_id']}/sso-secret")
    ).status_code == 403
    state, _, challenge = handshake()
    assert (
        await client.post(
            f"/api/websites/{site['website_id']}/sso/code",
            json={"state": state, "code_challenge": challenge},
        )
    ).status_code == 404
    services.user_repo.set_disabled(identities[1].id, True)
    app.dependency_overrides[current_user] = lambda: identities[1]
    assert (
        await client.post(
            f"/api/websites/{site['website_id']}/sso/code",
            json={"state": state, "code_challenge": challenge},
        )
    ).status_code == 403
    app.dependency_overrides[current_user] = lambda: identities[0]
    response = await client.post("/api/admin/websites", json=sso_payload(name="No secret"))
    uninitialized = response.json()["website_id"]
    assert (
        await client.post(
            f"/api/websites/{uninitialized}/sso/code",
            json={"state": state, "code_challenge": challenge},
        )
    ).status_code == 409


def test_only_exact_exchange_path_is_jwt_exempt():
    assert is_jwt_exempt_path("/api/app-sso/exchange")
    for path in [
        "/api/app-sso",
        "/api/app-sso/exchange/extra",
        "/api/app-sso/exchange/",
        "/api/websites/a/sso/code",
        "/api/admin/websites/a/sso-secret",
    ]:
        assert not is_jwt_exempt_path(path)


def test_persistent_grant_atomic_consumption_across_database_connections(tmp_path):
    from octop.infra.db.migrate import run_migrations

    path = tmp_path / "sso.db"
    first = SqlitePool(path)
    run_migrations(first)
    with first.transaction() as conn:
        conn.execute(
            "INSERT INTO settings(key, value) VALUES (?, ?)",
            ("custom.websites.v1.site", "site-value"),
        )
        conn.execute(
            "INSERT INTO users(username, role, created_at) VALUES (?, ?, ?)", ("viewer", "user", 1)
        )
        conn.execute(
            "INSERT INTO secrets(k, v, created_at) VALUES (?, ?, ?)",
            ("secret-key", b"secret-hash", 1),
        )
    repo = WebsiteRepo(first)
    stored_code = f"{int(time.time()) + 60:012d}:stored-code"
    repo.create_sso_code("hash", stored_code)
    second = SqlitePool(path)
    other = WebsiteRepo(second)
    assert other.get_sso_code("hash") == stored_code
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(
                r.consume_sso_code,
                "hash",
                stored_code,
                website_id="site",
                website_value="site-value",
                secret_key="secret-key",
                secret_hash=b"secret-hash",
                user_id=1,
                user_role="user",
            )
            for r in [repo, other]
        ]
        assert sorted(f.result() for f in futures) == [False, True]
    first.close()
    second.close()
