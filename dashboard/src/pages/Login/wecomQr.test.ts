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

describe("WeCom official login panel contract", () => {
  it("passes the server configuration to the full login panel, not the old QR endpoint", () => {
    const login = createWecomQrLogin(authorizationUrl, "en-US");
    expect(login.params).toEqual({
      login_type: "CorpApp",
      appid: "corp",
      agentid: "100001",
      redirect_uri: redirectUri,
      state: "server-state",
      redirect_type: "callback",
      panel_size: "small",
      lang: "en",
    });
    expect(createWecomQrLogin(authorizationUrl, "zh-CN").params.lang).toBe(
      "zh",
    );
  });

  it("returns the SDK code to the original backend callback with the server state", () => {
    const login = createWecomQrLogin(authorizationUrl, "zh");
    const callback = new URL(wecomQrCallback("wecom-code&state=evil", login)!);
    expect(callback.origin + callback.pathname).toBe(redirectUri);
    expect(callback.searchParams.get("code")).toBe("wecom-code&state=evil");
    expect(callback.searchParams.getAll("state")).toEqual(["server-state"]);
  });

  it.each(["", null, undefined, {}, 1])(
    "rejects an invalid SDK code: %s",
    (payload) => {
      expect(
        wecomQrCallback(payload, createWecomQrLogin(authorizationUrl, "zh")),
      ).toBeNull();
    },
  );

  it.each([
    authorizationUrl.replace("login.work.weixin.qq.com", "evil.example"),
    authorizationUrl.replace("/wwlogin/sso/login", "/other"),
    authorizationUrl.replace("state=server-state", "state="),
    authorizationUrl.replace("agentid=100001", "agentid="),
    authorizationUrl.replace("CorpApp", "ServiceApp"),
  ])("rejects invalid authorization configuration", (url) => {
    expect(() => createWecomQrLogin(url, "zh")).toThrow();
  });

  it.each([
    "javascript:alert(1)",
    "https://user:pass@workspace.example/callback",
    `${redirectUri}#fragment`,
  ])("rejects an unsafe configured callback: %s", (redirect) => {
    const url = new URL(authorizationUrl);
    url.searchParams.set("redirect_uri", redirect);
    expect(() => createWecomQrLogin(url.href, "zh")).toThrow();
  });
});
