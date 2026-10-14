import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthStatus: vi.fn(),
  getOauthStatus: vi.fn(),
  startOauth: vi.fn(),
  openSsoPopup: vi.fn(),
}));

vi.mock("../../context/ThemeContext", () => ({
  useTheme: () => ({ isDark: false }),
}));

vi.mock("react-i18next", () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t, i18n: { language: "zh" } }) };
});

vi.mock("../../api/modules/auth", () => ({
  authApi: {
    getAuthStatus: mocks.getAuthStatus,
    getOauthStatus: mocks.getOauthStatus,
    startOauth: mocks.startOauth,
    getCaptcha: () => Promise.resolve({ provider: "none" }),
  },
}));

vi.mock("../../utils/locale", () => ({
  applyGuestLocale: () => Promise.resolve(),
  applyUserLocale: () => Promise.resolve(),
}));

vi.mock("../../utils/ssoPopup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/ssoPopup")>()),
  openSsoPopup: mocks.openSsoPopup,
}));

vi.mock("./CaptchaField", async () => {
  const { forwardRef } = await import("react");
  return {
    default: forwardRef(() => <div data-testid="account-captcha" />),
  };
});

import LoginPage from "./index";
import * as wecomQr from "./wecomQr";

const authorizationUrl = (state: string) =>
  `https://login.work.weixin.qq.com/wwlogin/sso/login?${new URLSearchParams({
    login_type: "CorpApp",
    appid: "test-corp",
    agentid: "1000001",
    redirect_uri: "https://workspace.example/api/auth/oauth/callback",
    state,
  })}`;

function renderLogin() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthStatus.mockResolvedValue({ setup_required: false });
  mocks.getOauthStatus.mockResolvedValue({
    providers: [{ kind: "wecom", display_name: "WeCom", enabled: true }],
  });
  mocks.startOauth.mockResolvedValue({
    authorization_url: authorizationUrl("state-one"),
  });
});

afterEach(() => vi.restoreAllMocks());

