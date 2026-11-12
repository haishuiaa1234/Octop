import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { OctopUser } from "../../api/modules/auth";
import type { OctopAgent } from "../../context/AgentContext";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { benchmarkApi } from "../../api/modules/benchmarks";
import EvaluationCenter from "./index";

vi.mock("../../hooks/useCurrentUser", () => ({ useCurrentUser: vi.fn() }));
vi.mock("../../context/AgentContext", () => ({
  useAgent: () => ({
    agents: [
      { agent_id: "own", name: "Owned", user_id: 1 },
      { agent_id: "foreign", name: "Foreign", user_id: 2 },
      { agent_id: "remote", name: "Remote", user_id: 1, bridge: true },
    ] as OctopAgent[],
    loading: false,
    error: null,
  }),
}));
vi.mock("../../api/modules/benchmarks", () => ({
  benchmarkApi: { acceptFeedback: vi.fn() },
}));
vi.mock("../Agent/Benchmark", () => ({
  default: ({
    agentId,
    feedbackPanel,
  }: {
    agentId: string;
    feedbackPanel?: React.ReactNode;
  }) => (
    <div>
      <span data-testid="expert">{agentId}</span>
      {feedbackPanel || "own-feedback"}
    </div>
  ),
}));
vi.mock("../Admin/Feedback", () => ({
  default: ({ onReview }: { onReview: (item: unknown) => void }) => (
    <button
      onClick={() =>
        onReview({
          feedback_id: "f",
          agent_id: "foreign",
          question: "Q",
          correction: "A",
        })
      }
    >
      global-feedback
    </button>
  ),
}));
vi.mock("../Agent/Benchmark/CaseEditor", () => ({
  emptyCase: { match_mode: "manual", status: "draft" },
  default: ({
    initial,
    onSave,
  }: {
    initial: object;
    onSave: (data: object) => void;
  }) => (
    <button
      onClick={() =>
        onSave({ ...initial, status: "ready", rubric: "Reviewed criteria" })
      }
    >
      approve
    </button>
  ),
}));

describe("evaluation center", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCurrentUser).mockReturnValue({
      id: 1,
      role: "admin",
    } as OctopUser);
    vi.mocked(benchmarkApi.acceptFeedback).mockResolvedValue({} as never);
  });
  it("lets administrators review global feedback into the source expert only", async () => {
    render(
      <MemoryRouter>
        <EvaluationCenter />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("button", { name: "global-feedback" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "global-feedback" }));
    expect(benchmarkApi.acceptFeedback).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "approve" }));
    await waitFor(() =>
      expect(benchmarkApi.acceptFeedback).toHaveBeenCalledWith(
        "foreign",
        "f",
        expect.objectContaining({ status: "ready", question: "Q" }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId("expert")).toHaveTextContent("foreign"),
    );
  });
  it("never mounts global feedback for ordinary users or selects a foreign expert from the URL", () => {
    vi.mocked(useCurrentUser).mockReturnValue({
      id: 1,
      role: "user",
    } as OctopUser);
    render(
      <MemoryRouter initialEntries={["/benchmarks?agent=foreign"]}>
        <EvaluationCenter />
      </MemoryRouter>,
    );
    expect(
      screen.queryByRole("button", { name: "global-feedback" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("expert")).toHaveTextContent("own");
    expect(screen.getByText("own-feedback")).toBeInTheDocument();
  });
});
