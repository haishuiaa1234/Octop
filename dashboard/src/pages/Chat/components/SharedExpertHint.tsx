import { useTranslation } from "react-i18next";
import { Tooltip } from "antd";
import type { OctopAgent } from "../../../context/AgentContext";
import { isSharedExpertViewer } from "../../../utils/sharedExpert";
import { isTeamAgent } from "../../../utils/teamAgent";
import styles from "../index.module.less";

/** Marks an agent the current user only has shared access to, naming the owner. */
export default function SharedExpertHint({ agent }: { agent: OctopAgent }) {
  const { t } = useTranslation();
  if (!isSharedExpertViewer(agent)) return null;
  const tip = t(
    isTeamAgent(agent) ? "chat.sharedTeam.banner" : "chat.sharedExpert.banner",
    {
      name: agent.owner_username || "—",
    },
  );
  return (
    <Tooltip title={tip} mouseEnterDelay={0.35}>
      <span
        className={styles.sharedExpertFlag}
        aria-label={tip}
        onClick={(event) => event.stopPropagation()}
      >
        {t("chat.sharedExpert.flag")}
      </span>
    </Tooltip>
  );
}
