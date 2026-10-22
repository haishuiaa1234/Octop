"""Answer evaluation authorization and server-owned history snapshots."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from functools import partial
from typing import Any

from octop.infra.errors import ErrorCode, OctopError
from octop.infra.gateway.process.message_keys import STREAM_ERROR_FLAG, parse_checkpoint_ts_ms
from octop.infra.history.answer_text import join_answer_parts, visible_text
from octop.infra.history.reader import export_messages
from octop.infra.users.identity import User


async def _execute[T](function: Callable[..., T], *args: Any) -> T:
    return await asyncio.get_running_loop().run_in_executor(None, partial(function, *args))


def validate_evaluation(data: dict[str, Any]) -> dict[str, Any]:
    result = {
        key: data.get(key, "")
        for key in ("message_id", "rating", "reason", "comment", "correction", "reference")
    }
    if (
        not isinstance(result["message_id"], str)
        or not result["message_id"]
        or len(result["message_id"]) > 1000
    ):
        raise ValueError("Invalid message id")
    if result["rating"] not in ("helpful", "unhelpful"):
        raise ValueError("Invalid feedback rating")
    if result["rating"] == "unhelpful" and result["reason"] not in (
        "factual_error",
        "unsupported",
        "misunderstood",
        "incomplete",
        "other",
    ):
        raise ValueError("Negative feedback requires a reason")
    for key in ("comment", "correction", "reference"):
        if not isinstance(result[key], str) or len(result[key]) > 4000:
            raise ValueError("Invalid feedback text")
    if result["rating"] == "helpful":
        result["reason"] = ""
    return result


def answer_snapshot(messages: list[Any], message_id: str) -> tuple[str, str]:
    question: str | None = None
    group: list[dict[str, Any]] = []
    group_key: tuple[str, bool] | None = None
    for wire in messages:
        if not isinstance(wire, dict):
            continue
        data = wire.get("data", wire)
        role = wire.get("type") or wire.get("role")
        kwargs = data.get("additional_kwargs") or {}
        if role in ("human", "user"):
            question = visible_text(data.get("content"))
            group = []
            group_key = None
        elif role in ("ai", "assistant", "tool"):
            key = (str(kwargs.get("speaker_agent_id") or ""), bool(kwargs.get("team_wrapup")))
            if group_key is not None and key != group_key:
                group = []
            group_key = key
            group.append({"role": role, **data})
        if data.get("id") != message_id:
            continue
        answer = visible_text(data.get("content"))
        if (
            role not in ("ai", "assistant")
            or not answer.strip()
            or question is None
            or kwargs.get(STREAM_ERROR_FLAG)
            or data.get("tool_calls")
        ):
            raise ValueError("Message is not an assistant answer")
        parts: list[str] = []
        completed_tool_between = False
        saw_tool = False
        for item in group:
            if item["role"] == "tool":
                if parts and item.get("content"):
                    saw_tool = True
                continue
            if item.get("tool_calls") or (item.get("additional_kwargs") or {}).get(
                STREAM_ERROR_FLAG
            ):
                continue
            text = visible_text(item.get("content"))
            if text.strip():
                if saw_tool:
                    completed_tool_between = True
                parts.append(text)
        joined = (
            join_answer_parts(parts)
            if group_key and (group_key[0] or group_key[1] or not completed_tool_between)
            else answer
        )
        return question or "", joined
    raise ValueError("Answer not found")


def _projection_snapshot_messages(
    archived: list[Any], rows: list[Any], message_id: str
) -> list[Any]:
    projected = [(json.loads(row.message_json), row.created_at * 1000) for row in rows]

    def timestamp(wire: dict[str, Any], fallback: int = 0) -> int:
        data = wire.get("data", wire)
        return (
            parse_checkpoint_ts_ms((data.get("additional_kwargs") or {}).get("checkpoint_ts"))
            or fallback
        )

    target_time = next(
        (
            timestamp(wire, created)
            for wire, created in projected
            if wire.get("data", wire).get("id") == message_id
        ),
        None,
    )
    if target_time is None:
        return []
    # Timestamp boundaries link projection-only team replies to their archived
    # question, without accidentally borrowing a newer user turn.
    questions = [
        (timestamp(wire, fallback), wire)
        for wire, fallback in [
            *((wire, 0) for wire in archived if isinstance(wire, dict)),
            *projected,
        ]
        if (wire.get("type") or wire.get("role")) in ("human", "user")
        and 0 < timestamp(wire, fallback) <= target_time
    ]
    if not questions:
        return [wire for wire, _ in projected]
    question_time, question = max(questions, key=lambda item: item[0])
    tail = [
        wire
        for wire, created in projected
        if question_time <= timestamp(wire, created) <= target_time
        and (wire.get("type") or wire.get("role")) not in ("human", "user")
    ]
    return [question, *tail]


class FeedbackService:
    def __init__(self, server: Any) -> None:
        self.server = server
        self.services = server.services

    async def authorize(self, user: User, agent_id: str, thread_id: str) -> Any:
        thread = await _execute(self.services.thread_repo.get, thread_id)
        if thread is None or thread.agent_id != agent_id:
            raise OctopError(ErrorCode.NOT_FOUND, "Thread not found")
        if thread.user_id != user.id:
            raise OctopError(ErrorCode.FORBIDDEN, "Thread belongs to another user")
        agent = await _execute(self.services.agent_repo.get, agent_id)
        if agent is None:
            raise OctopError(ErrorCode.NOT_FOUND, "Agent not found")
        if not user.is_admin and agent.user_id != user.id and not agent.is_shared:
            raise OctopError(ErrorCode.FORBIDDEN, "Agent not accessible to user")
        return thread

    async def list(self, user: User, agent_id: str, thread_id: str) -> list[dict[str, Any]]:
        await self.authorize(user, agent_id, thread_id)
        return await _execute(
            self.services.feedback_repo.query, {"user_id": user.id, "thread_id": thread_id}
        )

    async def save(
        self, user: User, agent_id: str, thread_id: str, data: dict[str, Any]
    ) -> dict[str, Any]:
        data = validate_evaluation(data)
        await self.authorize(user, agent_id, thread_id)
        existing = await _execute(
            self.services.feedback_repo.get, user.id, thread_id, data["message_id"]
        )
        if existing is not None:
            return await _execute(self.services.feedback_repo.save, {**existing, **data})
        runtime = self.server.app_runtime
        gateway = getattr(runtime, "gateway", None)
        hub = getattr(gateway, "ws_hub", None)
        if hub is not None and hub.is_turn_active(thread_id):
            raise OctopError(ErrorCode.AGENT_BUSY, "Wait until the answer is complete")
        archive = getattr(runtime, "history_archive", None)
        if archive is not None:
            unfinished = await _execute(lambda: archive.store.turn(thread_id, unfinished=True))
            if unfinished is not None:
                raise OctopError(ErrorCode.AGENT_BUSY, "Wait until the answer is complete")
            messages = await export_messages(archive, runtime.agent_registry, agent_id, thread_id)
            if not any(
                isinstance(wire, dict) and wire.get("data", wire).get("id") == data["message_id"]
                for wire in messages
            ):
                rows = await _execute(
                    self.services.thread_message_repo.range_rows, thread_id, 0, 2**63 - 1
                )
                messages = _projection_snapshot_messages(messages, rows, data["message_id"])
        else:
            rows = await _execute(
                self.services.thread_message_repo.range_rows, thread_id, 0, 2**63 - 1
            )
            messages = [json.loads(row.message_json) for row in rows]
        try:
            question, answer = answer_snapshot(messages, data["message_id"])
        except ValueError as exc:
            raise OctopError(ErrorCode.NOT_FOUND, "Assistant answer not found") from exc
        speaker_id = agent_id
        for wire in messages:
            if not isinstance(wire, dict):
                continue
            message = wire.get("data", wire)
            if message.get("id") == data["message_id"]:
                speaker_id = str(
                    (message.get("additional_kwargs") or {}).get("speaker_agent_id") or agent_id
                )
                break
        agent = await _execute(self.services.agent_repo.get, speaker_id)
        return await _execute(
            self.services.feedback_repo.save,
            {
                **data,
                "user_id": user.id,
                "agent_id": speaker_id,
                "agent_name": agent.name if agent else speaker_id,
                "thread_id": thread_id,
                "question": question,
                "answer": answer,
            },
        )

    async def delete(self, user: User, agent_id: str, thread_id: str, message_id: str) -> None:
        await self.authorize(user, agent_id, thread_id)
        await _execute(self.services.feedback_repo.delete, user.id, thread_id, message_id)

    async def summary(
        self, user: User, filters: dict[str, Any], limit: int | None = None, offset: int = 0
    ) -> dict[str, Any]:
        if not user.is_admin:
            raise OctopError(ErrorCode.FORBIDDEN, "Administrator required")
        if limit is not None:
            return await _execute(self.services.feedback_repo.summary, filters, limit, offset)
        items = await _execute(self.services.feedback_repo.query, filters)
        return {
            "items": items,
            "total": len(items),
            "helpful": sum(item["rating"] == "helpful" for item in items),
            "unhelpful": sum(item["rating"] == "unhelpful" for item in items),
        }
