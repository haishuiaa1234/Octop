"""Benchmark HTTP contracts with real temporary persistence and no live model."""

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from httpx import ASGITransport, AsyncClient

from octop.api.deps import current_user, get_server
from octop.api.routers.benchmarks import router
from octop.infra.db.migrate import run_migrations
from octop.infra.db.pool import SqlitePool
from octop.infra.db.services import RepoBundle
from octop.infra.errors import OctopError
from octop.infra.users.identity import User


@pytest.fixture
def app_env(tmp_path):
    db = SqlitePool(tmp_path / "api.sqlite")
    run_migrations(db)
    repos = RepoBundle.from_pool(db)
    uid = repos.user_repo.create(username="one", password_hash="x", role="user")
    oid = repos.user_repo.create(username="two", password_hash="x", role="user")
    repos.agent_repo.create(agent_id="expert", user_id=uid, name="Expert")
    app = FastAPI()
    app.include_router(router, prefix="/api")
    app.dependency_overrides[current_user] = lambda: User(uid, "one", "user", None)
    server = SimpleNamespace(services=repos, app_runtime=None, benchmark_runner=None)
    app.dependency_overrides[get_server] = lambda: server

    @app.exception_handler(OctopError)
    async def error_handler(request, exc):
        return JSONResponse({"code": str(exc.code)}, status_code=exc.status)

    yield app, repos, uid, oid
    db.close()


@pytest.mark.asyncio
async def test_manual_case_validation_revision_and_split_export(app_env):
    app, _, _, _ = app_env
    root = "/api/agents/expert/benchmarks"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        bad = await client.post(f"{root}/cases", json={"title": "C", "status": "ready"})
        assert bad.status_code == 400
        created = await client.post(
            f"{root}/cases",
            json={
                "title": "C",
                "question": "Q",
                "reference_answer": "A",
                "status": "ready",
                "split": "train",
            },
        )
        assert created.status_code == 200
        case = created.json()
        assert case["source"] == "manual"
        assert case["revision"] == 1
        patched = await client.patch(f"{root}/cases/{case['case_id']}", json={"title": "Changed"})
        assert patched.json()["revision"] == 2
        assert len((await client.get(f"{root}/export?split=train")).json()) == 1
        assert (await client.get(f"{root}/export?split=test")).json() == []
        forged = await client.patch(f"{root}/cases/{case['case_id']}", json={"source": "feedback"})
        assert forged.status_code == 422
        assert (
            await client.patch(f"{root}/cases/not-here", json={"title": "C"})
        ).status_code == 404


@pytest.mark.asyncio
async def test_foreign_owner_cannot_read_or_create_cases(app_env):
    app, _, _, oid = app_env
    app.dependency_overrides[current_user] = lambda: User(oid, "two", "user", None)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.get("/api/agents/expert/benchmarks/cases")).status_code == 403
        assert (
            await client.post("/api/agents/expert/benchmarks/cases", json={"title": "C"})
        ).status_code == 403


@pytest.mark.asyncio
async def test_feedback_review_requires_ready_criteria_and_preserves_source(app_env):
    app, repos, uid, _ = app_env
    repos.thread_repo.insert(
        thread_id="t", agent_id="expert", user_id=uid, channel_type="dashboard", session_key="s"
    )
    repos.feedback_repo.save(
        {
            "user_id": uid,
            "agent_id": "expert",
            "agent_name": "Expert",
            "thread_id": "t",
            "message_id": "answer",
            "rating": "unhelpful",
            "reason": "factual_error",
            "comment": "",
            "correction": "Correct",
            "reference": "Evidence",
            "question": "Q",
            "answer": "Wrong",
        }
    )
    root = "/api/agents/expert/benchmarks"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        candidates = (await client.get(f"{root}/candidates")).json()
        cid = candidates[0]["candidate_id"]
        bad = await client.post(
            f"{root}/candidates/{cid}/accept", json={"title": "C", "question": "Q"}
        )
        assert bad.status_code == 400
        data = {"title": "C", "question": "Q", "reference_answer": "Correct", "status": "ready"}
        response = await client.post(f"{root}/candidates/{cid}/accept", json=data)
        assert response.status_code == 200
        case = response.json()
        assert case["source"] == "feedback"
        assert case["source_snapshot"]["answer"] == "Wrong"
        assert (await client.post(f"{root}/candidates/{cid}/accept", json=data)).json()[
            "case_id"
        ] == case["case_id"]


