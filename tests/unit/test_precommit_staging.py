"""The pre-commit hook must refresh large staged sets without adding user files."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

HOOK = Path(__file__).resolve().parents[2] / ".githooks" / "pre-commit"
BASH = shutil.which("bash")
if os.name == "nt" and (git := shutil.which("git")):
    git_bash = Path(git).resolve().parent.parent / "bin" / "bash.exe"
    if git_bash.is_file():
        BASH = str(git_bash)


@pytest.mark.skipif(BASH is None, reason="bash is required for the Git hook")
@pytest.mark.parametrize("file_count", [1, 650])
def test_refresh_staged_files_without_argument_limit(tmp_path: Path, file_count: int) -> None:
    def git(*args: str, input_bytes: bytes | None = None) -> bytes:
        result = subprocess.run(
            ["git", *args],
            cwd=tmp_path,
            input=input_bytes,
            capture_output=True,
            check=True,
        )
        return result.stdout

    git("init", "-q")
    git(
        "-c",
        "user.name=Hook Test",
        "-c",
        "user.email=hook@example.invalid",
        "commit",
        "--allow-empty",
        "-qm",
        "Initial",
    )
    names = [f"{index:04d}-{'x' * 100}.txt" for index in range(file_count)]
    for name in names:
        (tmp_path / name).write_text("before\n", encoding="utf-8")
    git(
        "add",
        "--pathspec-from-file=-",
        "--pathspec-file-nul",
        input_bytes="\0".join(names).encode(),
    )
    for name in names:
        (tmp_path / name).write_text("after\n", encoding="utf-8")
    (tmp_path / "user-untracked.txt").write_text("keep private\n", encoding="utf-8")
    (tmp_path / "dashboard").mkdir()
    # Only stub the expensive gates; run the real hook's staging logic and Git.
    script = "make() { return 0; }; npm() { return 0; };\n" + HOOK.read_text(encoding="utf-8")
    result = subprocess.run(
        [str(BASH)],
        input=script,
        cwd=tmp_path,
        capture_output=True,
        text=True,
        encoding="utf-8",
        env={**os.environ, "SKIP_PRECOMMIT": "0"},
        timeout=60,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert git("diff", "--name-only") == b""
    assert set(git("diff", "--cached", "--name-only").decode().splitlines()) == set(names)
    assert git("show", f":{names[-1]}") == b"after\n"
