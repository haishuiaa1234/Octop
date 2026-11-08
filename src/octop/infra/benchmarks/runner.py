"""Bounded, cancellable text-only evaluation outside production conversations."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from octop.infra.benchmarks.service import grade_answer, io
from octop.infra.errors import ErrorCode, OctopError
from octop.infra.gateway.process.usage_record import turn_usage_from_messages
from octop.infra.history.answer_text import visible_text
from octop.infra.users.resource_policy import assert_token_quota_available

logger = logging.getLogger(__name__)
Evaluator = Callable[[str, str], Awaitable[dict[str, Any]]]


async def prepare_evaluator(server: Any, agent_id: str) -> tuple[dict[str, Any], Evaluator]:
    runtime = server.app_runtime
    if runtime is None:
        raise OctopError.localized(ErrorCode.AGENT_NOT_RUNNING)
    from octop.infra.agents.teams import is_team_agent

    row = await io(server.services.agent_repo.get, agent_id)
    if row is None or is_team_agent(row) or getattr(row, "bridge_connection_id", None):
        raise ValueError("unsupported_expert")
    agent = runtime.agent_registry.get_agent(agent_id)
    config = agent.config
    ref = agent.model_factory.resolve_ref("auto")
    model = await io(agent.model_factory.get_chat_model, ref)
    instructions = [config.system_prompt or ""]
    for path in ("SOUL.md", "AGENTS.md"):
        content = await agent.workspace.aread_text(path, limit=20000)
        if content:
            instructions.append(f"[{path}]\n{content}")
    prompt = "\n\n".join(text for text in instructions if text)
    snapshot = {
        "mode": "text_only",
        "model_ref": ref,
        "instructions": prompt,
        "instruction_hash": hashlib.sha256(prompt.encode()).hexdigest(),
        "memory_enabled": False,
        "tools_enabled": False,
        "split": "",
    }

    async def evaluate(question: str, context: str) -> dict[str, Any]:
        messages: list[Any] = [SystemMessage(content=prompt)] if prompt else []
        if context:
            messages.append(HumanMessage(content=context))
        messages.append(HumanMessage(content=question))
        response = await model.ainvoke(messages, config={"tags": ["benchmark"]})
        if getattr(response, "tool_calls", None):
            raise ValueError("unexpected_tool_call")
        usage = turn_usage_from_messages([response]) or {}
        return {
            **usage,
            "answer": visible_text(response.content),
            "input_tokens": usage.get("input_tokens"),
            "output_tokens": usage.get("output_tokens"),
        }

    return snapshot, evaluate


class BenchmarkRunner:
    def __init__(self, server: Any) -> None:
        self.server = server
        self.repo = server.services.benchmark_repo
        self._tasks: dict[str, tuple[str, asyncio.Task[None]]] = {}
        self._lock = asyncio.Lock()
        self._closing = False

    async def recover(self) -> None:
        await io(self.repo.interrupt_runs)

    async def start(
        self, agent_id: str, user_id: int, name: str, cases: list[dict[str, Any]]
    ) -> dict[str, Any]:
        async with self._lock:
            active = [(aid, task) for aid, task in self._tasks.values() if not task.done()]
            if self._closing or len(active) >= 4 or any(aid == agent_id for aid, _ in active):
                raise OctopError.localized(ErrorCode.AGENT_BUSY)
            snapshot, evaluate = await prepare_evaluator(self.server, agent_id)
            snapshot["split"] = cases[0]["split"]
            results = [
                {
                    "case_id": case["case_id"],
                    "revision": case["revision"],
                    "case_snapshot": case,
                    "status": "pending",
                    "answer": "",
                    "error": "",
                    "duration_ms": 0,
                    "input_tokens": None,
                    "output_tokens": None,
                    "note": "",
                }
                for case in cases
            ]
            run = await io(self.repo.create_run, agent_id, user_id, name, snapshot, results)
            task = asyncio.create_task(
                self._execute(run, evaluate), name=f"benchmark:{run['run_id']}"
            )
            self._tasks[run["run_id"]] = agent_id, task
            task.add_done_callback(lambda _: self._tasks.pop(run["run_id"], None))
            return run  # type: ignore[no-any-return]

    async def _execute(self, run: dict[str, Any], evaluate: Evaluator) -> None:
        agent_id, run_id, results = run["agent_id"], run["run_id"], run["results"]
        status = "completed"
        try:
            await io(self.repo.update_run, agent_id, run_id, status="running")
            for result in results:
                result["status"] = "running"
                await io(self.repo.update_run, agent_id, run_id, results=results)
                started = time.perf_counter()
                try:
                    case = result["case_snapshot"]
                    user = await io(self.server.services.user_repo.get, run["user_id"])
                    expert = await io(self.server.services.agent_repo.get, agent_id)
                    if (
                        user is None
                        or user.disabled
                        or expert is None
                        or (user.role != "admin" and expert.user_id != user.id)
                    ):
                        raise OctopError.localized(ErrorCode.FORBIDDEN)
                    await io(
                        assert_token_quota_available,
                        self.server.services.user_policy_repo,
                        self.server.services.usage_repo,
                        run["user_id"],
                    )
                    output = await asyncio.wait_for(
                        evaluate(case["question"], case["context"]), 120
                    )
                    answer = str(output.get("answer") or "")
                    result.update(output, answer=answer, status=grade_answer(case, answer))
                    from octop.infra.gateway.process.usage_record import record_turn_usage

                    if (
                        output.get("input_tokens") is not None
                        or output.get("output_tokens") is not None
                    ):
                        await io(
                            record_turn_usage,
                            self.server.services.usage_repo,
                            agent_id=agent_id,
                            user_id=run["user_id"],
                            thread_id=run_id,
                            source="benchmark",
                            usage={**output, "model": run["config_snapshot"]["model_ref"]},
                        )
                except asyncio.CancelledError:
                    raise
                except Exception:
                    logger.warning(
                        "benchmark case failed run=%s case=%s",
                        run_id,
                        result["case_id"],
                    )
                    # Provider exception strings may contain credentials or request payloads.
                    result.update(status="error", error="evaluation_failed")
                finally:
                    result["duration_ms"] = round((time.perf_counter() - started) * 1000)
                await io(self.repo.update_run, agent_id, run_id, results=results)
        except asyncio.CancelledError:
            status = "interrupted" if self._closing else "cancelled"
            for result in results:
                if result["status"] in {"pending", "running"}:
                    result["status"] = "cancelled"
        except Exception:
            logger.error("benchmark run interrupted run=%s", run_id)
            status = "interrupted"
            for result in results:
                if result["status"] in {"pending", "running"}:
                    result.update(status="error", error="evaluation_failed")
        finally:
            await io(
                self.repo.update_run,
                agent_id,
                run_id,
                status=status,
                results=results,
                finished_at=int(time.time()),
            )

    async def wait(self, run_id: str) -> None:
        entry = self._tasks.get(run_id)
        if entry:
            await entry[1]

    async def cancel(self, agent_id: str, run_id: str) -> None:
        entry = self._tasks.get(run_id)
        if entry and entry[0] == agent_id:
            entry[1].cancel()
            await asyncio.gather(entry[1], return_exceptions=True)
        run = await io(self.repo.get_run, agent_id, run_id)
        if run and run["status"] in {"queued", "running"}:
            for result in run["results"]:
                if result["status"] in {"pending", "running"}:
                    result["status"] = "cancelled"
            await io(
                self.repo.update_run,
                agent_id,
                run_id,
                status="cancelled",
                results=run["results"],
                finished_at=int(time.time()),
            )

    async def close(self) -> None:
        async with self._lock:
            self._closing = True
            entries = list(self._tasks.items())
            tasks = [task for _, (_, task) in entries]
            for task in tasks:
                task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        for run_id, (agent_id, _) in entries:
            run = await io(self.repo.get_run, agent_id, run_id)
            if run and run["status"] in {"queued", "running"}:
                for result in run["results"]:
                    if result["status"] in {"pending", "running"}:
                        result["status"] = "cancelled"
                await io(
                    self.repo.update_run,
                    agent_id,
                    run_id,
                    status="interrupted",
                    results=run["results"],
                    finished_at=int(time.time()),
                )
