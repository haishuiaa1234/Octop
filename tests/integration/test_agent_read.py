"""Unread badges belong to the viewer, including viewers of shared agents."""

from __future__ import annotations

import pytest

from tests.support.auth import create_user


@pytest.mark.parametrize("kind", ["expert", "team"])
@pytest.mark.parametrize("sharing", ["everyone", "user", "role", "private", "other_user"])
async def test_mark_read_respects_access_and_only_clears_viewer_sessions(
    env_with_provider, kind: str, sharing: str
) -> None:
    client, server, admin_auth = env_with_provider
    owner_auth = await create_user(client, admin_auth, username="read_owner")
    peer_auth = await create_user(client, admin_auth, username="read_peer")
    services = server.services
    owner = services.user_repo.get_by_username("read_owner")
    peer = services.user_repo.get_by_username("read_peer")
    assert owner is not None and peer is not None
    agent_id = "read-agent"
    services.agent_repo.create(agent_id=agent_id, user_id=owner.id, name="Unread expert", kind=kind)
    services.agent_repo.set_shared(agent_id, sharing == "everyone")
    services.agent_share_target_repo.replace_for_agent(
        agent_id,
        user_ids=[peer.id] if sharing == "user" else [owner.id] if sharing == "other_user" else [],
        role_ids=[peer.role] if sharing == "role" else [],
    )
    for user_id, channel, count in (
        (owner.id, "dashboard", 5),
        (peer.id, "dashboard", 2),
        (peer.id, "cron", 1),
    ):
        key = f"{agent_id}:{channel}:{user_id}"
        services.thread_repo.insert(
            thread_id=key,
            agent_id=agent_id,
            user_id=user_id,
            channel_type=channel,
            session_key=key,
        )
        services.session_repo.upsert(
            session_key=key,
            agent_id=agent_id,
            user_id=user_id,
            channel_type=channel,
            chat_type="dm",
            thread_id=key,
        )
        services.session_repo.increment_unread(key, delta=count)

    allowed = sharing in {"everyone", "user", "role"}
    if allowed:
        listed = await client.get("/api/agents", headers=peer_auth)
        assert listed.status_code == 200, listed.text
        assert next(a for a in listed.json() if a["agent_id"] == agent_id)["unread_count"] == 3

    response = await client.post(f"/api/agents/{agent_id}/read", headers=peer_auth)
    assert response.status_code == (204 if allowed else 403), response.text
    assert services.session_repo.unread_totals_by_agent(peer.id, [agent_id]) == (
        {} if allowed else {agent_id: 3}
    )
    assert services.session_repo.unread_totals_by_agent(owner.id, [agent_id]) == {agent_id: 5}

    if allowed:
        # Reloading the sidebar must not restore the red badge.
        listed = await client.get("/api/agents", headers=peer_auth)
        assert listed.status_code == 200, listed.text
        assert next(a for a in listed.json() if a["agent_id"] == agent_id)["unread_count"] == 0
        assert (
            await client.post(f"/api/agents/{agent_id}/read", headers=peer_auth)
        ).status_code == 204

        # Revoked sharing must no longer permit writes to read state.
        services.agent_repo.set_shared(agent_id, False)
        services.agent_share_target_repo.replace_for_agent(agent_id, user_ids=[], role_ids=[])
        assert (
            await client.post(f"/api/agents/{agent_id}/read", headers=peer_auth)
        ).status_code == 403

    assert (
        await client.post(f"/api/agents/{agent_id}/read", headers=owner_auth)
    ).status_code == 204
    assert services.session_repo.unread_totals_by_agent(owner.id, [agent_id]) == {}


async def test_mark_read_missing_agent_returns_not_found(env_with_provider) -> None:
    client, _server, admin_auth = env_with_provider
    response = await client.post("/api/agents/missing-agent/read", headers=admin_auth)
    assert response.status_code == 404
