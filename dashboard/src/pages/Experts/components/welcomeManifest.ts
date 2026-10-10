import type { LocalizedText } from "@/utils/localizedText";
import { isHexColor } from "@/utils/color";

export interface QuickPrompt {
  title: LocalizedText;
  description: LocalizedText;
  prompt: LocalizedText;
  color: string;
  icon_name: string | null;
}

export interface ComposerAction {
  title: LocalizedText;
  prompt: LocalizedText;
  icon_name: string | null;
  behavior: "prefill" | "send";
  color?: string;
}

function normalizeComposerActionColor(color: unknown): string | undefined {
  return isHexColor(color) ? color : undefined;
}

export interface WelcomeConfigData {
  welcome_message?: LocalizedText;
  quick_prompts: QuickPrompt[];
  composer_actions?: ComposerAction[];
}

export type WelcomeManifestStatus = "loading" | "ready" | "error";

export interface WelcomeManifestSnapshot {
  status: WelcomeManifestStatus;
  dirty: boolean;
  data: WelcomeConfigData;
}

/** Only persist page config after a successful load, and only if the user edited it. */
export function shouldWriteWelcomeManifest(
  status: WelcomeManifestStatus,
  dirty: boolean,
): boolean {
  return status === "ready" && dirty;
}

export function validateComposerActions(
  actions: ComposerAction[],
): { valid: true } | { valid: false; index: number } {
  const index = actions.findIndex(
    (action) =>
      (!action.title?.zh?.trim() && !action.title?.en?.trim()) ||
      (!action.prompt?.zh?.trim() && !action.prompt?.en?.trim()),
  );
  return index === -1 ? { valid: true } : { valid: false, index };
}

export async function saveManifestBeforeAgentUpdate(
  persistManifest: () => Promise<"ok" | "invalid-json">,
  updateAgent: () => Promise<unknown>,
): Promise<"saved" | "manifest-invalid"> {
  if ((await persistManifest()) === "invalid-json") return "manifest-invalid";
  await updateAgent();
  return "saved";
}

export function parseManifestObject(
  raw: string,
): { ok: true; value: Record<string, unknown> } | { ok: false } {
  const text = raw.trim();
  if (!text) return { ok: true, value: {} };
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ok: true, value: parsed as Record<string, unknown> };
    }
  } catch {
    /* invalid JSON */
  }
  return { ok: false };
}

function hasWelcomeText(message: LocalizedText | undefined): boolean {
  return Boolean(message?.zh?.trim() || message?.en?.trim());
}

export function filterQuickPrompts(prompts: QuickPrompt[]): QuickPrompt[] {
  return prompts.filter(
    (p) => p.title?.zh || p.title?.en || p.prompt?.zh || p.prompt?.en,
  );
}

export function normalizeQuickPrompts(
  prompts:
    | Array<{
        title?: LocalizedText;
        description?: LocalizedText;
        prompt?: LocalizedText;
        color?: string;
        icon_name?: string | null;
      }>
    | undefined,
): QuickPrompt[] {
  return (prompts ?? []).map((prompt) => ({
    title: { zh: prompt.title?.zh ?? "", en: prompt.title?.en ?? "" },
    description: {
      zh: prompt.description?.zh ?? "",
      en: prompt.description?.en ?? "",
    },
    prompt: { zh: prompt.prompt?.zh ?? "", en: prompt.prompt?.en ?? "" },
    color: prompt.color || "#e8f4ff",
    icon_name: prompt.icon_name ?? null,
  }));
}

export function serializeQuickPrompts(prompts: QuickPrompt[]): QuickPrompt[] {
  return filterQuickPrompts(prompts).map((prompt) => ({
    title: { zh: prompt.title?.zh ?? "", en: prompt.title?.en ?? "" },
    description: {
      zh: prompt.description?.zh ?? "",
      en: prompt.description?.en ?? "",
    },
    prompt: { zh: prompt.prompt?.zh ?? "", en: prompt.prompt?.en ?? "" },
    color: prompt.color || "#e8f4ff",
    icon_name: prompt.icon_name ?? null,
  }));
}

export function filterComposerActions(
  actions: ComposerAction[],
): ComposerAction[] {
  return actions.filter(
    (action) =>
      (action.title?.zh || action.title?.en) &&
      (action.prompt?.zh || action.prompt?.en),
  );
}

export function normalizeComposerActions(
  actions:
    | Array<{
        title?: LocalizedText;
        prompt?: LocalizedText;
        icon_name?: string | null;
        behavior?: string;
        color?: string;
      }>
    | undefined,
): ComposerAction[] {
  return (actions ?? []).map((action) => ({
    title: { zh: action.title?.zh ?? "", en: action.title?.en ?? "" },
    prompt: { zh: action.prompt?.zh ?? "", en: action.prompt?.en ?? "" },
    icon_name: action.icon_name ?? null,
    behavior: action.behavior === "send" ? "send" : "prefill",
    ...(normalizeComposerActionColor(action.color)
      ? { color: normalizeComposerActionColor(action.color) }
      : {}),
  }));
}

export function serializeComposerActions(
  actions: ComposerAction[],
): ComposerAction[] {
  return filterComposerActions(actions).map((action) => ({
    title: { zh: action.title?.zh ?? "", en: action.title?.en ?? "" },
    prompt: { zh: action.prompt?.zh ?? "", en: action.prompt?.en ?? "" },
    icon_name: action.icon_name ?? null,
    behavior: action.behavior === "send" ? "send" : "prefill",
    ...(normalizeComposerActionColor(action.color)
      ? { color: normalizeComposerActionColor(action.color) }
      : {}),
  }));
}

/** Merge welcome fields into an existing workspace manifest without dropping other keys. */
export function mergeWelcomeIntoManifest(
  existing: Record<string, unknown>,
  patch: WelcomeConfigData,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...existing };
  if (patch.welcome_message !== undefined) {
    if (hasWelcomeText(patch.welcome_message)) {
      next.welcome_message = {
        zh: patch.welcome_message?.zh ?? "",
        en: patch.welcome_message?.en ?? "",
      };
    } else {
      delete next.welcome_message;
    }
  }
  next.quick_prompts = filterQuickPrompts(patch.quick_prompts);
  if (patch.composer_actions !== undefined) {
    next.composer_actions = serializeComposerActions(patch.composer_actions);
  }
  return next;
}
