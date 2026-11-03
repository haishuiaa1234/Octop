"""Regression guards for the production dashboard build."""

from __future__ import annotations

import re
from pathlib import Path


def test_frontend_build_heap_supports_document_viewers() -> None:
    makefile = (Path(__file__).resolve().parents[2] / "Makefile").read_text(encoding="utf-8")
    match = re.search(r'NODE_OPTIONS="--max-old-space-size=(\d+)" npm run build', makefile)
    assert match is not None, "Production builds must set an explicit Node heap budget"
    # The Excalidraw bundle exhausts a 2 GiB heap during Rollup chunk generation.
    assert int(match.group(1)) >= 4096
