import {
  useState,
  useEffect,
  useCallback,
  useImperativeHandle,
  forwardRef,
  useMemo,
} from "react";
import { useTranslation } from "react-i18next";
import { Button, Input, Segmented } from "antd";
import { PlusOutlined, DeleteOutlined } from "@ant-design/icons";
import { agentChatApi } from "@/api/modules/agentChat";
import { iconForName } from "./iconForName";
import { pastelIconBackground } from "@/utils/pastelIconBackground";
import styles from "../index.module.less";
import type {
  ComposerAction,
  QuickPrompt,
  WelcomeConfigData,
  WelcomeManifestSnapshot,
  WelcomeManifestStatus,
} from "./welcomeManifest";
import {
  normalizeComposerActions,
  normalizeQuickPrompts,
} from "./welcomeManifest";

export type { QuickPrompt, WelcomeConfigData };

interface WelcomeConfigProps {
  /** When set, load cards from the live agent workspace. */
  agentId?: string;
  /** Create-drawer seed; ignored when agentId is set. */
  initialPrompts?: QuickPrompt[];
  initialActions?: ComposerAction[];
  disabled?: boolean;
}

const defaultQuickPrompt: QuickPrompt = {
  title: { zh: "", en: "" },
  description: { zh: "", en: "" },
  prompt: { zh: "", en: "" },
  color: "#e8f4ff",
  icon_name: null,
};

const defaultComposerAction: ComposerAction = {
  title: { zh: "", en: "" },
  prompt: { zh: "", en: "" },
  icon_name: null,
  behavior: "prefill",
};

const presetColors = [
  "#e8f4ff",
  "#eef2ff",
  "#f0fdf4",
  "#fff7ed",
  "#fef3c7",
  "#fdf2f8",
  "#faf5ff",
];

// 图标名必须来自 iconForName 的 iconMap，否则会全部回退成默认图标造成重复。
// 以下 16 个名字在 iconMap 中均存在且互不相同。
const presetIcons = [
  "file-text",
  "message-square",
  "globe",
  "sparkles",
  "pen-tool",
  "book-open",
  "zap",
  "bar-chart-3",
  "list-todo",
  "mail",
  "hard-drive",
  "palette",
  "activity",
  "video",
  "terminal",
  "wrench",
];

export interface WelcomeConfigRef {
  getSnapshot: () => WelcomeManifestSnapshot;
}

