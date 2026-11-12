import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_STORAGE_KEY } from "./themePalettes";

const INDEX_HTML = readFileSync(
  resolve(__dirname, "../../index.html"),
  "utf8",
).replaceAll("%BASE_URL%", "/");

describe("boot favicon branding", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(["dinfectome", "default", "unknown"])(
    "selects the browser icon for %s before React loads",
    async (brand) => {
      const doc = new DOMParser().parseFromString(INDEX_HTML, "text/html");
      const script = Array.from(doc.scripts).find(
        (node) => node.textContent?.includes('fetch("/api/settings/branding"'),
      );
      expect(script).toBeDefined();
      const fetchBrand = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ brand }),
      });
      vi.stubGlobal("fetch", fetchBrand);
      new Function("document", script!.textContent!)(doc);
      await vi.waitFor(() => expect(fetchBrand).toHaveBeenCalledOnce());
      await vi.waitFor(() => {
        const favicon = doc.querySelector('link[rel="icon"]');
        expect(favicon?.getAttribute("href")).toBe(
          brand === "dinfectome"
            ? "/dinfectome-favicon.svg"
            : "/geneseeq-favicon.ico",
        );
        expect(favicon?.getAttribute("type")).toBe(
          brand === "dinfectome" ? "image/svg+xml" : "image/x-icon",
        );
      });
      expect(doc.querySelector("#octop-boot-logo")?.getAttribute("src")).toBe(
        brand === "dinfectome" ? "/dinfectome-logo.webp" : "/geneseeq-logo.png",
      );
    },
  );
});

function bootThemeScript(): string {
  const match = INDEX_HTML.match(
    /<script id="octop-boot-theme">([\s\S]*?)<\/script>/,
  );
  if (!match) {
    throw new Error("octop-boot-theme script missing from index.html");
  }
  return match[1];
}

function stubMatchMedia(systemDark: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("prefers-color-scheme: dark") ? systemDark : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

describe("index.html boot theme", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    localStorage.removeItem(THEME_STORAGE_KEY);
    document.documentElement.removeAttribute("data-theme");
    window.history.replaceState(null, "", "/");
    stubMatchMedia(true);
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    localStorage.removeItem(THEME_STORAGE_KEY);
    document.documentElement.removeAttribute("data-theme");
    window.history.replaceState(null, "", "/");
  });

  it("styles the splash from data-theme, not OS color scheme", () => {
    expect(INDEX_HTML).toContain('html[data-theme="dark"] #octop-boot');
    expect(INDEX_HTML).not.toMatch(
      /@media \(prefers-color-scheme: dark\)[\s\S]*#octop-boot/,
    );
  });

  it("keeps the branded boot logo inside the desktop chrome shell", () => {
    expect(INDEX_HTML).toContain('id="octop-chrome"');
    expect(INDEX_HTML).toContain('id="octop-stage"');
    expect(INDEX_HTML).toContain('src="/geneseeq-logo.png"');
    expect(INDEX_HTML).toContain('id="octop-boot-logo"');
    expect(INDEX_HTML).toContain('fetch("/api/settings/branding"');
    expect(INDEX_HTML).toContain('logo.src = "/dinfectome-logo.webp"');
  });

  it("shows the shared arc beside the status line", () => {
    expect(INDEX_HTML).toContain('class="octop-boot-spinner"');
    expect(INDEX_HTML).toContain("@keyframes octop-boot-spin");
  });

  it("keeps a stored light preference over OS dark", () => {
    localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ preference: "light", palette: "rose" }),
    );
    eval(bootThemeScript());
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("honors a stored dark preference", () => {
    stubMatchMedia(false);
    localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ preference: "dark", palette: "rose" }),
    );
    eval(bootThemeScript());
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("follows the OS when preference is system or missing", () => {
    eval(bootThemeScript());
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    document.documentElement.removeAttribute("data-theme");
    stubMatchMedia(false);
    eval(bootThemeScript());
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("migrates a legacy plain theme string", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    eval(bootThemeScript());
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("adopts the desktop shell preference over the stored one", () => {
    localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({
        preference: "dark",
        palette: "tech",
        customColor: "#112233",
      }),
    );
    window.history.replaceState(null, "", "/?octopTheme=light");
    eval(bootThemeScript());
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(JSON.parse(localStorage.getItem(THEME_STORAGE_KEY)!)).toEqual({
      preference: "light",
      palette: "tech",
      customColor: "#112233",
    });
    expect(window.location.search).not.toContain("octopTheme");
  });

  it("resolves a desktop system preference against the OS", () => {
    localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ preference: "light", palette: "rose" }),
    );
    window.history.replaceState(null, "", "/?octopTheme=system");
    eval(bootThemeScript());
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(JSON.parse(localStorage.getItem(THEME_STORAGE_KEY)!)).toMatchObject({
      preference: "system",
      palette: "rose",
    });
  });
});
