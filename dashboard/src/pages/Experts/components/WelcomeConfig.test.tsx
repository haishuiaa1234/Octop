import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import WelcomeConfig from "./WelcomeConfig";

describe("WelcomeConfig composer action colors", () => {
  it("updates the action preview when a preset color is selected", () => {
    render(
      <WelcomeConfig
        initialActions={[
          {
            title: { zh: "总结", en: "Summarize" },
            prompt: { zh: "总结内容", en: "Summarize" },
            icon_name: "sparkles",
            behavior: "prefill",
          },
        ]}
      />,
    );

    const preview = screen.getByRole("button", { name: "总结" });
    fireEvent.click(screen.getByRole("button", { name: "#2563eb" }));

    expect(preview).toHaveStyle({
      backgroundColor: "#2563eb",
      color: "#ffffff",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "experts.defaultColor" }),
    );
    expect(preview).not.toHaveStyle({ backgroundColor: "#2563eb" });
    expect(screen.getByLabelText("experts.composerActionHexColor")).toHaveValue(
      "#2563eb",
    );
  });

  it("accepts a custom hex color and updates the preview", () => {
    render(
      <WelcomeConfig
        initialActions={[
          {
            title: { zh: "总结", en: "Summarize" },
            prompt: { zh: "总结内容", en: "Summarize" },
            icon_name: null,
            behavior: "prefill",
          },
        ]}
      />,
    );

    fireEvent.change(screen.getByLabelText("experts.composerActionHexColor"), {
      target: { value: "#123456" },
    });
    expect(screen.getByRole("button", { name: "总结" })).toHaveStyle({
      backgroundColor: "#123456",
    });
  });
});
