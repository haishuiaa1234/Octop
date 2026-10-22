"""Persist immutable answer snapshots and editable user evaluations."""

from __future__ import annotations

from typing import Any

from octop.infra.db.pool import DatabasePool
from octop.infra.db.repos._base import now_ts
from octop.infra.utils.ulid import new_ulid

_FIELDS = "feedback_id,user_id,agent_id,agent_name,thread_id,message_id,rating,reason,comment,correction,reference,question,answer,created_at,updated_at"


class FeedbackRepo:
    def __init__(self, db: DatabasePool) -> None:
        self._db = db

    def get(self, user_id: int, thread_id: str, message_id: str) -> dict[str, Any] | None:
        with self._db.connect() as conn:
            row = conn.execute(
                f"SELECT {_FIELDS} FROM answer_feedback WHERE user_id=? AND thread_id=? AND message_id=?",
                (user_id, thread_id, message_id),
            ).fetchone()
        return {key: row[key] for key in _FIELDS.split(",")} if row else None

    def save(self, data: dict[str, Any]) -> dict[str, Any]:
        values = {**data, "feedback_id": new_ulid(), "created_at": now_ts(), "updated_at": now_ts()}
        with self._db.transaction() as conn:
            conn.execute(
                f"INSERT INTO answer_feedback ({_FIELDS}) VALUES ({','.join('?' for _ in _FIELDS.split(','))}) "
                "ON CONFLICT(user_id,thread_id,message_id) DO UPDATE SET "
                "rating=excluded.rating,reason=excluded.reason,comment=excluded.comment,"
                "correction=excluded.correction,reference=excluded.reference,updated_at=excluded.updated_at",
                tuple(values[key] for key in _FIELDS.split(",")),
            )
            row = conn.execute(
                f"SELECT {_FIELDS} FROM answer_feedback WHERE user_id=? AND thread_id=? AND message_id=?",
                (data["user_id"], data["thread_id"], data["message_id"]),
            ).fetchone()
        return {key: row[key] for key in _FIELDS.split(",")}

    def delete(self, user_id: int, thread_id: str, message_id: str) -> None:
        with self._db.transaction() as conn:
            conn.execute(
                "DELETE FROM answer_feedback WHERE user_id=? AND thread_id=? AND message_id=?",
                (user_id, thread_id, message_id),
            )

    def _where(self, filters: dict[str, Any]) -> tuple[str, list[Any]]:
        clauses, params = [], []
        for key, value in filters.items():
            if value is None:
                continue
            column, operator = {
                "start_time": ("created_at", ">="),
                "end_time": ("created_at", "<"),
            }.get(key, (key, "="))
            if column not in {"created_at", "agent_id", "rating", "reason", "user_id", "thread_id"}:
                raise ValueError("Unsupported feedback filter")
            clauses.append(f"{column} {operator} ?")
            params.append(value)
        return " WHERE " + " AND ".join(clauses) if clauses else "", params

    def query(
        self, filters: dict[str, Any], *, limit: int | None = None, offset: int = 0
    ) -> list[dict[str, Any]]:
        where, params = self._where(filters)
        pagination = ""
        if limit is not None:
            pagination = " LIMIT ? OFFSET ?"
            params.extend((limit, offset))
        with self._db.connect() as conn:
            rows = conn.execute(
                f"SELECT {_FIELDS} FROM answer_feedback{where} ORDER BY created_at DESC,id DESC{pagination}",
                tuple(params),
            ).fetchall()
        return [{key: row[key] for key in _FIELDS.split(",")} for row in rows]

    def summary(self, filters: dict[str, Any], limit: int, offset: int) -> dict[str, Any]:
        where, params = self._where(filters)
        with self._db.connect() as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN rating='helpful' THEN 1 ELSE 0 END),0) AS helpful, "
                "COALESCE(SUM(CASE WHEN rating='unhelpful' THEN 1 ELSE 0 END),0) AS unhelpful FROM answer_feedback"
                + where,
                tuple(params),
            ).fetchone()
        return {
            "items": self.query(filters, limit=limit, offset=offset),
            "total": row["total"],
            "helpful": row["helpful"],
            "unhelpful": row["unhelpful"],
        }