def test_openapi_describes_all_benchmark_routes(app_env):
    app, _, _, _ = app_env
    schema = app.openapi()
    paths = {path: item for path, item in schema["paths"].items() if "benchmarks" in path}
    assert len(paths) == 12
    assert all(operation.get("summary") for item in paths.values() for operation in item.values())
    assert "CaseOut" in schema["components"]["schemas"]
    assert "RunOut" in schema["components"]["schemas"]


@pytest.mark.asyncio
async def test_admin_reviews_foreign_feedback_without_exposing_raw_source(app_env):
    from unittest.mock import AsyncMock

    app, repos, uid, oid = app_env
    repos.thread_repo.insert(
        thread_id="shared-thread",
        agent_id="expert",
        user_id=oid,
        channel_type="dashboard",
        session_key="shared-session",
    )
    feedback = repos.feedback_repo.save(
        {
            "user_id": oid,
            "agent_id": "expert",
            "agent_name": "Expert",
            "thread_id": "shared-thread",
            "message_id": "answer",
            "rating": "unhelpful",
            "reason": "factual_error",
            "comment": "Private comment",
            "correction": "Correct",
            "reference": "Private reference",
            "question": "Private question",
            "answer": "Wrong",
        }
    )
    root = "/api/agents/expert/benchmarks"
    path = f"{root}/feedback/{feedback['feedback_id']}/accept"
    data = {
        "title": "Reviewed",
        "question": "Sanitized question",
        "reference_answer": "Correct",
        "match_mode": "manual",
        "status": "ready",
    }
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.post(path, json=data)).status_code == 403
        assert (await client.get(f"{root}/candidates")).json() == []
        app.dependency_overrides[current_user] = lambda: User(uid, "admin", "admin", None)
        assert (await client.post(path, json={**data, "status": "draft"})).status_code == 400
        assert (await client.post(path, json={**data, "reference_answer": ""})).status_code == 400
        missing = path.replace(feedback["feedback_id"], "missing")
        assert (await client.post(missing, json=data)).status_code == 404
        repos.agent_repo.create(agent_id="other", user_id=uid, name="Other")
        assert (
            await client.post(path.replace("/expert/", "/other/"), json=data)
        ).status_code == 404
        ignored = repos.benchmark_repo.capture_feedback(feedback)
        repos.benchmark_repo.ignore_candidate("expert", oid, ignored["candidate_id"])
        repos.feedback_repo.save({**feedback, "comment": "Updated private comment"})
        response = await client.post(path, json=data)
        assert response.status_code == 200, response.text
        case = response.json()
        assert case["source_feedback_id"] == feedback["feedback_id"]
        assert case["source_snapshot"]["user_id"] == oid
        assert case["source_snapshot"]["comment"] == "Updated private comment"
        assert case["question"] == "Sanitized question"
        assert (await client.post(path, json=data)).json()["case_id"] == case["case_id"]
        assert len((await client.get(f"{root}/cases")).json()) == 1
        app.dependency_overrides[current_user] = lambda: User(uid, "one", "user", None)
        visible = (await client.get(f"{root}/cases")).json()[0]
        assert visible["source_snapshot"] == {}
        assert visible["question"] == "Sanitized question"
        patched = await client.patch(f"{root}/cases/{case['case_id']}", json={"title": "Edited"})
        assert patched.json()["source_snapshot"] == {}
        exported = (await client.get(f"{root}/export?split=dev")).json()[0]
        assert exported["source_snapshot"] == {}
        run = repos.benchmark_repo.create_run(
            "expert",
            uid,
            "Frozen",
            {},
            [
                {
                    "case_id": case["case_id"],
                    "revision": 1,
                    "case_snapshot": case,
                    "status": "needs_review",
                    "answer": "",
                    "error": "",
                    "duration_ms": 0,
                }
            ],
        )
        result = (await client.get(f"{root}/runs/{run['run_id']}")).json()
        assert result["results"][0]["case_snapshot"]["source_snapshot"] == {}
        listed = (await client.get(f"{root}/runs")).json()[0]
        assert listed["results"][0]["case_snapshot"]["source_snapshot"] == {}
        server = app.dependency_overrides[get_server]()
        server.benchmark_runner = SimpleNamespace(start=AsyncMock(return_value=run))
        started = await client.post(f"{root}/runs", json={"case_ids": [case["case_id"]]})
        assert started.status_code == 200, started.text
        assert started.json()["results"][0]["case_snapshot"]["source_snapshot"] == {}
        repos.benchmark_repo.update_run("expert", run["run_id"], status="completed")
        reviewed = await client.post(
            f"{root}/runs/{run['run_id']}/results/{case['case_id']}/review",
            json={"passed": True, "note": "Reviewed"},
        )
        assert reviewed.status_code == 200, reviewed.text
        assert reviewed.json()["results"][0]["case_snapshot"]["source_snapshot"] == {}
        compared = await client.get(
            f"{root}/compare",
            params={
                "baseline": run["run_id"],
                "candidate": run["run_id"],
            },
        )
        assert compared.status_code == 200, compared.text
        for side in ("baseline", "candidate"):
            assert compared.json()[side]["results"][0]["case_snapshot"]["source_snapshot"] == {}
        stored = repos.benchmark_repo.get_run("expert", run["run_id"])
        assert stored["results"][0]["case_snapshot"]["source_snapshot"]["user_id"] == oid


