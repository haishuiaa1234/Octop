import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import zh from "../locales/zh.json";
import en from "../locales/en.json";
import { websiteLocales } from "../pages/Websites/locales";

const dashboard = resolve(__dirname, "../..");
const name = "智能工作台";
const html = readFileSync(resolve(dashboard, "index.html"), "utf8");
const manifest = JSON.parse(
  readFileSync(resolve(dashboard, "public/manifest.json"), "utf8"),
);

function displayStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(displayStrings);
  }
  return [];
}

describe("Geneseeq workbench identity", () => {
  it.each(["zh", "en"] as const)(
    "uses the workbench name in all %s display copy, keeping technical identifiers",
    (locale) => {
      const frontend = locale === "zh" ? zh : en;
      const backend = JSON.parse(
        readFileSync(
          resolve(dashboard, `../src/octop/i18n/${locale}.json`),
          "utf8",
        ),
      );
      const oldBrand = /Octop|OCTOP(?!_)/;
      for (const copy of [frontend, backend, websiteLocales[locale]]) {
        expect(
          displayStrings(copy).filter((text) => oldBrand.test(text)),
        ).toEqual([]);
      }
      expect(frontend.login.forgotPasswordCommand).toContain(
        "octop user passwd",
      );
      expect(frontend.wizard.password.whereDefault).toContain(
        "~/.octop/octop-login.txt",
      );
      expect(frontend.skills.newSkillTemplate).toContain("octop:");
    },
  );

  it.each([
    "pages/Chat/components/ChatInput.tsx",
    "pages/Login/ForgotPasswordModal.tsx",
    "pages/Control/RemoteBrowser/index.tsx",
    "pages/Control/RemoteDesktop/DesktopPanel.tsx",
    "pages/Agent/Memory/ProfileOverview.tsx",
    "pages/Agent/Memory/CandidatesReview.tsx",
    "pages/Agent/Memory/ProactiveConfig.tsx",
    "pages/Agent/Memory/EpisodesList.tsx",
    "pages/Agent/Memory/MigrateMemory.tsx",
    "pages/Agent/Connectors/index.tsx",
    "pages/Agent/Channels/components/constants.ts",
  ])("uses the workbench name in fallback and inline copy in %s", (path) => {
    const source = ts.createSourceFile(
      path,
      readFileSync(resolve(dashboard, "src", path), "utf8"),
      ts.ScriptTarget.Latest,
      true,
      path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const stale: string[] = [];
    function visit(node: ts.Node) {
      if (
        (ts.isStringLiteralLike(node) || ts.isJsxText(node)) &&
        /\bOctop(?:Bot)?\b|\bOCTOP\b/.test(node.text)
      ) {
        stale.push(node.text);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    expect(stale).toEqual([]);
  });

  it("uses the workbench name in the desktop startup and settings page", () => {
    const desktop = readFileSync(
      resolve(dashboard, "../desktop/src/assets/index.html"),
      "utf8",
    );
    const doc = new DOMParser().parseFromString(desktop, "text/html");
    expect(doc.title).toBe(name);
    expect(doc.querySelector("#loading-brand")?.textContent).toBe(name);
    expect(desktop).not.toContain("Octop");
  });

  it.each(["Header", "Sidebar"])(
    "keeps %s branding free of version numbers and sidebar update buttons",
    (layout) => {
      const source = readFileSync(
        resolve(dashboard, "src/layouts", `${layout}.tsx`),
        "utf8",
      );
      expect(source).not.toContain("CurrentVersionBadge");
      if (layout === "Sidebar") {
        expect(source).not.toContain("AppVersionBadge");
      } else {
        expect(source).toContain("<AppVersionBadge");
      }
    },
  );

  it("uses the approved name before React loads", () => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.title).toBe(name);
    expect(
      doc
        .querySelector('meta[name="apple-mobile-web-app-title"]')
        ?.getAttribute("content"),
    ).toBe(name);
    expect(doc.querySelector("#octop-boot-name")?.textContent).toBe(name);
    expect(doc.querySelector('link[rel="icon"]')?.getAttribute("href")).toBe(
      "/geneseeq-favicon.ico",
    );
  });

  it("keeps both translated page titles consistent", () => {
    for (const locale of [zh, en]) {
      expect(locale.app.name).toBe(name);
      expect(locale.app.pageTitle).toBe(name);
      expect(JSON.stringify(locale)).not.toContain("世和智能工作台");
      expect(JSON.stringify(locale)).not.toContain("分析部智能工作台");
    }
  });

  it("uses the product name in setup and login copy without renaming CLI paths", () => {
    for (const locale of [zh, en]) {
      expect(JSON.stringify(locale.wizard)).not.toMatch(/\bOctop\b/);
      expect(locale.login.forgotPasswordHelp).toContain(name);
      expect(locale.login.forgotPasswordCommand).toContain("octop user passwd");
      expect(locale.wizard.password.whereDefault).toContain(
        "~/.octop/octop-login.txt",
      );
    }
  });

  it("renames the installed app without changing its identity or start URL", () => {
    expect(manifest.name).toBe(name);
    expect(manifest.short_name).toBe(name);
    expect(manifest.description).toBe(name);
    expect(manifest.id).toBe("/");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
  });

  it.each([180, 192, 512])(
    "ships a nonblank %ipx corporate app icon",
    (size) => {
      const filename =
        size === 180
          ? "geneseeq-apple-touch-icon.png"
          : `geneseeq-icon-${size}.png`;
      const png = PNG.sync.read(
        readFileSync(resolve(dashboard, "public", filename)),
      );
      expect(png.width).toBe(size);
      expect(png.height).toBe(size);
      let bluePixels = 0;
      for (let offset = 0; offset < png.data.length; offset += 4) {
        if (
          png.data[offset + 2] > png.data[offset] + 30 &&
          png.data[offset + 3] > 0
        ) {
          bluePixels += 1;
        }
      }
      expect(bluePixels).toBeGreaterThan(size * size * 0.05);
      expect(manifest.icons).toContainEqual(
        expect.objectContaining({
          src: `/${filename}`,
          sizes: `${size}x${size}`,
          type: "image/png",
        }),
      );
    },
  );

  it("brands the offline fallback using local assets", () => {
    const offline = readFileSync(
      resolve(dashboard, "public/offline.html"),
      "utf8",
    );
    expect(offline).toContain(name);
    expect(new DOMParser().parseFromString(offline, "text/html").title).toBe(
      `${name} - 离线中`,
    );
    expect(offline).toContain('src="/geneseeq-logo.png"');
    expect(offline).not.toContain("Octop");
  });
});
