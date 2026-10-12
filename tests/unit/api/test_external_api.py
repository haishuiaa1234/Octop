from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from octop.infra.agents.external_api import (
    ExternalApiRuntime,
    configure_external_api,
    external_api_config,
)


class _Repo:
    def __init__(self) -> None:
        self.row = SimpleNamespace(agent_id="agent-1", config_json="{}", external_api_json=None)

    def get(self, agent_id: str):
        return self.row if agent_id == self.row.agent_id else None

    def update_config(self, agent_id: str, *, external_api_json: str | None = None) -> None:
        self.row.external_api_json = external_api_json

    def list_all(self):
        return [self.row]


def test_configure_external_api_returns_one_time_key_and_hides_hash() -> None:
    repo = _Repo()
    key = configure_external_api(repo, "agent-1", enabled=True)

    assert key is not None
    cfg = external_api_config(repo.row)
    assert cfg["enabled"] is True
    assert cfg["key_prefix"] == key[:14]
    assert cfg["key_hash"] != key
    assert repo.row.config_json == "{}"


def test_external_api_runtime_authenticates_only_matching_agent() -> None:
    repo = _Repo()
    key = configure_external_api(repo, "agent-1", enabled=True)
    runtime = ExternalApiRuntime()

    assert runtime.authenticate(repo.list_all(), key or "") is repo.row
    assert runtime.authenticate(repo.list_all(), "wrong") is None


@pytest.mark.asyncio
async def test_external_api_task_returns_result_and_request_id_is_idempotent() -> None:
    runtime = ExternalApiRuntime()
    session = SimpleNamespace(
        session_id="session-1",
        agent_id="agent-1",
        user_id=1,
        thread_id="thread-1",
        request_tasks={},
    )

    class _Processor:
        async def iter_turn_chunks(self, _msg):
            yield {"type": "token", "content": "需求"}
            yield {"type": "token", "content": "分析"}
            yield {"type": "done"}

    server = SimpleNamespace(
        app_runtime=SimpleNamespace(gateway=SimpleNamespace(processor=_Processor()))
    )
    task = runtime.submit(
        server=server,
        session=session,
        message="请分析",
        request_id="req-1",
    )
    duplicate = runtime.submit(
        server=server,
        session=session,
        message="请分析",
        request_id="req-1",
    )
    await asyncio.gather(*runtime._tasks)

    assert duplicate is task
    assert task.status == "completed"
    assert task.result == "需求分析"