@pytest.mark.asyncio
async def test_run_review_and_revision_aware_comparison_http_contract(app_env, monkeypatch):
    from unittest.mock import AsyncMock

    from octop.infra.benchmarks.runner import BenchmarkRunner

    app, _, _, _ = app_env
    server = app.dependency_overrides[get_server]()
    monkeypatch.setattr(
        "octop.infra.benchmarks.runner.prepare_evaluator",
        AsyncMock(
            return_value=(
                {"mode": "text_only", "model_ref": "fake/model"},
                AsyncMock(return_value={"answer": "Answer"}),
            )
        ),
    )
    server.benchmark_runner = runner = BenchmarkRunner(server)
    root = "/api/agents/expert/benchmarks"
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            case = (
                await client.post(
                    f"{root}/cases",
                    json={
                        "title": "Manual",
                        "question": "Question",
                        "rubric": "Check evidence",
                        "match_mode": "manual",
                        "status": "ready",
                    },
                )
            ).json()
            runs = []
            for verdict in (False, True):
                started = await client.post(
                    f"{root}/runs",
                    json={
                        "name": str(verdict),
                        "case_ids": [case["case_id"]],
                    },
                )
                assert started.status_code == 200, started.text
                run_id = started.json()["run_id"]
                runs.append(run_id)
                await runner.wait(run_id)
                detail = await client.get(f"{root}/runs/{run_id}")
                assert detail.status_code == 200, detail.text
                assert detail.json()["needs_review"] == 1
                reviewed = await client.post(
                    f"{root}/runs/{run_id}/results/{case['case_id']}/review",
                    json={"passed": verdict, "note": "Evidence reviewed"},
                )
                assert reviewed.status_code == 200, reviewed.text
                assert reviewed.json()["needs_review"] == 0
                assert reviewed.json()["passed"] == int(verdict)
            compared = await client.get(
                f"{root}/compare",
                params={
                    "baseline": runs[0],
                    "candidate": runs[1],
                },
            )
            assert compared.status_code == 200, compared.text
            assert compared.json()["items"][0]["change"] == "improved"
            assert (
                compared.json()["baseline"]["results"][0]["case_snapshot"]["rubric"]
                == "Check evidence"
            )
    finally:
        await runner.close()
