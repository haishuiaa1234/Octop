"""External keys retain the async HTTP contract through the new JWT gate."""

import asyncio

from octop.infra.agents.external_api import ExternalApiRuntime


async def test_external_key_task_deduplication_rotation_and_disable(env_with_agent, monkeypatch):
    client, server, admin, agent_id = env_with_agent
    runtime = ExternalApiRuntime()
    monkeypatch.setattr("octop.api.routers.external_api.runtime", runtime)
    calls = []

    async def chunks(message):
        calls.append(message)
        yield {"type": "token", "content": "Verified "}
        yield {"type": "token", "content": "answer"}
        yield {"type": "done"}

    monkeypatch.setattr(server.app_runtime.gateway.processor, "iter_turn_chunks", chunks)
    config_url = f"/api/agents/{agent_id}/external-api"
    session_url = "/api/v1/expert-api/sessions"
    assert (await client.post(session_url, json={})).status_code == 401
    configured = await client.put(config_url, headers=admin, json={"enabled": True})
    assert configured.status_code == 200
    key = {"Authorization": "Bearer " + configured.json()["api_key"]}
    session = await client.post(session_url, headers=key, json={})
    assert session.status_code == 201
    assert session.json()["agent_id"] == agent_id
    message_url = f"{session_url}/{session.json()['session_id']}/messages"
    body = {"message": "Question", "request_id": "same-request"}
    submitted = await client.post(message_url, headers=key, json=body)
    assert submitted.status_code == 202
    duplicate = await client.post(message_url, headers=key, json=body)
    assert duplicate.status_code == 202
    assert duplicate.json()["task_id"] == submitted.json()["task_id"]
    await asyncio.gather(*runtime._tasks)
    task_url = f"/api/v1/expert-api/tasks/{submitted.json()['task_id']}"
    task = await client.get(task_url, headers=key)
    assert task.status_code == 200
    assert task.json()["status"] == "completed"
    assert task.json()["result"] == "Verified answer"
    assert len(calls) == 1
    assert calls[0].tenant_id == agent_id

    rotated = await client.put(config_url, headers=admin, json={"enabled": True, "rotate": True})
    assert rotated.status_code == 200
    assert (await client.get(task_url, headers=key)).status_code == 401
    new_key = {"Authorization": "Bearer " + rotated.json()["api_key"]}
    assert (await client.get(task_url, headers=new_key)).status_code == 200
    assert (await client.delete(config_url, headers=admin)).status_code == 204
    assert (await client.post(session_url, headers=new_key, json={})).status_code == 401
