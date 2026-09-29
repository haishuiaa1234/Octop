import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WebsiteView from "./WebsiteView";
import { websiteApi } from "../../api/modules/websites";
import { websiteNavSections } from "./navigation";
import { resolveSelectedKey } from "../../routes";
import { canAccessPath } from "../../utils/permissions";

vi.mock("../../api/modules/websites", () => ({
  WEBSITES_CHANGED: "octop:websites-changed",
  websiteApi: { get: vi.fn() },
}));
vi.mock("../../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ id: 2 }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const site = {
  website_id: "one",
  name: "项目进度",
  url: "http://172.16.18.6:5184/",
  open_mode: "embed" as const,
  sort_order: 0,
};

function view(id = "one") {
  return render(
    <MemoryRouter initialEntries={[`/websites/${id}`]}>
      <Routes>
        <Route path="/websites/:websiteId" element={<WebsiteView />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("external websites", () => {
  it("embeds the authorized URL with sandbox and an independent link", async () => {
    vi.mocked(websiteApi.get).mockResolvedValue(site);
    view();
    const frame = await screen.findByTitle("项目进度");
    expect(frame).toHaveAttribute("src", site.url);
    expect(frame.getAttribute("sandbox")).not.toContain("allow-top-navigation");
    expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(screen.getByRole("link")).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
  });

  it("never embeds a rejected website", async () => {
    vi.mocked(websiteApi.get).mockRejectedValue(new Error("denied"));
    const { container } = view();
    await waitFor(() =>
      expect(screen.getByText("websites.unavailable")).toBeInTheDocument(),
    );
    expect(container.querySelector("iframe")).toBeNull();
  });

  it.each(["http://%/", `${window.location.origin}/untrusted`])(
    "does not expose invalid or dashboard-origin targets: %s",
    async (url) => {
      vi.mocked(websiteApi.get).mockResolvedValue({ ...site, url });
      const { container } = view();
      await screen.findByText("websites.unavailable");
      expect(container.querySelector("iframe")).toBeNull();
      expect(screen.queryByRole("link")).toBeNull();
    },
  );

  it("new-tab mode does not create an iframe", async () => {
    vi.mocked(websiteApi.get).mockResolvedValue({
      ...site,
      open_mode: "new_tab",
    });
    const { container } = view();
    await screen.findByRole("link");
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("removes the open iframe when access is revoked on revalidation", async () => {
    vi.mocked(websiteApi.get).mockResolvedValueOnce(site);
    const { container } = view();
    await screen.findByTitle("项目进度");
    vi.mocked(websiteApi.get).mockRejectedValue(new Error("revoked"));
    fireEvent(window, new Event("focus"));
    await screen.findByText("websites.unavailable");
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("keeps literal website names and separates admin navigation", () => {
    const sections = websiteNavSections([site], false);
    expect(sections[0].items[0].label).toBe("项目进度");
    expect(
      sections
        .flatMap((s) => s.items)
        .some((i) => i.path === "/admin/websites"),
    ).toBe(false);
    expect(
      websiteNavSections([], true)
        .flatMap((s) => s.items)
        .some((i) => i.path === "/admin/websites"),
    ).toBe(true);
    expect(resolveSelectedKey("/websites/one")).toBe("website-one");
    expect(canAccessPath({ role: "user" }, "/admin/websites")).toBe(false);
  });
});
