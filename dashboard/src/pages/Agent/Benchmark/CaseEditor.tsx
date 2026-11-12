import { Alert, Form, Input, Modal, Select } from "antd";
import { useTranslation } from "react-i18next";
import type { CaseInput } from "../../../api/modules/benchmarks";

export const emptyCase: CaseInput = {
  title: "",
  question: "",
  context: "",
  reference_answer: "",
  rubric: "",
  match_mode: "manual",
  keywords: [],
  tags: [],
  split: "dev",
  status: "draft",
};
export default function CaseEditor({
  initial,
  onSave,
  onCancel,
  busy,
  error,
  readyOnly = false,
}: {
  initial: CaseInput;
  onSave: (value: CaseInput) => void;
  onCancel: () => void;
  busy: boolean;
  error?: string;
  readyOnly?: boolean;
}) {
  const { t } = useTranslation();
  const [form] = Form.useForm<CaseInput>();
  const status = Form.useWatch("status", form) ?? initial.status;
  return (
    <Modal
      open
      title={t("benchmark.editCase")}
      onCancel={onCancel}
      onOk={() => form.submit()}
      confirmLoading={busy}
      width={720}
    >
      {error && (
        <Alert type="error" message={error} style={{ marginBottom: 16 }} />
      )}
      <Form
        form={form}
        initialValues={initial}
        onFinish={onSave}
        layout="vertical"
      >
        {(
          [
            "title",
            "question",
            "context",
            "reference_answer",
            "rubric",
          ] as const
        ).map((name) => (
          <Form.Item
            key={name}
            name={name}
            label={t(`benchmark.${name}`)}
            rules={
              name === "title" || (name === "question" && status === "ready")
                ? [{ required: true, message: t("benchmark.required") }]
                : []
            }
          >
            {name === "title" ? <Input /> : <Input.TextArea rows={3} />}
          </Form.Item>
        ))}
        {(
          [
            ["match_mode", ["exact", "contains", "manual"]],
            ["split", ["train", "dev", "test"]],
            ["status", ["draft", "needs_info", "ready", "disabled"]],
          ] as const
        ).map(([name, values]) => (
          <Form.Item key={name} name={name} label={t(`benchmark.${name}`)}>
            <Select
              options={values
                .filter(
                  (value) =>
                    name !== "status" || !readyOnly || value === "ready",
                )
                .map((value) => ({
                  value,
                  label: t(`benchmark.${value}`),
                }))}
            />
          </Form.Item>
        ))}
        {(["keywords", "tags"] as const).map((name) => (
          <Form.Item key={name} name={name} label={t(`benchmark.${name}`)}>
            <Select mode="tags" tokenSeparators={[","]} />
          </Form.Item>
        ))}
      </Form>
    </Modal>
  );
}
