"""Expert teams — create, list, update roster."""

from __future__ import annotations

from typing import Any, cast

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from pydantic import BaseModel, Field

from octop.api.common.agent import (
    assert_agent_access_row,
    assert_agent_owner,
    replace_share_targets,
    share_target_ids,
)
from octop.api.deps import current_user, get_server
from octop.infra.agents.manager import AgentCreateSpec
from octop.infra.agents.teams import (
    TEAM_KIND,
    TEAM_TEMPLATE_NAME,
    TEMPLATE_DIR,
    is_team_agent,
    team_icon_url,
)
from octop.infra.errors import ErrorCode, OctopError

router = APIRouter()


class TeamCreateBody(BaseModel):
    name: str
    description: str | None = None
    default_model: str | None = None
    color: str | None = None
    icon_name: str | None = None
    icon_url: str | None = None
    welcome_message: str | None = None
    member_ids: list[str] = Field(default_factory=list)
    config: dict[str, Any] = Field(default_factory=dict)
    is_shared: bool = Field(
        default=False, description="Allow all other users to chat with this team."
    )
    shared_user_ids: list[int] = Field(default_factory=list)
    shared_role_ids: list[str] = Field(default_factory=list)


class TeamPatchBody(BaseModel):
    name: str | None = None
    description: str | None = None
    default_model: str | None = None
    color: str | None = None
    icon_name: str | None = None
    welcome_message: str | None = None
    member_ids: list[str] | None = None
    is_shared: bool | None = Field(default=None, description="Owner-only sharing toggle.")
    shared_user_ids: list[int] | None = None
    shared_role_ids: list[str] | None = None


class TeamMemberSummary(BaseModel):
    agent_id: str
    name: str
    color: str | None
    icon_name: str | None
    icon_url: str | None
    state: str
    is_shared: bool
    user_id: int | None


class TeamResponse(BaseModel):
    team_id: str
    agent_id: str
    name: str
    description: str | None
    default_model: str | None
    color: str | None
    icon_name: str | None
    icon_url: str
    welcome_message: str | None
    state: str
    kind: str
    is_shared: bool
    is_owner: bool
    owner_username: str | None
    member_ids: list[str]
    members: list[TeamMemberSummary]
    shared_user_ids: list[int]
    shared_role_ids: list[str]


def _teams(server: Any) -> Any:
    assert server.app_runtime is not None
    return server.app_runtime.agent_registry.teams


def _require_team(server: Any, user: Any, team_id: str, *, owner_only: bool = True) -> Any:
    assert server.app_runtime is not None
    row = server.app_runtime.agent_registry.get_row(team_id)
    if row is None or not is_team_agent(row):
        raise OctopError(ErrorCode.TEAM_NOT_FOUND, f"team {team_id!r} not found")
    if owner_only:
        assert_agent_owner(row, user)
    else:
        targets = server.services.agent_share_target_repo.list_for_agent(team_id)
        assert_agent_access_row(row, user, share_targets=targets)
    return row


