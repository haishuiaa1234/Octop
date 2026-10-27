import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OctopEmptyMascot } from "../components/EmptyState";
import StreamConnectingIndicator from "../components/StreamConnectingIndicator";
import ThinkingBubble from "../pages/Chat/components/ThinkingBubble";
import WelcomeScreen from "../pages/Chat/components/WelcomeScreen";

const branding = vi.hoisted(() => ({ brand: "dinfectome" }));
vi.mock("../hooks/useServerBrand", () => ({
  useServerBrand: () => branding.brand,
}));

describe("Dinfectome illustrations", () => {
  beforeEach(() => {
    branding.brand = "dinfectome";
  });

  it("uses multiple supplied illustrations across welcome, thinking, connecting and empty states", () => {
    const { container, rerender } = render(
      <>
        <WelcomeScreen onPromptClick={vi.fn()} quickCards={[]} />
        <ThinkingBubble startedAt={Date.now()} />
        <StreamConnectingIndicator label="Connecting" />
        <OctopEmptyMascot />
      </>,
    );
    const sources = Array.from(container.querySelectorAll("img"), (img) =>
      img.getAttribute("src"),
    );
    expect(sources).toHaveLength(4);
    expect(sources.every((src) => src?.startsWith("/dinfectome-mascot-"))).toBe(
      true,
    );
    expect(new Set(sources).size).toBe(3);
    rerender(
      <>
        <WelcomeScreen onPromptClick={vi.fn()} quickCards={[]} />
        <ThinkingBubble startedAt={Date.now()} />
        <StreamConnectingIndicator label="Connected" />
        <OctopEmptyMascot />
      </>,
    );
    expect(
      Array.from(container.querySelectorAll("img"), (img) =>
        img.getAttribute("src"),
      ),
    ).toEqual(sources);
  });

  it("preserves the default welcome illustration", () => {
    branding.brand = "default";
    render(<WelcomeScreen onPromptClick={vi.fn()} quickCards={[]} />);
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "/shixiaohe-logo.png",
    );
  });
});
