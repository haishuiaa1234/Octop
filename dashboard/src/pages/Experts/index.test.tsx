import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OctopAgent } from "../../context/AgentContext";

const state = vi.hoisted(() => ({
  agents: [] as OctopAgent[],
  refresh: vi.fn(),
  request: vi.fn(),
  t: (key: string) => key,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: state.t, i18n: { language: "en" } }),
}));
vi.mock("../../context/AgentContext", () => ({
  useAgent: () => ({ agents: state.agents, refresh: state.refresh }),
}));
vi.mock("../../api/request", () => ({ request: state.request }));
vi.mock("../../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ id: 2, role: "user" }),
}));
vi.mock("../../layouts/PageShell", () => ({
  default: {
    FillTabs: ({ children }: { children: React.ReactNode }) => children,
  },
}));
vi.mock("./components/AgentCard", () => ({
  AgentCard: ({ agent }: { agent: OctopAgent }) => <div>{agent.name}</div>,
}));
vi.mock("./components/TeamCard", () => ({
  TeamCard: ({ agent }: { agent: OctopAgent }) => <div>{agent.name}</div>,
}));
vi.mock("./components/EditAgentDrawer", () => ({ default: () => null }));
vi.mock("./components/CreateFromExpertDrawer", () => ({ default: () => null }));
vi.mock("./components/TeamDrawer", () => ({ default: () => null }));
vi.mock("./components/ExpertMarketTab", () => ({ default: () => null }));
vi.mock("./components/AgentExpertsTable", () => ({
  default: ({ agents }: { agents: OctopAgent[] }) => (
    <div data-testid="expert-table">
      {agents.map((agent) => (
        <div key={agent.agent_id}>{agent.name}</div>
      ))}
    </div>
  ),
}));

import ExpertsPage from "./index";

const sharedTeam = {
  agent_id: "shared-team",
  name: "Shared team from owner",
  kind: "team",
  state: "running",
  is_shared: true,
  is_owner: false,
} as OctopAgent;
const ownedTeam = {
  ...sharedTeam,
  agent_id: "owned-team",
  name: "Owned team",
  is_owner: true,
};
const sharedExpert = {
  ...sharedTeam,
  agent_id: "shared-expert",
  name: "Shared solo expert",
  kind: "expert",
};

describe("ExpertsPage shared experts and teams", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    state.agents = [sharedTeam, ownedTeam, sharedExpert];
    state.request.mockImplementation(async (path: string) =>
      path === "/agents" ? state.agents : [],
    );
  });

  it("shows shared solo experts in My Experts and shared teams in My Teams", async () => {
    render(<ExpertsPage />);
    expect(screen.getByText(sharedExpert.name)).toBeInTheDocument();
    expect(screen.queryByText(sharedTeam.name)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /experts.myTeams/ }));
    expect(await screen.findByText(sharedTeam.name)).toBeInTheDocument();
    expect(screen.getByText(ownedTeam.name)).toBeInTheDocument();
  });

  it("includes shared solo experts in table view", async () => {
    localStorage.setItem("octop:experts-view", "table");
    await act(async () => {
      render(<ExpertsPage />);
    });
    expect(screen.getByTestId("expert-table")).toHaveTextContent(
      sharedExpert.name,
    );
  });

  it("keeps shared solo experts when the list is refreshed", async () => {
    render(<ExpertsPage />);
    fireEvent.click(screen.getByRole("button", { name: "" }));
    await waitFor(() => expect(state.refresh).toHaveBeenCalled());
    expect(screen.getByText(sharedExpert.name)).toBeInTheDocument();
  });

  it("removes revoked solo experts when the agent context updates", async () => {
    const { rerender } = render(<ExpertsPage />);
    expect(screen.getByText(sharedExpert.name)).toBeInTheDocument();
    state.agents = [ownedTeam];
    rerender(<ExpertsPage />);
    await waitFor(() =>
      expect(screen.queryByText(sharedExpert.name)).not.toBeInTheDocument(),
    );
  });

  it("keeps shared teams when the list is refreshed", async () => {
    render(<ExpertsPage />);
    fireEvent.click(screen.getByRole("tab", { name: /experts.myTeams/ }));
    const refresh = screen.getByRole("button", { name: "" });
    fireEvent.click(refresh);
    await waitFor(() => expect(state.refresh).toHaveBeenCalled());
    expect(screen.getByText(sharedTeam.name)).toBeInTheDocument();
  });

  it("removes revoked teams when the agent context updates", async () => {
    const { rerender } = render(<ExpertsPage />);
    fireEvent.click(screen.getByRole("tab", { name: /experts.myTeams/ }));
    expect(await screen.findByText(sharedTeam.name)).toBeInTheDocument();
    state.agents = [ownedTeam];
    rerender(<ExpertsPage />);
    await waitFor(() =>
      expect(screen.queryByText(sharedTeam.name)).not.toBeInTheDocument(),
    );
    expect(screen.getByText(ownedTeam.name)).toBeInTheDocument();
  });
});