@router.get(
    "/teams", summary="List owned and shared expert teams", response_model=list[TeamResponse]
)
async def list_teams(
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> list[dict[str, Any]]:
    return cast(list[dict[str, Any]], _teams(server).list_for_user(user.id))


@router.post("/teams", summary="Create an expert team", response_model=TeamResponse)
async def create_team(
    body: TeamCreateBody,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    teams = _teams(server)
    member_ids = teams.validate_member_ids(user, body.member_ids)
    assert server.app_runtime is not None
    spec = AgentCreateSpec(
        name=body.name.strip(),
        user_id=user.id,
        description=body.description,
        default_model=body.default_model,
        color=body.color,
        icon_name=body.icon_name or "users",
        icon_url=team_icon_url(body.icon_url),
        welcome_message=body.welcome_message,
        template_name=TEAM_TEMPLATE_NAME,
        kind=TEAM_KIND,
        config=body.config,
        member_ids=member_ids,
        mcp_servers=[],
        is_shared=body.is_shared,
    )
    row = await server.app_runtime.agent_registry.create(spec)
    replace_share_targets(
        server,
        row.agent_id,
        user_ids=body.shared_user_ids,
        role_ids=body.shared_role_ids,
    )
    row = server.app_runtime.agent_registry.get_row(row.agent_id) or row
    return cast(
        dict[str, Any],
        teams.team_payload(
            server.app_runtime.agent_registry.get_row(row.agent_id) or row, viewer_user_id=user.id
        ),
    )


@router.get("/teams/template", summary="Preview default team workspace files")
async def team_template_files(
    _user: Any = Depends(current_user),
) -> list[dict[str, str]]:
    files: list[dict[str, str]] = []
    if TEMPLATE_DIR.is_dir():
        for path in sorted(TEMPLATE_DIR.iterdir()):
            if path.is_file() and path.suffix.lower() == ".md" and not path.name.startswith("."):
                files.append(
                    {
                        "name": path.name,
                        "content": path.read_text(encoding="utf-8"),
                    }
                )
    return files


@router.get(
    "/teams/{team_id}",
    summary="Get an owned or shared expert team",
    description="Shared viewers may read member summaries, not member configuration or workspaces.",
    response_model=TeamResponse,
)
async def get_team(
    team_id: str,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    row = _require_team(server, user, team_id, owner_only=False)
    return cast(dict[str, Any], _teams(server).team_payload(row, viewer_user_id=user.id))


@router.patch(
    "/teams/{team_id}",
    summary="Update an expert team",
    description="Only the owner or an administrator may change configuration, members, or sharing.",
    response_model=TeamResponse,
)
async def patch_team(
    team_id: str,
    body: TeamPatchBody,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> dict[str, Any]:
    _require_team(server, user, team_id)
    teams = _teams(server)
    assert server.app_runtime is not None
    roster_changed = False
    if body.member_ids is not None:
        next_ids = teams.validate_member_ids(user, body.member_ids)
        teams.assert_roster_writable(team_id, next_ids)
        teams.replace_members(team_id, next_ids)
        roster_changed = True
    updates: dict[str, Any] = {}
    if body.name is not None:
        updates["name"] = body.name.strip()
    if body.description is not None:
        updates["description"] = body.description
    if body.default_model is not None:
        updates["default_model"] = body.default_model
    if body.color is not None:
        updates["color"] = body.color
    if body.icon_name is not None:
        updates["icon_name"] = body.icon_name
    if body.welcome_message is not None:
        updates["welcome_message"] = body.welcome_message
    if updates:
        await server.app_runtime.agent_registry.update(team_id, **updates)
    if body.is_shared is not None:
        await server.app_runtime.agent_registry.set_shared(team_id, body.is_shared)
    if "shared_user_ids" in body.model_fields_set or "shared_role_ids" in body.model_fields_set:
        current_users, current_roles = share_target_ids(server, team_id)
        replace_share_targets(
            server,
            team_id,
            user_ids=(
                body.shared_user_ids
                if "shared_user_ids" in body.model_fields_set
                else current_users
            )
            or [],
            role_ids=(
                body.shared_role_ids
                if "shared_role_ids" in body.model_fields_set
                else current_roles
            )
            or [],
        )
    if roster_changed:
        await server.app_runtime.agent_registry.reload(team_id)
    row = server.app_runtime.agent_registry.get_row(team_id)
    if row is None:
        raise OctopError(ErrorCode.TEAM_NOT_FOUND, f"team {team_id!r} not found")
    return cast(dict[str, Any], teams.team_payload(row, viewer_user_id=user.id))


@router.get(
    "/teams/{team_id}/members/{member_id}/avatar",
    summary="Fetch a team member avatar",
    description="Requires access to the current team and roster; does not grant member workspace access.",
    response_class=Response,
    responses={
        200: {"content": {"image/png": {}, "image/jpeg": {}, "image/webp": {}, "image/gif": {}}}
    },
)
async def get_member_avatar(
    team_id: str,
    member_id: str,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> Response:
    _require_team(server, user, team_id, owner_only=False)
    data, media_type = await _teams(server).member_avatar(team_id, member_id)
    return Response(
        content=data, media_type=media_type, headers={"Cache-Control": "private, no-store"}
    )


@router.delete("/teams/{team_id}", status_code=204, summary="Delete an expert team")
async def delete_team(
    team_id: str,
    user: Any = Depends(current_user),
    server: Any = Depends(get_server),
) -> None:
    _require_team(server, user, team_id)
    assert server.app_runtime is not None
    await server.app_runtime.agent_registry.delete(team_id)
