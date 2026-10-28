"""Per-agent user and role sharing targets."""

from __future__ import annotations

from dataclasses import dataclass

from octop.infra.db.pool import DatabasePool
from octop.infra.db.repos._base import DbRow, map_rows, now_ts


@dataclass(frozen=True)
class AgentShareTargetRow:
    id: int
    agent_id: str
    target_type: str
    target_id: str
    created_at: int

    @classmethod
    def from_row(cls, row: DbRow) -> AgentShareTargetRow:
        return cls(
            id=int(row["id"]),
            agent_id=str(row["agent_id"]),
            target_type=str(row["target_type"]),
            target_id=str(row["target_id"]),
            created_at=int(row["created_at"]),
        )


class AgentShareTargetRepo:
    def __init__(self, db: DatabasePool) -> None:
        self._db = db

    def list_for_agent(self, agent_id: str) -> list[AgentShareTargetRow]:
        with self._db.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM agent_share_targets WHERE agent_id = ? "
                "ORDER BY CASE target_type WHEN 'user' THEN 0 ELSE 1 END, target_id",
                (agent_id,),
            ).fetchall()
        return map_rows(rows, AgentShareTargetRow)

    def replace_for_agent(
        self,
        agent_id: str,
        *,
        user_ids: list[int] | tuple[int, ...],
        role_ids: list[str] | tuple[str, ...],
    ) -> None:
        users = sorted({int(value) for value in user_ids})
        roles = sorted({str(value).strip() for value in role_ids if str(value).strip()})
        created_at = now_ts()
        values = [(agent_id, "user", str(user_id), created_at) for user_id in users]
        values.extend((agent_id, "role", role_id, created_at) for role_id in roles)
        with self._db.transaction() as conn:
            conn.execute("DELETE FROM agent_share_targets WHERE agent_id = ?", (agent_id,))
            if values:
                conn.executemany(
                    "INSERT INTO agent_share_targets(agent_id, target_type, target_id, created_at) "
                    "VALUES (?, ?, ?, ?)",
                    values,
                )
