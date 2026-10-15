import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { OctopAgent } from "../../../context/AgentContext";
import SharedExpertHint from "./SharedExpertHint";

const agent = {
  agent_id: "shared",
  is_shared: true,
  is_owner: false,
  owner_username: "owner",
} as OctopAgent;

describe("SharedExpertHint", () => {
  it("uses team wording for a shared team", () => {
    render(<SharedExpertHint agent={{ ...agent, kind: "team" }} />);
    expect(screen.getByLabelText("chat.sharedTeam.banner")).toBeInTheDocument();
    expect(screen.getByText("chat.sharedExpert.flag")).toBeInTheDocument();
  });

  it("retains expert wording for a shared solo expert", () => {
    render(<SharedExpertHint agent={{ ...agent, kind: "expert" }} />);
    expect(
      screen.getByLabelText("chat.sharedExpert.banner"),
    ).toBeInTheDocument();
  });

  it("does not label the owner's team as a shared viewer", () => {
    const { container } = render(
      <SharedExpertHint agent={{ ...agent, kind: "team", is_owner: true }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
