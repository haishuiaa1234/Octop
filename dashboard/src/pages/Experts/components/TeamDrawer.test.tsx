import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OctopAgent } from "../../../context/AgentContext";
import type { TeamRecord } from "../../../api/modules/teams";

const { get, create, update, templateFiles, t } = vi.hoisted(() => ({
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  templateFiles: vi.fn(),
  t: (key: string) => key,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t, i18n: { language: "en" } }),
}));
vi.mock("../../../api/modules/teams", () => ({
  teamsApi: { get, create, update, templateFiles },
}));
vi.mock("../../../api/modules/userGroups", () => ({
  userGroupsApi: {
    audience: async () => ({ user_count: 3, group_count: 1 }),
    list: async () => [{ user_group_id: "lab", name: "Lab", enabled: true }],
  },
}));
vi.mock("../../../hooks/useAgentFormResources", () => ({
  useAgentFormResources: () => ({
    models: [{ provider_name: "test", model: "model" }],
    modelsLoading: false,
    backends: [],
    backendsLoading: false,
  }),
}));
vi.mock("@/utils/antdMessage", () => ({
  message: { success: vi.fn(), error: vi.fn() },
}));

import TeamDrawer from "./TeamDrawer";

const getComputedStyle = window.getComputedStyle.bind(window);

const experts = [
  { agent_id: "a", name: "Alpha", kind: "expert", is_owner: true },
  { agent_id: "b", name: "Beta", kind: "expert", is_owner: true },
] as OctopAgent[];

const record: TeamRecord = {
  team_id: "crew",
  agent_id: "crew",
  name: "Crew",
  kind: "team",
  member_ids: ["a", "b"],
  members: experts,
  is_shared: true,
  shared_user_ids: [],
  shared_role_ids: [],
  is_owner: true,
  owner_username: "owner",
};

function drawer(
  mode: "create" | "edit",
  team?: OctopAgent,
  members: OctopAgent[] = experts,
) {
  return (
    <TeamDrawer
      open
      mode={mode}
      team={team}
      experts={members}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />
  );
}

describe("TeamDrawer sharing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) =>
      getComputedStyle(element),
    );
    templateFiles.mockResolvedValue([]);
    get.mockResolvedValue(record);
    create.mockResolvedValue(record);
    update.mockResolvedValue(record);
  });

  afterEach(() => vi.mocked(window.getComputedStyle).mockRestore());

  it("creates a private team by default and sends its sharing setting", async () => {
    render(drawer("create"));
    const sharing = await screen.findByRole("radio", {
      name: "resourceVisibility.all",
    });
    expect(sharing).not.toBeChecked();
    fireEvent.change(screen.getByLabelText("experts.agentName"), {
      target: { value: "Crew" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Alpha/ }));
    fireEvent.click(screen.getByRole("button", { name: /Beta/ }));
    fireEvent.click(screen.getByRole("button", { name: "common.create" }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ is_shared: false }),
      ),
    );
  });

  it("allows sharing a new team without sharing its members", async () => {
    render(drawer("create"));
    fireEvent.change(screen.getByLabelText("experts.agentName"), {
      target: { value: "Crew" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Alpha/ }));
    fireEvent.click(screen.getByRole("button", { name: /Beta/ }));
    fireEvent.click(
      await screen.findByRole("radio", { name: "resourceVisibility.all" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "common.create" }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ is_shared: true, member_ids: ["a", "b"] }),
      ),
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("loads the latest sharing value for edit and can revoke it", async () => {
    render(
      drawer("edit", {
        ...record,
        is_shared: false,
      } as unknown as OctopAgent),
    );
    const sharing = screen.getByRole("radio", {
      name: "resourceVisibility.all",
    });
    await waitFor(() => expect(sharing).toBeChecked());
    fireEvent.click(
      screen.getByRole("radio", { name: "resourceVisibility.owner" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        "crew",
        expect.objectContaining({ is_shared: false }),
      ),
    );
  });

  it("retains a targeted-only member when saving an existing team", async () => {
    const members = [
      { ...experts[0]!, is_owner: false, is_shared: false },
      experts[1]!,
    ];
    get.mockResolvedValue({ ...record, members });
    render(drawer("edit", record as unknown as OctopAgent, members));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Alpha/ })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        "crew",
        expect.objectContaining({ member_ids: ["a", "b"] }),
      ),
    );
  });

  it("initializes sharing from the team while its details load", async () => {
    get.mockReturnValue(new Promise(() => {}));
    await act(async () => {
      render(drawer("edit", record as unknown as OctopAgent));
    });
    expect(
      screen.getByRole("radio", { name: "resourceVisibility.all" }),
    ).toBeChecked();
  });

  it("resets sharing when switching from edit to create", async () => {
    const { rerender } = render(
      drawer("edit", record as unknown as OctopAgent),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("radio", { name: "resourceVisibility.all" }),
      ).toBeChecked(),
    );
    rerender(drawer("create"));
    expect(
      screen.getByRole("radio", { name: "resourceVisibility.all" }),
    ).not.toBeChecked();
  });
});
