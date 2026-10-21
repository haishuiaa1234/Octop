"""Sharing teams does not grant member configuration or other users' history."""

from __future__ import annotations

from pathlib import Path

import pytest

from tests.support.app import octop_client, write_octop_config
from tests.support.auth import create_agent, create_user


@pytest.fixture
async def team_env(env_with_provider):
    client, server, admin = env_with_provider
    owner = await create_user(client, admin, username="team_owner")
    peer = await create_user(client, admin, username="team_peer")
    members = [await create_agent(client, owner, name=f"member-{i}") for i in range(2)]
    response = await client.post(
        "/api/teams", headers=owner, json={"name": "Shared team", "member_ids": members}
    )
    assert response.status_code == 200, response.text
    return client, server, owner, peer, members, response.json()["team_id"]


async def test_team_sharing_visibility_and_revocation(team_env):
    client, _server, owner, peer, members, team_id = team_env
    url = f"/api/teams/{team_id}"
    assert (await client.get(url, headers=peer)).status_code == 403
    assert not (await client.get("/api/teams", headers=peer)).json()

    response = await client.patch(url, headers=owner, json={"is_shared": True})
    assert response.status_code == 200, response.text
    assert response.json()["is_shared"] is True
    assert response.json()["is_owner"] is True
    owned = (await client.get("/api/agents", headers=owner)).json()
    own_team = next(row for row in owned if row["agent_id"] == team_id)
    assert own_team["owner_username"] == "team_owner"
    visible = (await client.get("/api/teams", headers=peer)).json()
    assert [row["team_id"] for row in visible] == [team_id]
    assert visible[0]["is_owner"] is False
    assert visible[0]["owner_username"] == "team_owner"
    assert (await client.get(url, headers=peer)).status_code == 200
    agents = (await client.get("/api/agents", headers=peer)).json()
    assert team_id in {row["agent_id"] for row in agents}
    assert not set(members) & {row["agent_id"] for row in agents}
    for member_id in members:
        response = await client.get(f"/api/agents/{member_id}/workspace/tree", headers=peer)
        assert response.status_code == 403, response.text
        response = await client.post(f"/api/agents/{member_id}/threads", headers=peer)
        assert response.status_code == 403, response.text

    response = await client.patch(url, headers=owner, json={"is_shared": False})
    assert response.status_code == 200, response.text
    assert response.json()["is_shared"] is False
    assert (await client.get(url, headers=peer)).status_code == 403
    assert not (await client.get("/api/teams", headers=peer)).json()
    assert (await client.get(f"/api/agents/{team_id}/threads", headers=peer)).status_code == 403


async def test_team_can_be_created_shared(team_env):
    client, _server, owner, peer, members, _team_id = team_env
    response = await client.post(
        "/api/teams",
        headers=owner,
        json={"name": "Shared at creation", "member_ids": members, "is_shared": True},
    )
    assert response.status_code == 200, response.text
    assert response.json()["is_shared"] is True
    team_id = response.json()["team_id"]
    assert (await client.get(f"/api/teams/{team_id}", headers=peer)).status_code == 200


async def test_shared_team_mutations_remain_owner_only(team_env):
    client, _server, owner, peer, members, team_id = team_env
    response = await client.patch(f"/api/agents/{team_id}", headers=owner, json={"is_shared": True})
    assert response.status_code == 200, response.text
    for body in ({"name": "Stolen"}, {"member_ids": members[::-1]}, {"is_shared": False}):
        response = await client.patch(f"/api/teams/{team_id}", headers=peer, json=body)
        assert response.status_code == 403, response.text
    assert (await client.delete(f"/api/teams/{team_id}", headers=peer)).status_code == 403
    for action in ("start", "stop", "reload"):
        response = await client.post(f"/api/agents/{team_id}/{action}", headers=peer)
        assert response.status_code == 403, response.text
    response = await client.patch(f"/api/agents/{team_id}", headers=peer, json={"is_shared": False})
    assert response.status_code == 403, response.text


