"""Team allowlists can see shared experts owned by another account."""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from octop_harness.config import HarnessAgentConfig, ModelConfig, ProviderConfig
from octop_harness.manager import HarnessAgentManager
from octop_harness.teams.inbox import InboxMessage

from octop.infra.agents.teams.team_manager import wire_host_dispatch, wire_shared_member_peers


def _config(
    tmp_path: Path, *, name: str = "agent", team_peers: tuple[str, ...] | None = None
) -> HarnessAgentConfig:
    cfg = HarnessAgentConfig(
        workspace_dir=tmp_path,
        providers=[
            ProviderConfig(
                id="openai",
                base_url="https://api.openai.com/v1",
                api_key="sk-test",
                models=[ModelConfig(id="gpt-4", enabled=True)],
            )
        ],
        default_model="openai/gpt-4",
        name=name,
    )
    if team_peers is None:
        return cfg
    return replace(cfg, team_peers=team_peers)


def _row(*, user_id: int, is_shared: int = 0, kind: str = "expert") -> SimpleNamespace:
    return SimpleNamespace(user_id=user_id, is_shared=is_shared, kind=kind)


def _registry(tmp_path: Path) -> tuple[HarnessAgentManager, dict[str, SimpleNamespace]]:
    rows = {
        "host": _row(user_id=3, kind="team"),
        "exp-a": _row(user_id=1, is_shared=1),
        "exp-b": _row(user_id=2, is_shared=1),
        "mine": _row(user_id=3),
        "private": _row(user_id=1, is_shared=0),
    }
    mock_agent = MagicMock()
    mock_agent.init_workspace.return_value = MagicMock()
    mock_agent.call = AsyncMock(return_value={"messages": []})
    with patch("octop_harness.manager.HarnessAgent", return_value=mock_agent):
        mgr = HarnessAgentManager()
        mgr.create_agent(
            _config(
                tmp_path / "host",
                name="host",
                team_peers=("mine", "exp-a", "exp-b", "private", "ghost"),
            ),
            agent_id="host",
            metadata={"user_id": 3, "display_name": "团队"},
        )
        mgr.create_agent(
            _config(tmp_path / "a", name="agent_a"),
            agent_id="exp-a",
            metadata={"user_id": 1, "display_name": "专家甲"},
        )
        mgr.create_agent(
            _config(tmp_path / "b", name="agent_b"),
            agent_id="exp-b",
            metadata={"user_id": 2, "display_name": "专家乙"},
        )
        mgr.create_agent(
            _config(tmp_path / "mine", name="mine"),
            agent_id="mine",
            metadata={"user_id": 3, "display_name": "自己的"},
        )
        mgr.create_agent(
            _config(tmp_path / "private", name="private"),
            agent_id="private",
            metadata={"user_id": 1, "display_name": "私有"},
        )
    return mgr, rows


def _wire(
    mgr: HarnessAgentManager,
    rows: dict[str, SimpleNamespace],
    *,
    admin: bool = False,
    roster: list[str] | None = None,
) -> None:
    def load_user(user_id: int) -> Any:
        return SimpleNamespace(id=user_id, is_admin=admin)

    wire_shared_member_peers(
        mgr.team,
        load_agent=rows.get,
        load_user=load_user,
        load_member_ids=lambda _host_id: list(
            roster if roster is not None else ["mine", "exp-a", "exp-b", "private", "ghost"]
        ),
    )


def test_host_lists_shared_members_and_skips_private(tmp_path: Path) -> None:
    mgr, rows = _registry(tmp_path)
    _wire(mgr, rows)
    peers = mgr.team.list_peers(3, exclude_agent_id="host")
    assert {entry.agent_id for entry in peers} == {"mine", "exp-a", "exp-b"}
    found = mgr.team.resolve_peer(3, "专家甲", exclude_agent_id="host")
    assert found is not None
    assert found.agent_id == "exp-a"
    assert mgr.team._resolve_peer_entry("host", "exp-a", 3).agent_id == "exp-a"
    with pytest.raises(ValueError, match="not owned by user"):
        mgr.team._resolve_peer_entry("host", "private", 3)


