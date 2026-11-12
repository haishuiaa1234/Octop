"""Upgrade the fork's overlapping migration history without losing local data."""

import os
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from tests.support.postgresql import requires_postgresql

from octop.infra.db import migrate
from octop.infra.db.pool import DatabasePool, PostgresPool, SqlitePool


@pytest.fixture(
    params=[
        "sqlite",
        pytest.param("postgresql", marks=[requires_postgresql, pytest.mark.postgresql]),
    ]
)
def history_pool(tmp_path: Path, request: pytest.FixtureRequest) -> Iterator[DatabasePool]:
    if request.param == "sqlite":
        pool = SqlitePool(tmp_path / "history.db")
        try:
            yield pool
        finally:
            pool.close()
        return

    import psycopg
    from psycopg.conninfo import conninfo_to_dict, make_conninfo

    url = os.environ["OCTOP_TEST_DATABASE_URL"]
    schema = "fork_upgrade_" + uuid.uuid4().hex[:12]
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute(f'CREATE SCHEMA "{schema}"')
    info = conninfo_to_dict(url)
    info["options"] = f"-c search_path={schema}"
    postgres = PostgresPool(make_conninfo(**info))
    try:
        yield postgres
    finally:
        postgres.close()
        with psycopg.connect(url, autocommit=True) as conn:
            conn.execute(f'DROP SCHEMA "{schema}" CASCADE')


def _apply_history_sql(pool: DatabasePool, number: int, path: Path) -> None:
    if pool.dialect == "sqlite":
        migrate._apply_sqlite_migration(pool, number, path)
    else:
        with pool.transaction() as conn:
            migrate._apply_postgresql_migration(conn, path.read_text(encoding="utf-8"))


def test_empty_database_migrates_idempotently(history_pool: DatabasePool) -> None:
    migrate.run_migrations(history_pool)
    migrate.run_migrations(history_pool)
    with history_pool.connect() as conn:
        assert conn.execute("SELECT version FROM _schema_version").fetchone()[0] == 28
        assert conn.execute("SELECT COUNT(*) FROM benchmark_runs").fetchone()[0] == 0


@pytest.mark.parametrize("history", ["main_gys", "main"])
def test_upgrade_both_fork_histories(tmp_path: Path, history: str) -> None:
    pool = SqlitePool(tmp_path / "octop.db")
    migrate.run_migrations(pool)

    with pool.connect() as conn:
        conn.execute(
            "INSERT INTO agents(agent_id, name, enabled, config_json, created_at, updated_at) "
            "VALUES ('custom-expert', 'Custom expert', 1, '{}', 1, 1)"
        )
        if history == "main_gys":
            conn.execute("DROP TABLE bridge_connections")
            conn.execute("ALTER TABLE skill_packages DROP COLUMN copy_policy")
            conn.execute(
                "UPDATE agents SET external_api_json = ? WHERE agent_id = 'custom-expert'",
                ('{"enabled": true, "key_hash": "existing-hash"}',),
            )
            conn.execute("UPDATE _schema_version SET version = 19")
        else:
            conn.execute("ALTER TABLE agents DROP COLUMN external_api_json")
            conn.execute("UPDATE _schema_version SET version = 20")

    migrate.run_migrations(pool)
    migrate.run_migrations(pool)

    with pool.connect() as conn:
        assert conn.execute("SELECT version FROM _schema_version").fetchone()[0] == 28
        agent = conn.execute(
            "SELECT name, external_api_json FROM agents WHERE agent_id = 'custom-expert'"
        ).fetchone()
        assert agent["name"] == "Custom expert"
        if history == "main_gys":
            assert agent["external_api_json"] == '{"enabled": true, "key_hash": "existing-hash"}'
        else:
            assert agent["external_api_json"] is None
        tables = {
            row["name"]
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
        }
        assert "bridge_connections" in tables
        assert "copy_policy" in {
            row["name"] for row in conn.execute("PRAGMA table_info(skill_packages)")
        }
    pool.close()


@pytest.mark.parametrize("version", [20, 21, 22, 23, 25, 26])
def test_upgrade_colliding_histories_preserves_rows(
    history_pool: DatabasePool, version: int
) -> None:
    pool = history_pool
    paths = dict(migrate._discover(pool.dialect))
    upstream_version = 20 if version <= 23 else 25
    for number, path in paths.items():
        if number <= upstream_version:
            _apply_history_sql(pool, number, path)
    local_version = version if version <= 23 else (21 if version == 26 else 20)
    for old, new in ((21, 26), (22, 27), (23, 28)):
        if old <= local_version:
            _apply_history_sql(pool, new, paths[new])
    with pool.connect() as conn:
        conn.execute("UPDATE _schema_version SET version = ?", (version,))
        conn.execute(
            "INSERT INTO users (username,password_hash,role,created_at) "
            "VALUES ('owner','existing-hash','admin',1)"
        )
        conn.execute(
            "INSERT INTO agents (agent_id,name,config_json,created_at,updated_at) "
            "VALUES ('expert','Local expert','{}',1,1)"
        )
        if local_version >= 21:
            conn.execute("UPDATE agents SET external_api_json = 'original-api-config'")
        if local_version >= 22:
            conn.execute(
                "INSERT INTO answer_feedback "
                "(feedback_id,user_id,agent_id,agent_name,thread_id,message_id,rating,"
                "question,answer,created_at,updated_at) "
                "VALUES ('feedback',1,'expert','Local expert','thread','message',"
                "'helpful','Question','Trusted answer',1,1)"
            )
            conn.execute(
                "INSERT INTO agent_share_targets(agent_id,target_type,target_id,created_at) "
                "VALUES ('expert','role','reviewer',1)"
            )
        if local_version >= 23:
            conn.execute(
                "INSERT INTO benchmark_cases(case_id,agent_id,title,question,created_at,updated_at) "
                "VALUES ('case','expert','Original case','Question',1,1)"
            )
            conn.execute(
                "INSERT INTO benchmark_runs "
                "(run_id,agent_id,user_id,name,config_snapshot,results,created_at,updated_at) "
                "VALUES ('run','expert',1,'Original run','{}','[]',1,1)"
            )
    migrate.run_migrations(pool)
    migrate.run_migrations(pool)
    with pool.connect() as conn:
        assert conn.execute("SELECT version FROM _schema_version").fetchone()[0] == 28
        assert conn.execute("SELECT name FROM agents").fetchone()[0] == "Local expert"
        if local_version >= 21:
            assert conn.execute("SELECT external_api_json FROM agents").fetchone()[0] == (
                "original-api-config"
            )
        if local_version >= 22:
            assert conn.execute("SELECT answer FROM answer_feedback").fetchone()[0] == (
                "Trusted answer"
            )
            assert conn.execute("SELECT target_id FROM agent_share_targets").fetchone()[0] == (
                "reviewer"
            )
        if local_version >= 23:
            assert conn.execute("SELECT title FROM benchmark_cases").fetchone()[0] == (
                "Original case"
            )
            assert conn.execute("SELECT name FROM benchmark_runs").fetchone()[0] == "Original run"
        columns = migrate._table_columns(pool, "skill_packages")
        assert {"allow_download", "shared", "copy_policy"} <= columns
        group_columns = migrate._table_columns(pool, "user_group")
        assert {"enabled", "avatar_icon"} <= group_columns
        assert conn.execute("SELECT COUNT(*) FROM user_totp").fetchone()[0] == 0
