import { beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "../request";
import { externalApi } from "./externalApi";

vi.mock("../request", () => ({ request: vi.fn() }));

describe("externalApi", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads only the selected expert configuration", async () => {
    await externalApi.getConfig("expert/id");
    expect(request).toHaveBeenCalledWith("/agents/expert%2Fid/external-api");
  });

  it("changes access without implicitly rotating a key", async () => {
    await externalApi.configure("expert-a", { enabled: false });
    expect(request).toHaveBeenCalledWith("/agents/expert-a/external-api", {
      method: "PUT",
      body: JSON.stringify({ enabled: false }),
    });
  });

  it("explicitly requests rotation for the selected expert", async () => {
    await externalApi.configure("expert-b", { enabled: true, rotate: true });
    expect(request).toHaveBeenCalledWith("/agents/expert-b/external-api", {
      method: "PUT",
      body: JSON.stringify({ enabled: true, rotate: true }),
    });
  });
});
