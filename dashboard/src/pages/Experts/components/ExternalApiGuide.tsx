import { useTranslation } from "react-i18next";
import { Alert, Button, Collapse, Tooltip } from "antd";
import { Copy } from "lucide-react";
import { copyText } from "../../../utils/copyText";
import { message } from "../../../utils/antdMessage";
import { externalApiGuideExamples } from "./externalApiGuideExamples";
import styles from "./ExternalApiGuide.module.less";

function CodeExample({ title, code }: { title: string; code: string }) {
  const { t } = useTranslation();
  async function copy() {
    if (await copyText(code)) message.success(t("common.copied"));
    else message.error(t("common.copyFailed"));
  }
  return (
    <div className={styles.example}>
      <div className={styles.exampleHeader}>
        <span>{title}</span>
        <Tooltip title={t("experts.externalApi.guide.copyExample")}>
          <Button
            size="small"
            type="text"
            icon={<Copy size={14} />}
            aria-label={t("experts.externalApi.guide.copyExample")}
            onClick={() => void copy()}
          />
        </Tooltip>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

export default function ExternalApiGuide({
  apiUrl,
  agentId,
}: {
  apiUrl: string;
  agentId: string;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`experts.externalApi.guide.${key}`);
  const examples = externalApiGuideExamples(apiUrl, agentId, {
    message: tr("exampleMessage"),
    followup: tr("exampleFollowup"),
    result: tr("exampleResult"),
    executionError: tr("exampleExecutionError"),
    authError: tr("exampleAuthError"),
  });

  return (
    <div className={styles.guide}>
      <p>{tr("intro")}</p>
      <ul className={styles.rules}>
        {["prerequisites", "keyScope", "keySecurity"].map((key) => (
          <li key={key}>{tr(key)}</li>
        ))}
      </ul>
      <Alert type="warning" showIcon message={tr("restartWarning")} />
      <Collapse
        bordered={false}
        defaultActiveKey={["quickstart"]}
        items={[
          {
            key: "quickstart",
            label: tr("quickstart"),
            children: (
              <div className={styles.section}>
                <p>{tr("curlEnvironment")}</p>
                <h4>{tr("stepCreate")}</h4>
                <p>{tr("createHint")}</p>
                <CodeExample title="cURL (Bash)" code={examples.create} />
                <CodeExample title="HTTP 201" code={examples.session} />
                <h4>{tr("stepSubmit")}</h4>
                <p>{tr("submitHint")}</p>
                <CodeExample title="cURL (Bash)" code={examples.submit} />
                <CodeExample title="HTTP 202" code={examples.submitted} />
                <h4>{tr("stepPoll")}</h4>
                <p>{tr("pollHint")}</p>
                <CodeExample title="cURL (Bash)" code={examples.poll} />
                <CodeExample title="HTTP 200" code={examples.completed} />
              </div>
            ),
          },
          {
            key: "parameters",
            label: tr("parameters"),
            children: (
              <div className={styles.section}>
                <h4>{tr("headers")}</h4>
                <CodeExample
                  title={tr("requestHeaders")}
                  code={
                    "Authorization: Bearer <api-key>\nContent-Type: application/json"
                  }
                />
                <h4>
                  <code>POST /sessions</code>
                </h4>
                <p>{tr("sessionBody")}</p>
                <p>{tr("metadata")}</p>
                <h4>
                  <code>POST /sessions/&#123;session_id&#125;/messages</code>
                </h4>
                <div className={styles.tableScroll}>
                  <table>
                    <thead>
                      <tr>
                        <th>{tr("field")}</th>
                        <th>{tr("type")}</th>
                        <th>{tr("description")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ["message", "string", "messageField"],
                        ["request_id", "string | null", "requestIdField"],
                      ].map(([field, type, label]) => (
                        <tr key={field}>
                          <td>
                            <code>{field}</code>
                          </td>
                          <td>
                            <code>{type}</code>
                          </td>
                          <td>{tr(label)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p>{tr("idempotency")}</p>
                <h4>
                  <code>GET /tasks/&#123;task_id&#125;</code>
                </h4>
                <p>{tr("taskFields")}</p>
                <p>{tr("configuredPrompt")}</p>
              </div>
            ),
          },
          {
            key: "status",
            label: tr("status"),
            children: (
              <div className={styles.section}>
                <div className={styles.tableScroll}>
                  <table>
                    <thead>
                      <tr>
                        <th>{tr("statusField")}</th>
                        <th>{tr("action")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {["queued", "running", "completed", "failed"].map(
                        (status) => (
                          <tr key={status}>
                            <td>
                              <code>{status}</code>
                            </td>
                            <td>{tr(status)}</td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
                <p>{tr("pollingPolicy")}</p>
                <CodeExample title="HTTP 200" code={examples.failed} />
              </div>
            ),
          },
          {
            key: "conversation",
            label: tr("conversation"),
            children: (
              <div className={styles.section}>
                <p>{tr("continueSession")}</p>
                <CodeExample title="cURL (Bash)" code={examples.followup} />
                <ul className={styles.rules}>
                  {["newConversation", "retryRequest", "multipleExperts"].map(
                    (key) => (
                      <li key={key}>{tr(key)}</li>
                    ),
                  )}
                </ul>
              </div>
            ),
          },
          {
            key: "python",
            label: tr("python"),
            children: (
              <div className={styles.section}>
                <p>{tr("pythonEnvironment")}</p>
                <CodeExample title="Python 3" code={examples.python} />
              </div>
            ),
          },
          {
            key: "errors",
            label: tr("errors"),
            children: (
              <div className={styles.section}>
                <div className={styles.tableScroll}>
                  <table>
                    <thead>
                      <tr>
                        <th>HTTP</th>
                        <th>{tr("handling")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {["401", "403", "404", "422", "5xx"].map((code) => (
                        <tr key={code}>
                          <td>
                            <code>{code}</code>
                          </td>
                          <td>{tr(`error${code}`)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p>{tr("errorEnvelope")}</p>
                <CodeExample title="HTTP 401" code={examples.authError} />
                <p>{tr("validationEnvelope")}</p>
              </div>
            ),
          },
          {
            key: "limits",
            label: tr("limits"),
            children: (
              <ul className={styles.rules}>
                {["restartWarning", "noCallbacks", "resultStorage"].map(
                  (key) => (
                    <li key={key}>{tr(key)}</li>
                  ),
                )}
              </ul>
            ),
          },
        ]}
      />
    </div>
  );
}
