import type { ChatMessage } from "../hooks/sseHelpers";
import { extractText } from "../../../utils/messageParser";
import { deriveMessageContent } from "./messageContent";

/** Older harness versions expose final IDs in updates instead of token frames. */
export function feedbackIdFromUpdate(
  data: unknown,
  message: ChatMessage,
): string | undefined {
  if (message.feedbackMessageId || message.status !== "streaming")
    return undefined;
  const value = data as { messages?: unknown[] } | null;
  const messages = Array.isArray(data) ? data : value?.messages;
  if (!Array.isArray(messages)) return undefined;
  const raw = messages[messages.length - 1] as
    | Record<string, unknown>
    | undefined;
  if (!raw || !["ai", "assistant"].includes(String(raw.type || raw.role)))
    return undefined;
  const body = (
    raw.data && typeof raw.data === "object" ? raw.data : raw
  ) as Record<string, unknown>;
  if (
    typeof body.id !== "string" ||
    !body.id ||
    (Array.isArray(body.tool_calls) && body.tool_calls.length)
  )
    return undefined;
  const text = deriveMessageContent({
    ...message,
    content: extractText(body.content),
    contentBlocks: undefined,
  }).textContent.trim();
  return text && text === deriveMessageContent(message).textContent.trim()
    ? body.id
    : undefined;
}
