import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { websiteApi, type WebsiteLink } from "../../api/modules/websites";
import { externalWebsiteTarget } from "./target";

interface ReadyMessage {
  type: "octop.sso.ready";
  state: string;
  code_challenge: string;
}

function isReadyMessage(value: unknown): value is ReadyMessage {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return (
    data.type === "octop.sso.ready" &&
    typeof data.state === "string" &&
    /^[A-Za-z0-9_-]{32,128}$/.test(data.state) &&
    typeof data.code_challenge === "string" &&
    /^[A-Za-z0-9_-]{43}$/.test(data.code_challenge)
  );
}

export function useWebsiteSso(
  site: WebsiteLink | undefined,
  frame: RefObject<HTMLIFrameElement>,
  scopeKey: string,
) {
  const [failed, setFailed] = useState(false);
  const controls = useRef<{
    openNew: () => void;
    hello: () => void;
    retry: () => void;
  }>();
  const id = site?.website_id;
  const url = site?.url;
  const mode = site?.auth_mode;
  const callback = site?.sso_callback_url;

  useEffect(() => {
    setFailed(false);
    controls.current = undefined;
    if (!id || !url || mode !== "octop" || !callback) return;
    const target = externalWebsiteTarget(url, window.location.origin);
    const destination = externalWebsiteTarget(callback, window.location.origin);
    if (!target || !destination || target.origin !== destination.origin) {
      setFailed(true);
      return;
    }
    let active = true;
    const popups = new Map<Window, { interval: number }>();
    let requests = new WeakMap<Window, Set<string>>();
    const isCurrent = (source: Window) =>
      active && (source === frame.current?.contentWindow || popups.has(source));
    const hello = (source: Window | null) => {
      source?.postMessage({ type: "octop.sso.hello" }, target.origin);
    };
    const forgetPopup = (popup: Window) => {
      const timers = popups.get(popup);
      if (timers) {
        window.clearInterval(timers.interval);
      }
      popups.delete(popup);
    };
    const receive = async (event: MessageEvent<unknown>) => {
      if (event.origin !== target.origin || !isReadyMessage(event.data)) return;
      const source = event.source as Window | null;
      if (!source || !isCurrent(source)) return;
      const message = event.data;
      const attempted = requests.get(source) ?? new Set<string>();
      if (attempted.has(message.state)) return;
      attempted.add(message.state);
      requests.set(source, attempted);
      try {
        const result = await websiteApi.issueSsoCode(id, {
          state: message.state,
          code_challenge: message.code_challenge,
        });
        if (!isCurrent(source)) return;
        if (
          result.state !== message.state ||
          new URL(result.callback_url).href !== destination.href
        )
          throw new Error("SSO response does not match the registered request");
        source.postMessage(
          {
            type: "octop.sso.code",
            code: result.code,
            state: result.state,
            callback_url: result.callback_url,
          },
          target.origin,
        );
        setFailed(false);
      } catch {
        attempted.delete(message.state);
        if (isCurrent(source)) setFailed(true);
      }
    };
    window.addEventListener("message", receive);
    controls.current = {
      hello: () => hello(frame.current?.contentWindow ?? null),
      retry: () => {
        setFailed(false);
        requests = new WeakMap();
        hello(frame.current?.contentWindow ?? null);
        for (const popup of popups.keys()) hello(popup);
      },
      openNew: () => {
        const popup = window.open("about:blank", "_blank");
        if (!popup) {
          setFailed(true);
          return;
        }
        // Keep a messaging handle without giving the application an opener.
        popup.opener = null;
        // Callback reloads lose the app's opener; discovery must survive login.
        const interval = window.setInterval(() => {
          if (popup.closed) forgetPopup(popup);
          else hello(popup);
        }, 500);
        popups.set(popup, { interval });
        popup.location.replace(target.href);
        setFailed(false);
      },
    };
    return () => {
      active = false;
      controls.current = undefined;
      window.removeEventListener("message", receive);
      for (const popup of popups.keys()) forgetPopup(popup);
    };
  }, [id, url, mode, callback, frame, scopeKey]);

  return {
    failed,
    openNew: useCallback(() => controls.current?.openNew(), []),
    hello: useCallback(() => controls.current?.hello(), []),
    retry: useCallback(() => controls.current?.retry(), []),
  };
}
