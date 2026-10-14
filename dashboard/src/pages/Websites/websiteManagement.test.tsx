import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "antd";
import WebsiteManagement from "./WebsiteManagement";
import { websiteApi } from "../../api/modules/websites";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../../api/modules/websites", () => ({
  WEBSITES_CHANGED: "octop:websites-changed",
  websiteApi: {
    manage: vi.fn(),
    users: vi.fn(),
    save: vi.fn(),
    remove: vi.fn(),
    rotateSsoSecret: vi.fn(),
  },
}));

const site = {
  website_id: "app-one",
  name: "Demo App",
  url: "http://localhost:5187/",
  enabled: true,
  visibility: "all" as const,
  user_ids: [],
  sort_order: 0,
  open_mode: "embed" as const,
  auth_mode: "octop" as const,
  sso_callback_url: "http://localhost:5187/auth/octop/callback",
};

const getComputedStyle = window.getComputedStyle.bind(window);
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) =>
    getComputedStyle(element),
  );
  vi.mocked(websiteApi.manage).mockResolvedValue([site]);
  vi.mocked(websiteApi.users).mockResolvedValue([]);
});

describe("website SSO administration", () => {
  it("edits and preserves the opt-in authentication mode and callback", async () => {
    vi.mocked(websiteApi.save).mockResolvedValue(site);
    render(
      <App>
        <WebsiteManagement />
      </App>,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "websites.edit" }),
    );
    expect(await screen.findByLabelText("websites.ssoCallback")).toHaveValue(
      site.sso_callback_url,
    );
    fireEvent.click(screen.getByRole("button", { name: "websites.save" }));
    await waitFor(() =>
      expect(websiteApi.save).toHaveBeenCalledWith(
        expect.objectContaining({
          auth_mode: "octop",
          sso_callback_url: site.sso_callback_url,
        }),
        "app-one",
      ),
    );
  });

  it("requires confirmation and removes the generated secret after closing", async () => {
    vi.mocked(websiteApi.rotateSsoSecret).mockResolvedValue({
      client_secret: "a-new-secret",
    });
    render(
      <App>
        <WebsiteManagement />
      </App>,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "websites.ssoSecret" }),
    );
    expect(websiteApi.rotateSsoSecret).not.toHaveBeenCalled();
    fireEvent.click(
      await screen.findByRole("button", { name: "websites.generate" }),
    );
    const secret = await screen.findByLabelText("websites.clientSecret");
    expect(secret).toHaveValue("a-new-secret");
    expect(websiteApi.rotateSsoSecret).toHaveBeenCalledWith("app-one");
    fireEvent.click(screen.getByRole("button", { name: "websites.close" }));
    await waitFor(() =>
      expect(screen.queryByDisplayValue("a-new-secret")).toBeNull(),
    );
  });
});
