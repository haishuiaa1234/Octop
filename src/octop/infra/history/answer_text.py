"""Pure visible-answer extraction shared by history snapshots and team delivery."""

from typing import Any

from octop.infra.utils.llm_text import strip_thinking


def visible_text(content: Any) -> str:
    if isinstance(content, str):
        return strip_thinking(content)
    if isinstance(content, list):
        return strip_thinking(
            "".join(
                block if isinstance(block, str) else str(block.get("text", ""))
                for block in content
                if isinstance(block, str)
                or (isinstance(block, dict) and block.get("type") in ("text", "output_text"))
            )
        )
    return ""


def join_answer_parts(parts: list[str]) -> str:
    result = ""
    for part in parts:
        if not part or result.endswith(part):
            continue
        if not result or part.startswith(result) or part.endswith(result):
            result = part if len(part) > len(result) else result
            continue
        separator = (
            ""
            if result[-1].isspace() or part[0].isspace() or part[0] in "，。！？、,.!?;:"
            else " "
        )
        result += separator + part
    return result
