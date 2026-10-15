import { describe, expect, it } from "vitest";
import {
  SIDEBAR_GROUPED_NAV_KEYS,
  SIDEBAR_NAV_KEYS,
  buildNavSections,
  isGroupedNavKey,
} from "./sidebarNav";
import type { OctopUser } from "../api/modules/auth";

const adminUser = {
  id: 1,
  username: "admin",
  role: "admin",
  permissions: ["*"],
} as OctopUser;

describe("sidebarNav", () => {
  it("keeps the fork launcher between experts and tasks", () => {
    const items = buildNavSections(adminUser)[0].items;
    expect(items.map((item) => item.key)).toEqual([
      "chat",
      "experts",
      "open-chatgpt",
      "tasks",
      "token-usage",
    ]);
    expect(items.find((item) => item.key === "open-chatgpt")).toMatchObject({
      path: "/open-chatgpt",
      labelKey: "chatgptLauncher.title",
    });
  });

  it("preserves upstream permission gates without hiding the fork launcher", () => {
    const user = { ...adminUser, role: "user", permissions: [] };
    expect(buildNavSections(user)[0].items.map((item) => item.key)).toEqual([
      "chat",
      "open-chatgpt",
    ]);
    expect(
      buildNavSections({ ...user, permissions: ["tasks"] })[0].items.map(
        (item) => item.key,
      ),
    ).toEqual(["chat", "open-chatgpt", "tasks"]);
  });

  it("marks catalog keys as grouped", () => {
    for (const key of SIDEBAR_GROUPED_NAV_KEYS) {
      expect(isGroupedNavKey(key)).toBe(true);
    }
    expect(isGroupedNavKey("chat")).toBe(false);
    expect(isGroupedNavKey("experts")).toBe(false);
  });

  it("places grouped keys only under sections with groupKey", () => {
    const sections = buildNavSections(adminUser, { mobileEnabled: true });
    const flatKeys = new Set(
      sections
        .filter((s) => !s.groupKey)
        .flatMap((s) => s.items.map((i) => i.key)),
    );
    const groupedKeys = new Set(
      sections
        .filter((s) => s.groupKey)
        .flatMap((s) => s.items.map((i) => i.key)),
    );
    for (const key of groupedKeys) {
      expect(isGroupedNavKey(key)).toBe(true);
      expect(flatKeys.has(key)).toBe(false);
    }
    for (const key of flatKeys) {
      expect(isGroupedNavKey(key)).toBe(false);
    }
  });

  it("covers every catalog key from the admin nav", () => {
    const keys = buildNavSections(adminUser, { mobileEnabled: true }).flatMap(
      (section) => section.items.map((item) => item.key),
    );
    expect(new Set(keys)).toEqual(new Set(SIDEBAR_NAV_KEYS));
    const grouped = buildNavSections(adminUser, { mobileEnabled: true }).filter(
      (section) => section.id,
    );
    expect(grouped.map((section) => section.id)).toEqual([
      "settings",
      "control",
      "admin",
    ]);
  });
});
