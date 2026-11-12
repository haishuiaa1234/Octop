"""Agent-scoped benchmark cases, reviewed feedback and frozen runs."""

from __future__ import annotations

import json
from typing import Any

from octop.infra.db.pool import DatabasePool
from octop.infra.db.repos._base import now_ts
from octop.infra.utils.ulid import new_ulid

_CASE_DEFAULTS: dict[str, Any] = {
    "title": "",
    "question": "",
    "context": "",
    "reference_answer": "",
    "rubric": "",
    "match_mode": "manual",
    "keywords": [],
    "tags": [],
    "split": "test",
    "status": "draft",
    "source": "manual",
    "source_feedback_id": None,
    "source_snapshot": {},
}
_SOURCE_FIELDS = {"source", "source_feedback_id", "source_snapshot"}
_JSON_FIELDS = {"keywords", "tags", "source_snapshot", "snapshot", "config_snapshot", "results"}


def _decode(row: Any) -> dict[str, Any]:
    keys = row.keys()
    data = {key: row[key] for key in keys if key != "id"}
    for key in _JSON_FIELDS & data.keys():
        data[key] = json.loads(data[key])
    return data


def _insert(conn: Any, table: str, data: dict[str, Any]) -> None:
    values = [
        json.dumps(value, ensure_ascii=False) if key in _JSON_FIELDS else value
        for key, value in data.items()
    ]
    conn.execute(
        f"INSERT INTO {table} ({','.join(data)}) VALUES ({','.join('?' for _ in data)})",
        tuple(values),
    )


