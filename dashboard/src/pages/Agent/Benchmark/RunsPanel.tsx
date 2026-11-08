import { useState } from "react";
import {
  Button,
  Descriptions,
  Drawer,
  Input,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import { useTranslation } from "react-i18next";
import type {
  BenchmarkResult,
  BenchmarkRun,
} from "../../../api/modules/benchmarks";
import { useServerTimezone } from "../../../hooks/useServerTimezone";
import { formatServerDateTime } from "../../../utils/formatMessageTime";
function Review({
  result,
  onReview,
  busy,
}: {
  result: BenchmarkResult;
  onReview: (passed: boolean, note: string) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState(result.note || "");
  return (
    <Space wrap>
      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t("benchmark.note")}
      />
      <Button disabled={busy} onClick={() => onReview(true, note)}>
        {t("benchmark.passed")}
      </Button>
      <Button danger disabled={busy} onClick={() => onReview(false, note)}>
        {t("benchmark.failed")}
      </Button>
    </Space>
  );
}
export default function RunsPanel({
  runs,
  detail,
  onOpen,
  onClose,
  onCancel,
  onReview,
  busy,
}: {
  runs: BenchmarkRun[];
  detail?: BenchmarkRun;
  onOpen: (id: string) => void;
  onClose: () => void;
  onCancel: (id: string) => void;
  onReview: (caseId: string, passed: boolean, note: string) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const timezone = useServerTimezone();
  return (
    <>
      <Table
        rowKey="run_id"
        dataSource={runs}
        scroll={{ x: 760 }}
        columns={[
          {
            title: t("benchmark.runName"),
            render: (_, r) => (
              <Button type="link" onClick={() => onOpen(r.run_id)}>
                {r.name}
              </Button>
            ),
          },
          {
            title: t("benchmark.status"),
            dataIndex: "status",
            render: (v: string) => t(`benchmark.${v}`),
          },
          {
            title: t("benchmark.progress"),
            render: (_, r) => `${r.completed}/${r.total}`,
          },
          ...(["passed", "failed", "errors", "needs_review"] as const).map(
            (key) => ({ title: t(`benchmark.${key}`), dataIndex: key }),
          ),
          {
            title: t("benchmark.createdAt"),
            render: (_, r) => formatServerDateTime(r.created_at, timezone),
          },
          {
            title: t("benchmark.actions"),
            render: (_, r) =>
              ["queued", "running"].includes(r.status) ? (
                <Button disabled={busy} onClick={() => onCancel(r.run_id)}>
                  {t("benchmark.cancel")}
                </Button>
              ) : null,
          },
        ]}
      />
      <Drawer
        open={!!detail}
        onClose={onClose}
        title={detail?.name}
        width="min(900px, 100vw)"
      >
        {detail && (
          <Space direction="vertical" style={{ width: "100%" }}>
            <Tag>{t("benchmark.textOnly")}</Tag>
            <Descriptions
              column={1}
              items={[
                {
                  key: "model",
                  label: t("benchmark.model"),
                  children: detail.config_snapshot.model_ref,
                },
                {
                  key: "hash",
                  label: t("benchmark.instructionHash"),
                  children: (
                    <Typography.Text style={{ overflowWrap: "anywhere" }}>
                      {detail.config_snapshot.instruction_hash}
                    </Typography.Text>
                  ),
                },
              ]}
            />
            {detail.results.map((r) => (
              <section
                key={r.case_id}
                style={{
                  borderTop: "1px solid #ddd",
                  paddingTop: 16,
                  width: "100%",
                }}
              >
                <Typography.Title level={5}>
                  {r.case_snapshot.title} · {t(`benchmark.${r.status}`)}
                </Typography.Title>
                <Descriptions
                  column={1}
                  items={[
                    {
                      key: "revision",
                      label: t("benchmark.revision"),
                      children: r.revision,
                    },
                    ...(
                      [
                        "question",
                        "context",
                        "reference_answer",
                        "rubric",
                      ] as const
                    ).map((key) => ({
                      key,
                      label: t(`benchmark.${key}`),
                      children: (
                        <span
                          style={{
                            whiteSpace: "pre-wrap",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {r.case_snapshot[key]}
                        </span>
                      ),
                    })),
                    {
                      key: "answer",
                      label: t("benchmark.answer"),
                      children: (
                        <span
                          style={{
                            whiteSpace: "pre-wrap",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {r.answer}
                        </span>
                      ),
                    },
                    {
                      key: "duration",
                      label: t("benchmark.duration"),
                      children: `${r.duration_ms} ms`,
                    },
                    {
                      key: "error",
                      label: t("benchmark.error"),
                      children: r.error,
                    },
                    {
                      key: "note",
                      label: t("benchmark.note"),
                      children: r.note,
                    },
                  ]}
                />
                {r.status === "needs_review" &&
                  detail.status !== "queued" &&
                  detail.status !== "running" && (
                    <Review
                      result={r}
                      busy={busy}
                      onReview={(passed, note) =>
                        onReview(r.case_id, passed, note)
                      }
                    />
                  )}
              </section>
            ))}
          </Space>
        )}
      </Drawer>
    </>
  );
}
