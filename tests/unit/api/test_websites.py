"""External website CRUD and access checks against a real temporary database."""

from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI

from octop.api.app import _install_exception_handlers
from octop.api.deps import current_user, get_server
from octop.config import OctopConfig
from octop.infra.db.migrate import run_migrations
from octop.infra.db.pool import SqlitePool
from octop.infra.db.services import build_shared_services
from octop.infra.users.identity import Role, User
from octop.infra.utils.paths import PathLayout


@pytest.fixture
async def websites(tmp_path):
    from octop.api.routers.websites import router

    db = SqlitePool(tmp_path / "websites.db")
    run_migrations(db)
    services = build_shared_services(db=db, paths=PathLayout(tmp_path), config=OctopConfig())
    admin_id = services.user_repo.create(username="admin", role="admin")
    alice_id = services.user_repo.create(username="alice", role="user")
    bob_id = services.user_repo.create(username="bob", role="user")
    identities = [
        User(i, name, role, None)
        for i, name, role in [
            (admin_id, "admin", Role.ADMIN),
            (alice_id, "alice", Role.USER),
            (bob_id, "bob", Role.USER),
        ]
    ]
    app = FastAPI()
    app.include_router(router, prefix="/api")
    _install_exception_handlers(app)
    app.dependency_overrides[get_server] = lambda: SimpleNamespace(services=services)
    app.dependency_overrides[current_user] = lambda: identities[0]
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client, app, identities, services
    db.close()


def payload(**overrides):
    return {"name": "项目进度", "url": "http://172.16.18.6:5184/", **overrides}


async def test_website_management_requires_admin(websites):
    client, app, identities, _ = websites
    app.dependency_overrides[current_user] = lambda: identities[1]
    for method, path, body in [
        ("GET", "/api/admin/websites", None),
        ("GET", "/api/admin/websites/users", None),
        ("POST", "/api/admin/websites", payload()),
        ("PUT", "/api/admin/websites/missing", payload()),
        ("DELETE", "/api/admin/websites/missing", None),
    ]:
        response = await client.request(method, path, json=body)
        assert response.status_code == 403


async def test_crud_visibility_sort_and_revocation(websites):
    client, app, identities, services = websites
    alice = identities[1]
    public = await client.post("/api/admin/websites", json=payload(sort_order=10))
    assert public.status_code == 201
    public_id = public.json()["website_id"]
    private = await client.post(
        "/api/admin/websites",
        json=payload(name="Restricted", visibility="selected", user_ids=[alice.id], sort_order=-1),
    )
    assert private.status_code == 201
    private_id = private.json()["website_id"]
    await client.post("/api/admin/websites", json=payload(name="Offline", enabled=False))
    # Each entry is independent and persists in the existing configuration store.
    assert services.settings_repo.get(f"custom.websites.v1.{public_id}") is not None
    app.dependency_overrides[current_user] = lambda: alice
    assert [r["website_id"] for r in (await client.get("/api/websites")).json()] == [
        private_id,
        public_id,
    ]
    assert "user_ids" not in (await client.get(f"/api/websites/{private_id}")).json()
    app.dependency_overrides[current_user] = lambda: identities[2]
    assert len((await client.get("/api/websites")).json()) == 1
    assert (await client.get(f"/api/websites/{private_id}")).status_code == 404
    app.dependency_overrides[current_user] = lambda: identities[0]
    assert len((await client.get("/api/admin/websites")).json()) == 3
    assert (
        await client.put(f"/api/admin/websites/{public_id}", json=payload(enabled=False))
    ).status_code == 200
    assert (await client.get(f"/api/websites/{public_id}")).status_code == 404
    assert (await client.delete(f"/api/admin/websites/{private_id}")).status_code == 204
    assert (
        await client.put(f"/api/admin/websites/{private_id}", json=payload())
    ).status_code == 404
    app.dependency_overrides[current_user] = lambda: alice
    assert (await client.get("/api/websites")).json() == []
    assert (await client.get(f"/api/websites/{private_id}")).status_code == 404


@pytest.mark.parametrize(
    "url",
    [
        "javascript:alert(1)",
        "data:text/html,hi",
        "file:///tmp/a",
        "/local",
        "http://user:secret@example.com",
        "http://example.com\\@evil.com",
        "http://example.com/\nfoo",
        "http://%/",
    ],
)
async def test_reject_unsafe_urls(websites, url):
    client, _, _, _ = websites
    assert (await client.post("/api/admin/websites", json=payload(url=url))).status_code == 422


async def test_validate_recipients_and_normalize_name(websites):
    client, _, _, _ = websites
    assert (await client.post("/api/admin/websites", json=payload(name="   "))).status_code == 422
    assert (
        await client.post("/api/admin/websites", json=payload(visibility="selected", user_ids=[]))
    ).status_code == 422
    assert (
        await client.post(
            "/api/admin/websites", json=payload(visibility="selected", user_ids=[99999])
        )
    ).status_code == 422
    saved = await client.post("/api/admin/websites", json=payload(name="  项目进度  "))
    assert saved.json()["name"] == "项目进度"


async def test_openapi_has_typed_models_and_summaries(websites):
    _, app, _, _ = websites
    schema = app.openapi()
    for path, operations in schema["paths"].items():
        for operation in operations.values():
            assert operation["summary"], path
    assert schema["paths"]["/api/websites/{website_id}"]["get"]["responses"]["200"]["content"][
        "application/json"
    ]["schema"]["$ref"]
