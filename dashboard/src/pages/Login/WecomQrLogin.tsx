import { useEffect, useRef, useState } from "react";
import { Alert, Button, Spin, Tooltip } from "antd";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { authApi } from "../../api/modules/auth";
import { apiErrorMessage } from "../../utils/apiError";
import {
  createWecomQrLogin,
  wecomQrCallback,
  WECOM_QR_ORIGIN,
  type WecomQrLogin as QrLogin,
} from "./wecomQr";

export default function WecomQrLogin() {
  const { t, i18n } = useTranslation();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [login, setLogin] = useState<QrLogin | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setLogin(null);
    setError(null);
    void authApi
      .startOauth("wecom", "/chat", controller.signal)
      .then(({ authorization_url }) => {
        if (!cancelled) {
          setLogin(createWecomQrLogin(authorization_url, i18n.language));
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(apiErrorMessage(err, t("login.oidcStartFailed"), t));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [refreshKey, i18n.language, t]);

  useEffect(() => {
    if (!login) return;
    const onMessage = (event: MessageEvent) => {
      if (
        event.origin !== WECOM_QR_ORIGIN ||
        !frameRef.current?.contentWindow ||
        event.source !== frameRef.current.contentWindow
      ) {
        return;
      }
      const callback = wecomQrCallback(event.data, login);
      if (callback) window.location.assign(callback);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [login]);

  return (
    <div style={{ width: "100%" }}>
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 300,
          height: 400,
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {error ? (
          <Alert type="error" showIcon message={error} />
        ) : (
          <>
            {loading && (
              <Spin
                aria-label={t("login.qrLoading")}
                style={{ position: "absolute" }}
              />
            )}
            {login && (
              <iframe
                key={login.src}
                ref={frameRef}
                src={login.src}
                title={t("login.wecomQr")}
                scrolling="no"
                onLoad={() => {
                  setLoading(false);
                  // Official QR SDK handshake: callback navigates the top-level page.
                  frameRef.current?.contentWindow?.postMessage(
                    "ask_usePostMessage",
                    WECOM_QR_ORIGIN,
                  );
                }}
                onError={() => {
                  setLoading(false);
                  setError(t("login.qrLoadFailed"));
                }}
                style={{
                  width: "100%",
                  height: 400,
                  border: 0,
                  background: "#fff",
                  visibility: loading ? "hidden" : "visible",
                }}
              />
            )}
          </>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "center", marginTop: 4 }}>
        <Tooltip title={t("login.refreshQr")}>
          <Button
            type="text"
            aria-label={t("login.refreshQr")}
            icon={<RefreshCw size={16} />}
            disabled={loading}
            onClick={() => setRefreshKey((key) => key + 1)}
            style={{ width: 44, height: 44 }}
          />
        </Tooltip>
      </div>
    </div>
  );
}
