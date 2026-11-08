"""Typed, owner-authorized expert Benchmark HTTP adapters."""

from __future__ import annotations

from collections.abc import Awaitable
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from octop.api.deps import current_user, get_server
from octop.i18n import tr
from octop.infra.benchmarks.service import BenchmarkService
from octop.infra.users.identity import User

router = APIRouter(prefix="/agents/{agent_id}/benchmarks")
CaseStatus = Literal["draft", "needs_info", "ready", "disabled"]
Split = Literal["train", "dev", "test"]
MatchMode = Literal["exact", "contains", "manual"]


class CaseInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(max_length=200)
    question: str = Field(
        default="", max_length=20000, description="Input visible to the evaluated model."
    )
    context: str = Field(
        default="", max_length=40000, description="Reproducible context, without grading labels."
    )
    reference_answer: str = Field(
        default="", max_length=20000, description="Evaluator-only expected answer."
    )
    rubric: str = Field(
        default="", max_length=10000, description="Human-review criteria; never sent to the model."
    )
    match_mode: MatchMode = "exact"
    keywords: list[str] = Field(default_factory=list, max_length=100)
    tags: list[str] = Field(default_factory=list, max_length=20)
    split: Split = "dev"
    status: CaseStatus = "draft"


class CasePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None, max_length=200)
    question: str | None = Field(default=None, max_length=20000)
    context: str | None = Field(default=None, max_length=40000)
    reference_answer: str | None = Field(default=None, max_length=20000)
    rubric: str | None = Field(default=None, max_length=10000)
    match_mode: MatchMode | None = None
    keywords: list[str] | None = Field(default=None, max_length=100)
    tags: list[str] | None = Field(default=None, max_length=20)
    split: Split | None = None
    status: CaseStatus | None = None


class CaseOut(CaseInput):
    case_id: str
    agent_id: str
    source: Literal["manual", "feedback"]
    source_feedback_id: str | None = None
    source_snapshot: dict[str, Any] = Field(default_factory=dict)
    revision: int
    created_at: int
    updated_at: int


class CandidateOut(BaseModel):
    candidate_id: str
    agent_id: str
    user_id: int
    feedback_id: str
    status: Literal["pending", "accepted", "ignored"]
    snapshot: dict[str, Any]
    case_id: str | None = None
    created_at: int
    updated_at: int


class RunInput(BaseModel):
    name: str = Field(default="", max_length=200)
    case_ids: list[str] = Field(min_length=1, max_length=100)


class ResultOut(BaseModel):
    case_id: str
    revision: int
    case_snapshot: CaseOut
    status: Literal["pending", "running", "passed", "failed", "needs_review", "error", "cancelled"]
    answer: str
    error: str
    duration_ms: int
    input_tokens: int | None = None
    output_tokens: int | None = None
    note: str = ""


class RunOut(BaseModel):
    run_id: str
    agent_id: str
    user_id: int
    name: str
    status: Literal["queued", "running", "completed", "cancelled", "interrupted"]
    config_snapshot: dict[str, Any]
    results: list[ResultOut]
    created_at: int
    updated_at: int
    finished_at: int | None = None
    total: int
    completed: int
    passed: int
    failed: int
    errors: int
    needs_review: int


class ReviewInput(BaseModel):
    passed: bool
    note: str = Field(default="", max_length=4000)


class ComparisonItem(BaseModel):
    case_id: str
    title: str
    comparable: bool
    change: Literal["improved", "regressed", "unchanged", "incomparable"]
    baseline_status: str | None
    candidate_status: str | None
    baseline_revision: int | None
    candidate_revision: int | None


class ComparisonOut(BaseModel):
    baseline: RunOut
    candidate: RunOut
    items: list[ComparisonItem]


async def _result(operation: Awaitable[Any], user: User) -> Any:
    try:
        return await operation
    except ValueError as exc:
        key = str(exc)
        if key == "revision_conflict":
            raise HTTPException(
                409, detail=tr("benchmark.errors.revision_conflict", user.locale)
            ) from exc
        if key not in {
            "invalid_case",
            "criteria_required",
            "invalid_selection",
            "mixed_splits",
            "not_reviewable",
            "unsupported_expert",
        }:
            key = "invalid_case"
        raise HTTPException(400, detail=tr(f"benchmark.errors.{key}", user.locale)) from exc


@router.get("/cases", response_model=list[CaseOut], summary="List expert benchmark cases")
async def list_cases(
    agent_id: str, user: User = Depends(current_user), server: Any = Depends(get_server)
) -> Any:
    return await _result(BenchmarkService(server).list_cases(user, agent_id), user)


@router.post("/cases", response_model=CaseOut, summary="Create a manual benchmark case")
async def create_case(
    agent_id: str,
    data: CaseInput,
    user: User = Depends(current_user),
    server: Any = Depends(get_server),
) -> Any:
    return await _result(
        BenchmarkService(server).save_case(user, agent_id, data.model_dump()), user
    )


