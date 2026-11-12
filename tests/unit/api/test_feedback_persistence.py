"""Feedback snapshots use projected messages and survive regeneration."""

from types import SimpleNamespace

import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from octop.infra.db.migrate import run_migrations
from octop.infra.db.pool import SqlitePool
from octop.infra.db.services import RepoBundle
from octop.infra.errors import OctopError
from octop.infra.feedback import FeedbackService
from octop.infra.history.projection import live_message_inputs, message_inputs
from octop.infra.users.identity import User


@pytest.mark.asyncio
async def test_feedback_snapshot_update_regeneration_and_withdrawal(tmp_path):
    db = SqlitePool(tmp_path / "control.sqlite")
    run_migrations(db)
    repos = RepoBundle.from_pool(db)
    uid = repos.user_repo.create(username="test", password_hash="x", role="user")
    repos.agent_repo.create(agent_id="a", user_id=uid, name="Expert")
    repos.agent_repo.create(agent_id="speaker", user_id=None, name="Actual speaker")
    repos.thread_repo.insert(
        thread_id="t", agent_id="a", user_id=uid, channel_type="dashboard", session_key="s"
    )
    repos.thread_message_repo.mark_projection("t", "ready")
    repos.thread_message_repo.append_if_ready(
        "t",
        message_inputs(
            [
                HumanMessage(content="Question", id="q"),
                AIMessage(
                    content="Original", id="a1", additional_kwargs={"speaker_agent_id": "speaker"}
                ),
            ]
        ),
    )
    service = FeedbackService(SimpleNamespace(services=repos, app_runtime=SimpleNamespace()))
    user = User(uid, "test", "user", None)
    data = {"message_id": "a1", "rating": "helpful"}
    first = await service.save(user, "a", "t", data)
    assert (first["question"], first["answer"]) == ("Question", "Original")
    assert (first["agent_id"], first["agent_name"]) == ("speaker", "Actual speaker")
    repos.thread_message_repo.append_if_ready(
        "t",
        message_inputs(
            [
                HumanMessage(content="Second question", id="q2"),
                AIMessage(content="<think>private</think>Regenerated", id="a2"),
            ]
        ),
    )
    updated = await service.save(user, "a", "t", {**data, "comment": "Edited"})
    assert updated["feedback_id"] == first["feedback_id"]
    assert updated["answer"] == "Original"
    assert updated["comment"] == "Edited"
    second = await service.save(user, "a", "t", {**data, "message_id": "a2"})
    assert second["answer"] == "Regenerated"
    repos.thread_message_repo.append_if_ready(
        "t",
        live_message_inputs(
            [
                AIMessage(
                    content="Team early",
                    id="team-early",
                    additional_kwargs={"speaker_agent_id": "speaker"},
                ),
                ToolMessage(content="private tool output", tool_call_id="tool", id="tool-result"),
                AIMessage(
                    content="Team final",
                    id="team-final",
                    additional_kwargs={"speaker_agent_id": "speaker"},
                ),
                HumanMessage(content="Later unrelated question", id="future-q"),
                AIMessage(content="Later answer", id="future-a"),
            ]
        ),
    )
    team = await service.save(user, "a", "t", {**data, "message_id": "team-final"})
    assert team["answer"] == "Team early Team final"
    assert team["question"] == "Second question"
    assert team["agent_id"] == "speaker"
    await service.delete(user, "a", "t", "team-final")
    assert len(await service.list(user, "a", "t")) == 2
    with db.transaction() as conn:
        conn.execute("DELETE FROM thread_messages WHERE thread_id='t'")
    service.server.app_runtime.gateway = SimpleNamespace(
        ws_hub=SimpleNamespace(is_turn_active=lambda _: True)
    )
    updated = await service.save(user, "a", "t", {**data, "comment": "Edited without history"})
    assert updated["answer"] == "Original"
    with pytest.raises(OctopError) as exc:
        await service.save(user, "a", "t", {**data, "message_id": "generating"})
    assert exc.value.code.value == "AGENT_BUSY"
    rows = repos.feedback_repo.query(
        {"start_time": first["created_at"], "end_time": second["created_at"] + 1}
    )
    assert len(rows) == 2
    assert repos.feedback_repo.query({"end_time": first["created_at"]}) == []
    await service.delete(user, "a", "t", "a1")
    assert len(await service.list(user, "a", "t")) == 1
    db.close()
