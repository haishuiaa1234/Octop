"""Answer feedback validation and trusted snapshot extraction."""

from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from octop.api.deps import current_user, get_server
from octop.api.routers.feedback import FeedbackInput, router
from octop.infra.errors import OctopError
from octop.infra.feedback import FeedbackService, answer_snapshot
from octop.infra.users.identity import User


def test_negative_feedback_requires_reason():
    with pytest.raises(ValueError):
        FeedbackInput(message_id="answer", rating="unhelpful")


def test_snapshot_only_captures_visible_body():
    messages = [
        {"type": "human", "data": {"id": "q", "content": "Question"}},
        {
            "type": "ai",
            "data": {
                "id": "a",
                "content": [
                    {"type": "thinking", "thinking": "secret"},
                    {"type": "text", "text": "Answer"},
                ],
            },
        },
    ]
    assert answer_snapshot(messages, "a") == ("Question", "Answer")
    with pytest.raises(ValueError):
        answer_snapshot(messages, "q")


def test_snapshot_strips_inline_thinking():
    assert answer_snapshot(
        [
            {"role": "user", "id": "q", "content": "Question"},
            {"role": "assistant", "id": "a", "content": "<think>secret</think>Visible"},
        ],
        "a",
    ) == ("Question", "Visible")


@pytest.mark.parametrize(
    "speaker,expected", [("", "Conclusion"), ("member", "Earlier error Conclusion")]
)
def test_snapshot_matches_visible_fragment_grouping(speaker, expected):
    def wire(role, identity, content, **extra):
        return {
            "type": role,
            "data": {
                "id": identity,
                "content": content,
                "additional_kwargs": {"speaker_agent_id": speaker},
                **extra,
            },
        }

    messages = [
        wire("human", "q", "Question"),
        wire("ai", "a0", "Earlier error"),
        wire("ai", "call", "", tool_calls=[{"name": "search"}]),
        wire("tool", "tool", "result"),
        wire("ai", "a1", "Conclusion"),
    ]
    assert answer_snapshot(messages, "a1") == ("Question", expected)


def test_snapshot_allows_attachment_only_question_without_embedding_data():
    assert answer_snapshot(
        [
            {
                "role": "user",
                "id": "q",
                "content": [{"type": "image_url", "image_url": "data:image/png;base64,private"}],
            },
            {"role": "assistant", "id": "a", "content": "Answer"},
        ],
        "a",
    ) == ("", "Answer")


@pytest.mark.asyncio
async def test_domain_rejects_invalid_evaluation():
    service = FeedbackService(SimpleNamespace(services=None))
    with pytest.raises(ValueError):
        await service.save(
            User(1, "one", "user", None), "a", "t", {"message_id": "a", "rating": "unhelpful"}
        )


@pytest.mark.asyncio
async def test_routes_validation_and_pagination():
    user = User(1, "admin", "admin", None)
    items = [
        {
            "feedback_id": str(i),
            "user_id": 1,
            "agent_id": "a",
            "agent_name": "Expert",
            "thread_id": "t",
            "message_id": str(i),
            "rating": "helpful",
            "reason": "",
            "comment": "",
            "correction": "",
            "reference": "",
            "question": "Q",
            "answer": "A",
            "created_at": 100,
            "updated_at": 100,
        }
        for i in range(25)
    ]
    repo = Mock()
    repo.query.return_value = items
    repo.summary.return_value = {"items": items[1:3], "total": 25, "helpful": 25, "unhelpful": 0}
    server = SimpleNamespace(services=SimpleNamespace(feedback_repo=repo))
    app = FastAPI()
    app.include_router(router, prefix="/api")
    app.dependency_overrides[current_user] = lambda: user
    app.dependency_overrides[get_server] = lambda: server
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get(
            "/api/admin/feedback?agent_id=a&start_time=100&end_time=101&limit=2&offset=1"
        )
        assert response.status_code == 200
        assert len(response.json()["items"]) == 2
        assert response.json()["total"] == 25
        assert repo.summary.call_args.args[0]["end_time"] == 101
        exported = await client.get("/api/admin/feedback/export")
        assert len(exported.json()) == 25
        assert "attachment" in exported.headers["content-disposition"]
        invalid = await client.put(
            "/api/agents/a/threads/t/feedback", json={"message_id": "x", "rating": "unhelpful"}
        )
        assert invalid.status_code == 422


@pytest.mark.asyncio
async def test_ownership_includes_admin_and_shared_agents():
    repo = Mock()
    repo.get.return_value = SimpleNamespace(agent_id="shared", user_id=2)
    agents = Mock()
    agents.get.return_value = SimpleNamespace(user_id=1, is_shared=True)
    service = FeedbackService(
        SimpleNamespace(services=SimpleNamespace(thread_repo=repo, agent_repo=agents))
    )
    for role in ("admin", "user"):
        with pytest.raises(OctopError):
            await service.authorize(User(1, "one", role, None), "shared", "t")
    await service.authorize(User(2, "two", "user", None), "shared", "t")


@pytest.mark.parametrize(
    "data",
    [
        {"content": "", "additional_kwargs": {}},
        {"content": "Failure", "additional_kwargs": {"octop_stream_error": True}},
        {"content": [{"type": "thinking", "thinking": "secret"}]},
        {"content": "Tool", "tool_calls": [{"name": "search"}]},
    ],
)
def test_snapshot_rejects_non_answers(data):
    with pytest.raises(ValueError):
        answer_snapshot(
            [{"role": "user", "content": "Q"}, {"type": "ai", "data": {"id": "a", **data}}], "a"
        )
