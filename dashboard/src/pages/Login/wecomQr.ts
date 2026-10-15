import {
  WWLoginLangType,
  WWLoginPanelSizeType,
  WWLoginRedirectType,
  WWLoginType,
  type WWLoginParams,
} from "@wecom/jssdk";

export interface WecomQrLogin {
  params: WWLoginParams;
  redirectUri: string;
  state: string;
}

export function createWecomQrLogin(
  authorizationUrl: string,
  language: string,
): WecomQrLogin {
  const authorization = new URL(authorizationUrl);
  const params = authorization.searchParams;
  const appid = params.get("appid");
  const agentid = params.get("agentid");
  const redirectUri = params.get("redirect_uri");
  const state = params.get("state");
  if (
    authorization.origin !== "https://login.work.weixin.qq.com" ||
    authorization.pathname !== "/wwlogin/sso/login" ||
    params.get("login_type") !== "CorpApp" ||
    !appid ||
    !agentid ||
    !redirectUri ||
    !state
  ) {
    throw new Error("Invalid WeCom authorization URL");
  }
  const callback = new URL(redirectUri);
  if (
    !["https:", "http:"].includes(callback.protocol) ||
    callback.username ||
    callback.password ||
    callback.hash
  ) {
    throw new Error("Invalid WeCom callback URL");
  }
  return {
    params: {
      login_type: WWLoginType.corpApp,
      appid,
      agentid,
      redirect_uri: redirectUri,
      state,
      redirect_type: WWLoginRedirectType.callback,
      panel_size: WWLoginPanelSizeType.small,
      lang: language.startsWith("zh") ? WWLoginLangType.zh : WWLoginLangType.en,
    },
    redirectUri,
    state,
  };
}

export function wecomQrCallback(
  code: unknown,
  login: WecomQrLogin,
): string | null {
  if (typeof code !== "string" || !code) return null;
  const callback = new URL(login.redirectUri);
  callback.searchParams.set("code", code);
  callback.searchParams.set("state", login.state);
  return callback.href;
}
