import { describe, expect, it, vi } from "vitest";

import {
  filterQuickPrompts,
  filterComposerActions,
  mergeWelcomeIntoManifest,
  normalizeQuickPrompts,
  normalizeComposerActions,
  parseManifestObject,
  serializeQuickPrompts,
  serializeComposerActions,
  saveManifestBeforeAgentUpdate,
  shouldWriteWelcomeManifest,
  validateComposerActions,
} from "./welcomeManifest";
import type { QuickPrompt } from "./welcomeManifest";
import type { ComposerAction } from "./welcomeManifest";

const prompt = (over: Partial<QuickPrompt> = {}): QuickPrompt => ({
  title: { zh: "标题", en: "Title" },
  description: { zh: "描述", en: "Desc" },
  prompt: { zh: "提示", en: "Prompt" },
  color: "#e8f4ff",
  icon_name: "sparkles",
  ...over,
});

const action = (over: Partial<ComposerAction> = {}): ComposerAction => ({
  title: { zh: "总结", en: "Summarize" },
  prompt: { zh: "请总结", en: "Summarize this" },
  icon_name: "file-text",
  behavior: "prefill",
  ...over,
});

describe("shouldWriteWelcomeManifest", () => {
  it("writes only after a successful load when the editor is dirty", () => {
    expect(shouldWriteWelcomeManifest("ready", true)).toBe(true);
    expect(shouldWriteWelcomeManifest("ready", false)).toBe(false);
    expect(shouldWriteWelcomeManifest("loading", true)).toBe(false);
    expect(shouldWriteWelcomeManifest("error", true)).toBe(false);
  });
});

describe("validateComposerActions", () => {
  it("rejects actions missing a title or prompt", () => {
    expect(
      validateComposerActions([
        action(),
        action({ title: { zh: "", en: "" } }),
      ]),
    ).toEqual({ valid: false, index: 1 });
  });

  it("accepts complete actions", () => {
    expect(validateComposerActions([action()])).toEqual({ valid: true });
  });
});

describe("saveManifestBeforeAgentUpdate", () => {
  it("does not update the agent when manifest persistence fails", async () => {
    const updateAgent = vi.fn().mockResolvedValue(undefined);

    await expect(
      saveManifestBeforeAgentUpdate(async () => {
        throw new Error("workspace write failed");
      }, updateAgent),
    ).rejects.toThrow("workspace write failed");

    expect(updateAgent).not.toHaveBeenCalled();
  });

  it("does not update the agent when the manifest is invalid", async () => {
    const updateAgent = vi.fn().mockResolvedValue(undefined);

    await expect(
      saveManifestBeforeAgentUpdate(async () => "invalid-json", updateAgent),
    ).resolves.toBe("manifest-invalid");

    expect(updateAgent).not.toHaveBeenCalled();
  });
});

describe("parseManifestObject", () => {
  it("accepts empty content as a new object", () => {
    expect(parseManifestObject("")).toEqual({ ok: true, value: {} });
    expect(parseManifestObject("   ")).toEqual({ ok: true, value: {} });
  });

  it("parses a JSON object", () => {
    expect(parseManifestObject('{"id":"demo","label":{"zh":"A"}}')).toEqual({
      ok: true,
      value: { id: "demo", label: { zh: "A" } },
    });
  });

  it("rejects arrays, scalars, and invalid JSON", () => {
    expect(parseManifestObject("[]")).toEqual({ ok: false });
    expect(parseManifestObject('"x"')).toEqual({ ok: false });
    expect(parseManifestObject("{")).toEqual({ ok: false });
  });
});

describe("mergeWelcomeIntoManifest", () => {
  it("keeps unrelated keys and updates only welcome fields", () => {
    const merged = mergeWelcomeIntoManifest(
      {
        id: "demo",
        label: { zh: "演示", en: "Demo" },
        source: { type: "skillhub" },
        welcome_message: { zh: "旧中文", en: "Old English" },
        quick_prompts: [],
      },
      {
        welcome_message: { zh: "新中文", en: "Old English" },
        quick_prompts: [prompt({ title: { zh: "卡", en: "" } })],
      },
    );
    expect(merged.id).toBe("demo");
    expect(merged.label).toEqual({ zh: "演示", en: "Demo" });
    expect(merged.source).toEqual({ type: "skillhub" });
    expect(merged.welcome_message).toEqual({ zh: "新中文", en: "Old English" });
    expect(merged.quick_prompts).toEqual([
      prompt({ title: { zh: "卡", en: "" } }),
    ]);
  });

  it("drops empty welcome copy and empty prompt cards", () => {
    const merged = mergeWelcomeIntoManifest(
      { id: "demo", welcome_message: { zh: "hi", en: "hi" } },
      {
        welcome_message: { zh: "  ", en: "" },
        quick_prompts: [
          prompt({ title: { zh: "", en: "" }, prompt: { zh: "", en: "" } }),
        ],
      },
    );
    expect(merged).toEqual({ id: "demo", quick_prompts: [] });
  });

  it("leaves welcome copy unchanged when the patch omits it", () => {
    const merged = mergeWelcomeIntoManifest(
      {
        id: "demo",
        welcome_message: { zh: "你好", en: "Hi" },
      },
      { quick_prompts: [prompt()] },
    );
    expect(merged.welcome_message).toEqual({ zh: "你好", en: "Hi" });
    expect(merged.quick_prompts).toEqual([prompt()]);
  });

  it("persists composer actions without changing welcome cards", () => {
    const existingCard = prompt();
    const merged = mergeWelcomeIntoManifest(
      { quick_prompts: [existingCard], other: "preserved" },
      { quick_prompts: [existingCard], composer_actions: [action()] },
    );

    expect(merged.quick_prompts).toEqual([existingCard]);
    expect(merged.composer_actions).toEqual([action()]);
    expect(merged.other).toBe("preserved");
  });
});

describe("normalizeComposerActions / serializeComposerActions", () => {
  it("defaults missing fields and omits empty actions", () => {
    expect(normalizeComposerActions([{ title: { zh: "总结" } }])).toEqual([
      {
        title: { zh: "总结", en: "" },
        prompt: { zh: "", en: "" },
        icon_name: null,
        behavior: "prefill",
      },
    ]);
    expect(
      filterComposerActions([action(), action({ prompt: { zh: "", en: "" } })]),
    ).toHaveLength(1);
    expect(serializeComposerActions([action()])).toEqual([action()]);
  });
});

describe("filterQuickPrompts", () => {
  it("keeps a card that has either title or prompt text", () => {
    expect(
      filterQuickPrompts([
        prompt({ title: { zh: "", en: "" }, prompt: { zh: "x", en: "" } }),
        prompt({ title: { zh: "", en: "" }, prompt: { zh: "", en: "" } }),
      ]),
    ).toHaveLength(1);
  });
});

describe("normalizeQuickPrompts / serializeQuickPrompts", () => {
  it("fills missing locale fields and drops empty cards on serialize", () => {
    const normalized = normalizeQuickPrompts([
      { title: { zh: "卡" }, color: "", icon_name: undefined },
      { title: { zh: "", en: "" }, prompt: { zh: "", en: "" } },
    ]);
    expect(normalized[0]).toEqual({
      title: { zh: "卡", en: "" },
      description: { zh: "", en: "" },
      prompt: { zh: "", en: "" },
      color: "#e8f4ff",
      icon_name: null,
    });
    expect(serializeQuickPrompts(normalized)).toHaveLength(1);
  });
});
