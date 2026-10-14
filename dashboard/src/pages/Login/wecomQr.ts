export const WECOM_QR_ORIGIN = "https://open.work.weixin.qq.com";

export interface WecomQrLogin {
  src: string;
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
  const qr = new URL("/wwopen/sso/qrConnect", WECOM_QR_ORIGIN);
  qr.search = new URLSearchParams({
    login_type: "jssdk",
    appid,
    agentid,
    redirect_uri: redirectUri,
    state,
    lang: language.startsWith("zh") ? "zh" : "en",
    version: "1.2.4",
  }).toString();
  return { src: qr.href, redirectUri, state };
}

export function wecomQrCallback(
  payload: unknown,
  login: WecomQrLogin,
): string | null {
  if (typeof payload !== "string") return null;
  try {
    const callback = new URL(payload);
    const expected = new URL(login.redirectUri);
    if (
      !["https:", "http:"].includes(callback.protocol) ||
      callback.origin !== expected.origin ||
      callback.pathname !== expected.pathname ||
      callback.username ||
      callback.password ||
      callback.hash ||
      callback.searchParams.get("state") !== login.state
    ) {
      return null;
    }
    return callback.href;
  } catch {
    return null;
  }
}