@router.patch("/cases/{case_id}", response_model=CaseOut, summary="Revise a benchmark case")
async def update_case(
    agent_id: str,
    case_id: str,
    data: CasePatch,
    user: User = Depends(current_user),
    server: Any = Depends(get_server),
) -> Any:
    return await _result(
        BenchmarkService(server).save_case(
            user, agent_id, data.model_dump(exclude_unset=True), case_id
        ),
        user,
    )


@router.get(
    "/candidates",
    response_model=list[CandidateOut],
    summary="Collect and list own feedback candidates",
    description="Owner/admin only. Imports only the acting user's feedback for this expert; accepted cases remain frozen.",
)
async def list_candidates(
    agent_id: str, user: User = Depends(current_user), server: Any = Depends(get_server)
) -> Any:
    return await _result(BenchmarkService(server).candidates(user, agent_id), user)


@router.post(
    "/candidates/{candidate_id}/accept",
    response_model=CaseOut,
    summary="Review feedback into a ready benchmark case",
)
async def accept_candidate(
    agent_id: str,
    candidate_id: str,
    data: CaseInput,
    user: User = Depends(current_user),
    server: Any = Depends(get_server),
) -> Any:
    return await _result(
        BenchmarkService(server).accept(user, agent_id, candidate_id, data.model_dump()), user
    )


@router.post(
    "/candidates/{candidate_id}/ignore",
    response_model=CandidateOut,
    summary="Ignore a feedback candidate",
)
async def ignore_candidate(
    agent_id: str,
    candidate_id: str,
    user: User = Depends(current_user),
    server: Any = Depends(get_server),
) -> Any:
    return await _result(BenchmarkService(server).ignore(user, agent_id, candidate_id), user)


@router.get("/runs", response_model=list[RunOut], summary="List benchmark runs and scores")
async def list_runs(
    agent_id: str, user: User = Depends(current_user), server: Any = Depends(get_server)
) -> Any:
    return await _result(BenchmarkService(server).list_runs(user, agent_id), user)


@router.post(
    "/runs",
    response_model=RunOut,
    summary="Start an isolated text benchmark run",
    description="Freezes expert model/instructions and case revisions. No production tools, memory or workspace writes. At most 100 same-split cases, one run per expert, 120 seconds per case.",
)
async def create_run(
    agent_id: str,
    data: RunInput,
    user: User = Depends(current_user),
    server: Any = Depends(get_server),
) -> Any:
    return await _result(
        BenchmarkService(server).start_run(user, agent_id, data.case_ids, data.name), user
    )


@router.get(
    "/runs/{run_id}", response_model=RunOut, summary="Inspect a benchmark run and case results"
)
async def get_run(
    agent_id: str,
    run_id: str,
    user: User = Depends(current_user),
    server: Any = Depends(get_server),
) -> Any:
    return await _result(BenchmarkService(server).get_run(user, agent_id, run_id), user)


@router.post(
    "/runs/{run_id}/cancel", response_model=RunOut, summary="Cancel a run and keep partial results"
)
async def cancel_run(
    agent_id: str,
    run_id: str,
    user: User = Depends(current_user),
    server: Any = Depends(get_server),
) -> Any:
    return await _result(BenchmarkService(server).cancel_run(user, agent_id, run_id), user)


@router.post(
    "/runs/{run_id}/results/{case_id}/review",
    response_model=RunOut,
    summary="Record a human verdict for a manual-scored result",
)
async def review_result(
    agent_id: str,
    run_id: str,
    case_id: str,
    data: ReviewInput,
    user: User = Depends(current_user),
    server: Any = Depends(get_server),
) -> Any:
    return await _result(
        BenchmarkService(server).review(user, agent_id, run_id, case_id, data.passed, data.note),
        user,
    )


@router.get(
    "/export", response_model=list[CaseOut], summary="Export ready cases from one data split"
)
async def export_cases(
    agent_id: str,
    split: Split = Query("train"),
    user: User = Depends(current_user),
    server: Any = Depends(get_server),
) -> JSONResponse:
    cases = await _result(BenchmarkService(server).export(user, agent_id, split), user)
    return JSONResponse(
        cases, headers={"Content-Disposition": f'attachment; filename="benchmark-{split}.json"'}
    )


@router.get(
    "/compare", response_model=ComparisonOut, summary="Compare runs using matching case revisions"
)
async def compare(
    agent_id: str,
    baseline: str,
    candidate: str,
    user: User = Depends(current_user),
    server: Any = Depends(get_server),
) -> Any:
    return await _result(
        BenchmarkService(server).compare(user, agent_id, baseline, candidate), user
    )