def test_request_allowlist_narrows_host_roster(tmp_path: Path) -> None:
    mgr, rows = _registry(tmp_path)
    _wire(mgr, rows)
    peers = mgr.team.list_peers(3, exclude_agent_id="host", team_peers=["exp-b", "private"])
    assert [entry.agent_id for entry in peers] == ["exp-b"]


def test_member_request_allowlist_sees_shared_colleague(tmp_path: Path) -> None:
    mgr, rows = _registry(tmp_path)
    _wire(mgr, rows)
    peers = mgr.team.list_peers(3, exclude_agent_id="exp-a", team_peers=("exp-b", "private"))
    assert [entry.agent_id for entry in peers] == ["exp-b"]
    with patch(
        "octop_harness.teams.team_manager._request_team_peers",
        return_value=("exp-b",),
    ):
        entry = mgr.team._resolve_peer_entry("exp-a", "exp-b", 3)
    assert entry.agent_id == "exp-b"
    with (
        patch(
            "octop_harness.teams.team_manager._request_team_peers",
            return_value=("private",),
        ),
        pytest.raises(ValueError, match="not owned by user"),
    ):
        mgr.team._resolve_peer_entry("exp-a", "private", 3)


def test_ordinary_expert_does_not_list_other_users_shared_experts(tmp_path: Path) -> None:
    mgr, rows = _registry(tmp_path)
    _wire(mgr, rows)
    peers = mgr.team.list_peers(1, exclude_agent_id="exp-a")
    assert [entry.agent_id for entry in peers] == ["private"]


def test_wire_twice_does_not_duplicate_members(tmp_path: Path) -> None:
    mgr, rows = _registry(tmp_path)
    _wire(mgr, rows)
    _wire(mgr, rows)
    peers = mgr.team.list_peers(3, exclude_agent_id="host")
    assert [entry.agent_id for entry in peers].count("exp-a") == 1


def test_admin_may_dispatch_private_member_on_roster(tmp_path: Path) -> None:
    mgr, rows = _registry(tmp_path)
    _wire(mgr, rows, admin=True)
    peers = mgr.team.list_peers(3, exclude_agent_id="host")
    assert {entry.agent_id for entry in peers} == {"mine", "exp-a", "exp-b", "private"}
    assert mgr.team._resolve_peer_entry("host", "private", 3).agent_id == "private"


def test_shared_host_delegates_only_current_usable_roster(tmp_path: Path) -> None:
    mgr, rows = _registry(tmp_path)
    rows["host"].is_shared = 1
    _wire(mgr, rows, roster=["mine", "exp-a", "private"])
    peers = mgr.team.list_peers(4, exclude_agent_id="host")
    assert {entry.agent_id for entry in peers} == {"mine", "exp-a"}
    assert mgr.team._resolve_peer_entry("host", "mine", 4).agent_id == "mine"
    for denied in ("exp-b", "private", "host"):
        with pytest.raises(ValueError):
            mgr.team._resolve_peer_entry("host", denied, 4)


def test_revoked_or_removed_roster_cannot_bypass_original_resolver(tmp_path: Path) -> None:
    mgr, rows = _registry(tmp_path)
    rows["host"].is_shared = 1
    roster = ["mine", "exp-a"]
    _wire(mgr, rows, roster=roster)
    assert mgr.team._resolve_peer_entry("host", "mine", 4).agent_id == "mine"
    roster.remove("mine")
    # Even the member's own user must not bypass the team's current roster.
    with pytest.raises(ValueError):
        mgr.team._resolve_peer_entry("host", "mine", 3)
    assert [entry.agent_id for entry in mgr.team.list_peers(3, exclude_agent_id="host")] == [
        "exp-a"
    ]
    rows["host"].is_shared = 0
    assert mgr.team.list_peers(1, exclude_agent_id="host") == []
    with pytest.raises(ValueError):
        mgr.team._resolve_peer_entry("host", "exp-a", 1)


