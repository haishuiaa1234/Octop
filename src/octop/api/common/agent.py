"""Shared agent ownership / existence checks for HTTP routers."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any, cast

from octop.infra.errors import ErrorCode, OctopError


def agent_is_shared(row: Any) -> bool:
    return int(getattr(row, "is_shared", 0) or 0) == 1


def user_owns_agent(row: Any, user: Any) -> bool:
    return row.user_id is not None and row.user_id == user.id


def agent_has_share_target(row: Any, user: Any, share_targets: Iterable[Any]) -> bool:
    user_id = str(getattr(user, "id", ""))
    role_id = str(getattr(user, "role", ""))
    return any(
        (
            getattr(target, "target_type", None) == "user"
            and str(getattr(target, "target_id", "")) == user_id
        )
        or (
            getattr(target, "target_type", None) == "role"
            and str(getattr(target, "target_id", "")) == role_id
        )
        for target in share_targets
    )


def share_target_ids(server: Any, agent_id: str) -> tuple[list[int], list[str]]:
    users: list[int] = []
    roles: list[str] = []
    for target in _list_share_targets(server, agent_id):
        if target.target_type == "user":
            users.append(int(target.target_id))
        elif target.target_type == "role":
            roles.append(target.target_id)
    return users, roles


def replace_share_targets(
    server: Any,
    agent_id: str,
    *,
    user_ids: list[int],
    role_ids: list[str],
) -> tuple[list[int], list[str]]:
    normalized_users = sorted({int(value) for value in user_ids})
    normalized_roles = sorted({str(value).strip() for value in role_ids if str(value).strip()})
    for user_id in normalized_users:
        target = server.services.user_repo.get(user_id)
        if target is None:
            raise OctopError(ErrorCode.NOT_FOUND, f"user {user_id} not found")
    from octop.infra.db.repos.user_roles import UserRoleRepo

    role_repo = UserRoleRepo(server.services.db)
    for role_id in normalized_roles:
        if role_repo.get(role_id) is None:
            raise OctopError(ErrorCode.NOT_FOUND, f"role {role_id} not found")
    server.services.agent_share_target_repo.replace_for_agent(
        agent_id,
        user_ids=normalized_users,
        role_ids=normalized_roles,
    )
    return normalized_users, normalized_roles


def _list_share_targets(server: Any, agent_id: str) -> Iterable[Any]:
    """Return persisted targets, tolerating lightweight test/runtime doubles."""
    services = getattr(server, "services", None)
    repo = getattr(services, "agent_share_target_repo", None)
    if repo is None:
        return ()
    return cast(Iterable[Any], repo.list_for_agent(agent_id))


def assert_agent_owner(row: Any, user: Any) -> None:
    """Raise if the user may not mutate this agent row (admin bypasses)."""
    if user.is_admin:
        return
    if row.user_id is None or row.user_id != user.id:
        raise OctopError(ErrorCode.FORBIDDEN, "agent not owned by user")


def _user_may_access(row: Any, user: Any, share_targets: Iterable[Any] = ()) -> bool:
    if user.is_admin:
        return True
    if row.user_id is not None and row.user_id == user.id:
        return True
    return bool(agent_is_shared(row)) or agent_has_share_target(row, user, share_targets)


def assert_agent_access_row(row: Any, user: Any, *, share_targets: Iterable[Any] = ()) -> None:
    if not _user_may_access(row, user, share_targets):
        raise OctopError(ErrorCode.FORBIDDEN, "agent not accessible to user")


def require_agent_row(
    agent_id: str,
    *,
    user: Any,
    as_user: int | None,
    server: Any,
) -> Any:
    """Load an agent row after owner / shared-agent / admin ``as_user`` checks."""
    assert server.app_runtime is not None
    row = server.app_runtime.agent_registry.get_row(agent_id)
    if row is None:
        raise OctopError(ErrorCode.AGENT_NOT_FOUND, f"agent {agent_id!r} not found")
    if as_user is not None and as_user != user.id:
        if not user.is_admin:
            raise OctopError(ErrorCode.FORBIDDEN, "as_user requires admin")
        target = server.user_manager.get_by_id(as_user)
        if target is None:
            raise OctopError(ErrorCode.NOT_FOUND, f"user {as_user} not found")
        if row.user_id is not None and row.user_id != as_user:
            raise OctopError(ErrorCode.FORBIDDEN, "agent not owned by as_user")
    else:
        targets = _list_share_targets(server, agent_id)
        assert_agent_access_row(row, user, share_targets=targets)
    return row


def require_agent_owner_row(
    agent_id: str,
    *,
    user: Any,
    as_user: int | None,
    server: Any,
) -> Any:
    """Load an agent row and require owner-level access."""
    row = require_agent_row(agent_id, user=user, as_user=as_user, server=server)
    assert_agent_owner(row, user)
    return row


def assert_agent_access(server: Any, agent_id: str, user: Any) -> None:
    """Ensure agent exists and is accessible to the current user."""
    require_agent_row(agent_id, user=user, as_user=None, server=server)
