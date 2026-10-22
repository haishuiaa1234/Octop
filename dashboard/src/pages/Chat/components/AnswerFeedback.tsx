import { useState } from "react";
import { Alert, Form, Input, Modal, Radio, Space } from "antd";
import { Pencil, ThumbsDown, ThumbsUp, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { message } from "../../../utils/antdMessage";
import { apiErrorMessage } from "../../../utils/apiError";
import {
  feedbackReasons,
  type FeedbackInput,
  type FeedbackRating,
} from "../../../api/modules/feedback";
import { useFeedback } from "../FeedbackContext";
import styles from "../index.module.less";

type Details = Pick<
  FeedbackInput,
  "reason" | "comment" | "correction" | "reference"
>;
const emptyDetails: Details = {
  reason: "",
  comment: "",
  correction: "",
  reference: "",
};

export default function AnswerFeedback({ messageId }: { messageId?: string }) {
  const feedback = useFeedback();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<FeedbackRating | null>(null);
  const [form] = Form.useForm<Details>();
  if (!feedback) return null;
  const item = messageId ? feedback.items[messageId] : undefined;
  const disabled = busy || feedback.loading || feedback.error || !messageId;
  const save = async (rating: FeedbackRating, details: Details) => {
    if (!messageId) return;
    setBusy(true);
    try {
      await feedback.save({
        message_id: messageId,
        rating,
        ...details,
        reason: rating === "helpful" ? "" : details.reason,
      });
      setEditing(null);
      message.success(t("feedback.saved"));
    } catch (err) {
      message.error(apiErrorMessage(err, t("feedback.saveFailed"), t));
    } finally {
      setBusy(false);
    }
  };
  const edit = (rating: FeedbackRating) => {
    form.setFieldsValue(
      item
        ? {
            reason: item.reason,
            comment: item.comment,
            correction: item.correction,
            reference: item.reference,
          }
        : emptyDetails,
    );
    setEditing(rating);
  };
  const withdraw = async () => {
    if (!messageId) return;
    setBusy(true);
    try {
      await feedback.remove(messageId);
      message.success(t("feedback.withdrawn"));
    } catch (err) {
      message.error(apiErrorMessage(err, t("feedback.saveFailed"), t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <span
        role="group"
        aria-label={t("feedback.title")}
        style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
      >
        <button
          type="button"
          className={`${styles.msgActionBtn} ${
            item?.rating === "helpful" ? styles.msgActionBtnActive : ""
          }`}
          disabled={disabled}
          aria-label={t("feedback.helpful")}
          title={t("feedback.helpful")}
          aria-pressed={item?.rating === "helpful"}
          onClick={() =>
            item?.rating === "helpful"
              ? edit("helpful")
              : void save("helpful", emptyDetails)
          }
        >
          <ThumbsUp size={14} />
        </button>
        <button
          type="button"
          className={`${styles.msgActionBtn} ${
            item?.rating === "unhelpful" ? styles.msgActionBtnActive : ""
          }`}
          disabled={disabled}
          aria-label={t("feedback.unhelpful")}
          title={t("feedback.unhelpful")}
          aria-pressed={item?.rating === "unhelpful"}
          onClick={() => edit("unhelpful")}
        >
          <ThumbsDown size={14} />
        </button>
        {item && (
          <>
            <button
              type="button"
              className={styles.msgActionBtn}
              disabled={disabled}
              aria-label={t("feedback.edit")}
              title={t("feedback.edit")}
              onClick={() => edit(item.rating)}
            >
              <Pencil size={13} />
            </button>
            <button
              type="button"
              className={styles.msgActionBtn}
              disabled={disabled}
              aria-label={t("feedback.withdraw")}
              title={t("feedback.withdraw")}
              onClick={() => void withdraw()}
            >
              <Undo2 size={13} />
            </button>
          </>
        )}
        {feedback.error && (
          <button
            type="button"
            className={styles.msgActionBtn}
            onClick={feedback.reload}
          >
            {t("feedback.retry")}
          </button>
        )}
        {!messageId && feedback.refreshAnswer && (
          <button
            type="button"
            className={styles.msgActionBtn}
            onClick={feedback.refreshAnswer}
          >
            {t("feedback.refreshAnswer")}
          </button>
        )}
      </span>
      <Modal
        title={t("feedback.title")}
        open={editing !== null}
        confirmLoading={busy}
        okText={t("feedback.submit")}
        cancelText={t("common.cancel")}
        onCancel={() => {
          if (!busy) setEditing(null);
        }}
        onOk={() => form.submit()}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) =>
            editing && void save(editing, { ...emptyDetails, ...values })
          }
        >
          {editing === "unhelpful" && (
            <Form.Item
              name="reason"
              label={t("feedback.reason")}
              rules={[
                { required: true, message: t("feedback.reasonRequired") },
              ]}
            >
              <Radio.Group>
                <Space direction="vertical">
                  {feedbackReasons.map((reason) => (
                    <Radio key={reason} value={reason}>
                      {t(`feedback.reasons.${reason}`)}
                    </Radio>
                  ))}
                </Space>
              </Radio.Group>
            </Form.Item>
          )}
          <Form.Item name="comment" label={t("feedback.comment")}>
            <Input.TextArea maxLength={4000} showCount rows={3} />
          </Form.Item>
          <Form.Item name="correction" label={t("feedback.correction")}>
            <Input.TextArea maxLength={4000} showCount rows={3} />
          </Form.Item>
          <Form.Item name="reference" label={t("feedback.reference")}>
            <Input.TextArea maxLength={4000} showCount rows={2} />
          </Form.Item>
        </Form>
        <Alert type="info" showIcon message={t("feedback.reviewNote")} />
      </Modal>
    </>
  );
}