class BenchmarkRepo:
    def __init__(self, db: DatabasePool) -> None:
        self._db = db

    def _get(self, table: str, where: str, params: tuple[Any, ...]) -> dict[str, Any] | None:
        with self._db.connect() as conn:
            row = conn.execute(f"SELECT * FROM {table} WHERE {where}", params).fetchone()
        return _decode(row) if row else None

    def list_cases(self, agent_id: str) -> list[dict[str, Any]]:
        with self._db.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM benchmark_cases WHERE agent_id=? ORDER BY updated_at DESC,id DESC",
                (agent_id,),
            ).fetchall()
        return [_decode(row) for row in rows]

    def get_case(self, agent_id: str, case_id: str) -> dict[str, Any] | None:
        return self._get("benchmark_cases", "agent_id=? AND case_id=?", (agent_id, case_id))

    def _new_case(self, conn: Any, agent_id: str, data: dict[str, Any]) -> dict[str, Any]:
        ts = now_ts()
        result = {
            **_CASE_DEFAULTS,
            **{key: value for key, value in data.items() if key in _CASE_DEFAULTS},
            "case_id": new_ulid(),
            "agent_id": agent_id,
            "revision": 1,
            "created_at": ts,
            "updated_at": ts,
        }
        _insert(conn, "benchmark_cases", result)
        row = conn.execute(
            "SELECT * FROM benchmark_cases WHERE case_id=?", (result["case_id"],)
        ).fetchone()
        return _decode(row)

    def save_case(
        self,
        agent_id: str,
        data: dict[str, Any],
        case_id: str | None = None,
        *,
        expected_revision: int | None = None,
    ) -> dict[str, Any]:
        with self._db.transaction() as conn:
            if case_id is None:
                return self._new_case(conn, agent_id, data)
            else:
                updates = {
                    key: value
                    for key, value in data.items()
                    if key in _CASE_DEFAULTS and key not in _SOURCE_FIELDS
                }
                updates["updated_at"] = now_ts()
                revision_filter = " AND revision=?" if expected_revision is not None else ""
                params = tuple(
                    json.dumps(value, ensure_ascii=False) if key in _JSON_FIELDS else value
                    for key, value in updates.items()
                ) + (agent_id, case_id)
                if expected_revision is not None:
                    params += (expected_revision,)
                cursor = conn.execute(
                    "UPDATE benchmark_cases SET "
                    + ",".join(f"{key}=?" for key in updates)
                    + ",revision=revision+1 WHERE agent_id=? AND case_id=?"
                    + revision_filter,
                    params,
                )
                row = conn.execute(
                    "SELECT * FROM benchmark_cases WHERE agent_id=? AND case_id=?",
                    (agent_id, case_id),
                ).fetchone()
                if cursor.rowcount == 0 and row is not None and expected_revision is not None:
                    raise ValueError("revision_conflict")
            if row is None:
                raise ValueError("Benchmark case not found")
            return _decode(row)

    def capture_feedback(self, feedback: dict[str, Any]) -> dict[str, Any]:
        ts = now_ts()
        with self._db.transaction() as conn:
            conn.execute(
                "INSERT INTO benchmark_candidates(candidate_id,agent_id,user_id,feedback_id,snapshot,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(feedback_id,user_id) DO UPDATE SET snapshot=excluded.snapshot,updated_at=excluded.updated_at WHERE benchmark_candidates.status='pending' AND benchmark_candidates.agent_id=excluded.agent_id",
                (
                    new_ulid(),
                    feedback["agent_id"],
                    feedback["user_id"],
                    feedback["feedback_id"],
                    json.dumps(feedback, ensure_ascii=False),
                    ts,
                    ts,
                ),
            )
            row = conn.execute(
                "SELECT * FROM benchmark_candidates WHERE agent_id=? AND user_id=? AND feedback_id=?",
                (feedback["agent_id"], feedback["user_id"], feedback["feedback_id"]),
            ).fetchone()
            if row is None:
                raise ValueError("Feedback belongs to another agent")
            return _decode(row)

    def list_candidates(self, agent_id: str, user_id: int) -> list[dict[str, Any]]:
        with self._db.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM benchmark_candidates WHERE agent_id=? AND user_id=? ORDER BY updated_at DESC,id DESC",
                (agent_id, user_id),
            ).fetchall()
        return [_decode(row) for row in rows]

    def get_candidate(
        self, agent_id: str, user_id: int, candidate_id: str
    ) -> dict[str, Any] | None:
        return self._get(
            "benchmark_candidates",
            "agent_id=? AND user_id=? AND candidate_id=?",
            (agent_id, user_id, candidate_id),
        )

    def accept_candidate(
        self,
        agent_id: str,
        user_id: int,
        candidate_id: str,
        case_data: dict[str, Any],
        *,
        reviewed_feedback: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        with self._db.transaction() as conn:
            # Lock the candidate before inspecting status so concurrent reviewers create one case.
            conn.execute(
                "UPDATE benchmark_candidates SET status=status WHERE agent_id=? AND user_id=? AND candidate_id=?",
                (agent_id, user_id, candidate_id),
            )
            row = conn.execute(
                "SELECT * FROM benchmark_candidates WHERE agent_id=? AND user_id=? AND candidate_id=?",
                (agent_id, user_id, candidate_id),
            ).fetchone()
            if row is None or (row["status"] == "ignored" and reviewed_feedback is None):
                raise ValueError("Benchmark candidate not pending")
            if row["status"] == "accepted":
                case = conn.execute(
                    "SELECT * FROM benchmark_cases WHERE agent_id=? AND case_id=?",
                    (agent_id, row["case_id"]),
                ).fetchone()
                if case is None:
                    raise ValueError("Accepted benchmark case not found")
                return _decode(case)
            case_data = {
                **case_data,
                "source": "feedback",
                "source_feedback_id": row["feedback_id"],
                "source_snapshot": reviewed_feedback
                if reviewed_feedback is not None
                else json.loads(row["snapshot"]),
            }
            case = self._new_case(conn, agent_id, case_data)
            conn.execute(
                "UPDATE benchmark_candidates SET status='accepted',case_id=?,snapshot=?,updated_at=? WHERE candidate_id=?",
                (
                    case["case_id"],
                    json.dumps(case_data["source_snapshot"], ensure_ascii=False),
                    now_ts(),
                    candidate_id,
                ),
            )
            return case

    def ignore_candidate(self, agent_id: str, user_id: int, candidate_id: str) -> dict[str, Any]:
        with self._db.transaction() as conn:
            conn.execute(
                "UPDATE benchmark_candidates SET status='ignored',updated_at=? WHERE agent_id=? AND user_id=? AND candidate_id=? AND status='pending'",
                (now_ts(), agent_id, user_id, candidate_id),
            )
            row = conn.execute(
                "SELECT * FROM benchmark_candidates WHERE agent_id=? AND user_id=? AND candidate_id=?",
                (agent_id, user_id, candidate_id),
            ).fetchone()
            if row is None:
                raise ValueError("Benchmark candidate not found")
            return _decode(row)

    def create_run(
        self,
        agent_id: str,
        user_id: int,
        name: str,
        config_snapshot: dict[str, Any],
        results: list[dict[str, Any]],
    ) -> dict[str, Any]:
        ts = now_ts()
        data: dict[str, Any] = {
            "run_id": new_ulid(),
            "agent_id": agent_id,
            "user_id": user_id,
            "name": name,
            "status": "queued",
            "config_snapshot": config_snapshot,
            "results": results,
            "created_at": ts,
            "updated_at": ts,
            "finished_at": None,
        }
        with self._db.transaction() as conn:
            _insert(conn, "benchmark_runs", data)
        result = self.get_run(agent_id, data["run_id"])
        assert result is not None
        return result

    def list_runs(self, agent_id: str) -> list[dict[str, Any]]:
        with self._db.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM benchmark_runs WHERE agent_id=? ORDER BY updated_at DESC,id DESC LIMIT 200",
                (agent_id,),
            ).fetchall()
        return [_decode(row) for row in rows]

    def get_run(self, agent_id: str, run_id: str) -> dict[str, Any] | None:
        return self._get("benchmark_runs", "agent_id=? AND run_id=?", (agent_id, run_id))

    def update_run(self, agent_id: str, run_id: str, **fields: Any) -> dict[str, Any]:
        if fields.keys() - {"status", "results", "finished_at"}:
            raise ValueError("Unsupported benchmark run field")
        fields["updated_at"] = now_ts()
        with self._db.transaction() as conn:
            conn.execute(
                "UPDATE benchmark_runs SET "
                + ",".join(f"{key}=?" for key in fields)
                + " WHERE agent_id=? AND run_id=?",
                tuple(
                    json.dumps(value, ensure_ascii=False) if key in _JSON_FIELDS else value
                    for key, value in fields.items()
                )
                + (agent_id, run_id),
            )
            row = conn.execute(
                "SELECT * FROM benchmark_runs WHERE agent_id=? AND run_id=?", (agent_id, run_id)
            ).fetchone()
            if row is None:
                raise ValueError("Benchmark run not found")
            return _decode(row)

    def update_result(
        self, agent_id: str, run_id: str, case_id: str, changes: dict[str, Any]
    ) -> dict[str, Any]:
        if changes.keys() - {"status", "note", "reviewer_id"}:
            raise ValueError("Unsupported benchmark result field")
        with self._db.transaction() as conn:
            # Serialize JSON deltas before reading the current result collection.
            conn.execute(
                "UPDATE benchmark_runs SET status=status WHERE agent_id=? AND run_id=?",
                (agent_id, run_id),
            )
            row = conn.execute(
                "SELECT * FROM benchmark_runs WHERE agent_id=? AND run_id=?",
                (agent_id, run_id),
            ).fetchone()
            if row is None:
                raise ValueError("Benchmark run not found")
            run = _decode(row)
            for result in run["results"]:
                if result["case_id"] == case_id:
                    result.update(changes)
                    break
            else:
                raise ValueError("Benchmark result not found")
            run["updated_at"] = now_ts()
            conn.execute(
                "UPDATE benchmark_runs SET results=?,updated_at=? WHERE agent_id=? AND run_id=?",
                (
                    json.dumps(run["results"], ensure_ascii=False),
                    run["updated_at"],
                    agent_id,
                    run_id,
                ),
            )
            return run

    def interrupt_runs(self) -> None:
        with self._db.transaction() as conn:
            conn.execute(
                "UPDATE benchmark_runs SET status=status WHERE status IN ('queued','running')"
            )
            rows = conn.execute(
                "SELECT run_id,results FROM benchmark_runs WHERE status IN ('queued','running')"
            ).fetchall()
            ts = now_ts()
            for row in rows:
                results = json.loads(row["results"])
                for result in results:
                    if result.get("status") in {"pending", "running"}:
                        result["status"] = "cancelled"
                conn.execute(
                    "UPDATE benchmark_runs SET status='interrupted',results=?,updated_at=?,finished_at=? WHERE run_id=?",
                    (json.dumps(results, ensure_ascii=False), ts, ts, row["run_id"]),
                )
