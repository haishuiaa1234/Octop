# tests/unit/db/test_agent_is_shared.py
from __future__ import annotations

from pathlib import Path

import pytest

from octop.infra.db.migrate import run_migrations
from octop.infra.db.pool import SqlitePool
from octop.infra.db.repos.agents import AgentRepo
from octop.infra.db.repos.users import UserRepo


@pytest.fixture
def db(tmp_path: Path) -> SqlitePool:
    pool = SqlitePool(tmp_path / "octop.db")
    run_migrations(pool)
    return pool


def test_is_shared_default_zero_and_list_shared(db):
    run_migrations(db)  # or use fixture that already migrated
    UserRepo(db).create(username="u1", password_hash="h", role="user")
    UserRepo(db).create(username="u2", password_hash="h", role="user")
    repo = AgentRepo(db)
    repo.create(agent_id="a1", user_id=1, name="mine")
    repo.create(agent_id="a2", user_id=2, name="theirs")
    repo.set_shared("a2", True)
    rows = repo.list_shared(exclude_user_id=1)
    assert [r.agent_id for r in rows] == ["a2"]
    assert rows[0].is_shared == 1


def test_group_visibility_and_directed_shares_have_the_same_access_rules(db):
    from octop.api.common.agent import assert_agent_access_row, assert_agent_owner
    from octop.infra.db.services import RepoBundle
    from octop.infra.errors import OctopError
    from octop.infra.users.groups import RESOURCE_EXPERT, GroupAccess
    from octop.infra.users.identity import User

    repos = RepoBundle.from_pool(db)
    owner = repos.user_repo.create(username="owner", role="user")
    member = repos.user_repo.create(username="member", role="user")
    recipient = repos.user_repo.create(username="recipient", role="user")
    outsider = repos.user_repo.create(username="outsider", role="user")
    group = repos.user_group_repo.create(name="team", description=None)
    repos.user_group_member_repo.add(group.user_group_id, member)
    repos.agent_repo.create(agent_id="grouped", user_id=owner, name="grouped")
    repos.agent_repo.create(agent_id="direct", user_id=owner, name="direct")
    repos.agent_repo.set_shared("grouped", True)
    GroupAccess(repos).set_visibility(RESOURCE_EXPERT, "grouped", "groups", [group.user_group_id])
    repos.agent_share_target_repo.replace_for_agent("grouped", user_ids=[recipient], role_ids=[])
    repos.agent_share_target_repo.replace_for_agent("direct", user_ids=[recipient], role_ids=[])
    for uid, expected in [
        (member, {"grouped"}),
        (recipient, {"grouped", "direct"}),
        (outsider, set()),
    ]:
        rows = repos.agent_repo.list_shared(user_id=uid, role_id="user", viewer_user_id=uid)
        assert {row.agent_id for row in rows} == expected
        viewer = User(uid, "viewer", "user", None)
        for aid in ("grouped", "direct"):
            row = repos.agent_repo.get(aid)
            if aid in expected:
                assert_agent_access_row(row, viewer, repos=repos)
                with pytest.raises(OctopError):
                    assert_agent_owner(row, viewer)
            else:
                with pytest.raises(OctopError):
                    assert_agent_access_row(row, viewer, repos=repos)
    repos.agent_share_target_repo.replace_for_agent("direct", user_ids=[], role_ids=["user"])
    assert {
        row.agent_id for row in repos.agent_repo.list_shared(user_id=outsider, role_id="user")
    } == {"direct"}
    assert {row.agent_id for row in repos.agent_repo.list_shared(viewer_user_id=outsider)} == {
        "direct"
    }


def test_explicit_admin_viewer_bypasses_groups_without_broadening_default_access(db):
    from octop.infra.db.services import RepoBundle
    from octop.infra.users.groups import RESOURCE_EXPERT, GroupAccess

    repos = RepoBundle.from_pool(db)
    owner = repos.user_repo.create(username="owner", role="user")
    viewer = repos.user_repo.create(username="viewer", role="admin")
    group = repos.user_group_repo.create(name="restricted", description=None)
    repos.agent_repo.create(agent_id="grouped", user_id=owner, name="Group expert")
    repos.agent_repo.set_shared("grouped", True)
    GroupAccess(repos).set_visibility(RESOURCE_EXPERT, "grouped", "groups", [group.user_group_id])

    assert repos.agent_repo.list_shared(user_id=viewer) == []
    assert [
        row.agent_id
        for row in repos.agent_repo.list_shared(
            user_id=viewer, role_id="admin", viewer_user_id=None
        )
    ] == ["grouped"]
