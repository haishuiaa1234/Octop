"""Upgrade both histories that independently used schema version 19."""

from pathlib import Path

import pytest

from octop.infra.db import migrate
from octop.infra.db.pool import SqlitePool


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
        assert conn.execute("SELECT version FROM _schema_version").fetchone()[0] == 21
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
