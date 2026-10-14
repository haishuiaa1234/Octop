import { describe, expect, it } from "vitest";
import { createWecomQrLogin, wecomQrCallback } from "./wecomQr";

const redirectUri = "https://workspace.example/api/auth/oauth/callback";
const authorizationUrl = `https://login.work.weixin.qq.com/wwlogin/sso/login?${new URLSearchParams(
  {
    login_type: "CorpApp",
    appid: "corp",
    agentid: "100001",
    redirect_uri: redirectUri,
    state: "server-state",
  },
)}`;

describe("WeCom QR URL and callback contract", () => {
  it("uses the official QR-only iframe with the server callback and state", () => {
    const login = createWecomQrLogin(authorizationUrl, "en-US");
    const url = new URL(login.src);
    expect(url.origin).toBe("https://open.work.weixin.qq.com");
    expect(url.pathname).toBe("/wwopen/sso/qrConnect");
    expect(url.searchParams.get("login_type")).toBe("jssdk");
    expect(url.searchParams.get("version")).toBe("1.2.4");
    expect(url.searchParams.get("lang")).toBe("en");
    expect(url.searchParams.get("redirect_uri")).toBe(redirectUri);
    expect(login.state).toBe("server-state");
  });

  it("only accepts the expected callback with its original state", () => {
    const login = createWecomQrLogin(authorizationUrl, "zh");
    const callback = `${redirectUri}?code=wecom-code&state=server-state`;
    expect(wecomQrCallback(callback, login)).toBe(callback);
    expect(wecomQrCallback(`${redirectUri}?state=server-state`, login)).toBe(
      `${redirectUri}?state=server-state`,
    );
  });

  it.each([
    "https://evil.example/api/auth/oauth/callback?code=x&state=server-state",
    "https://workspace.example/other?code=x&state=server-state",
    `${redirectUri}?code=x&state=other-state`,
    `${redirectUri}?code=x`,
    `https://user:pass@workspace.example/api/auth/oauth/callback?state=server-state`,
    "javascript:alert(1)",
    "not a url",
    { code: "x", state: "server-state" },
  ])("rejects an unrelated or invalid callback: %s", (payload) => {
    expect(
      wecomQrCallback(payload, createWecomQrLogin(authorizationUrl, "zh")),
    ).toBeNull();
  });

  it.each([
    authorizationUrl.replace("login.work.weixin.qq.com", "evil.example"),
    authorizationUrl.replace("state=server-state", "state="),
    authorizationUrl.replace("agentid=100001", "agentid="),
  ])("rejects invalid authorization configuration", (url) => {
    expect(() => createWecomQrLogin(url, "zh")).toThrow();
  });
});
