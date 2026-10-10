import { iconForName } from "../../Experts/components/iconForName";
import type { ChatComposerAction } from "../../../api/modules/agentChat";
import styles from "../index.module.less";
import { contrastingTextColor, isHexColor } from "../../../utils/color";

interface ChatInputComposerActionsProps {
  actions: ChatComposerAction[];
  label: string;
  disabled?: boolean;
  onPrefill: (prompt: string) => void;
  onSend: (prompt: string) => void;
}

export default function ChatInputComposerActions({
  actions,
  label,
  disabled = false,
  onPrefill,
  onSend,
}: ChatInputComposerActionsProps) {
  if (actions.length === 0) return null;

  return (
    <div className={styles.composerActions} role="group" aria-label={label}>
      {actions.map((action, index) => {
        const color = isHexColor(action.color) ? action.color : undefined;
        return (
          <button
            key={`${action.title}-${index}`}
            type="button"
            className={styles.composerActionButton}
            data-colored={Boolean(color)}
            style={
              color
                ? {
                    backgroundColor: color,
                    borderColor: color,
                    color: contrastingTextColor(color),
                  }
                : undefined
            }
            aria-label={action.title}
            title={action.title}
            disabled={disabled}
            onClick={() =>
              action.behavior === "send"
                ? onSend(action.prompt)
                : onPrefill(action.prompt)
            }
          >
            {action.icon_name && (
              <span className={styles.composerActionIcon} aria-hidden="true">
                {iconForName(action.icon_name, 15)}
              </span>
            )}
            <span>{action.title}</span>
          </button>
        );
      })}
    </div>
  );
}
