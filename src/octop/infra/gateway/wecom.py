"""WeCom delivery with immediate progress and bounded, coalesced stream updates.

Keep SDK connections, inbound parsing and native media delivery in octop-gateway.
Its per-delta reply loop waits for an ACK before reading the next model token;
this adapter keeps exactly one sender and one pending cumulative snapshot per turn.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from contextlib import suppress
from typing import Any

from octop_gateway.channel import MessageProcessor
from octop_gateway.channels.wecom import WeComChannel as GatewayWeComChannel
from octop_gateway.constraints import tool_hint_message
from octop_gateway.models import (
    ChannelSubject,
    ContentPart,
    InboundMessage,
    MessageEventType,
    TextContent,
)
from octop_gateway.utils import extract_media, extract_text

from octop.i18n import tr
from octop.infra.utils.locale import Locale, resolve_locale

logger = logging.getLogger(__name__)
_UPDATE_INTERVAL = 0.3


class _StreamReply:
    def __init__(self, client: Any, frame: Any, placeholder: str) -> None:
        from wecom_aibot_sdk import generate_req_id

        self._client = client
        self._frame = frame
        self._stream_id = generate_req_id("him")
        self._content = placeholder
        self._changed = asyncio.Event()
        self._changed.set()
        self._finished = asyncio.Event()
        self._task = asyncio.create_task(self._send(), name="wecom-stream-reply")

    def update(self, content: str) -> None:
        self._content = content
        self._changed.set()

    async def finish(self, content: str) -> None:
        self.update(content)
        self._finished.set()
        await self._task

    async def close(self) -> None:
        self._task.cancel()
        await asyncio.gather(self._task, return_exceptions=True)

    async def _send(self) -> None:
        while True:
            await self._changed.wait()
            self._changed.clear()
            content, finish = self._content, self._finished.is_set()
            try:
                await self._client.reply_stream(
                    frame=self._frame,
                    stream_id=self._stream_id,
                    content=content,
                    finish=finish,
                )
            except Exception:
                if finish:
                    raise
                # A failed progress update must not discard the final answer.
                logger.warning("WeCom progress update failed", exc_info=True)
            if finish:
                return
            # Bound send frequency even with fast ACKs. A final reply bypasses
            # the interval, but always follows the in-flight update's ACK.
            with suppress(TimeoutError):
                await asyncio.wait_for(self._finished.wait(), timeout=_UPDATE_INTERVAL)


class WeComChannel(GatewayWeComChannel):
    """Octop's WeCom stream adapter; state is isolated for each inbound turn."""

    def __init__(
        self,
        processor: MessageProcessor,
        *,
        locale_resolver: Callable[[InboundMessage], Locale] | None = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(processor, **kwargs)
        self._locale_resolver = locale_resolver

    async def handle_inbound(self, raw_payload: Any) -> None:
        message = self.parse_inbound(raw_payload)
        meta = message.metadata
        client = meta.get("_ws_client", self._ws_client)
        frame = meta.get("_frame")
        if not client or not frame:
            await super().handle_inbound(raw_payload)
            return

        self._track_subject(message)
        await self._acquire_rate_slot()
        locale = (
            self._locale_resolver(message)
            if self._locale_resolver
            else resolve_locale(channel_type="wecom", metadata=meta)
        )
        reply = _StreamReply(client, frame, tr("channel.processing", locale))
        iterator = self._processor(message)
        text: list[str] = []
        thinking: list[str] = []
        media: list[ContentPart] = []
        error: str | None = None
        try:
            try:
                # Start the placeholder before media downloads / model startup,
                # without waiting for the network acknowledgement.
                await asyncio.sleep(0)
                if self._media_backend:
                    await self._persist_media(message)
                async for event in iterator:
                    if event.type == MessageEventType.DELTA:
                        chunk = "".join(p.text for p in event.content if isinstance(p, TextContent))
                        if chunk:
                            text.append(chunk)
                            reply.update("".join(text))
                    elif event.type == MessageEventType.THINKING_DELTA:
                        if self._constraints.show_thinking:
                            thinking.extend(
                                p.text for p in event.content if isinstance(p, TextContent)
                            )
                            reply.update(
                                self._constraints.thinking_template.format(
                                    content="".join(thinking).strip()
                                )
                            )
                    elif event.type == MessageEventType.FLUSH:
                        thinking.clear()
                    elif event.type == MessageEventType.TOOL_START:
                        if self._constraints.show_tool_hints:
                            reply.update(
                                tool_hint_message(event.metadata, self._constraints, phase="start")
                            )
                    elif event.type == MessageEventType.MESSAGE:
                        text.append(extract_text(event.content))
                        media.extend(extract_media(event.content))
                    elif event.type == MessageEventType.ERROR:
                        error = event.error or tr("channel.reply_failed", locale)
                        break
                    elif event.type == MessageEventType.COMPLETED:
                        break
            except Exception:
                logger.exception("WeCom processor failed")
                error = tr("channel.reply_failed", locale)
            finally:
                close = getattr(iterator, "aclose", None)
                if close is not None:
                    await close()

            await reply.finish(error or "".join(text) or "✅")
            if not error and media:
                subject_id = message.channel_subject.subject_id if message.channel_subject else ""
                media_meta = dict(meta)
                # The callback's stream is finished; native media follows in
                # the same chat using upstream's proactive routing.
                media_meta.pop("_frame", None)
                subject = ChannelSubject(subject_id=subject_id, metadata=media_meta)
                for part in media:
                    await self._send_media(subject, part)
        finally:
            await reply.close()
