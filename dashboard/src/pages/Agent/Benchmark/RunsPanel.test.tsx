import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RunsPanel from "./RunsPanel";
import type { BenchmarkRun } from "../../../api/modules/benchmarks";
import { emptyCase } from "./CaseEditor";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../../../hooks/useServerTimezone", () => ({
  useServerTimezone: () => "UTC",
}));
describe("run controls", () => {
  it("cancels active runs and submits explicit manual verdicts", () => {
    const run: BenchmarkRun = {
      run_id: "r",
      name: "Trial",
      status: "running",
      created_at: 1730000000,
      total: 1,
      completed: 1,
      passed: 0,
      failed: 0,
      errors: 0,
      needs_review: 1,
      config_snapshot: {
        mode: "text_only",
        model_ref: "model",
        instruction_hash: "hash",
      },
      results: [
        {
          case_id: "c",
          revision: 2,
          case_snapshot: {
            ...emptyCase,
            title: "Frozen title",
            reference_answer: "Frozen reference",
          },
          status: "needs_review",
          answer: "Actual response",
          error: "",
          duration_ms: 123,
          note: "",
        },
      ],
    };
    const cancel = vi.fn();
    const review = vi.fn();
    const view = render(
      <RunsPanel
        runs={[run]}
        detail={run}
        onOpen={vi.fn()}
        onClose={vi.fn()}
        onCancel={cancel}
        onReview={review}
        busy={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "benchmark.cancel" }));
    expect(cancel).toHaveBeenCalledWith("r");
    expect(
      screen.queryByRole("button", { name: "benchmark.passed" }),
    ).not.toBeInTheDocument();
    view.rerender(
      <RunsPanel
        runs={[run]}
        detail={{ ...run, status: "completed" }}
        onOpen={vi.fn()}
        onClose={vi.fn()}
        onCancel={cancel}
        onReview={review}
        busy={false}
      />,
    );
    expect(screen.getByText("Frozen reference")).toBeInTheDocument();
    expect(screen.getByText("Actual response")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("benchmark.note"), {
      target: { value: "Checked rubric" },
    });
    fireEvent.click(screen.getByRole("button", { name: "benchmark.passed" }));
    expect(review).toHaveBeenCalledWith("c", true, "Checked rubric");
  });
});
