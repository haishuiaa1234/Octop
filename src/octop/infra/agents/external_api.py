"""External REST API access for configured expert instances."""

from __future__ import annotations

import asyncio
import hashlib
import json
import secrets
from dataclasses import dataclass, field
from typing import Any

from octop.infra.agents.settings.profile import parse_config_json
from octop.infra.utils.ulid import new_ulid

API_KEY_PREFIX = "octop_"


def _hash_key(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def new_api_key() -> str:
    return API_KEY_PREFIX + secrets.token_urlsafe(32)


def external_api_config(row: Any) -> dict[str, Any]:
    return parse_config_json(getattr(row, "external_api_json", None))


def configure_external_api(
    repo: Any, agent_id: str, *, enabled: bool, rotate: bool = False
) -> str | None:
    row = repo.get(agent_id)
    if row is None:
        return None
    current = external_api_config(row)
    plain: str | None = None
    if enabled and (rotate or not current.get("key_hash")):
        plain = new_api_key()
        current["key_hash"] = _hash_key(plain)
        current["key_prefix"] = plain[:14]
    current["enabled"] = bool(enabled)
    repo.update_config(
        agent_id,
        external_api_json=json.dumps(current, ensure_ascii=False),
    )
    return plain


@dataclass
class SessionState:
    session_id: str
    agent_id: str
    user_id: int
    thread_id: str
    request_tasks: dict[str, str] = field(default_factory=dict)


@dataclass
class TaskState:
    task_id: str
    session_id: str
    agent_id: str
    status: str = "queued"
    result: str | None = None
    error: str | None = None


class ExternalApiRuntime:
    """In-process session/task registry used by the REST adapter."""

    def __init__(self) -> None:
        self.sessions: dict[str, SessionState] = {}
        self.tasks: dict[str, TaskState] = {}
        self._tasks: set[asyncio.Task[None]] = set()

    def authenticate(self, rows: list[Any], raw_key: str) -> Any | None:
        digest = _hash_key(raw_key)
        for row in rows:
            cfg = external_api_config(row)
            if cfg.get("enabled") and secrets.compare_digest(
                str(cfg.get("key_hash") or ""), digest
            ):
                return row
        return None

    async def create_session(self, *, server: Any, row: Any) -> SessionState:
        registry = server.app_runtime.agent_registry
        if not registry.is_bootstrapped(row.agent_id):
            await registry.start(row.agent_id)
        session_id = new_ulid()
        session_key = f"external-api:{session_id}"
        thread_id = await server.app_runtime.gateway.thread_registry.get_or_create_by_key(
            session_key=session_key,
            agent_id=row.agent_id,
            user_id=int(row.user_id or 0),
            channel_type="external_api",
        )
        state = SessionState(session_id, row.agent_id, int(row.user_id or 0), thread_id)
        self.sessions[session_id] = state
        return state

    def submit(
        self, *, server: Any, session: SessionState, message: str, request_id: str | None
    ) -> TaskState:
        if request_id and request_id in session.request_tasks:
            return self.tasks[session.request_tasks[request_id]]
        task = TaskState(new_ulid(), session.session_id, session.agent_id)
        self.tasks[task.task_id] = task
        if request_id:
            session.request_tasks[request_id] = task.task_id
        pending = asyncio.create_task(
            self._run(server, session, task, message), name=f"external-api-{task.task_id}"
        )
        self._tasks.add(pending)
        pending.add_done_callback(self._tasks.discard)
        return task

    async def _run(self, server: Any, session: SessionState, task: TaskState, message: str) -> None:
        task.status = "running"
        try:
            from octop_gateway.models import ChannelSubject, InboundMessage, TextContent

            msg = InboundMessage(
                channel_id="external-api",
                channel_type="external_api",
                tenant_id=session.agent_id,
                channel_subject=ChannelSubject(subject_id=str(session.user_id)),
                channel_session_id=f"external-api:{session.session_id}",
                content=[TextContent(text=message)],
                metadata={
                    "thread_id": session.thread_id,
                    "session_key": f"external-api:{session.session_id}",
                },
            )
            processor = server.app_runtime.gateway.processor
            chunks: list[str] = []
            async for chunk in processor.iter_turn_chunks(msg):
                if chunk.get("type") == "token" and isinstance(chunk.get("content"), str):
                    chunks.append(chunk["content"])
                if chunk.get("type") == "error":
                    raise RuntimeError(str(chunk.get("message") or "expert execution failed"))
            task.result = "".join(chunks)
            task.status = "completed"
        except Exception as exc:
            task.error = str(exc)
            task.status = "failed"


runtime = ExternalApiRuntime()


__all__ = [
    "API_KEY_PREFIX",
    "ExternalApiRuntime",
    "SessionState",
    "TaskState",
    "configure_external_api",
    "external_api_config",
    "new_api_key",
    "runtime",
]
