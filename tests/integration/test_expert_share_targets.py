"""Expert creation preserves explicit recipients alongside group visibility."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from octop.infra.agents.manager import AgentCreateSpec
from octop.infra.db.repos.user_roles import UserRoleRepo
from tests.support.auth import create_user


async def _install_url(env: Any, source: str, monkeypatch: pytest.MonkeyPatch) -> str:
    client, server, auth = env
    if source == "builtin":
        return "/api/agents/from-expert/default"
    if source == "published":
        created = await client.post(
            "/api/agents/from-expert/default", headers=auth, json={"name": "source"}
        )
        assert created.status_code == 201, created.text
        published = await client.post(
            f"/api/agents/{created.json()['agent_id']}/publish-expert",
            headers=auth,
            json={"name": "Shared template"},
        )
        assert published.status_code == 201, published.text
        return f"/api/experts/published/{published.json()['id']}/install"

    from octop.api.routers import experts

    async def create_market_agent(**kwargs: Any) -> Any:
        row = await server.app_runtime.agent_registry.create(
            AgentCreateSpec(name=kwargs["options"].name, user_id=kwargs["user"].id),
            defer_bootstrap=True,
        )
        return SimpleNamespace(
            row=row,
            expert_id="market-expert",
            icon_name=None,
            color=None,
            slug="market-expert",
            welcome_enrichment="skipped",
        )

    monkeypatch.setattr(experts, "create_skillhub_market_agent", create_market_agent)
    return "/api/experts/hub/market-expert/install"


@pytest.mark.parametrize("source", ["builtin", "published", "market"])
@pytest.mark.parametrize("visibility", ["owner", "groups"])
async def test_expert_creation_keeps_recipients_and_audience(
    env: Any, monkeypatch: pytest.MonkeyPatch, source: str, visibility: str
) -> None:
    client, server, admin_auth = env
    url = await _install_url(env, source, monkeypatch)
    UserRoleRepo(server.services.db).create(
        user_role_id="ops", user_role_name="Operations", permissions=[], policies=[]
    )
    owner = await create_user(client, admin_auth, username="owner")
    direct = await create_user(client, admin_auth, username="direct")
    role = await create_user(client, admin_auth, username="role", role="ops")
    outsider = await create_user(client, admin_auth, username="outsider")
    direct_id = server.services.user_repo.get_by_username("direct").id
    group = server.services.repos.user_group_repo.create(name="restricted", description=None)
    group_ids = [group.user_group_id] if visibility == "groups" else []
    response = await client.post(
        url,
        headers=owner,
        json={
            "name": "targeted-expert",
            "visibility": visibility,
            "group_ids": group_ids,
            "shared_user_ids": [direct_id, direct_id],
            "shared_role_ids": ["ops", " ops "],
        },
    )
    assert response.status_code == 201, response.text
    agent_id = response.json()["agent_id"]
    detail = await client.get(f"/api/agents/{agent_id}", headers=owner)
    assert detail.status_code == 200, detail.text
    assert detail.json()["shared_user_ids"] == [direct_id]
    assert detail.json()["shared_role_ids"] == ["ops"]
    assert detail.json()["visibility"] == visibility
    assert detail.json()["group_ids"] == group_ids
    assert detail.json()["is_shared"] is (visibility != "owner")
    for recipient in (direct, role):
        result = await client.get(f"/api/agents/{agent_id}", headers=recipient)
        assert result.status_code == 200, result.text
    assert (await client.get(f"/api/agents/{agent_id}", headers=outsider)).status_code == 403
    if visibility == "groups":
        outsider_id = server.services.user_repo.get_by_username("outsider").id
        server.services.repos.user_group_member_repo.add(group.user_group_id, outsider_id)
        assert (await client.get(f"/api/agents/{agent_id}", headers=outsider)).status_code == 200


@pytest.mark.parametrize("source", ["builtin", "published", "market"])
@pytest.mark.parametrize(
    "targets", [{"shared_user_ids": [999999]}, {"shared_role_ids": ["missing-role"]}]
)
async def test_expert_creation_rejects_unknown_recipients_before_creation(
    env: Any, monkeypatch: pytest.MonkeyPatch, source: str, targets: dict[str, Any]
) -> None:
    client, _server, auth = env
    url = await _install_url(env, source, monkeypatch)
    before = (await client.get("/api/agents", headers=auth)).json()
    response = await client.post(url, headers=auth, json={"name": "invalid-target", **targets})
    assert response.status_code == 404, response.text
    assert response.json()["error"]["code"] == "NOT_FOUND"
    after = (await client.get("/api/agents", headers=auth)).json()
    assert {row["agent_id"] for row in after} == {row["agent_id"] for row in before}