describe("Login inline WeCom QR", () => {
  it("does not flash the account form while detecting login providers", async () => {
    let resolve!: (value: { providers: unknown[] }) => void;
    mocks.getOauthStatus.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    renderLogin();
    await waitFor(() => expect(mocks.getOauthStatus).toHaveBeenCalled());
    expect(screen.queryByPlaceholderText("login.username")).toBeNull();
    await act(async () => resolve({ providers: [] }));
    expect(screen.getByPlaceholderText("login.username")).toBeInTheDocument();
  });

  it("defaults to an inline QR without opening a popup or showing account fields", async () => {
    renderLogin();

    const frame = await screen.findByTitle("login.wecomQr");
    const src = new URL(frame.getAttribute("src")!);
    expect(src.origin).toBe("https://open.work.weixin.qq.com");
    expect(src.pathname).toBe("/wwopen/sso/qrConnect");
    expect(src.searchParams.get("appid")).toBe("test-corp");
    expect(src.searchParams.get("agentid")).toBe("1000001");
    expect(src.searchParams.get("state")).toBe("state-one");
    expect(src.searchParams.get("redirect_uri")).toBe(
      "https://workspace.example/api/auth/oauth/callback",
    );
    expect(src.searchParams.get("lang")).toBe("zh");
    expect(screen.getByRole("tab", { name: "login.qrLogin" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByPlaceholderText("login.username")).toBeNull();
    expect(mocks.startOauth).toHaveBeenCalledExactlyOnceWith(
      "wecom",
      "/chat",
      expect.any(AbortSignal),
    );
    expect(mocks.openSsoPopup).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  it("switches between account and QR login while preserving typed credentials", async () => {
    const user = userEvent.setup();
    renderLogin();
    await screen.findByTitle("login.wecomQr");
    const signal = mocks.startOauth.mock.calls[0][2] as AbortSignal;

    await user.click(screen.getByRole("tab", { name: "login.accountLogin" }));
    expect(signal.aborted).toBe(true);
    await user.type(screen.getByPlaceholderText("login.username"), "reviewer");
    await user.type(screen.getByPlaceholderText("login.password"), "secret");
    expect(screen.getByTestId("account-captcha")).toBeInTheDocument();
    expect(
      screen.getByTestId("login-forgot-password-toggle"),
    ).toBeInTheDocument();
    expect(screen.queryByTitle("login.wecomQr")).toBeNull();

    await user.click(screen.getByRole("tab", { name: "login.qrLogin" }));
    await screen.findByTitle("login.wecomQr");
    expect(screen.queryByPlaceholderText("login.username")).toBeNull();
    await user.click(screen.getByRole("tab", { name: "login.accountLogin" }));
    expect(screen.getByPlaceholderText("login.username")).toHaveValue(
      "reviewer",
    );
    expect(screen.getByPlaceholderText("login.password")).toHaveValue("secret");
  });

  it("refreshes the QR using a new server authorization state", async () => {
    const user = userEvent.setup();
    renderLogin();
    fireEvent.load(await screen.findByTitle("login.wecomQr"));

    mocks.startOauth.mockResolvedValue({
      authorization_url: authorizationUrl("state-two"),
    });
    await user.click(screen.getByRole("button", { name: "login.refreshQr" }));
    await waitFor(() => {
      const frame = screen.getByTitle("login.wecomQr");
      expect(
        new URL(frame.getAttribute("src")!).searchParams.get("state"),
      ).toBe("state-two");
    });
    expect(mocks.startOauth).toHaveBeenCalledTimes(2);
    expect(mocks.openSsoPopup).not.toHaveBeenCalled();
  });

  it("requests the official iframe postMessage handshake after loading", async () => {
    renderLogin();
    const frame = (await screen.findByTitle(
      "login.wecomQr",
    )) as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow!, "postMessage");

    fireEvent.load(frame);

    expect(postMessage).toHaveBeenCalledExactlyOnceWith(
      "ask_usePostMessage",
      wecomQr.WECOM_QR_ORIGIN,
    );
  });

  it("only validates messages from the current WeCom iframe and removes its listener on unmount", async () => {
    const validate = vi.spyOn(wecomQr, "wecomQrCallback").mockReturnValue(null);
    const view = renderLogin();
    const frame = (await screen.findByTitle(
      "login.wecomQr",
    )) as HTMLIFrameElement;
    const payload =
      "https://workspace.example/api/auth/oauth/callback?state=state-one&code=test";
    const send = (origin: string, source: MessageEventSource | null) =>
      fireEvent(
        window,
        new MessageEvent("message", { origin, source, data: payload }),
      );

    send("https://untrusted.example", frame.contentWindow);
    send(wecomQr.WECOM_QR_ORIGIN, window);
    send(wecomQr.WECOM_QR_ORIGIN, null);
    expect(validate).not.toHaveBeenCalled();

    send(wecomQr.WECOM_QR_ORIGIN, frame.contentWindow);
    expect(validate).toHaveBeenCalledExactlyOnceWith(
      payload,
      expect.objectContaining({ state: "state-one" }),
    );

    const source = frame.contentWindow;
    view.unmount();
    validate.mockClear();
    send(wecomQr.WECOM_QR_ORIGIN, source);
    expect(validate).not.toHaveBeenCalled();
  });

  it("cancels pending QR authorization when switching to account login", async () => {
    let resolve!: (value: { authorization_url: string }) => void;
    mocks.startOauth.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const user = userEvent.setup();
    renderLogin();
    await screen.findByRole("tab", { name: "login.accountLogin" });
    await waitFor(() => expect(mocks.startOauth).toHaveBeenCalledOnce());
    const signal = mocks.startOauth.mock.calls[0][2] as AbortSignal;

    await user.click(screen.getByRole("tab", { name: "login.accountLogin" }));
    expect(signal.aborted).toBe(true);
    await act(async () =>
      resolve({ authorization_url: authorizationUrl("late") }),
    );

    expect(screen.queryByTitle("login.wecomQr")).toBeNull();
    expect(screen.getByPlaceholderText("login.username")).toBeInTheDocument();
  });

  it("allows retry and account login when QR authorization fails", async () => {
    mocks.startOauth.mockRejectedValueOnce(new Error("unavailable"));
    const user = userEvent.setup();
    renderLogin();

    expect(await screen.findByRole("alert")).toHaveTextContent("unavailable");
    await user.click(screen.getByRole("button", { name: "login.refreshQr" }));
    await screen.findByTitle("login.wecomQr");
    await user.click(screen.getByRole("tab", { name: "login.accountLogin" }));
    expect(screen.getByPlaceholderText("login.username")).toBeInTheDocument();
  });

  it("falls back to the existing account form when WeCom is not enabled", async () => {
    mocks.getOauthStatus.mockResolvedValue({
      providers: [{ kind: "wecom", display_name: "WeCom", enabled: false }],
    });
    renderLogin();

    await screen.findByPlaceholderText("login.username");
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByTitle("login.wecomQr")).toBeNull();
    expect(mocks.startOauth).not.toHaveBeenCalled();
  });

  it("keeps account login available when provider status is unreachable", async () => {
    mocks.getOauthStatus.mockRejectedValue(new Error("offline"));
    renderLogin();

    await screen.findByPlaceholderText("login.username");
    expect(screen.queryByTitle("login.wecomQr")).toBeNull();
    expect(mocks.startOauth).not.toHaveBeenCalled();
  });

  it("keeps account login available when the setup probe fails", async () => {
    mocks.getAuthStatus.mockRejectedValue(new Error("offline"));
    renderLogin();
    await screen.findByPlaceholderText("login.username");
    expect(mocks.startOauth).not.toHaveBeenCalled();
  });
});
