import { render, screen } from "@testing-library/react";
import { Form } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ShareTargetsField from "./ShareTargetsField";

const options = {
  users: [{ id: 2, username: "alice", display_name: "Alice" }],
  roles: [{ id: "ops", name: "运营" }],
};

vi.mock("../../../api/modules/agentSharing", () => ({
  agentSharingApi: { options: vi.fn(async () => options) },
}));

describe("ShareTargetsField", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders all-users, multi-user, and multi-role controls", async () => {
    render(
      <Form initialValues={{ is_shared: false }}>
        <ShareTargetsField />
      </Form>,
    );

    expect(
      await screen.findByRole("switch", { name: "experts.share.toggle" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "experts.share.users" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "experts.share.roles" }),
    ).toBeInTheDocument();
  });
});
