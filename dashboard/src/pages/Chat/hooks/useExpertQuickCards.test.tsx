import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { welcome } = vi.hoisted(() => ({ welcome: vi.fn() }));

vi.mock("../../../api/modules/agentChat", () => ({
  agentChatApi: { welcome: (...args: unknown[]) => welcome(...args) },
}));

import { useExpertChatWelcome } from "./useExpertQuickCards";

describe("useExpertChatWelcome composer actions", () => {
  beforeEach(() => {
    welcome.mockReset();
  });

  it("loads the selected expert's actions for its chat composer", async () => {
    welcome.mockResolvedValue({
      composer_actions: [
        {
          title: { zh: "总结", en: "Summarize" },
          prompt: { zh: "总结这段内容", en: "Summarize this" },
          icon_name: "file-text",
          behavior: "prefill",
        },
      ],
    });

    const { result } = renderHook(() =>
      useExpertChatWelcome({ agent_id: "expert-1" } as never),
    );

    await waitFor(() => {
      expect(result.current.composerActions).toEqual([
        {
          title: "总结",
          prompt: "总结这段内容",
          icon_name: "file-text",
          behavior: "prefill",
        },
      ]);
    });
    expect(welcome).toHaveBeenCalledWith("expert-1");
  });
});
