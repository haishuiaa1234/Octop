import { describe, expect, it, vi } from "vitest";
import { request } from "../request";
import { benchmarkApi } from "./benchmarks";
vi.mock("../request", () => ({ request: vi.fn().mockResolvedValue([]) }));
describe("benchmark API", () => {
  it("scopes and encodes agent IDs and preserves list responses", async () => {
    expect(await benchmarkApi.cases("a/b")).toEqual([]);
    expect(request).toHaveBeenCalledWith("/agents/a%2Fb/benchmarks/cases");
  });
  it("creates runs with only selected case IDs", async () => {
    await benchmarkApi.createRun("a", { name: "test", case_ids: ["c"] });
    expect(request).toHaveBeenLastCalledWith("/agents/a/benchmarks/runs", {
      method: "POST",
      body: JSON.stringify({ name: "test", case_ids: ["c"] }),
    });
  });
});
