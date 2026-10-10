import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ChatInputComposerActions from "./ChatInputComposerActions";

describe("ChatInputComposerActions colors", () => {
  it("applies configured colors while preserving uncolored action styling", () => {
    render(
      <ChatInputComposerActions
        label="actions"
        actions={[
          {
            title: "Bright",
            prompt: "bright",
            icon_name: null,
            behavior: "prefill",
            color: "#ffffff",
          },
          {
            title: "Legacy",
            prompt: "legacy",
            icon_name: null,
            behavior: "prefill",
          },
          {
            title: "Dark",
            prompt: "dark",
            icon_name: null,
            behavior: "prefill",
            color: "#123456",
          },
          {
            title: "Invalid",
            prompt: "invalid",
            icon_name: null,
            behavior: "prefill",
            color: "rgb(1, 2, 3)",
          },
        ]}
        onPrefill={vi.fn()}
        onSend={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Bright" })).toHaveStyle({
      backgroundColor: "#ffffff",
      color: "#111827",
    });
    expect(screen.getByRole("button", { name: "Legacy" })).not.toHaveAttribute(
      "style",
    );
    expect(screen.getByRole("button", { name: "Dark" })).toHaveStyle({
      color: "#ffffff",
    });
    expect(screen.getByRole("button", { name: "Invalid" })).not.toHaveAttribute(
      "style",
    );
  });
});
