"""Website routes remain mounted behind real Octop authentication."""

from tests.support.auth import create_user


async def test_website_routes_with_real_auth(env):
    client, _server, admin = env
    assert (await client.get("/api/websites")).status_code == 401
    response = await client.post(
        "/api/admin/websites",
        headers=admin,
        json={"name": "Project progress", "url": "http://intranet.example.test:5184/"},
    )
    assert response.status_code == 201
    website_id = response.json()["website_id"]
    viewer = await create_user(client, admin, username="website-viewer")
    response = await client.get("/api/websites", headers=viewer)
    assert [row["website_id"] for row in response.json()] == [website_id]
    assert (await client.get(f"/api/websites/{website_id}", headers=viewer)).status_code == 200
    assert (await client.get("/api/admin/websites", headers=viewer)).status_code == 403
    assert (
        await client.delete(f"/api/admin/websites/{website_id}", headers=viewer)
    ).status_code == 403
