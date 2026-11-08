import { Alert, Button, Descriptions, List, Space, Typography } from "antd";
import { useTranslation } from "react-i18next";
import type { Candidate, CaseInput } from "../../../api/modules/benchmarks";
import { emptyCase } from "./CaseEditor";
export default function CandidatesPanel({
  items,
  onAccept,
  onIgnore,
  busy,
}: {
  items: Candidate[];
  onAccept: (id: string, draft: CaseInput) => void;
  onIgnore: (id: string) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      <Alert type="info" message={t("benchmark.ownFeedback")} />
      <List
        dataSource={items}
        renderItem={(item) => (
          <List.Item
            actions={
              item.status === "pending"
                ? [
                    <Button
                      key="accept"
                      disabled={busy}
                      onClick={() =>
                        onAccept(item.candidate_id, {
                          ...emptyCase,
                          title: item.snapshot.question?.slice(0, 80) || "",
                          question: item.snapshot.question || "",
                          reference_answer:
                            item.snapshot.correction ||
                            (item.snapshot.rating === "helpful"
                              ? item.snapshot.answer
                              : "") ||
                            "",
                        })
                      }
                    >
                      {t("benchmark.reviewDraft")}
                    </Button>,
                    <Button
                      key="ignore"
                      disabled={busy}
                      onClick={() => onIgnore(item.candidate_id)}
                    >
                      {t("benchmark.ignore")}
                    </Button>,
                  ]
                : [<span key="status">{t(`benchmark.${item.status}`)}</span>]
            }
          >
            <Descriptions
              column={1}
              style={{ width: "100%" }}
              items={(
                [
                  "question",
                  "answer",
                  "rating",
                  "reason",
                  "comment",
                  "correction",
                  "reference",
                ] as const
              ).map((key) => ({
                key,
                label: t(
                  `benchmark.${key === "answer" ? "sourceAnswer" : key}`,
                ),
                children: (
                  <Typography.Paragraph
                    style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                  >
                    {item.snapshot[key] || "—"}
                  </Typography.Paragraph>
                ),
              }))}
            />
          </List.Item>
        )}
      />
    </Space>
  );
}
