import { afterEach, describe, expect, it } from "vitest";
import { getSnapshot, ingestHarnessChunk, removeSession } from "./chatStore";
import { convertHistoryMessages } from "./useChat";
import { parseHarnessChunk } from "../../../utils/parseHarnessChunk";

const session = "feedback-stream";
afterEach(() => removeSession(session));

describe("feedback answer identity", () => {
  it("preserves the server message ID from token frames without replacing UI IDs", () => {
    const first = parseHarnessChunk(
      'data: {"type":"token","content":"Hello","message_id":"server1"}',
    )!;
    ingestHarnessChunk(session, first);
    const id = getSnapshot(session).messages[0].id;
    ingestHarnessChunk(
      session,
      parseHarnessChunk(
        'data: {"type":"token","content":" world","message_id":"server1"}',
      )!,
    );
    expect(getSnapshot(session).messages[0]).toMatchObject({
      id,
      feedbackMessageId: "server1",
      content: "Hello world",
    });
  });

  it("history carries the same persisted ID, never a generated fallback", () => {
    const messages = convertHistoryMessages([
      { role: "assistant", id: "server1", content: "Answer" },
      { role: "assistant", content: "No id" },
    ]);
    expect(messages[0].feedbackMessageId).toBe("server1");
    expect(messages[1].feedbackMessageId).toBeUndefined();
  });

  it("keeps two experts' feedback identities separate", () => {
    ingestHarnessChunk(
      session,
      parseHarnessChunk(
        'data: {"type":"token","content":"A","message_id":"answer-a","agent_id":"expert-a"}',
      )!,
    );
    ingestHarnessChunk(
      session,
      parseHarnessChunk(
        'data: {"type":"token","content":"B","message_id":"answer-b","agent_id":"expert-b"}',
      )!,
    );
    expect(
      getSnapshot(session).messages.map((m) => m.feedbackMessageId),
    ).toEqual(["answer-a", "answer-b"]);
  });

  it("uses a completed state update when older harness token frames omit IDs", () => {
    ingestHarnessChunk(session, {
      type: "token",
      node: "agent",
      content: "Answer",
    });
    ingestHarnessChunk(session, {
      type: "state_update",
      node: "agent",
      data: { messages: [{ type: "ai", id: "persisted", content: "Answer" }] },
    });
    expect(getSnapshot(session).messages[0].feedbackMessageId).toBe(
      "persisted",
    );
  });

  it("does not assign an old identical snapshot answer to a new live reply", () => {
    ingestHarnessChunk(session, {
      type: "token",
      node: "agent",
      content: "Answer",
    });
    ingestHarnessChunk(session, {
      type: "state_snapshot",
      data: {
        messages: [
          { type: "ai", id: "old", content: "Answer" },
          { type: "human", id: "new-user", content: "Again" },
        ],
      },
    });
    expect(getSnapshot(session).messages[0].feedbackMessageId).toBeUndefined();
  });

  it("uses the persisted team wrap-up identity without appending the answer twice", () => {
    ingestHarnessChunk(
      session,
      parseHarnessChunk(
        'data: {"type":"token","content":"Summary","agent_id":"host","team_wrapup":true,"message_id":"runtime-id"}',
      )!,
      "host",
    );
    ingestHarnessChunk(
      session,
      parseHarnessChunk(
        'data: {"type":"done","agent_id":"host","team_wrapup":true}',
      )!,
      "host",
    );
    ingestHarnessChunk(
      session,
      parseHarnessChunk(
        'data: {"type":"answer_identity","agent_id":"host","team_wrapup":true,"message_id":"persisted-wrapup"}',
      )!,
      "host",
    );
    expect(getSnapshot(session).messages).toHaveLength(1);
    expect(getSnapshot(session).messages[0]).toMatchObject({
      content: "Summary",
      feedbackMessageId: "persisted-wrapup",
    });
  });

  it("attaches a member's final identity without changing another member", () => {
    ingestHarnessChunk(session, {
      type: "token",
      node: "agent",
      content: "A",
      agent_id: "a",
    });
    ingestHarnessChunk(session, {
      type: "token",
      node: "agent",
      content: "B",
      agent_id: "b",
    });
    ingestHarnessChunk(
      session,
      parseHarnessChunk(
        'data: {"type":"answer_identity","agent_id":"a","message_id":"saved-a"}',
      )!,
    );
    expect(
      getSnapshot(session).messages.map((item) => item.feedbackMessageId),
    ).toEqual(["saved-a", undefined]);
  });
});
