import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Form,
  Input,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from "antd";
import { Download, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import PageShell from "../../../layouts/PageShell";
import {
  feedbackApi,
  feedbackReasons,
  type Feedback,
  type FeedbackFilters,
  type FeedbackPage as Page,
} from "../../../api/modules/feedback";
import { useServerTimezone } from "../../../hooks/useServerTimezone";
import { formatServerDateTime } from "../../../utils/formatMessageTime";
import { apiErrorMessage } from "../../../utils/apiError";
import { message } from "../../../utils/antdMessage";
import { feedbackDateRange } from "./filters";

interface FilterValues extends FeedbackFilters {
  start?: string;
  end?: string;
}
const emptyPage: Page = { items: [], total: 0, helpful: 0, unhelpful: 0 };

export default function FeedbackPage() {
  const { t } = useTranslation();
  const zone = useServerTimezone();
  const [form] = Form.useForm<FilterValues>();
  const [filters, setFilters] = useState<FeedbackFilters>({});
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<Page>(emptyPage);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [detail, setDetail] = useState<Feedback | null>(null);
  const pageSize = 20;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    feedbackApi
      .adminList(filters, (page - 1) * pageSize, pageSize)
      .then((value) => {
        if (active) setData(value);
      })
      .catch(() => {
        if (active) {
          setError(true);
          setData(emptyPage);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [filters, page, revision]);

  const search = (values: FilterValues) => {
    try {
      const dates = feedbackDateRange(values.start, values.end, zone);
      setFilters({
        agent_id: values.agent_id?.trim() || undefined,
        rating: values.rating,
        reason: values.reason,
        ...dates,
      });
      setPage(1);
    } catch {
      message.error(t("feedback.invalidRange"));
    }
  };
  const download = async () => {
    setExporting(true);
    try {
      const blob = await feedbackApi.export(filters);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "answer-feedback.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      message.error(apiErrorMessage(err, t("feedback.exportFailed"), t));
    } finally {
      setExporting(false);
    }
  };

  return (
    <PageShell
      title={t("feedback.adminTitle")}
      subtitle={t("feedback.adminSubtitle")}
      actions={
        <Space>
          <Button
            icon={<RefreshCw size={15} />}
            onClick={() => setRevision((value) => value + 1)}
            disabled={loading}
          >
            {t("feedback.refresh")}
          </Button>
          <Button
            icon={<Download size={15} />}
            loading={exporting}
            disabled={loading || error}
            onClick={() => void download()}
          >
            {t("feedback.export")}
          </Button>
        </Space>
      }
    >
      <Form
        form={form}
        layout="inline"
        onFinish={search}
        style={{ gap: 12, marginBottom: 20 }}
      >
        <Form.Item name="agent_id" label={t("feedback.agent")}>
          <Input
            placeholder={t("feedback.agentPlaceholder")}
            allowClear
            style={{ width: 210 }}
          />
        </Form.Item>
        <Form.Item name="rating" label={t("feedback.rating")}>
          <Select
            allowClear
            style={{ width: 130 }}
            options={["helpful", "unhelpful"].map((value) => ({
              value,
              label: t(`feedback.${value}`),
            }))}
          />
        </Form.Item>
        <Form.Item name="reason" label={t("feedback.reason")}>
          <Select
            allowClear
            style={{ width: 170 }}
            options={feedbackReasons.map((value) => ({
              value,
              label: t(`feedback.reasons.${value}`),
            }))}
          />
        </Form.Item>
        <Form.Item name="start" label={t("feedback.startDate")}>
          <Input type="date" />
        </Form.Item>
        <Form.Item name="end" label={t("feedback.endDate")}>
          <Input type="date" />
        </Form.Item>
        <Space>
          <Button htmlType="submit" type="primary">
            {t("feedback.search")}
          </Button>
          <Button
            onClick={() => {
              form.resetFields();
              setFilters({});
              setPage(1);
            }}
          >
            {t("feedback.reset")}
          </Button>
        </Space>
      </Form>
      <Typography.Paragraph type="secondary">
        {t("feedback.timezone", { timezone: zone })}
      </Typography.Paragraph>
      {error && (
        <Alert
          type="error"
          showIcon
          message={t("feedback.loadFailed")}
          action={
            <Button onClick={() => setRevision((value) => value + 1)}>
              {t("feedback.retry")}
            </Button>
          }
        />
      )}
      <Space size="large" wrap style={{ marginBottom: 20 }}>
        <Statistic title={t("feedback.total")} value={data.total} />
        <Statistic title={t("feedback.helpful")} value={data.helpful} />
        <Statistic title={t("feedback.unhelpful")} value={data.unhelpful} />
      </Space>
      <Table<Feedback>
        rowKey="feedback_id"
        dataSource={data.items}
        loading={loading}
        scroll={{ x: 1000 }}
        pagination={{
          current: page,
          pageSize,
          total: data.total,
          showSizeChanger: false,
          onChange: setPage,
        }}
        columns={[
          {
            title: t("feedback.agent"),
            dataIndex: "agent_name",
            width: 180,
            render: (_, row) => (
              <>
                <div>{row.agent_name}</div>
                <Typography.Text type="secondary" copyable>
                  {row.agent_id}
                </Typography.Text>
                <br />
                <Button
                  size="small"
                  type="link"
                  onClick={() => {
                    form.setFieldValue("agent_id", row.agent_id);
                    form.submit();
                  }}
                >
                  {t("feedback.filterAgent")}
                </Button>
              </>
            ),
          },
          {
            title: t("feedback.rating"),
            dataIndex: "rating",
            width: 120,
            render: (rating: string) => (
              <Tag color={rating === "helpful" ? "green" : "orange"}>
                {t(`feedback.${rating}`)}
              </Tag>
            ),
          },
          {
            title: t("feedback.reason"),
            dataIndex: "reason",
            width: 150,
            render: (reason: string) =>
              reason ? t(`feedback.reasons.${reason}`) : "—",
          },
          {
            title: t("feedback.question"),
            dataIndex: "question",
            ellipsis: true,
          },
          { title: t("feedback.user"), dataIndex: "user_id", width: 90 },
          {
            title: t("feedback.updatedAt"),
            dataIndex: "updated_at",
            width: 190,
            render: (value: number) => formatServerDateTime(value, zone),
          },
          {
            title: t("feedback.details"),
            key: "details",
            width: 90,
            render: (_, row) => (
              <Button type="link" onClick={() => setDetail(row)}>
                {t("feedback.details")}
              </Button>
            ),
          },
        ]}
      />
      <Drawer
        title={t("feedback.details")}
        open={detail !== null}
        onClose={() => setDetail(null)}
        width={720}
      >
        {detail && (
          <>
            <Descriptions
              column={1}
              size="small"
              items={[
                {
                  key: "expert",
                  label: t("feedback.agent"),
                  children: `${detail.agent_name} (${detail.agent_id})`,
                },
                {
                  key: "user",
                  label: t("feedback.user"),
                  children: detail.user_id,
                },
                {
                  key: "thread",
                  label: t("feedback.thread"),
                  children: detail.thread_id,
                },
                {
                  key: "answer",
                  label: t("feedback.answerId"),
                  children: detail.message_id,
                },
                {
                  key: "rating",
                  label: t("feedback.rating"),
                  children: t(`feedback.${detail.rating}`),
                },
                {
                  key: "reason",
                  label: t("feedback.reason"),
                  children: detail.reason
                    ? t(`feedback.reasons.${detail.reason}`)
                    : "—",
                },
                {
                  key: "created",
                  label: t("feedback.createdAt"),
                  children: formatServerDateTime(detail.created_at, zone),
                },
                {
                  key: "updated",
                  label: t("feedback.updatedAt"),
                  children: formatServerDateTime(detail.updated_at, zone),
                },
              ]}
            />
            {(
              [
                "question",
                "answer",
                "comment",
                "correction",
                "reference",
              ] as const
            ).map((key) => (
              <section key={key}>
                <Typography.Title level={5}>
                  {t(`feedback.${key}`)}
                </Typography.Title>
                <Typography.Paragraph
                  style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                >
                  {detail[key] || "—"}
                </Typography.Paragraph>
              </section>
            ))}
          </>
        )}
      </Drawer>
    </PageShell>
  );
}
