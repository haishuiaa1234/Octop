import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { branding } = vi.hoisted(() => ({ branding: vi.fn() }));

vi.mock("../api/modules/settings", () => ({
  octopSettingsApi: { branding },
}));

describe("server brand favicon", () => {
  let favicon: HTMLLinkElement;

  beforeEach(() => {
    vi.resetModules();
    branding.mockReset();
    favicon = document.createElement("link");
    favicon.rel = "icon";
    favicon.type = "image/x-icon";
    favicon.href = "/geneseeq-favicon.ico";
    document.head.appendChild(favicon);
  });

  afterEach(() => favicon.remove());

  it("uses the same Dinfectome response for page branding and the browser icon", async () => {
    branding.mockResolvedValue({ brand: "dinfectome" });
    const { useServerBrand, useBrandFavicon } = await import(
      "./useServerBrand"
    );
    const hook = renderHook(() => {
      useBrandFavicon();
      return useServerBrand();
    });

    await waitFor(() => expect(hook.result.current).toBe("dinfectome"));
    expect(favicon).toHaveAttribute("href", "/dinfectome-logo.webp");
    expect(favicon).toHaveAttribute("type", "image/webp");
    hook.rerender();
    expect(branding).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('link[rel="icon"]')).toHaveLength(1);
  });

  it.each(["default", "other", undefined])(
    "uses the default G icon for brand %s",
    async (brand) => {
      favicon.href = "/dinfectome-logo.webp";
      favicon.type = "image/webp";
      branding.mockResolvedValue({ brand });
      const { useBrandFavicon } = await import("./useServerBrand");
      renderHook(() => useBrandFavicon());

      await waitFor(() => expect(branding).toHaveBeenCalledTimes(1));
      expect(favicon).toHaveAttribute("href", "/geneseeq-favicon.ico");
      expect(favicon).toHaveAttribute("type", "image/x-icon");
    },
  );

  it("keeps the default icon when branding cannot be fetched", async () => {
    branding.mockRejectedValue(new Error("branding unavailable"));
    const { useBrandFavicon } = await import("./useServerBrand");
    renderHook(() => useBrandFavicon());

    await waitFor(() => expect(branding).toHaveBeenCalledTimes(1));
    expect(favicon).toHaveAttribute("href", "/geneseeq-favicon.ico");
    expect(favicon).toHaveAttribute("type", "image/x-icon");
  });
});
