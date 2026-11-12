import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatAgentProfileProvider } from "../ChatAgentProfileContext";
import GeneratingIndicator from "./GeneratingIndicator";

vi.mock("../../../context/AgentContext", () => ({
  useAgent: () => ({
    agents: [],
    activeAgent: { agent_id: "host", name: "Team", kind: "team" },
  }),
}));

describe("GeneratingIndicator shared team speaker", () => {
  it("shows a private member's name and avatar without opening management", () => {
    render(
      <ChatAgentProfileProvider
        canOpen={false}
        onOpen={vi.fn()}
        isTeam
        teamMembers={[
          {
            agent_id: "private",
            name: "Private member",
            icon_url: "/member.png",
          },
        ]}
      >
        <GeneratingIndicator agentId="private" showAvatar />
      </ChatAgentProfileProvider>,
    );
    expect(
      screen.getByLabelText("Private member").querySelector("img"),
    ).toHaveAttribute("src", "/member.png");
    expect(screen.queryByRole("button", { name: "Private member" })).toBeNull();
  });
});