const WelcomeConfig = forwardRef<WelcomeConfigRef, WelcomeConfigProps>(
  ({ agentId, initialPrompts, initialActions, disabled = false }, ref) => {
    const { t, i18n } = useTranslation();
    const [status, setStatus] = useState<WelcomeManifestStatus>(() =>
      agentId ? "loading" : "ready",
    );
    const [dirty, setDirty] = useState(false);
    const [quickPrompts, setQuickPrompts] = useState<QuickPrompt[]>(() =>
      agentId ? [] : normalizeQuickPrompts(initialPrompts),
    );
    const [composerActions, setComposerActions] = useState<ComposerAction[]>(
      () => (agentId ? [] : normalizeComposerActions(initialActions)),
    );
    const currentLang = i18n.language.startsWith("zh") ? "zh" : "en";
    const markDirty = () => {
      if (!disabled) setDirty(true);
    };

    const snapshotData = useMemo(
      (): WelcomeConfigData => ({
        quick_prompts: quickPrompts,
        composer_actions: composerActions,
      }),
      [quickPrompts, composerActions],
    );

    useImperativeHandle(
      ref,
      () => ({
        getSnapshot: () => ({
          status,
          dirty,
          data: snapshotData,
        }),
      }),
      [status, dirty, snapshotData],
    );

    const loadConfig = useCallback(async () => {
      if (!agentId) {
        setStatus("ready");
        return;
      }
      setStatus("loading");
      setDirty(false);
      try {
        const data = await agentChatApi.welcome(agentId);
        setQuickPrompts(normalizeQuickPrompts(data.quick_prompts));
        setComposerActions(normalizeComposerActions(data.composer_actions));
        setStatus("ready");
      } catch {
        setQuickPrompts([]);
        setComposerActions([]);
        setStatus("error");
      }
    }, [agentId]);

    useEffect(() => {
      void loadConfig();
    }, [loadConfig]);

    useEffect(() => {
      if (agentId || dirty) return;
      setQuickPrompts(normalizeQuickPrompts(initialPrompts));
    }, [agentId, dirty, initialPrompts]);

    useEffect(() => {
      if (agentId || dirty) return;
      setComposerActions(normalizeComposerActions(initialActions));
    }, [agentId, dirty, initialActions]);

    const addQuickPrompt = () => {
      if (disabled) return;
      markDirty();
      setQuickPrompts([...quickPrompts, { ...defaultQuickPrompt }]);
    };

    const removeQuickPrompt = (index: number) => {
      if (disabled) return;
      markDirty();
      setQuickPrompts(quickPrompts.filter((_, i) => i !== index));
    };

    const updateQuickPrompt = (
      index: number,
      field: "color" | "icon_name",
      value: string | null,
    ) => {
      if (disabled) return;
      markDirty();
      const newPrompts = [...quickPrompts];
      newPrompts[index] = { ...newPrompts[index], [field]: value };
      setQuickPrompts(newPrompts);
    };

    const updateLocalizedField = (
      index: number,
      field: "title" | "description" | "prompt",
      lang: "zh" | "en",
      value: string,
    ) => {
      if (disabled) return;
      markDirty();
      const newPrompts = [...quickPrompts];
      const currentField = newPrompts[index][field];
      newPrompts[index] = {
        ...newPrompts[index],
        [field]: {
          zh: currentField?.zh ?? "",
          en: currentField?.en ?? "",
          [lang]: value,
        },
      };
      setQuickPrompts(newPrompts);
    };

    const addComposerAction = () => {
      if (disabled) return;
      markDirty();
      setComposerActions([...composerActions, { ...defaultComposerAction }]);
    };

    const removeComposerAction = (index: number) => {
      if (disabled) return;
      markDirty();
      setComposerActions((current) => current.filter((_, i) => i !== index));
    };

    const updateComposerAction = (
      index: number,
      field: "icon_name" | "behavior",
      value: string | null,
    ) => {
      if (disabled) return;
      markDirty();
      setComposerActions((current) =>
        current.map((action, i) =>
          i === index ? { ...action, [field]: value } : action,
        ),
      );
    };

    const updateComposerActionText = (
      index: number,
      field: "title" | "prompt",
      value: string,
    ) => {
      if (disabled) return;
      markDirty();
      setComposerActions((current) =>
        current.map((action, i) =>
          i === index
            ? {
                ...action,
                [field]: {
                  zh: action[field]?.zh ?? "",
                  en: action[field]?.en ?? "",
                  [currentLang]: value,
                },
              }
            : action,
        ),
      );
    };

    return (
      <div className={styles.welcomeConfig}>
        {status === "loading" ? (
          <div className={styles.welcomeConfigLoading}>
            {t("common.loading")}
          </div>
        ) : (
          <>
            <div className={styles.welcomeConfigSection}>
              <div className={styles.quickPromptsHeader}>
                <h4>{t("experts.quickPromptsTitle")}</h4>
                <Button
                  type="dashed"
                  icon={<PlusOutlined />}
                  disabled={disabled}
                  onClick={addQuickPrompt}
                >
                  {t("experts.addQuickPrompt")}
                </Button>
              </div>

              <div className={styles.quickPromptsList}>
                {quickPrompts.map((prompt, index) => (
                  <div key={index} className={styles.quickPromptItem}>
                    <div className={styles.quickPromptHeader}>
                      <span className={styles.quickPromptIndex}>
                        {index + 1}
                      </span>
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        disabled={disabled}
                        onClick={() => removeQuickPrompt(index)}
                      />
                    </div>

                    <div className={styles.quickPromptFields}>
                      <div className={styles.quickPromptRow}>
                        <div className={styles.quickPromptField}>
                          <label>{t("experts.quickPromptTitle")}</label>
                          <Input
                            value={prompt.title[currentLang]}
                            disabled={disabled}
                            onChange={(e) =>
                              updateLocalizedField(
                                index,
                                "title",
                                currentLang,
                                e.target.value,
                              )
                            }
                            placeholder={t(
                              "experts.quickPromptTitlePlaceholder",
                            )}
                          />
                        </div>
                        <div className={styles.quickPromptField}>
                          <label>{t("experts.quickPromptDescription")}</label>
                          <Input
                            value={prompt.description[currentLang]}
                            disabled={disabled}
                            onChange={(e) =>
                              updateLocalizedField(
                                index,
                                "description",
                                currentLang,
                                e.target.value,
                              )
                            }
                            placeholder={t(
                              "experts.quickPromptDescriptionPlaceholder",
                            )}
                          />
                        </div>
                      </div>

                      <div className={styles.quickPromptRow}>
                        <div className={styles.quickPromptFieldFull}>
                          <label>{t("experts.quickPromptContent")}</label>
                          <Input.TextArea
                            value={prompt.prompt[currentLang]}
                            disabled={disabled}
                            onChange={(e) =>
                              updateLocalizedField(
                                index,
                                "prompt",
                                currentLang,
                                e.target.value,
                              )
                            }
                            placeholder={t(
                              "experts.quickPromptContentPlaceholder",
                            )}
                            rows={2}
                          />
                        </div>
                      </div>

                      <div className={styles.quickPromptRow}>
                        <div className={styles.quickPromptField}>
                          <label>{t("experts.quickPromptColor")}</label>
                          <div className={styles.colorPicker}>
                            {presetColors.map((color) => (
                              <button
                                key={color}
                                type="button"
                                disabled={disabled}
                                className={
                                  styles.colorOption +
                                  (prompt.color === color
                                    ? " " + styles.colorOptionActive
                                    : "")
                                }
                                style={{ backgroundColor: color }}
                                onClick={() =>
                                  updateQuickPrompt(index, "color", color)
                                }
                              />
                            ))}
                          </div>
                        </div>
                        <div className={styles.quickPromptField}>
                          <label>{t("experts.quickPromptIcon")}</label>
                          <div className={styles.iconPicker}>
                            <button
                              type="button"
                              disabled={disabled}
                              className={
                                styles.iconOption +
                                " " +
                                styles.iconOptionNoIcon +
                                (!prompt.icon_name
                                  ? " " + styles.iconOptionActive
                                  : "")
                              }
                              onClick={() =>
                                updateQuickPrompt(index, "icon_name", null)
                              }
                            >
                              {t("experts.noIcon")}
                            </button>
                            {presetIcons.map((icon) => (
                              <button
                                key={icon}
                                type="button"
                                disabled={disabled}
                                className={
                                  styles.iconOption +
                                  (prompt.icon_name === icon
                                    ? " " + styles.iconOptionActive
                                    : "")
                                }
                                onClick={() =>
                                  updateQuickPrompt(index, "icon_name", icon)
                                }
                              >
                                {iconForName(icon, 16)}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      {quickPrompts.length > 0 && (
                        <div className={styles.quickPromptPreview}>
                          <div className={styles.quickPromptPreviewLabel}>
                            {t("experts.quickPromptPreview")}
                          </div>
                          <div className={styles.quickCardPreview}>
                            <div
                              className={styles.quickCardIcon}
                              style={{
                                background: pastelIconBackground(
                                  prompt.color,
                                  index,
                                ),
                                color: "rgba(15,23,42,0.55)",
                              }}
                            >
                              {iconForName(prompt.icon_name, 18)}
                            </div>
                            <div className={styles.quickCardBody}>
                              <span className={styles.quickCardTitle}>
                                {prompt.title[currentLang] ||
                                  t("experts.quickPromptTitlePlaceholder")}
                              </span>
                              <span className={styles.quickCardDesc}>
                                {prompt.description[currentLang] ||
                                  t(
                                    "experts.quickPromptDescriptionPlaceholder",
                                  )}
                              </span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {quickPrompts.length === 0 && (
                  <div className={styles.quickPromptsEmpty}>
                    {t("experts.noQuickPrompts")}
                  </div>
                )}
              </div>
            </div>

            <div className={styles.welcomeConfigSection}>
              <div className={styles.quickPromptsHeader}>
                <h4>{t("experts.composerActionsTitle")}</h4>
                <Button
                  type="dashed"
                  icon={<PlusOutlined />}
                  disabled={disabled}
                  onClick={addComposerAction}
                >
                  {t("experts.addComposerAction")}
                </Button>
              </div>
              <div className={styles.quickPromptsList}>
                {composerActions.map((action, index) => (
                  <div
                    key={index}
                    className={styles.quickPromptItem}
                    data-composer-action-index={index}
                  >
                    <div className={styles.quickPromptHeader}>
                      <span className={styles.quickPromptIndex}>
                        {index + 1}
                      </span>
                      <Button
                        type="text"
                        danger
                        aria-label={t("experts.removeComposerAction", {
                          number: index + 1,
                        })}
                        icon={<DeleteOutlined />}
                        disabled={disabled}
                        onClick={() => removeComposerAction(index)}
                      />
                    </div>
                    <div className={styles.quickPromptFields}>
                      <div className={styles.quickPromptFieldFull}>
                        <label>{t("experts.composerActionTitle")}</label>
                        <Input
                          value={action.title[currentLang]}
                          disabled={disabled}
                          onChange={(event) =>
                            updateComposerActionText(
                              index,
                              "title",
                              event.target.value,
                            )
                          }
                          placeholder={t(
                            "experts.composerActionTitlePlaceholder",
                          )}
                        />
                      </div>
                      <div className={styles.quickPromptFieldFull}>
                        <label>{t("experts.composerActionPrompt")}</label>
                        <Input.TextArea
                          value={action.prompt[currentLang]}
                          disabled={disabled}
                          onChange={(event) =>
                            updateComposerActionText(
                              index,
                              "prompt",
                              event.target.value,
                            )
                          }
                          placeholder={t(
                            "experts.composerActionPromptPlaceholder",
                          )}
                          rows={2}
                        />
                      </div>
                      <div className={styles.quickPromptFieldFull}>
                        <label>{t("experts.composerActionBehavior")}</label>
                        <Segmented
                          disabled={disabled}
                          value={action.behavior}
                          options={[
                            {
                              label: t("experts.composerActionPrefill"),
                              value: "prefill",
                            },
                            {
                              label: t("experts.composerActionSend"),
                              value: "send",
                            },
                          ]}
                          onChange={(value) =>
                            updateComposerAction(
                              index,
                              "behavior",
                              value as "prefill" | "send",
                            )
                          }
                        />
                      </div>
                      <div className={styles.quickPromptFieldFull}>
                        <label>{t("experts.quickPromptIcon")}</label>
                        <div className={styles.iconPicker}>
                          <button
                            type="button"
                            disabled={disabled}
                            aria-label={t("experts.noIcon")}
                            aria-pressed={!action.icon_name}
                            className={`${styles.iconOption} ${
                              styles.iconOptionNoIcon
                            }${
                              !action.icon_name
                                ? ` ${styles.iconOptionActive}`
                                : ""
                            }`}
                            onClick={() =>
                              updateComposerAction(index, "icon_name", null)
                            }
                          >
                            {t("experts.noIcon")}
                          </button>
                          {presetIcons.map((icon) => (
                            <button
                              key={icon}
                              type="button"
                              disabled={disabled}
                              aria-label={icon}
                              aria-pressed={action.icon_name === icon}
                              className={`${styles.iconOption}${
                                action.icon_name === icon
                                  ? ` ${styles.iconOptionActive}`
                                  : ""
                              }`}
                              onClick={() =>
                                updateComposerAction(index, "icon_name", icon)
                              }
                            >
                              {iconForName(icon, 16)}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                {composerActions.length === 0 && (
                  <div className={styles.quickPromptsEmpty}>
                    {t("experts.noComposerActions")}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    );
  },
);

WelcomeConfig.displayName = "WelcomeConfig";
export default WelcomeConfig;
