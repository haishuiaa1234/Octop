import { request } from "../request";
import type { LocalizedText } from "../../utils/localizedText";

export interface ChatComposerAction {
  title: string;
  prompt: string;
  icon_name: string | null;
  behavior: "prefill" | "send";
}

export interface ChatComposerActionDto {
  title: LocalizedText;
  prompt: LocalizedText;
  icon_name?: string | null;
  behavior?: "prefill" | "send";
}

export interface ChatWelcomeResponse {
  welcome_message?: LocalizedText;
  quick_prompts?: Array<{
    title: LocalizedText;
    description: LocalizedText;
    prompt: LocalizedText;
    color?: string;
    icon_name?: string | null;
    expert?: string;
    agent_id?: string;
  }>;
  composer_actions?: ChatComposerActionDto[];
  task_examples?: { zh?: string[]; en?: string[] } | null;
}

export const agentChatApi = {
  welcome: (agentId: string) =>
    request<ChatWelcomeResponse>(
      `/agents/${encodeURIComponent(agentId)}/chat/welcome`,
    ),

  polish: (agentId: string, text: string, defaultModel?: string | null) =>
    request<{ text: string }>(
      `/agents/${encodeURIComponent(agentId)}/chat/polish`,
      {
        method: "POST",
        body: JSON.stringify({
          text,
          ...(defaultModel ? { default_model: defaultModel } : {}),
        }),
      },
    ),
};
