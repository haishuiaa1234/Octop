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
  websiteApi: { get: vi.fn(), issueSsoCode: vi.fn() },
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

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

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
    expect(sections[0].id).toBe("websites");
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

  it("exchanges an application challenge without exposing the Octop token", async () => {
    const ssoSite = {
      ...site,
      url: "http://localhost:5187/",
      auth_mode: "octop" as const,
      sso_callback_url: "http://localhost:5187/auth/octop/callback",
    };
    vi.mocked(websiteApi.get).mockResolvedValue(ssoSite);
    vi.mocked(websiteApi.issueSsoCode).mockResolvedValue({
      code: "one-time-code",
      state: "s".repeat(43),
      expires_in: 60,
      callback_url: ssoSite.sso_callback_url,
    });
    view();
    const frame = (await screen.findByTitle("项目进度")) as HTMLIFrameElement;
    const send = vi.spyOn(frame.contentWindow!, "postMessage");
    fireEvent(
      window,
      new MessageEvent("message", {
        origin: "http://localhost:5187",
        source: frame.contentWindow,
        data: {
          type: "octop.sso.ready",
          state: "s".repeat(43),
          code_challenge: "c".repeat(43),
        },
      }),
    );
    await waitFor(() =>
      expect(websiteApi.issueSsoCode).toHaveBeenCalledWith("one", {
        state: "s".repeat(43),
        code_challenge: "c".repeat(43),
      }),
    );
    expect(send).toHaveBeenCalledWith(
      {
        type: "octop.sso.code",
        code: "one-time-code",
        state: "s".repeat(43),
        callback_url: ssoSite.sso_callback_url,
      },
      "http://localhost:5187",
    );
  });

  it("rejects SSO messages from foreign origins, windows and malformed challenges", async () => {
    vi.mocked(websiteApi.get).mockResolvedValue({
      ...site,
      url: "http://localhost:5187/",
      auth_mode: "octop" as const,
      sso_callback_url: "http://localhost:5187/auth/octop/callback",
    });
    view();
    const frame = (await screen.findByTitle("项目进度")) as HTMLIFrameElement;
    const valid = {
      type: "octop.sso.ready",
      state: "s".repeat(43),
      code_challenge: "c".repeat(43),
    };
    for (const invalid of [
      {
        origin: "https://evil.example",
        source: frame.contentWindow,
        data: valid,
      },
      { origin: "http://localhost:5187", source: window, data: valid },
      {
        origin: "http://localhost:5187",
        source: frame.contentWindow,
        data: { ...valid, code_challenge: "bad" },
      },
    ]) {
      fireEvent(window, new MessageEvent("message", invalid));
    }
    expect(websiteApi.issueSsoCode).not.toHaveBeenCalled();
  });

  it("ignores a pending SSO response after access is revoked", async () => {
    const ssoSite = {
      ...site,
      url: "http://localhost:5187/",
      auth_mode: "octop" as const,
      sso_callback_url: "http://localhost:5187/auth/octop/callback",
    };
    vi.mocked(websiteApi.get).mockResolvedValue(ssoSite);
    let resolveCode!: (value: {
      code: string;
      state: string;
      expires_in: number;
      callback_url: string;
    }) => void;
    vi.mocked(websiteApi.issueSsoCode).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCode = resolve;
        }),
    );
    view();
    const frame = (await screen.findByTitle("项目进度")) as HTMLIFrameElement;
    const send = vi.spyOn(frame.contentWindow!, "postMessage");
    fireEvent(
      window,
      new MessageEvent("message", {
        origin: "http://localhost:5187",
        source: frame.contentWindow,
        data: {
          type: "octop.sso.ready",
          state: "s".repeat(43),
          code_challenge: "c".repeat(43),
        },
      }),
    );
    await waitFor(() =>
      expect(websiteApi.issueSsoCode).toHaveBeenCalledTimes(1),
    );
    vi.mocked(websiteApi.get).mockRejectedValue(new Error("revoked"));
    fireEvent(window, new Event("focus"));
    await screen.findByText("websites.unavailable");
    resolveCode({
      code: "stale",
      state: "s".repeat(43),
      expires_in: 60,
      callback_url: ssoSite.sso_callback_url,
    });
    await waitFor(() => expect(send).not.toHaveBeenCalled());
  });

  it("opens an SSO app without an opener and handshakes only with that popup", async () => {
    const ssoSite = {
      ...site,
      url: "http://localhost:5187/",
      open_mode: "new_tab" as const,
      auth_mode: "octop" as const,
      sso_callback_url: "http://localhost:5187/auth/octop/callback",
    };
    vi.mocked(websiteApi.get).mockResolvedValue(ssoSite);
    vi.mocked(websiteApi.issueSsoCode).mockResolvedValue({
      code: "popup-code",
      state: "s".repeat(43),
      expires_in: 60,
      callback_url: ssoSite.sso_callback_url,
    });
    const popup = {
      opener: window,
      closed: false,
      location: { replace: vi.fn() },
      postMessage: vi.fn(),
    };
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    view();
    fireEvent.click(
      await screen.findByRole("button", { name: "websites.openNew" }),
    );
    expect(popup.opener).toBeNull();
    expect(popup.location.replace).toHaveBeenCalledWith(ssoSite.url);
    fireEvent(
      window,
      new MessageEvent("message", {
        origin: "http://localhost:5187",
        source: popup as unknown as Window,
        data: {
          type: "octop.sso.ready",
          state: "s".repeat(43),
          code_challenge: "c".repeat(43),
        },
      }),
    );
    await waitFor(() =>
      expect(popup.postMessage).toHaveBeenCalledWith(
        {
          type: "octop.sso.code",
          code: "popup-code",
          state: "s".repeat(43),
          callback_url: ssoSite.sso_callback_url,
        },
        "http://localhost:5187",
      ),
    );
  });

  it("keeps popup discovery after login so a reloaded application can sign in again", async () => {
    const ssoSite = {
      ...site,
      url: "http://localhost:5187/",
      open_mode: "new_tab" as const,
      auth_mode: "octop" as const,
      sso_callback_url: "http://localhost:5187/auth/octop/callback",
    };
    vi.mocked(websiteApi.get).mockResolvedValue(ssoSite);
    vi.mocked(websiteApi.issueSsoCode).mockImplementation(async (_, body) => ({
      code: "popup-code",
      state: body.state,
      expires_in: 60,
      callback_url: ssoSite.sso_callback_url,
    }));
    const popup = {
      opener: window,
      closed: false,
      location: { replace: vi.fn() },
      postMessage: vi.fn(),
    };
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const intervals = vi.spyOn(window, "setInterval");
    const clearInterval = vi.spyOn(window, "clearInterval");
    const timeouts = vi.spyOn(window, "setTimeout");
    view();
    fireEvent.click(
      await screen.findByRole("button", { name: "websites.openNew" }),
    );
    const discoveryIndex = intervals.mock.calls.findIndex(
      (call) => call[1] === 500,
    );
    const discoveryId = intervals.mock.results[discoveryIndex].value;
    const ready = (state: string) =>
      fireEvent(
        window,
        new MessageEvent("message", {
          origin: "http://localhost:5187",
          source: popup as unknown as Window,
          data: {
            type: "octop.sso.ready",
            state,
            code_challenge: "c".repeat(43),
          },
        }),
      );
    ready("s".repeat(43));
    await waitFor(() =>
      expect(websiteApi.issueSsoCode).toHaveBeenCalledTimes(1),
    );
    await waitFor(() => expect(popup.postMessage).toHaveBeenCalled());
    expect(clearInterval).not.toHaveBeenCalledWith(discoveryId);
    expect(timeouts.mock.calls.some((call) => call[1] === 60_000)).toBe(false);
    ready("t".repeat(43));
    await waitFor(() =>
      expect(websiteApi.issueSsoCode).toHaveBeenCalledTimes(2),
    );
  });

  it("shows a retryable failure instead of silently bypassing SSO", async () => {
    vi.mocked(websiteApi.get).mockResolvedValue({
      ...site,
      url: "http://localhost:5187/",
      auth_mode: "octop" as const,
      sso_callback_url: "http://localhost:5187/auth/octop/callback",
    });
    vi.mocked(websiteApi.issueSsoCode).mockRejectedValue(
      new Error("missing secret"),
    );
    view();
    const frame = (await screen.findByTitle("项目进度")) as HTMLIFrameElement;
    fireEvent(
      window,
      new MessageEvent("message", {
        origin: "http://localhost:5187",
        source: frame.contentWindow,
        data: {
          type: "octop.sso.ready",
          state: "s".repeat(43),
          code_challenge: "c".repeat(43),
        },
      }),
    );
    await screen.findByText("websites.ssoFailed");
    expect(
      screen.getByRole("button", { name: "websites.retry" }),
    ).toBeInTheDocument();
  });
});
