"""WeCom replies with a local SDK double; never connects to a real group."""

import asyncio
from contextlib import suppress
from unittest.mock import AsyncMock

import pytest
from octop_gateway.channels.wecom import WeComConfig
from octop_gateway.constraints import ChannelConstraints
from octop_gateway.models import FileContent, MessageEvent, MessageEventType, TextContent

from octop.infra.gateway.wecom import WeComChannel


class ReplyClient:
    def __init__(self, *, blocked=False):
        self.calls = []
        self.entered = asyncio.Event()
        self.release = asyncio.Event()
        self.active = 0
        self.max_active = 0
        if not blocked:
            self.release.set()

    async def reply_stream(self, **kwargs):
        self.calls.append(kwargs)
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        self.entered.set()
        try:
            await self.release.wait()
        finally:
            self.active -= 1


def channel_for(processor, client):
    channel = WeComChannel(
        processor,
        config=WeComConfig(show_thinking=False, show_tool_hints=False),
        constraints=ChannelConstraints(send_rate_limit=None),
    )
    channel._ws_client = client
    return channel


def payload(chat="test-group"):
    return {
        "from": {"userid": "test-user"},
        "chattype": "group",
        "chatid": chat,
        "msgtype": "text",
        "text": {"content": "test"},
        "_frame": {"body": {"msgid": chat}},
    }


@pytest.mark.asyncio
async def test_typing_first_still_shows_progress_before_answer():
    release_answer = asyncio.Event()

    async def processor(message):
        yield MessageEvent.typing()
        yield MessageEvent.thinking_delta("private reasoning")
        await release_answer.wait()
        yield MessageEvent.delta("答案")
        yield MessageEvent.completed()

    client = ReplyClient()
    task = asyncio.create_task(channel_for(processor, client).handle_inbound(payload()))
    try:
        await asyncio.wait_for(client.entered.wait(), 0.5)
        assert client.calls[0]["content"] == "正在处理……"
        assert client.calls[0]["finish"] is False
    finally:
        release_answer.set()
        await task
    assert client.calls[-1]["content"] == "答案"
    assert client.calls[-1]["finish"] is True
    assert all("private reasoning" not in call["content"] for call in client.calls)


@pytest.mark.asyncio
async def test_slow_ack_does_not_block_model_and_coalesces_exact_final_text():
    consumed = asyncio.Event()
    answer = "这是完整的答案。" * 50

    async def processor(message):
        yield MessageEvent.typing()
        for char in answer:
            yield MessageEvent.delta(char)
            await asyncio.sleep(0)
        consumed.set()
        yield MessageEvent.completed()

    client = ReplyClient(blocked=True)
    task = asyncio.create_task(channel_for(processor, client).handle_inbound(payload()))
    try:
        await asyncio.wait_for(client.entered.wait(), 0.5)
        await asyncio.wait_for(consumed.wait(), 0.5)
        assert len(client.calls) == 1
    finally:
        client.release.set()
        await task
    assert client.calls[-1]["content"] == answer
    assert client.calls[-1]["finish"] is True
    assert len(client.calls) <= 3
    assert client.max_active == 1
    assert len({call["stream_id"] for call in client.calls}) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("terminal", ["error", "exception", "empty", "media"])
async def test_terminal_paths_close_stream_and_processor(terminal):
    closed = asyncio.Event()

    async def processor(message):
        try:
            yield MessageEvent.typing()
            if terminal == "exception":
                raise RuntimeError("internal detail")
            if terminal == "error":
                yield MessageEvent.error_event("请求失败")
                await asyncio.Event().wait()
            if terminal == "media":
                yield MessageEvent(
                    type=MessageEventType.MESSAGE,
                    content=[FileContent(url="file:///test.pdf", filename="test.pdf")],
                )
            yield MessageEvent.completed()
            await asyncio.Event().wait()
        finally:
            closed.set()

    client = ReplyClient()
    channel = channel_for(processor, client)
    channel._send_media = AsyncMock()
    await channel.handle_inbound(payload())
    assert closed.is_set()
    assert client.calls[-1]["finish"] is True
    assert client.calls[-1]["content"] != "正在处理……"
    assert all("internal detail" not in c["content"] for c in client.calls)
    if terminal == "error":
        assert client.calls[-1]["content"] == "请求失败"
    if terminal == "media":
        channel._send_media.assert_awaited_once()
        assert "_frame" not in channel._send_media.await_args.args[0].metadata


