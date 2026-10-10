import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { agentChatApi } from "../../../api/modules/agentChat";
import type { ChatComposerAction } from "../../../api/modules/agentChat";
import type { OctopAgent } from "../../../context/AgentContext";
import { pickLocale, type LocalizedText } from "../../../utils/localizedText";
import type { WelcomeQuickCard } from "../components/WelcomeScreen";

interface WelcomePromptDto {
  title: LocalizedText;
  description: LocalizedText;
  prompt: LocalizedText;
  color?: string;
  icon_name?: string | null;
  expert?: string;
}

function mapQuickPrompts(
  prompts: WelcomePromptDto[] | undefined,
  locale: "zh" | "en",
): WelcomeQuickCard[] {
  return (prompts ?? []).map((p) => ({
    title: pickLocale(p.title, locale),
    description: pickLocale(p.description, locale),
    prompt: pickLocale(p.prompt, locale),
    color: p.color || "#e8f4ff",
    icon_name: p.icon_name ?? null,
    expertName: p.expert?.trim() || undefined,
  }));
}

export function useExpertChatWelcome(agent: OctopAgent | null): {
  quickCards: WelcomeQuickCard[];
  composerActions: ChatComposerAction[];
  welcomeSuffix: string | null;
} {
  const { i18n } = useTranslation();
  const [fetchedCards, setFetchedCards] = useState<WelcomeQuickCard[]>([]);
  const [fetchedActions, setFetchedActions] = useState<ChatComposerAction[]>(
    [],
  );
  const [welcomeSuffix, setWelcomeSuffix] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const locale: "zh" | "en" = i18n.language.startsWith("zh") ? "zh" : "en";
    const agentId = agent?.agent_id;
    if (!agentId) {
      setFetchedCards([]);
      setFetchedActions([]);
      setWelcomeSuffix(null);
      return;
    }

    setFetchedCards([]);
    setFetchedActions([]);
    void agentChatApi
      .welcome(agentId)
      .then((data) => {
        if (cancelled) return;
        setFetchedCards(mapQuickPrompts(data.quick_prompts, locale));
        setFetchedActions(
          (data.composer_actions ?? []).map((action) => ({
            title: pickLocale(action.title, locale),
            prompt: pickLocale(action.prompt, locale),
            icon_name: action.icon_name ?? null,
            behavior: action.behavior ?? "prefill",
            ...(action.color ? { color: action.color } : {}),
          })),
        );
        setWelcomeSuffix(
          pickLocale(data.welcome_message, locale, { crossFallback: false }) ||
            null,
        );
      })
      .catch(() => {
        if (!cancelled) {
          setFetchedCards([]);
          setFetchedActions([]);
          setWelcomeSuffix(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [agent?.agent_id, i18n.language]);

  return {
    quickCards: fetchedCards,
    composerActions: fetchedActions,
    welcomeSuffix,
  };
}
