import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TFunction } from "i18next";
import { openChatGPT } from "./openChatGPT";

const { info } = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock("../utils/antdModal", () => ({ modal: { info } }));
const t = ((key: string) => key) as TFunction;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("openChatGPT", () => {
  it("launches the local protocol without forwarding the current URL or navigating the app", () => {
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { assign } });
    openChatGPT(t);
    expect(assign).toHaveBeenCalledExactlyOnceWith("octop-chatgpt://open");
    expect(info).toHaveBeenCalledOnce();
  });

  it("offers an explicit retry and a separate web fallback without claiming success", () => {
    const assign = vi.fn();
    vi.stubGlobal(
      "window",
      new Proxy(window, {
        get: (target, key) =>
          key === "location" ? { assign } : Reflect.get(target, key),
      }),
    );
    openChatGPT(t);
    render(info.mock.calls[0][0].content);
    expect(screen.getByText("chatgptLauncher.help")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "chatgptLauncher.retry" }),
    );
    expect(assign).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole("link", { name: "chatgptLauncher.web" }),
    ).toHaveAttribute("href", "https://chatgpt.com/");
    expect(
      screen.getByRole("link", { name: "chatgptLauncher.web" }),
    ).toHaveAttribute("rel", "noopener noreferrer");
  });
});