@pytest.mark.asyncio
async def test_cancellation_closes_processor_and_pending_sender():
    closed = asyncio.Event()

    async def processor(message):
        try:
            yield MessageEvent.typing()
            yield MessageEvent.delta("part")
            await asyncio.Event().wait()
        finally:
            closed.set()

    client = ReplyClient(blocked=True)
    task = asyncio.create_task(channel_for(processor, client).handle_inbound(payload()))
    await asyncio.wait_for(client.entered.wait(), 0.5)
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task
    assert closed.is_set()
    assert client.active == 0


@pytest.mark.asyncio
async def test_incremental_updates_arrive_before_completion_without_changing_text():
    partial = asyncio.Event()

    class Client(ReplyClient):
        async def reply_stream(self, **kwargs):
            await super().reply_stream(**kwargs)
            if kwargs["content"] == "hello world" and not kwargs["finish"]:
                partial.set()

    async def processor(message):
        yield MessageEvent(
            type=MessageEventType.DELTA,
            content=[TextContent(text="hello "), TextContent(text="world")],
        )
        await asyncio.wait_for(partial.wait(), 2)
        yield MessageEvent.delta("!")
        yield MessageEvent.completed()

    client = Client()
    await channel_for(processor, client).handle_inbound(payload())
    assert partial.is_set()
    assert client.calls[-1]["content"] == "hello world!"


@pytest.mark.asyncio
async def test_concurrent_chats_do_not_share_stream_or_content():
    async def processor(message):
        for _ in range(5):
            yield MessageEvent.delta(message.metadata["chat_id"])
            await asyncio.sleep(0)
        yield MessageEvent.completed()

    client = ReplyClient()
    channel = channel_for(processor, client)
    await asyncio.gather(channel.handle_inbound(payload("A")), channel.handle_inbound(payload("B")))
    final = [c for c in client.calls if c["finish"]]
    assert {c["content"] for c in final} == {"AAAAA", "BBBBB"}
    assert len({c["stream_id"] for c in final}) == 2


@pytest.mark.asyncio
async def test_placeholder_failure_still_delivers_final_answer():
    class Client(ReplyClient):
        async def reply_stream(self, **kwargs):
            await super().reply_stream(**kwargs)
            if not kwargs["finish"]:
                raise OSError("test ACK failure")

    async def processor(message):
        yield MessageEvent.delta("answer")
        yield MessageEvent.completed()

    client = Client()
    await channel_for(processor, client).handle_inbound(payload())
    assert client.calls[-1]["content"] == "answer"
    assert client.calls[-1]["finish"]


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["invoke", "stream"])
async def test_gateway_registers_adapter_with_user_locale(tmp_path, monkeypatch, mode):
    import json
    from types import SimpleNamespace

    from octop_gateway.manager import ChannelManager
    from tests.unit.gateway.test_gateway_runtime_status import _make_gateway

    async def processor(message):
        yield MessageEvent.delta("answer")
        yield MessageEvent.completed()

    gateway = _make_gateway(tmp_path)
    monkeypatch.setattr(WeComChannel, "start", AsyncMock())
    monkeypatch.setattr(WeComChannel, "stop", AsyncMock())
    monkeypatch.setattr(gateway._repos.user_repo, "get", lambda _: SimpleNamespace(locale="en"))
    gateway._processor = processor
    manager = gateway._channel_manager = ChannelManager()
    row = SimpleNamespace(
        channel_id="test-channel",
        agent_id="test-agent",
        user_id=1,
        kind="wecom",
        config_json=json.dumps({"bot_id": "test", "secret": "test", "response_mode": mode}),
    )
    try:
        await gateway._register_channel(row)
        channel = manager.get_channel(row.channel_id)
        assert isinstance(channel, WeComChannel)
        assert channel.tenant_id == row.agent_id
        client = channel._ws_client = ReplyClient()
        await channel.handle_inbound(payload())
        assert client.calls[0]["content"] == "Processing…"
        assert client.calls[-1]["content"] == "answer"
    finally:
        await manager.remove_channel(row.channel_id)
