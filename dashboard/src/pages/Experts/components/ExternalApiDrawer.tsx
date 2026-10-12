import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Button,
  Drawer,
  Input,
  Popconfirm,
  Spin,
  Switch,
  Tooltip,
} from "antd";
import { Copy, RefreshCw } from "lucide-react";
import { getApiUrl } from "../../../api/config";
import {
  externalApi,
  type ExternalApiConfig,
} from "../../../api/modules/externalApi";
import { apiErrorMessage } from "../../../utils/apiError";
import { copyText } from "../../../utils/copyText";
import { message } from "../../../utils/antdMessage";
import styles from "./ExternalApiDrawer.module.less";

interface ExternalApiDrawerProps {
  agentId: string;
  agentName: string;
  open: boolean;
  onClose: () => void;
}

function ExternalApiSettings({
  agentId,
  agentName,
  onSavingChange,
}: Pick<ExternalApiDrawerProps, "agentId" | "agentName"> & {
  onSavingChange: (saving: boolean) => void;
}) {
  const { t } = useTranslation();
  const [config, setConfig] = useState<ExternalApiConfig | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const savingRef = useRef(false);
  const apiUrl = new URL(getApiUrl("/v1/expert-api"), window.location.href)
    .href;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    externalApi
      .getConfig(agentId)
      .then((result) => {
        if (!cancelled) setConfig(result);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(
            apiErrorMessage(err, t("experts.externalApi.loadFailed"), t),
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, attempt, t]);

  async function configure(enabled: boolean, rotate?: boolean) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    onSavingChange(true);
    setError(null);
    try {
      const result = await externalApi.configure(agentId, {
        enabled,
        ...(rotate ? { rotate: true } : {}),
      });
      const { api_key, ...settings } = result;
      setConfig(settings);
      setApiKey(api_key ?? null);
    } catch (err) {
      setError(apiErrorMessage(err, t("experts.externalApi.saveFailed"), t));
    } finally {
      savingRef.current = false;
      setSaving(false);
      onSavingChange(false);
    }
  }

  async function copy(value: string) {
    if (await copyText(value)) message.success(t("common.copied"));
    else message.error(t("common.copyFailed"));
  }

  if (loading)
    return (
      <div className={styles.loading}>
        <Spin />
      </div>
    );

  return (
    <div className={styles.settings}>
      <div className={styles.expert}>
        <strong>{agentName}</strong>
        <span>{agentId}</span>
      </div>
      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          action={
            !config ? (
              <Button onClick={() => setAttempt((value) => value + 1)}>
                {t("common.retry")}
              </Button>
            ) : undefined
          }
        />
      )}
      {config && (
        <>
          <div className={styles.toggleRow}>
            <span id={`external-api-enabled-${agentId}`}>
              {t("experts.externalApi.enabled")}
            </span>
            <Switch
              aria-labelledby={`external-api-enabled-${agentId}`}
              checked={config.enabled}
              loading={saving}
              onChange={(checked) => void configure(checked)}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor={`external-api-key-${agentId}`}>API Key</label>
            <div className={styles.valueRow}>
              <Input
                id={`external-api-key-${agentId}`}
                readOnly
                autoComplete="off"
                value={
                  apiKey ?? (config.key_prefix ? `${config.key_prefix}...` : "")
                }
                placeholder={t("experts.externalApi.noKey")}
              />
              {apiKey && (
                <Tooltip title={t("experts.externalApi.copyKey")}>
                  <Button
                    icon={<Copy size={16} />}
                    aria-label={t("experts.externalApi.copyKey")}
                    onClick={() => void copy(apiKey)}
                  />
                </Tooltip>
              )}
            </div>
            {apiKey && (
              <Alert
                type="warning"
                showIcon
                message={t("experts.externalApi.keyOnce")}
              />
            )}
            <Popconfirm
              title={t("experts.externalApi.rotateConfirm")}
              description={t("experts.externalApi.rotateWarning")}
              onConfirm={() => configure(true, true)}
              okText={t("common.confirm")}
              cancelText={t("common.cancel")}
              disabled={!config.enabled || saving}
            >
              <Button
                icon={<RefreshCw size={14} />}
                disabled={!config.enabled || saving}
              >
                {t("experts.externalApi.rotate")}
              </Button>
            </Popconfirm>
          </div>
          <div className={styles.field}>
            <label htmlFor={`external-api-url-${agentId}`}>
              {t("experts.externalApi.address")}
            </label>
            <div className={styles.valueRow}>
              <Input
                id={`external-api-url-${agentId}`}
                readOnly
                value={apiUrl}
              />
              <Tooltip title={t("experts.externalApi.copyAddress")}>
                <Button
                  icon={<Copy size={16} />}
                  aria-label={t("experts.externalApi.copyAddress")}
                  onClick={() => void copy(apiUrl)}
                />
              </Tooltip>
            </div>
          </div>
          <div className={styles.field}>
            <span>{t("experts.externalApi.authorization")}</span>
            <code>Authorization: Bearer &lt;api-key&gt;</code>
          </div>
          <dl className={styles.endpoints}>
            {[
              ["createSession", "POST", "/sessions"],
              ["sendMessage", "POST", "/sessions/{session_id}/messages"],
              ["getTask", "GET", "/tasks/{task_id}"],
            ].map(([label, method, path]) => (
              <div key={label}>
                <dt>{t(`experts.externalApi.${label}`)}</dt>
                <dd>
                  <strong>{method}</strong>
                  <code>{path}</code>
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </div>
  );
}

export default function ExternalApiDrawer({
  agentId,
  agentName,
  open,
  onClose,
}: ExternalApiDrawerProps) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  return (
    <Drawer
      title={t("experts.externalApi.title")}
      open={open}
      width="min(520px, 100vw)"
      onClose={() => {
        if (!saving) onClose();
      }}
      closable={!saving}
      maskClosable={!saving}
      keyboard={!saving}
      destroyOnHidden
    >
      {/* Unmount immediately on close so one-time keys cannot survive reopening. */}
      {open && (
        <ExternalApiSettings
          key={agentId}
          agentId={agentId}
          agentName={agentName}
          onSavingChange={setSaving}
        />
      )}
    </Drawer>
  );
}