def test_member_delegation_requires_current_shared_host_and_caller_membership(
    tmp_path: Path,
) -> None:
    mgr, rows = _registry(tmp_path)
    rows["host"].is_shared = 1
    roster = ["exp-a", "mine"]
    _wire(mgr, rows, roster=roster)
    with patch(
        "langgraph.config.get_config",
        return_value={"configurable": {"team_host_agent_id": "host", "team_peers": ["mine"]}},
    ):
        assert mgr.team._resolve_peer_entry("exp-a", "mine", 4).agent_id == "mine"
        assert [e.agent_id for e in mgr.team.list_peers(4, exclude_agent_id="exp-a")] == ["mine"]
        with pytest.raises(ValueError):
            mgr.team._resolve_peer_entry("private", "mine", 4)
        roster.remove("exp-a")
        with pytest.raises(ValueError):
            mgr.team._resolve_peer_entry("exp-a", "mine", 4)
        roster.append("exp-a")
        rows["host"].is_shared = 0
        with pytest.raises(ValueError):
            mgr.team._resolve_peer_entry("exp-a", "mine", 4)


def test_roster_override_alone_cannot_delegate_private_members(tmp_path: Path) -> None:
    mgr, rows = _registry(tmp_path)
    rows["host"].is_shared = 1
    _wire(mgr, rows, roster=["exp-a", "mine"])
    with (
        patch(
            "langgraph.config.get_config", return_value={"configurable": {"team_peers": ["mine"]}}
        ),
        pytest.raises(ValueError),
    ):
        mgr.team._resolve_peer_entry("exp-a", "mine", 4)


@pytest.mark.asyncio
async def test_delegated_peer_request_retains_chatting_user(tmp_path: Path) -> None:
    mgr, rows = _registry(tmp_path)
    rows["host"].is_shared = 1
    _wire(mgr, rows, roster=["mine", "exp-a"])
    await mgr.team.call_peer(from_agent_id="host", to_agent_id="mine", user_id=4, message="help")
    request = mgr.team._registry.get("mine").agent.call.call_args.args[0]
    assert str(request.user) == "4"


@pytest.mark.parametrize("host_id", ["missing", "mine"])
def test_invalid_team_context_cannot_grant_member_access(tmp_path: Path, host_id: str) -> None:
    mgr, rows = _registry(tmp_path)
    _wire(mgr, rows, roster=["exp-a", "mine"])
    with (
        patch(
            "langgraph.config.get_config",
            return_value={"configurable": {"team_host_agent_id": host_id, "team_peers": ["mine"]}},
        ),
        pytest.raises(ValueError),
    ):
        mgr.team._resolve_peer_entry("exp-a", "mine", 4)


def test_member_unshared_by_another_owner_stops_delegation(tmp_path: Path) -> None:
    mgr, rows = _registry(tmp_path)
    rows["host"].is_shared = 1
    _wire(mgr, rows, roster=["exp-a", "mine"])
    assert mgr.team._resolve_peer_entry("host", "exp-a", 4).agent_id == "exp-a"
    rows["exp-a"].is_shared = 0
    with pytest.raises(ValueError):
        mgr.team._resolve_peer_entry("host", "exp-a", 4)


@pytest.mark.asyncio
@pytest.mark.parametrize("stream_order", ["before", "after", None])
@pytest.mark.parametrize("revocation", ["sharing", "roster", "member"])
async def test_queued_team_job_rechecks_authorization_before_execution(
    tmp_path: Path, stream_order: str | None, revocation: str
) -> None:
    mgr, rows = _registry(tmp_path)
    rows["host"].is_shared = 1
    roster = ["mine", "exp-a"]
    stream = AsyncMock(return_value={"messages": []})

    def wire_stream() -> None:
        wire_host_dispatch(mgr.team, is_team=lambda aid: aid == "host", stream_peer=stream)

    if stream_order == "before":
        wire_stream()
    _wire(mgr, rows, roster=roster)
    if stream_order == "after":
        wire_stream()
    assert mgr.team._resolve_peer_entry("host", "exp-a", 4).agent_id == "exp-a"
    if revocation == "sharing":
        rows["host"].is_shared = 0
    elif revocation == "roster":
        roster.remove("exp-a")
    else:
        rows["exp-a"].is_shared = 0
    with pytest.raises(ValueError):
        await mgr.team._invoke_inbox_target(
            InboxMessage(
                id="queued-job",
                source_agent_id="host",
                target_agent_id="exp-a",
                user_id=4,
                message="help",
                source_thread_id="room",
            )
        )
    stream.assert_not_awaited()
    mgr.team._registry.get("exp-a").agent.call.assert_not_awaited()
