"""Benchmark domain rules. Evaluation labels never enter model inputs."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from functools import partial
from typing import Any

from octop.infra.errors import ErrorCode, OctopError
from octop.infra.users.resource_policy import assert_token_quota_available

CASE_DEFAULTS: dict[str, Any] = {
    "title": "",
    "question": "",
    "context": "",
    "reference_answer": "",
    "rubric": "",
    "match_mode": "exact",
    "keywords": [],
    "tags": [],
    "split": "dev",
    "status": "draft",
}


async def io(function: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    return await asyncio.get_running_loop().run_in_executor(
        None, partial(function, *args, **kwargs)
    )


def validate_case(data: dict[str, Any]) -> dict[str, Any]:
    case = {**CASE_DEFAULTS, **{k: v for k, v in data.items() if k in CASE_DEFAULTS}}
    for key, limit in {
        "title": 200,
        "question": 20000,
        "context": 40000,
        "reference_answer": 20000,
        "rubric": 10000,
    }.items():
        if not isinstance(case[key], str) or len(case[key]) > limit:
            raise ValueError("invalid_case")
        case[key] = case[key].strip()
    if not case["title"]:
        raise ValueError("invalid_case")
    for key, choices in {
        "match_mode": {"exact", "contains", "manual"},
        "split": {"train", "dev", "test"},
        "status": {"draft", "needs_info", "ready", "disabled"},
    }.items():
        if not isinstance(case[key], str) or case[key] not in choices:
            raise ValueError("invalid_case")
    for key, count, size in (("keywords", 100, 200), ("tags", 20, 50)):
        values = case[key]
        if not isinstance(values, list) or len(values) > count:
            raise ValueError("invalid_case")
        if any(not isinstance(v, str) or not v.strip() or len(v) > size for v in values):
            raise ValueError("invalid_case")
        case[key] = list(dict.fromkeys(v.strip() for v in values))
    if case["status"] == "ready":
        if not case["question"]:
            raise ValueError("invalid_case")
        if (
            (case["match_mode"] == "exact" and not case["reference_answer"])
            or (case["match_mode"] == "contains" and not case["keywords"])
            or (case["match_mode"] == "manual" and not (case["rubric"] or case["reference_answer"]))
        ):
            raise ValueError("criteria_required")
    return case


def grade_answer(case: dict[str, Any], answer: str) -> str:
    if not answer.strip():
        return "error"
    if case["match_mode"] == "manual":
        return "needs_review"
    if case["match_mode"] == "contains":
        return "passed" if all(word in answer for word in case["keywords"]) else "failed"
    return "passed" if answer.strip() == case["reference_answer"].strip() else "failed"


def run_counts(run: dict[str, Any]) -> dict[str, Any]:
    results = run.get("results", [])
    return {
        **run,
        "total": len(results),
        "completed": sum(r["status"] not in {"pending", "running"} for r in results),
        "passed": sum(r["status"] == "passed" for r in results),
        "failed": sum(r["status"] == "failed" for r in results),
        "errors": sum(r["status"] == "error" for r in results),
        "needs_review": sum(r["status"] == "needs_review" for r in results),
    }


def compare_runs(baseline: dict[str, Any], candidate: dict[str, Any]) -> list[dict[str, Any]]:
    left = {r["case_id"]: r for r in baseline["results"]}
    right = {r["case_id"]: r for r in candidate["results"]}
    items = []
    for case_id in dict.fromkeys([*left, *right]):
        a, b = left.get(case_id), right.get(case_id)
        comparable = bool(
            a
            and b
            and a["revision"] == b["revision"]
            and a["status"] in {"passed", "failed"}
            and b["status"] in {"passed", "failed"}
        )
        change = "incomparable"
        if comparable and a and b:
            change = (
                "unchanged"
                if a["status"] == b["status"]
                else "improved"
                if b["status"] == "passed"
                else "regressed"
            )
        item = b or a or {}
        items.append(
            {
                "case_id": case_id,
                "title": item.get("case_snapshot", {}).get("title", case_id),
                "comparable": comparable,
                "change": change,
                "baseline_status": a["status"] if a else None,
                "candidate_status": b["status"] if b else None,
                "baseline_revision": a["revision"] if a else None,
                "candidate_revision": b["revision"] if b else None,
            }
        )
    return items


class BenchmarkService:
    def __init__(self, server: Any) -> None:
        self.server = server
        self.services = server.services
        self.repo = self.services.benchmark_repo

    @staticmethod
    def visible_case(user: Any, case: dict[str, Any]) -> dict[str, Any]:
        snapshot = case.get("source_snapshot", {})
        if snapshot and not user.is_admin and snapshot.get("user_id") != user.id:
            return {**case, "source_snapshot": {}}
        return case

    def visible_run(self, user: Any, run: dict[str, Any]) -> dict[str, Any]:
        return run_counts(
            {
                **run,
                "results": [
                    {**result, "case_snapshot": self.visible_case(user, result["case_snapshot"])}
                    for result in run.get("results", [])
                ],
            }
        )

    async def authorize(self, user: Any, agent_id: str) -> Any:
        row = await io(self.services.agent_repo.get, agent_id)
        if row is None:
            raise OctopError.localized(ErrorCode.AGENT_NOT_FOUND)
        if not user.is_admin and row.user_id != user.id:
            raise OctopError.localized(ErrorCode.FORBIDDEN)
        return row

    async def list_cases(self, user: Any, agent_id: str) -> list[dict[str, Any]]:
        await self.authorize(user, agent_id)
        return [self.visible_case(user, case) for case in await io(self.repo.list_cases, agent_id)]

    async def save_case(
        self, user: Any, agent_id: str, data: dict[str, Any], case_id: str | None = None
    ) -> dict[str, Any]:
        await self.authorize(user, agent_id)
        old = await self._case(agent_id, case_id) if case_id else {}
        values = validate_case({**old, **data})
        saved = await io(
            self.repo.save_case, agent_id, values, case_id, expected_revision=old.get("revision")
        )
        return self.visible_case(user, saved)

    async def _case(self, agent_id: str, case_id: str) -> dict[str, Any]:
        case = await io(self.repo.get_case, agent_id, case_id)
        if case is None:
            raise OctopError.localized(ErrorCode.NOT_FOUND)
        return case  # type: ignore[no-any-return]

    async def candidates(self, user: Any, agent_id: str) -> list[dict[str, Any]]:
        await self.authorize(user, agent_id)
        # Reading the inbox also backfills existing feedback; no cross-user conversation sharing.
        feedback = await io(
            self.services.feedback_repo.query, {"agent_id": agent_id, "user_id": user.id}
        )
        for item in feedback:
            await io(self.repo.capture_feedback, item)
        return await io(self.repo.list_candidates, agent_id, user.id)  # type: ignore[no-any-return]

    async def accept(
        self, user: Any, agent_id: str, candidate_id: str, data: dict[str, Any]
    ) -> dict[str, Any]:
        await self.authorize(user, agent_id)
        values = validate_case(data)
        if values["status"] != "ready":
            raise ValueError("criteria_required")
        candidate = await io(self.repo.get_candidate, agent_id, user.id, candidate_id)
        if candidate is None:
            raise OctopError.localized(ErrorCode.NOT_FOUND)
        return await io(self.repo.accept_candidate, agent_id, user.id, candidate_id, values)  # type: ignore[no-any-return]

    async def ignore(self, user: Any, agent_id: str, candidate_id: str) -> dict[str, Any]:
        await self.authorize(user, agent_id)
        if await io(self.repo.get_candidate, agent_id, user.id, candidate_id) is None:
            raise OctopError.localized(ErrorCode.NOT_FOUND)
        return await io(self.repo.ignore_candidate, agent_id, user.id, candidate_id)  # type: ignore[no-any-return]

    async def accept_feedback(
        self, user: Any, agent_id: str, feedback_id: str, data: dict[str, Any]
    ) -> dict[str, Any]:
        if not user.is_admin:
            raise OctopError.localized(ErrorCode.FORBIDDEN)
        await self.authorize(user, agent_id)
        feedback = await io(self.services.feedback_repo.get_by_id, feedback_id)
        if feedback is None or feedback["agent_id"] != agent_id:
            raise OctopError.localized(ErrorCode.NOT_FOUND)
        values = validate_case(data)
        if values["status"] != "ready":
            raise ValueError("criteria_required")
        candidate = await io(self.repo.capture_feedback, feedback)
        return await io(  # type: ignore[no-any-return]
            self.repo.accept_candidate,
            agent_id,
            feedback["user_id"],
            candidate["candidate_id"],
            values,
            reviewed_feedback=feedback,
        )

    async def list_runs(self, user: Any, agent_id: str) -> list[dict[str, Any]]:
        await self.authorize(user, agent_id)
        return [self.visible_run(user, run) for run in await io(self.repo.list_runs, agent_id)]

    async def get_run(self, user: Any, agent_id: str, run_id: str) -> dict[str, Any]:
        await self.authorize(user, agent_id)
        run = await io(self.repo.get_run, agent_id, run_id)
        if run is None:
            raise OctopError.localized(ErrorCode.NOT_FOUND)
        return self.visible_run(user, run)

    def runner(self) -> Any:
        from octop.infra.benchmarks.runner import BenchmarkRunner

        if getattr(self.server, "benchmark_runner", None) is None:
            self.server.benchmark_runner = BenchmarkRunner(self.server)
        return self.server.benchmark_runner

    async def start_run(
        self, user: Any, agent_id: str, case_ids: list[str], name: str = ""
    ) -> dict[str, Any]:
        await self.authorize(user, agent_id)
        if not case_ids or len(case_ids) > 100 or len(set(case_ids)) != len(case_ids):
            raise ValueError("invalid_selection")
        cases = [await self._case(agent_id, case_id) for case_id in case_ids]
        if any(case["status"] != "ready" for case in cases):
            raise ValueError("invalid_selection")
        if len({case["split"] for case in cases}) != 1:
            raise ValueError("mixed_splits")
        await io(
            assert_token_quota_available,
            self.services.user_policy_repo,
            self.services.usage_repo,
            user.id,
        )
        return self.visible_run(
            user, await self.runner().start(agent_id, user.id, name[:200], cases)
        )

    async def cancel_run(self, user: Any, agent_id: str, run_id: str) -> dict[str, Any]:
        await self.get_run(user, agent_id, run_id)
        await self.runner().cancel(agent_id, run_id)
        return await self.get_run(user, agent_id, run_id)

    async def review(
        self, user: Any, agent_id: str, run_id: str, case_id: str, passed: bool, note: str
    ) -> dict[str, Any]:
        run = await self.get_run(user, agent_id, run_id)
        if run["status"] in {"queued", "running"}:
            raise ValueError("not_reviewable")
        result = next((r for r in run["results"] if r["case_id"] == case_id), None)
        if result is None:
            raise OctopError.localized(ErrorCode.NOT_FOUND)
        if result["status"] not in {"needs_review", "passed", "failed"}:
            raise ValueError("not_reviewable")
        if result["case_snapshot"]["match_mode"] != "manual":
            raise ValueError("not_reviewable")
        result.update(
            status="passed" if passed else "failed", note=note[:4000], reviewer_id=user.id
        )
        return self.visible_run(
            user,
            await io(
                self.repo.update_result,
                agent_id,
                run_id,
                case_id,
                {"status": result["status"], "note": result["note"], "reviewer_id": user.id},
            ),
        )

    async def export(self, user: Any, agent_id: str, split: str) -> list[dict[str, Any]]:
        if split not in {"train", "dev", "test"}:
            raise ValueError("invalid_selection")
        return [
            case
            for case in await self.list_cases(user, agent_id)
            if case["split"] == split and case["status"] == "ready"
        ]

    async def compare(
        self, user: Any, agent_id: str, baseline: str, candidate: str
    ) -> dict[str, Any]:
        a = await self.get_run(user, agent_id, baseline)
        b = await self.get_run(user, agent_id, candidate)
        return {"baseline": a, "candidate": b, "items": compare_runs(a, b)}
