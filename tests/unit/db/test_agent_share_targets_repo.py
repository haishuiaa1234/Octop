from __future__ import annotations

from pathlib import Path

from octop.infra.db.migrate import run_migrations
from octop.infra.db.pool import SqlitePool
from octop.infra.db.repos.agent_share_targets import AgentShareTargetRepo
from octop.infra.db.repos.agents import AgentRepo
from octop.infra.db.repos.users import UserRepo


def test_replace_for_agent_stores_deduplicated_user_and_role_targets(tmp_path: Path) -> None:
    db = SqlitePool(tmp_path / "octop.db")
    run_migrations(db)
    owner_id = UserRepo(db).create(username="owner", password_hash="h", role="admin")
    AgentRepo(db).create(agent_id="agent-1", user_id=owner_id, name="Shared")

    repo = AgentShareTargetRepo(db)
    repo.replace_for_agent("agent-1", user_ids=[3, 3, 2], role_ids=["user", "user", "ops"])

    rows = repo.list_for_agent("agent-1")
    assert [(row.target_type, row.target_id) for row in rows] == [
        ("user", "2"),
        ("user", "3"),
        ("role", "ops"),
        ("role", "user"),
    ]


def test_replace_for_agent_replaces_old_targets_atomically(tmp_path: Path) -> None:
    db = SqlitePool(tmp_path / "octop.db")
    run_migrations(db)
    owner_id = UserRepo(db).create(username="owner", password_hash="h", role="admin")
    AgentRepo(db).create(agent_id="agent-1", user_id=owner_id, name="Shared")

    repo = AgentShareTargetRepo(db)
    repo.replace_for_agent("agent-1", user_ids=[2], role_ids=["ops"])
    repo.replace_for_agent("agent-1", user_ids=[4], role_ids=[])

    assert [(row.target_type, row.target_id) for row in repo.list_for_agent("agent-1")] == [
        ("user", "4")
    ]


def test_schema_repair_recreates_targets_for_existing_v22_database(tmp_path: Path) -> None:
    db = SqlitePool(tmp_path / "octop.db")
    run_migrations(db)
    with db.connect() as conn:
        conn.execute("DROP TABLE agent_share_targets")

    run_migrations(db)

    with db.connect() as conn:
        table = conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
            ("agent_share_targets",),
        ).fetchone()
    assert table is not None
