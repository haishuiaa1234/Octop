import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { feedbackApi } from "../../api/modules/feedback";
import { FeedbackProvider } from "./FeedbackContext";
import AnswerFeedback from "./components/AnswerFeedback";

vi.mock("../../api/modules/feedback", () => ({
  feedbackReasons: ["other"],
  feedbackApi: { list: vi.fn(), save: vi.fn(), remove: vi.fn() },
}));

describe("feedback ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(feedbackApi.list).mockResolvedValue({ items: [] });
  });

  it("does not request feedback or expose actions for another user's shared conversation", () => {
    render(
      <FeedbackProvider agentId="a1" threadId="shared-thread" enabled={false}>
        <AnswerFeedback messageId="answer1" />
      </FeedbackProvider>,
    );
    expect(feedbackApi.list).not.toHaveBeenCalled();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("drops the old feedback context when switching to a shared conversation", async () => {
    const view = render(
      <FeedbackProvider agentId="a1" threadId="owned-thread">
        <AnswerFeedback messageId="answer1" />
      </FeedbackProvider>,
    );
    expect(feedbackApi.list).toHaveBeenCalledWith("a1", "owned-thread");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "feedback.helpful" }),
      ).toBeEnabled(),
    );
    vi.mocked(feedbackApi.list).mockClear();
    view.rerender(
      <FeedbackProvider agentId="a1" threadId="shared-thread" enabled={false}>
        <AnswerFeedback messageId="answer1" />
      </FeedbackProvider>,
    );
    expect(feedbackApi.list).not.toHaveBeenCalled();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
