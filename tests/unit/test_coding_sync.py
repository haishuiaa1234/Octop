"""Exercise the CODING ref sync with local Git repositories, not production."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

from tests.support.git import isolated_git_env

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "ci" / "sync_coding.sh"
BASH = shutil.which("bash")
if os.name == "nt" and (git_executable := shutil.which("git")):
    git_bash = Path(git_executable).resolve().parent.parent / "bin" / "bash.exe"
    if git_bash.is_file():
        BASH = str(git_bash)

pytestmark = pytest.mark.skipif(BASH is None, reason="Git Bash is required for ref sync")


def git(directory: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(directory), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=check,
        env={**isolated_git_env(), "GIT_CONFIG_GLOBAL": os.devnull, "GIT_TERMINAL_PROMPT": "0"},
    )


def commit(directory: Path, content: str) -> str:
    (directory / "sample.txt").write_text(content, encoding="utf-8")
    git(directory, "add", "sample.txt")
    git(
        directory,
        "-c",
        "user.name=Sync Test",
        "-c",
        "user.email=sync@example.invalid",
        "commit",
        "-qm",
        content,
    )
    return git(directory, "rev-parse", "HEAD").stdout.strip()


@pytest.fixture
def repos(tmp_path: Path) -> tuple[Path, Path]:
    source = tmp_path / "source"
    target = tmp_path / "target.git"
    source.mkdir()
    target.mkdir()
    git(source, "init", "-q", "-b", "main_gys")
    git(source, "config", "core.hooksPath", str(tmp_path / "no-hooks"))
    git(target, "init", "--bare", "-q")
    commit(source, "initial")
    return source, target


def sync(source: Path, target: Path, ref: str) -> subprocess.CompletedProcess[str]:
    assert BASH is not None
    assert SCRIPT.is_file()
    return subprocess.run(
        [BASH, SCRIPT.as_posix(), target.as_posix(), ref],
        cwd=source,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
        env={**isolated_git_env(), "GIT_CONFIG_GLOBAL": os.devnull, "GIT_TERMINAL_PROMPT": "0"},
        timeout=30,
    )


def test_sync_branch_and_complete_incremental_history(repos: tuple[Path, Path]) -> None:
    source, target = repos
    initial = git(source, "rev-parse", "HEAD").stdout.strip()
    first = sync(source, target, "refs/heads/main_gys")
    assert first.returncode == 0, first.stderr
    updated = commit(source, "second")
    second = sync(source, target, "refs/heads/main_gys")
    assert second.returncode == 0, second.stderr
    assert git(target, "rev-parse", "refs/heads/main_gys").stdout.strip() == updated
    assert git(target, "rev-list", "--count", "refs/heads/main_gys").stdout.strip() == "2"
    assert git(target, "cat-file", "-t", initial).stdout.strip() == "commit"


def test_sync_is_idempotent(repos: tuple[Path, Path]) -> None:
    source, target = repos
    for _ in range(2):
        result = sync(source, target, "refs/heads/main_gys")
        assert result.returncode == 0, result.stderr
    assert git(target, "rev-list", "--count", "refs/heads/main_gys").stdout.strip() == "1"


def test_sync_slash_branch_preserves_target_only_refs(repos: tuple[Path, Path]) -> None:
    source, target = repos
    head = git(source, "rev-parse", "HEAD").stdout.strip()
    git(source, "push", "-q", str(target), "HEAD:refs/heads/coding-only")
    git(source, "branch", "codex/feature-sync")
    result = sync(source, target, "refs/heads/codex/feature-sync")
    assert result.returncode == 0, result.stderr
    assert git(target, "rev-parse", "refs/heads/coding-only").stdout.strip() == head
    assert git(target, "rev-parse", "refs/heads/codex/feature-sync").stdout.strip() == head
    assert git(target, "show-ref", "--verify", "refs/heads/main_gys", check=False).returncode


def test_sync_preserves_annotated_tag_object(repos: tuple[Path, Path]) -> None:
    source, target = repos
    git(
        source,
        "-c",
        "user.name=Sync Test",
        "-c",
        "user.email=sync@example.invalid",
        "tag",
        "-a",
        "v-test",
        "-m",
        "Annotated tag",
    )
    tag = git(source, "rev-parse", "refs/tags/v-test").stdout.strip()
    result = sync(source, target, "refs/tags/v-test")
    assert result.returncode == 0, result.stderr
    assert git(target, "rev-parse", "refs/tags/v-test").stdout.strip() == tag
    assert git(target, "cat-file", "-t", tag).stdout.strip() == "tag"


def test_sync_rejects_divergent_target_branch(repos: tuple[Path, Path]) -> None:
    source, target = repos
    initial = git(source, "rev-parse", "HEAD").stdout.strip()
    coding_commit = commit(source, "CODING-only commit")
    git(source, "push", "-q", str(target), "HEAD:refs/heads/main_gys")
    git(source, "checkout", "-q", "-b", "github-only", initial)
    commit(source, "GitHub-only commit")
    git(source, "branch", "-f", "main_gys", "HEAD")
    result = sync(source, target, "refs/heads/main_gys")
    assert result.returncode != 0
    assert "rejected" in result.stdout + result.stderr
    assert git(target, "rev-parse", "refs/heads/main_gys").stdout.strip() == coding_commit


def test_sync_rejects_replacing_an_existing_tag(repos: tuple[Path, Path]) -> None:
    source, target = repos
    initial = git(source, "rev-parse", "HEAD").stdout.strip()
    git(source, "tag", "v-test")
    git(source, "push", "-q", str(target), "refs/tags/v-test")
    commit(source, "new commit")
    git(source, "tag", "-f", "v-test")
    result = sync(source, target, "refs/tags/v-test")
    assert result.returncode != 0
    assert "rejected" in result.stdout + result.stderr
    assert git(target, "rev-parse", "refs/tags/v-test").stdout.strip() == initial


@pytest.mark.parametrize("ref", ["main_gys", "refs/pull/1/head", "refs/heads/invalid..ref"])
def test_sync_rejects_invalid_ref_without_writing(repos: tuple[Path, Path], ref: str) -> None:
    source, target = repos
    result = sync(source, target, ref)
    assert result.returncode == 2, result.stderr
    assert git(target, "for-each-ref", "--format=%(refname)").stdout == ""


def test_missing_source_ref_does_not_delete_target(repos: tuple[Path, Path]) -> None:
    source, target = repos
    head = git(source, "rev-parse", "HEAD").stdout.strip()
    git(source, "push", "-q", str(target), "HEAD:refs/heads/target-only")
    result = sync(source, target, "refs/heads/target-only")
    assert result.returncode != 0
    assert git(target, "rev-parse", "refs/heads/target-only").stdout.strip() == head
