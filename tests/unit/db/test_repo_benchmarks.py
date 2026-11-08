"""Benchmark persistence contracts against real SQLite."""

from pathlib import Path
from sqlite3 import IntegrityError

import pytest

from octop.infra.db.migrate import run_migrations
from octop.infra.db.pool import SqlitePool
from octop.infra.db.services import RepoBundle


@pytest.fixture
def store(tmp_path: Path):
    db = SqlitePool(tmp_path / "benchmarks.db")
    run_migrations(db)
    repos = RepoBundle.from_pool(db)
    uid = repos.user_repo.create(username="owner", password_hash="h", role="user")
    with db.transaction() as conn:
        for aid in ("a", "b"):
            conn.execute(
                "INSERT INTO agents(agent_id,user_id,name,created_at,updated_at) VALUES (?,?,?,0,0)",
                (aid, uid, aid),
            )
    return db, repos, uid


def test_cases_revision_and_isolation(store):
    _, repos, _ = store
    repo = repos.benchmark_repo
    case = repo.save_case("a", {"title": "one", "question": "Q", "keywords": ["yes"]})
    assert case["revision"] == 1
    assert case["keywords"] == ["yes"]
    assert repo.get_case("b", case["case_id"]) is None
    updated = repo.save_case("a", {"title": "two", "source": "feedback"}, case["case_id"])
    assert updated["revision"] == 2
    assert updated["question"] == "Q"
    assert updated["source"] == "manual"
    assert repo.list_cases("b") == []


def test_stale_case_revision_cannot_overwrite(store):
    _, repos, _ = store
    repo = repos.benchmark_repo
    case = repo.save_case("a", {"title": "original"})
    repo.save_case("a", {"title": "first edit"}, case["case_id"], expected_revision=1)
    with pytest.raises(ValueError, match="revision_conflict"):
        repo.save_case("a", {"title": "stale edit"}, case["case_id"], expected_revision=1)
    assert repo.get_case("a", case["case_id"])["title"] == "first edit"
    assert repo.get_case("a", case["case_id"])["revision"] == 2
    with pytest.raises(ValueError, match="not found"):
        repo.save_case("b", {}, case["case_id"], expected_revision=1)


def test_candidates_deduplicate_freeze_and_accept_atomically(store):
    _, repos, uid = store
    repo = repos.benchmark_repo
    feedback = {
        "agent_id": "a",
        "user_id": uid,
        "feedback_id": "feedback",
        "question": "Q",
        "answer": "A",
    }
    first = repo.capture_feedback(feedback)
    changed = repo.capture_feedback({**feedback, "answer": "B"})
    assert first["candidate_id"] == changed["candidate_id"]
    assert changed["snapshot"]["answer"] == "B"
    assert repo.list_candidates("b", uid) == []
    assert repo.get_candidate("a", uid + 1, first["candidate_id"]) is None
    case = repo.accept_candidate(
        "a", uid, first["candidate_id"], {"title": "reviewed", "question": "Q"}
    )
    assert repo.accept_candidate("a", uid, first["candidate_id"], {}) == case
    frozen = repo.capture_feedback({**feedback, "answer": "C"})
    assert frozen["snapshot"]["answer"] == "B"
    assert case["source_snapshot"]["answer"] == "B"
    assert case["source_feedback_id"] == "feedback"
    assert len(repo.list_cases("a")) == 1
    ignored = repo.capture_feedback({**feedback, "feedback_id": "other"})
    repo.ignore_candidate("a", uid, ignored["candidate_id"])
    with pytest.raises(ValueError):
        repo.accept_candidate("a", uid, ignored["candidate_id"], {})


def test_runs_freeze_json_and_interrupt(store):
    db, repos, uid = store
    repo = repos.benchmark_repo
    case = repo.save_case("a", {"question": "Q"})
    run = repo.create_run("a", uid, "trial", {"model": "fake"}, [{"case_snapshot": case}])
    repo.save_case("a", {"question": "changed"}, case["case_id"])
    assert repo.get_run("b", run["run_id"]) is None
    assert repo.get_run("a", run["run_id"])["results"][0]["case_snapshot"]["question"] == "Q"
    repo.update_run("a", run["run_id"], status="running")
    repo.interrupt_runs()
    assert repo.get_run("a", run["run_id"])["status"] == "interrupted"
    assert repo.list_runs("a")[0]["config_snapshot"] == {"model": "fake"}
    run_migrations(db)
    with db.connect() as conn:
        assert conn.execute("SELECT version FROM _schema_version").fetchone()[0] == 23


