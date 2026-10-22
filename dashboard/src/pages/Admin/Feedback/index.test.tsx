import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import FeedbackPage from "./index";
import { feedbackApi } from "../../../api/modules/feedback";

vi.mock("../../../layouts/PageShell", () => ({
  default: ({
    children,
    actions,
  }: {
    children: ReactNode;
    actions: ReactNode;
  }) => (
    <div>
      {actions}
      {children}
    </div>
  ),
}));
vi.mock("../../../hooks/useServerTimezone", () => ({
  useServerTimezone: () => "Asia/Shanghai",
}));
vi.mock("../../../api/modules/feedback", () => ({
  feedbackReasons: ["factual_error"],
  feedbackApi: { adminList: vi.fn(), export: vi.fn() },
}));

describe("admin feedback", () => {
  const getComputedStyle = window.getComputedStyle.bind(window);
  afterEach(() => vi.mocked(window.getComputedStyle).mockRestore());
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) =>
      getComputedStyle(element),
    );
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn(() => "blob:feedback"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
    vi.mocked(feedbackApi.adminList).mockResolvedValue({
      items: [],
      total: 0,
      helpful: 0,
      unhelpful: 0,
    });
    vi.mocked(feedbackApi.export).mockResolvedValue(new Blob(["[]"]));
  });
  it("uses the applied filters for both the table and full export", async () => {
    render(<FeedbackPage />);
    await waitFor(() => expect(feedbackApi.adminList).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("feedback.agent"), {
      target: { value: "expert-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "feedback.search" }));
    await waitFor(() =>
      expect(feedbackApi.adminList).toHaveBeenLastCalledWith(
        expect.objectContaining({ agent_id: "expert-1" }),
        0,
        20,
      ),
    );
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:feedback");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "feedback.export" }));
    await waitFor(() =>
      expect(feedbackApi.export).toHaveBeenCalledWith(
        expect.objectContaining({ agent_id: "expert-1" }),
      ),
    );
  });
});
