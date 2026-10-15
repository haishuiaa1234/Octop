import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EmptyState, OctopEmptyMascot } from "../components/EmptyState";
import StreamConnectingIndicator from "../components/StreamConnectingIndicator";
import ThinkingBubble from "../pages/Chat/components/ThinkingBubble";

const dashboard = resolve(__dirname, "../..");
const logo = "/shixiaohe-mascot.png";
const originalHash =
  "c8a3bf96e9796990dcbe3dd2c8a0cae24f9aee94b38977e179848d9a6428f6a2";

describe("Shared Shi Xiao He mascot", () => {
  it.each([120, 160, 180])(
    "uses the blue mascot in a %ipx empty state",
    (size) => {
      const { container } = render(<OctopEmptyMascot size={size} />);
      const image = container.querySelector("img");

      expect(image).toHaveAttribute("src", logo);
      expect(image).toHaveAttribute("alt", "");
      expect(image).toHaveAttribute("draggable", "false");
      if (size !== 160) {
        expect(image).toHaveStyle({ width: `${size}px`, height: `${size}px` });
      }
    },
  );

  it("preserves empty-state copy and its action", () => {
    const onAction = vi.fn();
    const { container } = render(
      <EmptyState
        variant="mascot"
        title="No items"
        description="Not configured"
        actionLabel="Configure"
        onAction={onAction}
      />,
    );

    expect(container.querySelector("img")).toHaveAttribute("src", logo);
    expect(screen.getByText("No items")).toBeInTheDocument();
    expect(screen.getByText("Not configured")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Configure" }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it.each(["default", "onDark"] as const)(
    "uses the blue mascot on a %s connection indicator",
    (tone) => {
      const { container } = render(
        <StreamConnectingIndicator
          label="Connecting"
          hint="Please wait"
          tone={tone}
          size={tone === "onDark" ? "sm" : "md"}
        />,
      );

      expect(container.querySelector("img")).toHaveAttribute("src", logo);
      expect(screen.getByText("Connecting")).toBeInTheDocument();
      expect(screen.getByText("Please wait")).toBeInTheDocument();
    },
  );

  it("keeps the thinking timer and cancel action with the blue mascot", () => {
    const onCancel = vi.fn();
    const { container } = render(
      <ThinkingBubble startedAt={Date.now() - 5000} onCancel={onCancel} />,
    );

    expect(container.querySelector("img")).toHaveAttribute("src", logo);
    expect(screen.getByText(/chat.thinking.*5s/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it.each([
    resolve(dashboard, "public", logo.slice(1)),
    resolve(dashboard, "../desktop/src/assets", logo.slice(1)),
  ])("ships the supplied image unchanged at %s", (path) => {
    const bytes = readFileSync(path);

    expect(createHash("sha256").update(bytes).digest("hex")).toBe(originalHash);
    expect(bytes.readUInt32BE(16)).toBe(2480);
    expect(bytes.readUInt32BE(20)).toBe(3508);
  });

  it("does not switch the desktop startup mascot back to the red artwork", () => {
    const html = readFileSync(
      resolve(dashboard, "../desktop/src/assets/index.html"),
      "utf8",
    );
    const doc = new DOMParser().parseFromString(html, "text/html");

    expect(doc.querySelector("#mascot")?.getAttribute("src")).toBe(logo);
    expect(html).not.toContain("octop-mascot-");
    expect(html).not.toContain("pickMascot");
  });
});
