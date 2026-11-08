"""Benchmark grading, immutable evaluation inputs, privacy and cancellation."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest


def test_ready_case_requires_usable_grading_and_question():
    from octop.infra.benchmarks.service import validate_case

    with pytest.raises(ValueError):
        validate_case({"title": "case", "question": "Q", "status": "ready"})
    case = validate_case(
        {"title": "case", "question": "Q", "status": "ready", "reference_answer": "A"}
    )
    assert case["match_mode"] == "exact"
    with pytest.raises(ValueError):
        validate_case({**case, "question": " "})
    with pytest.raises(ValueError):
        validate_case({**case, "match_mode": "contains", "keywords": []})


def test_grading_never_passes_empty_output_and_manual_requires_review():
    from octop.infra.benchmarks.service import grade_answer

    assert grade_answer({"match_mode": "exact", "reference_answer": " A "}, "A") == "passed"
    assert grade_answer({"match_mode": "exact", "reference_answer": "A"}, "B") == "failed"
    assert grade_answer({"match_mode": "exact", "reference_answer": ""}, " ") == "error"
    assert grade_answer({"match_mode": "contains", "keywords": ["甲", "乙"]}, "甲乙") == "passed"
    assert grade_answer({"match_mode": "contains", "keywords": ["甲", "乙"]}, "甲") == "failed"
    assert (
        grade_answer({"match_mode": "manual", "rubric": "Check evidence"}, "Answer")
        == "needs_review"
    )


def test_comparison_excludes_changed_revisions():
    from octop.infra.benchmarks.service import compare_runs

    def result(revision, status):
        return {
            "case_id": "c",
            "revision": revision,
            "status": status,
            "case_snapshot": {"title": "C"},
        }

    old = {"results": [result(1, "failed")]}
    assert compare_runs(old, {"results": [result(1, "passed")]})[0]["change"] == "improved"
    changed = compare_runs(old, {"results": [result(2, "passed")]})[0]
    assert changed["comparable"] is False
    assert changed["change"] == "incomparable"


@pytest.fixture
def environment(tmp_path):
    from octop.infra.db.migrate import run_migrations
    from octop.infra.db.pool import SqlitePool
    from octop.infra.db.services import RepoBundle
    from octop.infra.users.identity import User

    db = SqlitePool(tmp_path / "benchmark.sqlite")
    run_migrations(db)
    repos = RepoBundle.from_pool(db)
    uid = repos.user_repo.create(username="owner", password_hash="x", role="user")
    other = repos.user_repo.create(username="other", password_hash="x", role="user")
    repos.agent_repo.create(agent_id="expert", user_id=uid, name="Expert")
    server = SimpleNamespace(services=repos, app_runtime=None, benchmark_runner=None)
    yield server, User(uid, "owner", "user", None), User(other, "other", "user", None)
    db.close()


@pytest.mark.asyncio
async def test_cases_are_owner_only_and_feedback_is_user_scoped(environment):
    from octop.infra.benchmarks.service import BenchmarkService
    from octop.infra.errors import OctopError

    server, owner, other = environment
    service = BenchmarkService(server)
    with pytest.raises(OctopError):
        await service.list_cases(other, "expert")
    for user in (owner, other):
        server.services.thread_repo.insert(
            thread_id=f"t{user.id}",
            agent_id="expert",
            user_id=user.id,
            channel_type="dashboard",
            session_key=f"s{user.id}",
        )
        server.services.feedback_repo.save(
            {
                "user_id": user.id,
                "agent_id": "expert",
                "agent_name": "Expert",
                "thread_id": f"t{user.id}",
                "message_id": "answer",
                "rating": "helpful",
                "reason": "",
                "comment": "",
                "correction": "",
                "reference": "",
                "question": f"private {user.id}",
                "answer": "A",
            }
        )
    candidates = await service.candidates(owner, "expert")
    assert len(candidates) == 1
    assert candidates[0]["snapshot"]["question"] == f"private {owner.id}"
    assert len(await service.candidates(owner, "expert")) == 1


@pytest.mark.asyncio
async def test_run_freezes_cases_and_does_not_send_reference(monkeypatch, environment):
    from octop.infra.benchmarks.runner import BenchmarkRunner
    from octop.infra.benchmarks.service import BenchmarkService

    server, user, _ = environment
    evaluator = AsyncMock(return_value={"answer": "A", "input_tokens": 2, "output_tokens": 1})
    monkeypatch.setattr(
        "octop.infra.benchmarks.runner.prepare_evaluator",
        AsyncMock(return_value=({"mode": "text_only", "model_ref": "test/model"}, evaluator)),
    )
    runner = BenchmarkRunner(server)
    server.benchmark_runner = runner
    service = BenchmarkService(server)
    case = await service.save_case(
        user,
        "expert",
        {
            "title": "C",
            "question": "Q",
            "reference_answer": "A",
            "status": "ready",
        },
    )
    run = await service.start_run(user, "expert", [case["case_id"]], "baseline")
    await runner.wait(run["run_id"])
    stored = await service.get_run(user, "expert", run["run_id"])
    assert stored["passed"] == 1
    assert stored["status"] == "completed"
    assert evaluator.call_args.args == ("Q", "")
    await service.save_case(user, "expert", {"reference_answer": "B"}, case["case_id"])
    assert stored["results"][0]["case_snapshot"]["reference_answer"] == "A"
    await runner.close()


@pytest.mark.asyncio
async def test_actual_evaluator_is_tool_free_and_preserves_detailed_usage(environment):
    from langchain_core.messages import AIMessage

    from octop.infra.benchmarks.runner import prepare_evaluator

    server, _, _ = environment
    response = AIMessage(
        content="Answer",
        usage_metadata={
            "input_tokens": 12,
            "output_tokens": 5,
            "total_tokens": 17,
            "input_token_details": {"cache_read": 4},
            "output_token_details": {"reasoning": 2},
        },
    )
    model = SimpleNamespace(ainvoke=AsyncMock(return_value=response))
    workspace = SimpleNamespace(aread_text=AsyncMock(side_effect=["Persona", "Rules"]))
    factory = SimpleNamespace(
        resolve_ref=lambda ref: "provider/model",
        get_chat_model=lambda ref: model,
    )
    agent = SimpleNamespace(
        config=SimpleNamespace(system_prompt="Instructions"),
        model_factory=factory,
        workspace=workspace,
    )
    server.app_runtime = SimpleNamespace(
        agent_registry=SimpleNamespace(get_agent=lambda agent_id: agent)
    )
    snapshot, evaluate = await prepare_evaluator(server, "expert")
    output = await evaluate("Question", "Context")

    assert snapshot["tools_enabled"] is False
    assert snapshot["memory_enabled"] is False
    assert [call.args[0] for call in workspace.aread_text.call_args_list] == [
        "SOUL.md",
        "AGENTS.md",
    ]
    messages = model.ainvoke.call_args.args[0]
    assert [message.type for message in messages] == ["system", "human", "human"]
    assert [message.content for message in messages] == [
        "Instructions\n\n[SOUL.md]\nPersona\n\n[AGENTS.md]\nRules",
        "Context",
        "Question",
    ]
    assert output["answer"] == "Answer"
    assert output["cache_read_tokens"] == 4
    assert output["reasoning_tokens"] == 2
    assert output["uncached_input_tokens"] == 8

    model.ainvoke.return_value = AIMessage(
        content="", tool_calls=[{"name": "unexpected", "args": {}, "id": "call"}]
    )
    with pytest.raises(ValueError, match="unexpected_tool_call"):
        await evaluate("Question", "")


@pytest.mark.asyncio
async def test_cancel_stops_pending_calls(monkeypatch, environment):
    from octop.infra.benchmarks.runner import BenchmarkRunner
    from octop.infra.benchmarks.service import BenchmarkService

    server, user, _ = environment
    entered = asyncio.Event()

    async def evaluate(question, context):
        entered.set()
        await asyncio.Event().wait()

    monkeypatch.setattr(
        "octop.infra.benchmarks.runner.prepare_evaluator",
        AsyncMock(
            return_value=({"mode": "text_only", "model_ref": "test/model"}, evaluate),
        ),
    )
    runner = BenchmarkRunner(server)
    server.benchmark_runner = runner
    service = BenchmarkService(server)
    case = await service.save_case(
        user,
        "expert",
        {
            "title": "C",
            "question": "Q",
            "reference_answer": "A",
            "status": "ready",
        },
    )
    run = await service.start_run(user, "expert", [case["case_id"]], "cancel")
    await asyncio.wait_for(entered.wait(), 2)
    cancelled = await service.cancel_run(user, "expert", run["run_id"])
    assert cancelled["status"] == "cancelled"
    assert cancelled["results"][0]["status"] == "cancelled"
    await runner.close()


@pytest.mark.asyncio
async def test_runs_reject_mixed_training_and_evaluation_splits(environment):
    from octop.infra.benchmarks.service import BenchmarkService

    server, user, _ = environment
    service = BenchmarkService(server)
    cases = [
        await service.save_case(
            user,
            "expert",
            {
                "title": split,
                "question": "Q",
                "reference_answer": "A",
                "status": "ready",
                "split": split,
            },
        )
        for split in ("train", "test")
    ]
    with pytest.raises(ValueError):
        await service.start_run(user, "expert", [c["case_id"] for c in cases], "mixed")


@pytest.mark.asyncio
async def test_run_respects_token_quota_before_loading_model(environment):
    from octop.infra.benchmarks.service import BenchmarkService
    from octop.infra.errors import ErrorCode, OctopError

    server, user, _ = environment
    server.services.user_policy_repo.set(user.id, "token_quota", "0")
    service = BenchmarkService(server)
    case = await service.save_case(
        user,
        "expert",
        {
            "title": "C",
            "question": "Q",
            "reference_answer": "A",
            "status": "ready",
        },
    )
    with pytest.raises(OctopError) as error:
        await service.start_run(user, "expert", [case["case_id"]], "quota")
    assert error.value.code == ErrorCode.TOKEN_QUOTA_EXCEEDED


@pytest.mark.asyncio
async def test_shutdown_terminalizes_a_task_cancelled_before_its_first_step(
    monkeypatch, environment
):
    from octop.infra.benchmarks.runner import BenchmarkRunner
    from octop.infra.benchmarks.service import BenchmarkService

    server, user, _ = environment
    evaluator = AsyncMock(return_value={"answer": "A"})
    monkeypatch.setattr(
        "octop.infra.benchmarks.runner.prepare_evaluator",
        AsyncMock(
            return_value=({"mode": "text_only", "model_ref": "test/model"}, evaluator),
        ),
    )
    runner = BenchmarkRunner(server)
    server.benchmark_runner = runner
    service = BenchmarkService(server)
    case = await service.save_case(
        user,
        "expert",
        {
            "title": "C",
            "question": "Q",
            "reference_answer": "A",
            "status": "ready",
        },
    )
    run = await service.start_run(user, "expert", [case["case_id"]], "shutdown")
    await runner.close()
    stored = await service.get_run(user, "expert", run["run_id"])
    assert stored["status"] == "interrupted"
    assert all(result["status"] not in {"pending", "running"} for result in stored["results"])
