import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { OctopAgent } from "../../../context/AgentContext";
import SessionList from "./SessionList";
import styles from "../index.module.less";

const team = {
  id: 1,
  agent_id: "shared-team",
  name: "Medical Analysis Department Shared Team",
  kind: "team",
  state: "running",
  is_shared: true,
  is_owner: false,
  owner_username: "owner",
} as OctopAgent;

function renderList(agent: OctopAgent, expanded: boolean) {
  const onNewChat = vi.fn();
  const onAgentSelect = vi.fn();
  render(
    <MemoryRouter>
      <SessionList
        agents={[agent]}
        sessions={[]}
        activeId={null}
        activeAgentId={expanded ? agent.agent_id : "another-agent"}
        hasMore={false}
        loadingMore={false}
        onLoadMore={vi.fn()}
        onFetchAllSessions={vi.fn()}
        onSelect={vi.fn()}
        onAgentSelect={onAgentSelect}
        onNewChat={onNewChat}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        onPin={vi.fn()}
        onFork={vi.fn()}
      />
    </MemoryRouter>,
  );
  return { onNewChat, onAgentSelect };
}

describe("SessionList shared team names", () => {
  it.each([true, false])(
    "gives shared team names a wrapping layout (expanded: %s)",
    (expanded) => {
      const { onNewChat, onAgentSelect } = renderList(team, expanded);
      const name = screen.getByText(team.name);
      expect(name).toHaveClass(styles.sharedTeamName);
      expect(name.nextElementSibling).toContainElement(
        screen.getByLabelText("chat.teamBadge"),
      );
      expect(
        screen.getByLabelText("chat.sharedTeam.banner"),
      ).toBeInTheDocument();
      fireEvent.click(
        screen.getByRole("button", { name: "chatWelcome.newChat" }),
      );
      expect(onNewChat).toHaveBeenCalledWith(team.agent_id);
      expect(onAgentSelect).not.toHaveBeenCalled();
    },
  );

  it.each(["expert", "private-team"])(
    "keeps the existing compact layout for %s",
    (kind) => {
      const agent = {
        ...team,
        kind: kind === "expert" ? "expert" : "team",
        is_shared: kind === "expert",
      };
      renderList(agent, true);
      expect(screen.getByText(team.name)).not.toHaveClass(
        styles.sharedTeamName,
      );
    },
  );
});
