"""Typed HTTP adapters for answer feedback."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, model_validator

from octop.api.deps import current_user, get_server
from octop.infra.feedback import FeedbackService
from octop.infra.users.identity import User

router = APIRouter()
Rating = Literal["helpful", "unhelpful"]
Reason = Literal["", "factual_error", "unsupported", "misunderstood", "incomplete", "other"]


class FeedbackInput(BaseModel):
    message_id: str = Field(
        min_length=1,
        max_length=1000,
        description="Persistent ID of the completed assistant answer.",
    )
    rating: Rating
    reason: Reason = Field(
        default="", description="Required for unhelpful feedback; cleared for helpful feedback."
    )
    comment: str = Field(default="", max_length=4000)
    correction: str = Field(default="", max_length=4000)
    reference: str = Field(default="", max_length=4000)

    @model_validator(mode="after")
    def check_reason(self) -> FeedbackInput:
        if self.rating == "unhelpful" and not self.reason:
            raise ValueError("Negative feedback requires a reason")
        if self.rating == "helpful":
            self.reason = ""
        return self


class Feedback(FeedbackInput):
    feedback_id: str
    user_id: int
    agent_id: str
    agent_name: str
    thread_id: str
    question: str = Field(description="Immutable question snapshot from trusted server history.")
    answer: str = Field(description="Immutable visible answer; excludes thinking and tool results.")
    created_at: int
    updated_at: int


class FeedbackList(BaseModel):
    items: list[Feedback]


class FeedbackSummary(FeedbackList):
    total: int
    helpful: int
    unhelpful: int


def filters(
    agent_id: str | None = None,
    rating: Rating | None = None,
    reason: Reason | None = None,
    start_time: int | None = None,
    end_time: int | None = None,
) -> dict[str, Any]:
    return {
        "agent_id": agent_id,
        "rating": rating,
        "reason": reason,
        "start_time": start_time,
        "end_time": end_time,
    }


@router.get(
    "/agents/{agent_id}/threads/{thread_id}/feedback",
    response_model=FeedbackList,
    summary="List own answer feedback",
)
async def list_feedback(
    agent_id: str,
    thread_id: str,
    user: User = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    return {"items": await FeedbackService(server).list(user, agent_id, thread_id)}


@router.put(
    "/agents/{agent_id}/threads/{thread_id}/feedback",
    response_model=Feedback,
    summary="Create or update own answer feedback",
    description="Only the thread owner may evaluate a completed answer. Updates retain its original question and answer snapshots.",
)
async def save_feedback(
    agent_id: str,
    thread_id: str,
    body: FeedbackInput,
    user: User = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    return await FeedbackService(server).save(user, agent_id, thread_id, body.model_dump())


@router.delete(
    "/agents/{agent_id}/threads/{thread_id}/feedback",
    status_code=204,
    summary="Withdraw own answer feedback",
)
async def delete_feedback(
    agent_id: str,
    thread_id: str,
    message_id: str,
    user: User = Depends(current_user),
    server: Any = Depends(get_server),
) -> Response:
    await FeedbackService(server).delete(user, agent_id, thread_id, message_id)
    return Response(status_code=204)


@router.get(
    "/admin/feedback",
    response_model=FeedbackSummary,
    summary="Summarize feedback for administrators",
)
async def summary_feedback(
    criteria: Annotated[dict[str, Any], Depends(filters)],
    limit: int = Query(20, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: User = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    return await FeedbackService(server).summary(user, criteria, limit, offset)


@router.get(
    "/admin/feedback/export",
    response_model=list[Feedback],
    summary="Export all matching feedback for administrators",
    description="Administrator only. Downloads every matching record as JSON without pagination.",
)
async def export_feedback(
    criteria: Annotated[dict[str, Any], Depends(filters)],
    user: User = Depends(current_user),
    server: Any = Depends(get_server),
) -> JSONResponse:
    result = await FeedbackService(server).summary(user, criteria)
    return JSONResponse(
        result["items"],
        headers={"Content-Disposition": 'attachment; filename="answer-feedback.json"'},
    )
