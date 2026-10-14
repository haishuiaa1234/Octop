"""JWT-protected app grants work identically after local and WeCom authentication."""

import base64
import hashlib
import secrets
from urllib.parse import parse_qs, urlsplit

from octop.infra.auth.sso.providers.wecom import WeComAdapter
from octop.infra.auth.sso.service import SsoService
from tests.support.auth import bearer, create_user


async def test_local_and_wecom_existing_identity_share_external_app_flow(env, monkeypatch):
    client, server, admin = env
    local = await create_user(client, admin, username="app-viewer")
    assert server.services is not None
    assert server.user_manager is not None
    local_user = server.services.user_repo.get_by_username("app-viewer")
    assert local_user is not None
    sso = SsoService(server.services, server.user_manager)
    sso.put_config_for_kind(
        "wecom",
        {
            "enabled": True,
            "client_id": "corp-id",
            "client_secret": "private-wecom-secret",
            "extra": {"agent_id": "1000002"},
        },
    )
    provider = server.services.sso_repo.get_by_kind("wecom")
    assert provider is not None
    server.services.user_repo.upsert_sso_identity(
        local_user.id, provider_id=provider.id, subject="existing-corp-user"
    )
    monkeypatch.setattr(
        WeComAdapter,
        "complete_login",
        lambda self, code, **kwargs: ("existing-corp-user", {"name": "Corporate viewer"}),
    )

    site_response = await client.post(
        "/api/admin/websites",
        headers=admin,
        json={
            "name": "External app",
            "url": "https://app.example.test/",
            "auth_mode": "octop",
            "sso_callback_url": "https://app.example.test/callback",
        },
    )
    assert site_response.status_code == 201
    website_id = site_response.json()["website_id"]
    secret_response = await client.post(
        f"/api/admin/websites/{website_id}/sso-secret", headers=admin
    )
    assert secret_response.status_code == 200
    secret = secret_response.json()["client_secret"]
    assert (await client.post(f"/api/websites/{website_id}/sso/code", json={})).status_code == 401
    assert (await client.post(f"/api/admin/websites/{website_id}/sso-secret")).status_code == 401
    for path in ["/api/app-sso/unknown", "/api/app-sso/exchange/extra", "/api/app-sso/exchange/"]:
        assert (await client.post(path, json={})).status_code == 401

    identities = []
    for auth in [local, None]:
        if auth is None:
            started = await client.post(
                "/api/auth/oauth/start", json={"kind": "wecom", "redirect_after": "/chat"}
            )
            assert started.status_code == 200
            callback = await client.get(
                "/api/auth/oauth/callback",
                params={"state": started.json()["state"], "code": "provider-auth-code"},
            )
            assert callback.status_code == 302
            login_code = parse_qs(urlsplit(callback.headers["location"]).fragment)["code"][0]
            logged_in = await client.post("/api/auth/oauth/exchange", json={"code": login_code})
            assert logged_in.status_code == 200, logged_in.text
            assert logged_in.json()["user"]["id"] == local_user.id
            auth = bearer(logged_in.json()["access_token"])
        state = secrets.token_urlsafe(32)
        verifier = secrets.token_urlsafe(48)
        challenge = (
            base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
            .decode()
            .rstrip("=")
        )
        issued = await client.post(
            f"/api/websites/{website_id}/sso/code",
            headers=auth,
            json={"state": state, "code_challenge": challenge},
        )
        assert issued.status_code == 200, issued.text
        body = {
            "website_id": website_id,
            "client_secret": secret,
            "code": issued.json()["code"],
            "state": state,
            "code_verifier": verifier,
        }
        exchanged = await client.post("/api/app-sso/exchange", json=body)
        assert exchanged.status_code == 200, exchanged.text
        assert exchanged.headers["cache-control"] == "no-store"
        user = exchanged.json()["user"]
        assert set(user) == {"id", "username", "display_name", "locale"}
        assert user["id"] == local_user.id
        assert user["username"] == "app-viewer"
        assert "private-wecom-secret" not in exchanged.text
        assert "access_token" not in exchanged.text
        identities.append(user["id"])
        assert (await client.post("/api/app-sso/exchange", json=body)).status_code == 401
    assert identities == [local_user.id, local_user.id]
