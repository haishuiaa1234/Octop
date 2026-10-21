import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OctopAgent } from "../../../context/AgentContext";

const { navigate, setActiveAgent, request, refresh } = vi.hoisted(() => ({
  navigate: vi.fn(),
  setActiveAgent: vi.fn(),
  request: vi.fn(async () => ({})),
  refresh: vi.fn(),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));
vi.mock("react-i18next", async () => {
  const { createInstance } = await import("i18next");
  const { default: en } = await import("../../../locales/en.json");
  const i18n = createInstance();
  await i18n.init({
    lng: "en",
    resources: { en: { translation: en } },
    showSupportNotice: false,
  });
  return { useTranslation: () => ({ t: i18n.t, i18n }) };
});
vi.mock("../../../context/AgentContext", () => ({
  useAgent: () => ({ setActiveAgent, refresh }),
}));
vi.mock("../../../api/request", () => ({ request }));
vi.mock("../../Agent/Workspace/components/WorkspaceDrawer", () => ({
  default: () => null,
}));
vi.mock("./SubagentCatalogDrawer", () => ({ default: () => null }));
vi.mock("./SkillCatalogDrawer", () => ({ default: () => null }));
vi.mock("./ChannelCatalogDrawer", () => ({ default: () => null }));
vi.mock("./MemoryCatalogDrawer", () => ({ default: () => null }));
vi.mock("./ToolCatalogDrawer", () => ({ default: () => null }));
vi.mock("./PluginCatalogDrawer", () => ({ default: () => null }));
vi.mock("./MbtiCatalogDrawer", () => ({ default: () => null }));
vi.mock("./ExternalApiDrawer", () => ({ default: () => null }));

import { AgentCard } from "./AgentCard";
import { TeamCard } from "./TeamCard";
import AgentExpertsTable from "./AgentExpertsTable";

const expert = {
  agent_id: "shared-expert",
  name: "Shared expert",
  kind: "expert",
  state: "running",
  is_shared: true,
  is_owner: false,
  owner_username: "expert_author",
} as OctopAgent;

const callbacks = {
  onEdit: vi.fn(),
  onDeleted: vi.fn(),
  onStateChange: vi.fn(),
};
const views = [
  [
    "expert card",
    (agent: OctopAgent) => <AgentCard agent={agent} {...callbacks} />,
  ],
  [
    "expert table",
    (agent: OctopAgent) => (
      <AgentExpertsTable agents={[agent]} {...callbacks} />
    ),
  ],
  [
    "team card",
    (agent: OctopAgent) => (
      <TeamCard
        agent={{ ...agent, kind: "team" }}
        experts={[]}
        {...callbacks}
      />
    ),
  ],
] as const;

const getComputedStyle = window.getComputedStyle.bind(window);

beforeEach(() => {
  vi.clearAllMocks();
  request.mockReset().mockResolvedValue({});
  // jsdom cannot measure the pseudo-element used by Ant Design's scrollbar.
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) =>
    getComputedStyle(element),
  );
});
afterEach(() => {
  vi.mocked(window.getComputedStyle).mockRestore();
  vi.useRealTimers();
});

describe.each(views)("%s shared access", (_label, view) => {
  it.each([true, false])(
    "shows shared status and creator when is_owner=%s",
    (isOwner) => {
      render(view({ ...expert, is_owner: isOwner }));
      expect(screen.getByText("Shared")).toBeInTheDocument();
      expect(screen.getByText("Created by: expert_author")).toBeInTheDocument();
    },
  );

  it("keeps chat available without management controls for a shared viewer", () => {
    render(view(expert));
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    for (const name of ["Edit", "Delete", "Reload", "Workspace", "More"]) {
      expect(
        screen.queryByRole("button", { name, exact: true }),
      ).not.toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: /Chat/ }));
    expect(setActiveAgent).toHaveBeenCalledWith(expert.agent_id);
    expect(navigate).toHaveBeenCalledWith(`/chat/${expert.agent_id}`);
    expect(callbacks.onEdit).not.toHaveBeenCalled();
  });

  it("does not allow viewers to start a stopped shared expert", () => {
    render(view({ ...expert, state: "stopped" }));
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Start|Retry/ }),
    ).not.toBeInTheDocument();
  });

  it("does not offer model configuration to viewers when the expert fails", () => {
    render(
      view({
        ...expert,
        state: "failed",
        last_error: "octop:agent_errors.no_models_configured",
      }),
    );
    expect(
      screen.queryByRole("button", { name: "Configure models" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Retry|Start/ }),
    ).not.toBeInTheDocument();
  });

  it("retains management controls for the owner", () => {
    render(view({ ...expert, is_owner: true }));
    expect(screen.getByRole("switch")).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Edit", exact: true }),
    ).toBeEnabled();
  });

  it("does not show shared metadata on private experts", () => {
    render(view({ ...expert, is_shared: false, is_owner: true }));
    expect(screen.queryByText("Shared")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Created by: expert_author"),
    ).not.toBeInTheDocument();
  });
});

describe.each(views)("%s state polling", (_label, view) => {
  it("refreshes a shared viewer's starting expert through the readable detail endpoint", async () => {
    vi.useFakeTimers();
    request.mockResolvedValue({ state: "running", last_error: null });
    render(view({ ...expert, state: "starting" }));
    expect(
      screen.queryByRole("button", { name: /Chat/ }),
    ).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(request).toHaveBeenCalledWith(`/agents/${expert.agent_id}`);
    expect(screen.getByRole("button", { name: /Chat/ })).toBeEnabled();
    expect(callbacks.onStateChange).toHaveBeenCalledWith(
      expert.agent_id,
      "running",
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not poll owner-only maintenance status for a running shared viewer", async () => {
    vi.useFakeTimers();
    render(view(expert));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("retains runtime status polling for the owner", async () => {
    vi.useFakeTimers();
    request.mockResolvedValue({ state: "running", last_error: null });
    render(view({ ...expert, state: "starting", is_owner: true }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(request).toHaveBeenCalledWith(`/agents/${expert.agent_id}/status`);
    expect(screen.getByRole("button", { name: /Chat/ })).toBeEnabled();
  });
});
