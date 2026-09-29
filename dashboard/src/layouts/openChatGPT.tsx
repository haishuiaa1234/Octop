import { Button, Space } from "antd";
import type { TFunction } from "i18next";
import { modal } from "../utils/antdModal";

// Handled on the browser's computer, never by the Octop server.
export const CHATGPT_LAUNCH_URI = "octop-chatgpt://open";

export function openChatGPT(t: TFunction) {
  const launch = () => window.location.assign(CHATGPT_LAUNCH_URI);
  modal.info({
    title: t("chatgptLauncher.title"),
    content: (
      <>
        <p>{t("chatgptLauncher.help")}</p>
        <p>{t("chatgptLauncher.setup")}</p>
        <Space wrap>
          <Button onClick={launch}>{t("chatgptLauncher.retry")}</Button>
          <a
            href="https://chatgpt.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("chatgptLauncher.web")}
          </a>
        </Space>
      </>
    ),
    okText: t("common.close"),
  });
  // Keep this synchronous with the menu click for browser user activation.
  launch();
}
