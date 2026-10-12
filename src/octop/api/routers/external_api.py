"""REST API for invoking configured expert instances from third-party apps."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Header, Response, status
from pydantic import BaseModel, Field

from octop.api.common.agent import assert_agent_owner
from octop.api.deps import current_user, get_server
from octop.infra.agents.external_api import (
    configure_external_api,
    external_api_config,
    runtime,
)
from octop.infra.errors import ErrorCode, OctopError

router = APIRouter()


class ExternalApiConfigBody(BaseModel):
    enabled: bool = True
    rotate: bool = False


class ExternalSessionBody(BaseModel):
    metadata: dict[str, str] = Field(default_factory=dict)


class ExternalMessageBody(BaseModel):
    message: str = Field(..., min_length=1, max_length=100_000)
    request_id: str | None = Field(default=None, max_length=200)


def _api_key(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise OctopError(ErrorCode.AUTH_FAILED, "Authorization bearer token required", status=401)
    value = authorization[7:].strip()
    if not value:
        raise OctopError(ErrorCode.AUTH_FAILED, "API key required", status=401)
    return value


def _row_for_key(server: Any, authorization: str | None) -> Any:
    key = _api_key(authorization)
    row = runtime.authenticate(server.services.agent_repo.list_all(), key)
    if row is None:
        raise OctopError(ErrorCode.AUTH_FAILED, "invalid or disabled expert API key", status=401)
    if not row.enabled:
        raise OctopError(ErrorCode.FORBIDDEN, "expert is disabled", status=403)
    return row


@router.get("/agents/{agent_id}/external-api", summary="Get expert external API settings")
async def get_external_api_config(
    agent_id: str,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    row = server.services.agent_repo.get(agent_id)
    if row is None:
        raise OctopError(ErrorCode.AGENT_NOT_FOUND, f"agent {agent_id!r} not found")
    assert_agent_owner(row, user)
    cfg = external_api_config(row)
    return {
        "agent_id": agent_id,
        "enabled": bool(cfg.get("enabled")),
        "key_prefix": cfg.get("key_prefix"),
    }


@router.put("/agents/{agent_id}/external-api", summary="Configure expert external API")
async def configure_external_api_route(
    agent_id: str,
    body: ExternalApiConfigBody,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    row = server.services.agent_repo.get(agent_id)
    if row is None:
        raise OctopError(ErrorCode.AGENT_NOT_FOUND, f"agent {agent_id!r} not found")
    assert_agent_owner(row, user)
    plain = configure_external_api(
        server.services.agent_repo,
        agent_id,
        enabled=body.enabled,
        rotate=body.rotate,
    )
    cfg = external_api_config(server.services.agent_repo.get(agent_id))
    payload: dict[str, Any] = {
        "agent_id": agent_id,
        "enabled": bool(cfg.get("enabled")),
        "key_prefix": cfg.get("key_prefix"),
    }
    if plain is not None:
        payload["api_key"] = plain
    return payload


@router.delete(
    "/agents/{agent_id}/external-api", status_code=204, summary="Disable expert external API"
)
async def disable_external_api(
    agent_id: str,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> Response:
    row = server.services.agent_repo.get(agent_id)
    if row is None:
        raise OctopError(ErrorCode.AGENT_NOT_FOUND, f"agent {agent_id!r} not found")
    assert_agent_owner(row, user)
    configure_external_api(server.services.agent_repo, agent_id, enabled=False)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/v1/expert-api/sessions", status_code=201, summary="Create external expert session")
async def create_external_session(
    body: ExternalSessionBody,
    authorization: str | None = Header(default=None),
    server: Any = Depends(get_server),
) -> dict[str, str]:
    row = _row_for_key(server, authorization)
    session = await runtime.create_session(server=server, row=row)
    return {"session_id": session.session_id, "agent_id": session.agent_id}


@router.post(
    "/v1/expert-api/sessions/{session_id}/messages",
    status_code=202,
    summary="Submit asynchronous expert message",
)
async def submit_external_message(
    session_id: str,
    body: ExternalMessageBody,
    authorization: str | None = Header(default=None),
    server: Any = Depends(get_server),
) -> dict[str, str]:
    row = _row_for_key(server, authorization)
    session = runtime.sessions.get(session_id)
    if session is None or session.agent_id != row.agent_id:
        raise OctopError(ErrorCode.NOT_FOUND, "session not found")
    task = runtime.submit(
        server=server,
        session=session,
        message=body.message.strip(),
        request_id=body.request_id.strip() if body.request_id else None,
    )
    return {"task_id": task.task_id, "session_id": task.session_id, "status": task.status}


@router.get("/v1/expert-api/tasks/{task_id}", summary="Get external expert task")
async def get_external_task(
    task_id: str,
    authorization: str | None = Header(default=None),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    row = _row_for_key(server, authorization)
    task = runtime.tasks.get(task_id)
    if task is None or task.agent_id != row.agent_id:
        raise OctopError(ErrorCode.NOT_FOUND, "task not found")
    payload: dict[str, Any] = {
        "task_id": task.task_id,
        "session_id": task.session_id,
        "status": task.status,
    }
    if task.status == "completed":
        payload["result"] = task.result or ""
    if task.status == "failed":
        payload["error"] = task.error or "expert execution failed"
    return payload


__all__ = ["router"]
