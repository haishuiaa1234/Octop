import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AnswerFeedback from "./AnswerFeedback";
import { FeedbackProvider } from "../FeedbackContext";
import { feedbackApi } from "../../../api/modules/feedback";

vi.mock("../../../api/modules/feedback", () => ({
  feedbackReasons: [
    "factual_error",
    "unsupported",
    "misunderstood",
    "incomplete",
    "other",
  ],
  feedbackApi: { list: vi.fn(), save: vi.fn(), remove: vi.fn() },
}));

const saved = {
  feedback_id: "f1",
  message_id: "answer1",
  rating: "helpful" as const,
  reason: "",
  comment: "",
  correction: "",
  reference: "",
  question: "question",
  answer: "answer",
  agent_id: "a1",
  agent_name: "Expert",
  thread_id: "t1",
  user_id: 1,
  created_at: 1,
  updated_at: 1,
};

function mount(threadId = "t1") {
  return render(
    <FeedbackProvider agentId="a1" threadId={threadId}>
      <AnswerFeedback messageId="answer1" />
    </FeedbackProvider>,
  );
}

describe("answer feedback", () => {
  const getComputedStyle = window.getComputedStyle.bind(window);
  afterEach(() => vi.mocked(window.getComputedStyle).mockRestore());
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) =>
      getComputedStyle(element),
    );
    vi.mocked(feedbackApi.list).mockResolvedValue({ items: [] });
    vi.mocked(feedbackApi.save).mockResolvedValue(saved);
    vi.mocked(feedbackApi.remove).mockResolvedValue(undefined);
  });

  it("submits the persisted answer ID and restores the selected rating", async () => {
    mount();
    const helpful = screen.getByRole("button", { name: "feedback.helpful" });
    await waitFor(() => expect(helpful).toBeEnabled());
    fireEvent.click(helpful);
    await waitFor(() =>
      expect(feedbackApi.save).toHaveBeenCalledWith("a1", "t1", {
        message_id: "answer1",
        rating: "helpful",
        reason: "",
        comment: "",
        correction: "",
        reference: "",
      }),
    );
    expect(helpful).toHaveAttribute("aria-pressed", "true");
  });

  it("withdraws a stored rating without creating a second record", async () => {
    vi.mocked(feedbackApi.list).mockResolvedValue({ items: [saved] });
    mount();
    const withdraw = await screen.findByRole("button", {
      name: "feedback.withdraw",
    });
    fireEvent.click(withdraw);
    await waitFor(() =>
      expect(feedbackApi.remove).toHaveBeenCalledWith("a1", "t1", "answer1"),
    );
    expect(feedbackApi.save).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "feedback.withdraw" }),
      ).toBeNull(),
    );
  });

  it("requires a reason for negative feedback and keeps the dialog on failure", async () => {
    mount();
    const negative = screen.getByRole("button", { name: "feedback.unhelpful" });
    await waitFor(() => expect(negative).toBeEnabled());
    fireEvent.click(negative);
    fireEvent.click(screen.getByRole("button", { name: "feedback.submit" }));
    expect(
      await screen.findByText("feedback.reasonRequired"),
    ).toBeInTheDocument();
    expect(feedbackApi.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("feedback.reasons.factual_error"));
    vi.mocked(feedbackApi.save).mockRejectedValue(new Error("network"));
    fireEvent.click(screen.getByRole("button", { name: "feedback.submit" }));
    await waitFor(() => expect(feedbackApi.save).toHaveBeenCalled());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("does not display an old thread's feedback after switching threads", async () => {
    let resolve!: (value: { items: (typeof saved)[] }) => void;
    vi.mocked(feedbackApi.list).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const view = mount();
    view.rerender(
      <FeedbackProvider agentId="a1" threadId="t2">
        <AnswerFeedback messageId="answer1" />
      </FeedbackProvider>,
    );
    await waitFor(() =>
      expect(feedbackApi.list).toHaveBeenCalledWith("a1", "t2"),
    );
    resolve({ items: [saved] });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "feedback.helpful" }),
      ).toBeEnabled(),
    );
    expect(
      screen.getByRole("button", { name: "feedback.helpful" }),
    ).toHaveAttribute("aria-pressed", "false");
  });
});
