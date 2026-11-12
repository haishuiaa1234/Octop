"""Environment isolation for tests that operate on temporary Git repositories."""

from __future__ import annotations

import os
import subprocess


def isolated_git_env() -> dict[str, str]:
    """Keep an enclosing commit hook's repository settings out of test repos."""
    local_names = subprocess.run(
        ["git", "rev-parse", "--local-env-vars"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.splitlines()
    return {key: value for key, value in os.environ.items() if key not in local_names}