async def test_shared_team_threads_and_history_are_user_scoped(team_env):
    client, _server, owner, peer, _members, team_id = team_env
    response = await client.patch(f"/api/teams/{team_id}", headers=owner, json={"is_shared": True})
    assert response.status_code == 200, response.text
    url = f"/api/agents/{team_id}/threads"
    owner_thread = await client.post(url, headers=owner)
    peer_thread = await client.post(url, headers=peer)
    assert owner_thread.status_code == peer_thread.status_code == 201
    owner_tid = owner_thread.json()["thread_id"]
    peer_tid = peer_thread.json()["thread_id"]
    assert owner_tid != peer_tid
    assert owner_thread.json()["session_key"] != peer_thread.json()["session_key"]
    assert [row["thread_id"] for row in (await client.get(url, headers=owner)).json()] == [
        owner_tid
    ]
    assert [row["thread_id"] for row in (await client.get(url, headers=peer)).json()] == [peer_tid]
    for auth, foreign_tid in ((owner, peer_tid), (peer, owner_tid)):
        response = await client.get(f"{url}/{foreign_tid}/history", headers=auth)
        assert response.status_code == 403, response.text
        response = await client.delete(f"{url}/{foreign_tid}", headers=auth)
        assert response.status_code == 403, response.text


async def test_private_member_avatar_is_readable_only_through_current_shared_team(team_env):
    client, _server, owner, peer, members, team_id = team_env
    member_id = members[0]
    image = b"\x89PNG\r\n\x1a\n" + b"avatar-test"
    response = await client.post(
        f"/api/agents/{member_id}/avatar",
        headers=owner,
        files={"file": ("avatar.png", image, "image/png")},
    )
    assert response.status_code == 201, response.text
    response = await client.patch(f"/api/teams/{team_id}", headers=owner, json={"is_shared": True})
    assert response.status_code == 200, response.text
    detail = (await client.get(f"/api/teams/{team_id}", headers=peer)).json()
    member = next(row for row in detail["members"] if row["agent_id"] == member_id)
    avatar_url = member["icon_url"]
    assert avatar_url.startswith(f"/api/teams/{team_id}/members/{member_id}/avatar")
    response = await client.get(avatar_url, headers=peer)
    assert response.status_code == 200, response.text
    assert response.content == image
    assert response.headers["content-type"] == "image/png"
    assert (await client.get(f"/api/agents/{member_id}/avatar", headers=peer)).status_code == 403
    outsider = await create_agent(client, owner, name="outside-roster")
    response = await client.get(f"/api/teams/{team_id}/members/{outsider}/avatar", headers=peer)
    assert response.status_code == 400, response.text
    response = await client.patch(
        f"/api/teams/{team_id}", headers=owner, json={"member_ids": [members[1], outsider]}
    )
    assert response.status_code == 200, response.text
    assert (await client.get(avatar_url, headers=peer)).status_code == 400
    response = await client.patch(f"/api/teams/{team_id}", headers=owner, json={"is_shared": False})
    assert response.status_code == 200, response.text
    assert (await client.get(avatar_url, headers=peer)).status_code == 403


async def test_team_member_avatar_rechecks_member_owner_sharing(team_env, env_with_provider):
    client, _server, owner, peer, members, team_id = team_env
    author = await create_user(client, env_with_provider[2], username="avatar_author")
    member_id = await create_agent(client, author, name="shared-portrait")
    image = b"\x89PNG\r\n\x1a\n" + b"shared-avatar"
    response = await client.post(
        f"/api/agents/{member_id}/avatar",
        headers=author,
        files={"file": ("avatar.png", image, "image/png")},
    )
    assert response.status_code == 201, response.text
    response = await client.patch(
        f"/api/agents/{member_id}", headers=author, json={"is_shared": True}
    )
    assert response.status_code == 200, response.text
    response = await client.patch(
        f"/api/teams/{team_id}",
        headers=owner,
        json={"is_shared": True, "member_ids": [members[0], member_id]},
    )
    assert response.status_code == 200, response.text
    avatar_url = f"/api/teams/{team_id}/members/{member_id}/avatar"
    assert (await client.get(avatar_url, headers=peer)).content == image
    response = await client.patch(
        f"/api/agents/{member_id}", headers=author, json={"is_shared": False}
    )
    assert response.status_code == 200, response.text
    assert (await client.get(avatar_url, headers=peer)).status_code == 400


async def test_team_openapi_has_typed_shared_responses(tmp_octop_home: Path):
    write_octop_config(tmp_octop_home, enable_api_docs=True)
    async with octop_client(tmp_octop_home, patch_llm=False) as (client, _server):
        response = await client.get("/api/openapi.json")
        assert response.status_code == 200, response.text
        schema = response.json()
        response_schema = schema["paths"]["/api/teams/{team_id}"]["get"]["responses"]["200"][
            "content"
        ]["application/json"]["schema"]
        assert response_schema["$ref"].endswith("/TeamResponse")
        assert "is_shared" in schema["components"]["schemas"]["TeamResponse"]["properties"]
        assert (await client.get("/api/docs")).status_code == 200
