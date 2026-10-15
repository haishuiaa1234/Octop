import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "antd";
import { Plug } from "lucide-react";
import type { OctopAgent } from "../../../context/AgentContext";
import ExternalApiDrawer from "./ExternalApiDrawer";
import { isBridgeAgentId } from "../../../utils/remoteExpert";
import styles from "../index.module.less";

export interface ExternalApiButtonProps {
  agent: Pick<OctopAgent, "agent_id" | "name" | "is_owner" | "bridge">;
  buttonClassName?: string;
}

export default function ExternalApiButton({
  agent,
  buttonClassName = styles.agentCard2EditBtn,
}: ExternalApiButtonProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (
    agent.is_owner === false ||
    agent.bridge ||
    isBridgeAgentId(agent.agent_id)
  )
    return null;

  return (
    <>
      <Tooltip title={t("experts.externalApi.title")} mouseEnterDelay={0.5}>
        <button
          type="button"
          className={buttonClassName}
          aria-label={t("experts.externalApi.title")}
          onClick={() => setOpen(true)}
        >
          <Plug size={13} />
        </button>
      </Tooltip>
      <ExternalApiDrawer
        agentId={agent.agent_id}
        agentName={agent.name}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
