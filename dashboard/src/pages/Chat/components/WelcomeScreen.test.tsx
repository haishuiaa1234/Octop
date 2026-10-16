import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import WelcomeScreen from "./WelcomeScreen";

describe("WelcomeScreen logo", () => {
  it("shows the supplied logo without switching back to an Octop mascot", () => {
    render(<WelcomeScreen onPromptClick={vi.fn()} quickCards={[]} />);

    const logo = screen.getByRole("img");
    expect(logo).toHaveAttribute("src", "/shixiaohe-logo.png");
    expect(logo).not.toHaveAttribute("role", "button");
    expect(logo).not.toHaveAttribute("tabindex");
    fireEvent.click(logo);
    expect(logo).toHaveAttribute("src", "/shixiaohe-logo.png");
  });

  it("keeps the logo hidden when the chat requests it", () => {
    render(
      <WelcomeScreen onPromptClick={vi.fn()} quickCards={[]} hideMascot />,
    );

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
