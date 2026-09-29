import { useEffect, useState } from "react";
import { Alert, Button, Space, Spin, Typography } from "antd";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import {
  websiteApi,
  WEBSITES_CHANGED,
  type WebsiteLink,
} from "../../api/modules/websites";
import styles from "./websites.module.less";
import { externalWebsiteTarget } from "./target";

export default function WebsiteView() {
  const { websiteId = "" } = useParams();
  const userId = useCurrentUser()?.id;
  const { t } = useTranslation();
  const [state, setState] = useState<{
    key: string;
    site?: WebsiteLink;
  }>();
  const key = `${userId}:${websiteId}`;
  useEffect(() => {
    let alive = true;
    let sequence = 0;
    const refresh = async () => {
      const current = ++sequence;
      try {
        const site = await websiteApi.get(websiteId);
        if (alive && current === sequence) setState({ key, site });
      } catch {
        if (alive && current === sequence) setState({ key });
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    window.addEventListener(WEBSITES_CHANGED, refresh);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener(WEBSITES_CHANGED, refresh);
    };
  }, [websiteId, key]);
  if (state?.key !== key)
    return (
      <div className={styles.center}>
        <Spin />
      </div>
    );
  const target =
    state.site && externalWebsiteTarget(state.site.url, window.location.origin);
  if (!state.site || !target)
    return (
      <div className={styles.center}>
        <Alert type="error" message={t("websites.unavailable")} />
      </div>
    );
  const site = state.site;
  const mixedContent =
    window.location.protocol === "https:" && target.protocol === "http:";
  return (
    <div className={styles.viewer}>
      <div className={styles.toolbar}>
        <Typography.Text strong ellipsis>
          {site.name}
        </Typography.Text>
        <Space>
          <Button href={site.url} target="_blank" rel="noopener noreferrer">
            {t("websites.openNew")}
          </Button>
        </Space>
      </div>
      {site.open_mode === "new_tab" || mixedContent ? (
        <div className={styles.center}>
          <Alert
            type="info"
            message={t(
              mixedContent ? "websites.mixedContent" : "websites.newTabHint",
            )}
          />
        </div>
      ) : (
        <>
          <div className={styles.hint}>{t("websites.embedHint")}</div>
          <iframe
            key={site.url}
            src={site.url}
            title={site.name}
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"
          />
        </>
      )}
    </div>
  );
}
