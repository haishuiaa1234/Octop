import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Benchmark from "./index";
import CasesPanel from "./CasesPanel";
import {
  benchmarkApi,
  type BenchmarkCase,
} from "../../../api/modules/benchmarks";
import { emptyCase } from "./CaseEditor";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../../../hooks/useServerTimezone", () => ({
  useServerTimezone: () => "UTC",
}));
vi.mock("../../../api/modules/benchmarks", () => ({
  benchmarkApi: {
    cases: vi.fn(),
    candidates: vi.fn(),
    runs: vi.fn(),
    updateCase: vi.fn(),
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(benchmarkApi.candidates).mockResolvedValue([]);
  vi.mocked(benchmarkApi.runs).mockResolvedValue([]);
});
describe("benchmark scope", () => {
  it("queues a fresh request after a mutation while an older refresh is pending", async () => {
    const item: BenchmarkCase = {
      ...emptyCase,
      case_id: "c",
      agent_id: "a",
      title: "Case",
      revision: 1,
      source: "manual",
      source_snapshot: {},
      created_at: 0,
      updated_at: 0,
    };
    let resolveSlow!: (items: BenchmarkCase[]) => void;
    vi.mocked(benchmarkApi.cases)
      .mockResolvedValueOnce([item])
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSlow = resolve;
          }),
      )
      .mockResolvedValue([{ ...item, status: "disabled" }]);
    vi.mocked(benchmarkApi.updateCase).mockResolvedValue({
      ...item,
      status: "disabled",
    });
    render(<Benchmark agentId="a" />);
    await screen.findByText("Case");
    fireEvent.click(screen.getByRole("button", { name: "benchmark.refresh" }));
    await waitFor(() => expect(benchmarkApi.cases).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "benchmark.disable" }));
    await waitFor(() =>
      expect(benchmarkApi.updateCase).toHaveBeenCalledTimes(1),
    );
    resolveSlow([item]);
    await waitFor(() => expect(benchmarkApi.cases).toHaveBeenCalledTimes(3));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "benchmark.disable" }),
      ).toBeDisabled(),
    );
  });
  it("does not display late responses from the previous expert", async () => {
    let resolveOld!: (items: BenchmarkCase[]) => void;
    vi.mocked(benchmarkApi.cases).mockImplementation((a) =>
      a === "old"
        ? new Promise((resolve) => {
            resolveOld = resolve;
          })
        : Promise.resolve([
            {
              ...emptyCase,
              case_id: "new-case",
              agent_id: a,
              title: "New expert",
              revision: 1,
              source: "manual",
              source_snapshot: {},
              created_at: 0,
              updated_at: 0,
            },
          ]),
    );
    const view = render(<Benchmark agentId="old" />);
    await waitFor(() => expect(benchmarkApi.cases).toHaveBeenCalledWith("old"));
    view.rerender(<Benchmark agentId="new" />);
    await screen.findByText("New expert");
    resolveOld([
      {
        ...emptyCase,
        case_id: "old-case",
        agent_id: "old",
        title: "Old expert",
        revision: 1,
        source: "manual",
        source_snapshot: {},
        created_at: 0,
        updated_at: 0,
      },
    ]);
    await waitFor(() =>
      expect(screen.queryByText("Old expert")).not.toBeInTheDocument(),
    );
  });
  it("blocks remote experts without making requests", () => {
    render(<Benchmark agentId="remote" blocked />);
    expect(screen.getByText("benchmark.unavailable")).toBeInTheDocument();
    expect(benchmarkApi.cases).not.toHaveBeenCalled();
  });
  it("requires ready selections and a run name", () => {
    const onRun = vi.fn();
    const cases: BenchmarkCase[] = ["ready", "draft"].map((status, i) => ({
      ...emptyCase,
      status: status as BenchmarkCase["status"],
      case_id: String(i),
      agent_id: "a",
      title: `case-${i}`,
      revision: 1,
      source: "manual",
      source_snapshot: {},
      created_at: 0,
      updated_at: 0,
    }));
    render(
      <CasesPanel
        cases={cases}
        busy={false}
        onEdit={vi.fn()}
        onDisable={vi.fn()}
        onRun={onRun}
        onExport={vi.fn()}
      />,
    );
    const start = screen.getByRole("button", { name: "benchmark.startRun" });
    expect(start).toBeDisabled();
    const checks = screen.getAllByRole("checkbox");
    expect(checks[2]).toBeDisabled();
    fireEvent.click(checks[1]);
    expect(start).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("benchmark.runName"), {
      target: { value: "Trial" },
    });
    fireEvent.click(start);
    expect(onRun).toHaveBeenCalledWith(["0"], "Trial");
  });
});
