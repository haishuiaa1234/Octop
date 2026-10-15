import { useEffect, useRef, useState } from "react";
import { Alert, Button, Spin, Tooltip } from "antd";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { createWWLoginPanel, type WWLoginInstance } from "@wecom/jssdk";
import { authApi } from "../../api/modules/auth";
import { apiErrorMessage } from "../../utils/apiError";
import { createWecomQrLogin, wecomQrCallback } from "./wecomQr";

export default function WecomQrLogin() {
  const { t, i18n } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let failed = false;
    let panel: WWLoginInstance | undefined;
    const controller = new AbortController();
    const onLoad = () => {
      if (!cancelled) setLoading(false);
    };
    const onError = () => {
      if (!cancelled) {
        failed = true;
        setLoading(false);
        setError(t("login.qrLoadFailed"));
      }
    };
    setLoading(true);
    setError(null);
    void authApi
      .startOauth("wecom", "/chat", controller.signal)
      .then(({ authorization_url }) => {
        if (cancelled || !panelRef.current) return;
        const login = createWecomQrLogin(authorization_url, i18n.language);
        panel = createWWLoginPanel({
          el: panelRef.current,
          params: login.params,
          onLoginSuccess: ({ code }) => {
            if (cancelled || failed) return;
            const callback = wecomQrCallback(code, login);
            if (callback) window.location.assign(callback);
          },
          onLoginFail: ({ errMsg }) => {
            if (cancelled) return;
            failed = true;
            setLoading(false);
            setError(errMsg || t("login.qrLoadFailed"));
          },
        });
        panel.el.title = t("login.wecomQr");
        panel.el.addEventListener("load", onLoad);
        panel.el.addEventListener("error", onError);
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
      if (panel) {
        panel.el.removeEventListener("load", onLoad);
        panel.el.removeEventListener("error", onError);
        panel.unmount();
      }
    };
  }, [refreshKey, i18n.language, t]);

  return (
    <div style={{ width: "100%" }}>
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 320,
          height: 380,
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {error && <Alert type="error" showIcon message={error} />}
        {loading && (
          <Spin
            aria-label={t("login.qrLoading")}
            style={{ position: "absolute" }}
          />
        )}
        <div
          ref={panelRef}
          style={{
            width: 320,
            height: 380,
            display: error ? "none" : "block",
            visibility: loading ? "hidden" : "visible",
          }}
        />
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
