import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OctopAgent } from "../../../context/AgentContext";

const { navigate, setActiveAgent, request } = vi.hoisted(() => ({
  navigate: vi.fn(),
  setActiveAgent: vi.fn(),
  request: vi.fn(),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));
vi.mock("../../../context/AgentContext", () => ({
  useAgent: () => ({ setActiveAgent, refresh: vi.fn() }),
}));
vi.mock("../../../api/request", () => ({ request }));
vi.mock("../../Agent/Workspace/components/WorkspaceDrawer", () => ({
  default: () => null,
}));
vi.mock("./ChannelCatalogDrawer", () => ({ default: () => null }));
vi.mock("./MemoryCatalogDrawer", () => ({ default: () => null }));

import { TeamCard } from "./TeamCard";

const team = {
  agent_id: "crew",
  name: "Crew",
  kind: "team",
  state: "running",
  is_shared: true,
  is_owner: false,
  owner_username: "owner",
} as OctopAgent;

function card(agent: OctopAgent) {
  return (
    <TeamCard
      agent={agent}
      experts={[]}
      onEdit={vi.fn()}
      onDeleted={vi.fn()}
      onStateChange={vi.fn()}
    />
  );
}

describe("TeamCard shared access", () => {
  beforeEach(() => vi.clearAllMocks());

  it("marks an owner's shared team", () => {
    render(card({ ...team, is_owner: true }));
    expect(screen.getByText("experts.share.badge")).toBeInTheDocument();
    expect(screen.getByText("experts.share.creator")).toBeInTheDocument();
  });

  it("hides management controls for viewers but keeps chat available", () => {
    render(card(team));
    expect(screen.getByText("experts.share.badge")).toBeInTheDocument();
    expect(screen.getByText("experts.share.creator")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
    for (const name of [
      "Edit",
      "pageShell.workspace.title",
      "experts.reloadAgent",
    ]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.queryByRole("button", { name: "common.more" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /对话/ }));
    expect(setActiveAgent).toHaveBeenCalledWith("crew");
    expect(navigate).toHaveBeenCalledWith("/chat/crew");
    expect(request).not.toHaveBeenCalled();
  });

  it("does not offer viewers a start action when a team is stopped", () => {
    render(card({ ...team, state: "stopped" }));
    expect(screen.queryByRole("button", { name: "启动" })).toBeNull();
  });
});