def test_restart_terminalizes_unfinished_results(store):
    _, repos, uid = store
    repo = repos.benchmark_repo
    run = repo.create_run(
        "a",
        uid,
        "restart",
        {},
        [
            {"case_id": "one", "status": "passed", "answer": "kept"},
            {"case_id": "two", "status": "running"},
            {"case_id": "three", "status": "pending"},
        ],
    )
    repo.interrupt_runs()
    updated = repo.get_run("a", run["run_id"])
    assert [result["status"] for result in updated["results"]] == [
        "passed",
        "cancelled",
        "cancelled",
    ]
    assert updated["finished_at"] is not None
    assert updated["results"][0]["answer"] == "kept"


def test_existing_version_22_database_upgrades(store):
    db, repos, uid = store
    with db.transaction() as conn:
        for table in ("benchmark_candidates", "benchmark_runs", "benchmark_cases"):
            conn.execute(f"DROP TABLE {table}")
        conn.execute("UPDATE _schema_version SET version=22")
    run_migrations(db)
    run_migrations(db)
    assert repos.benchmark_repo.create_run("a", uid, "after upgrade", {}, [])["status"] == "queued"


def test_failed_candidate_accept_rolls_back_case(store):
    _, repos, uid = store
    repo = repos.benchmark_repo
    candidate = repo.capture_feedback({"agent_id": "a", "user_id": uid, "feedback_id": "f"})
    with pytest.raises(IntegrityError):
        repo.accept_candidate("a", uid, candidate["candidate_id"], {"status": "invalid"})
    assert repo.list_cases("a") == []
    assert repo.get_candidate("a", uid, candidate["candidate_id"])["status"] == "pending"


def test_result_delta_preserves_other_review(store):
    _, repos, uid = store
    repo = repos.benchmark_repo
    run = repo.create_run(
        "a",
        uid,
        "reviews",
        {},
        [
            {"case_id": "one", "status": "needs_review", "answer": "A"},
            {"case_id": "two", "status": "needs_review", "answer": "B"},
        ],
    )
    repo.update_result(
        "a", run["run_id"], "one", {"status": "passed", "note": "first", "reviewer_id": uid}
    )
    updated = repo.update_result("a", run["run_id"], "two", {"status": "failed", "note": "second"})
    assert updated["results"][0] == {
        "case_id": "one",
        "status": "passed",
        "answer": "A",
        "note": "first",
        "reviewer_id": uid,
    }
    assert updated["results"][1]["status"] == "failed"
    with pytest.raises(ValueError):
        repo.update_result("b", run["run_id"], "one", {"status": "failed"})
    with pytest.raises(ValueError):
        repo.update_result("a", run["run_id"], "missing", {"status": "failed"})
    with pytest.raises(ValueError):
        repo.update_result("a", run["run_id"], "one", {"answer": "overwrite"})


def test_concurrent_result_deltas_preserve_both_reviews(store):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from octop.infra.db.repos.benchmarks import BenchmarkRepo

    db, repos, uid = store
    other_db = SqlitePool(db.path)
    try:
        run = repos.benchmark_repo.create_run(
            "a",
            uid,
            "concurrent",
            {},
            [
                {"case_id": "one", "status": "needs_review"},
                {"case_id": "two", "status": "needs_review"},
            ],
        )
        barrier = Barrier(2)

        def review(repo, case_id):
            barrier.wait(timeout=5)
            return repo.update_result(
                "a", run["run_id"], case_id, {"status": "passed", "note": case_id}
            )

        with ThreadPoolExecutor(max_workers=2) as executor:
            first = executor.submit(review, repos.benchmark_repo, "one")
            second = executor.submit(review, BenchmarkRepo(other_db), "two")
            first.result(timeout=10)
            second.result(timeout=10)
        updated = repos.benchmark_repo.get_run("a", run["run_id"])
        assert [item["note"] for item in updated["results"]] == ["one", "two"]
    finally:
        other_db.close()
