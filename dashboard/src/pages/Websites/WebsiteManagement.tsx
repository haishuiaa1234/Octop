import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import { useTranslation } from "react-i18next";
import {
  websiteApi,
  WEBSITES_CHANGED,
  type ManagedWebsite,
  type WebsiteInput,
  type WebsiteUser,
} from "../../api/modules/websites";
import styles from "./websites.module.less";
import { externalWebsiteTarget } from "./target";

const defaults: WebsiteInput = {
  name: "",
  url: "",
  enabled: true,
  visibility: "all",
  user_ids: [],
  sort_order: 0,
  open_mode: "embed",
};

export default function WebsiteManagement() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [sites, setSites] = useState<ManagedWebsite[]>([]);
  const [users, setUsers] = useState<WebsiteUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<ManagedWebsite>();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<WebsiteInput>();
  const visibility = Form.useWatch("visibility", form);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, people] = await Promise.all([
        websiteApi.manage(),
        websiteApi.users(),
      ]);
      setSites(rows);
      setUsers(people);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const edit = (site?: ManagedWebsite) => {
    setEditing(site);
    form.resetFields();
    form.setFieldsValue(site ?? defaults);
    setOpen(true);
  };
  const changed = async () => {
    window.dispatchEvent(new Event(WEBSITES_CHANGED));
    await load();
  };
  const save = async (input: WebsiteInput) => {
    setSaving(true);
    try {
      await websiteApi.save(
        {
          ...input,
          user_ids: input.visibility === "all" ? [] : input.user_ids,
        },
        editing?.website_id,
      );
      setOpen(false);
      message.success(t("websites.saved"));
      await changed();
    } catch {
      message.error(t("websites.saveFailed"));
    } finally {
      setSaving(false);
    }
  };
  const remove = async (site: ManagedWebsite) => {
    try {
      await websiteApi.remove(site.website_id);
      await changed();
    } catch {
      message.error(t("websites.saveFailed"));
    }
  };

  return (
    <div className={styles.management}>
      <div className={styles.toolbar}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          {t("websites.manage")}
        </Typography.Title>
        <Button type="primary" onClick={() => edit()}>
          {t("websites.add")}
        </Button>
      </div>
      <Alert
        type="info"
        showIcon
        message={t("websites.accessHint")}
        style={{ margin: "16px 0" }}
      />
      {failed && (
        <Alert
          type="error"
          message={t("websites.loadFailed")}
          action={
            <Button onClick={() => void load()}>{t("websites.retry")}</Button>
          }
        />
      )}
      <Table<ManagedWebsite>
        rowKey="website_id"
        dataSource={sites}
        loading={loading}
        scroll={{ x: 850 }}
        columns={[
          { title: t("websites.name"), dataIndex: "name" },
          { title: t("websites.url"), dataIndex: "url", ellipsis: true },
          { title: t("websites.sort"), dataIndex: "sort_order", width: 90 },
          {
            title: t("websites.enabled"),
            dataIndex: "enabled",
            render: (enabled: boolean) => (
              <Tag color={enabled ? "green" : "default"}>
                {t(enabled ? "websites.on" : "websites.off")}
              </Tag>
            ),
          },
          {
            title: t("websites.visibility"),
            render: (_, row) =>
              t(
                row.visibility === "all" ? "websites.all" : "websites.selected",
              ),
          },
          {
            title: t("websites.mode"),
            render: (_, row) =>
              t(
                row.open_mode === "embed"
                  ? "websites.embed"
                  : "websites.newTab",
              ),
          },
          {
            title: t("websites.actions"),
            render: (_, row) => (
              <Space>
                <Button size="small" onClick={() => edit(row)}>
                  {t("websites.edit")}
                </Button>
                <Popconfirm
                  title={t("websites.deleteConfirm", { name: row.name })}
                  onConfirm={() => remove(row)}
                  okText={t("websites.delete")}
                  cancelText={t("websites.cancel")}
                >
                  <Button size="small" danger>
                    {t("websites.delete")}
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      <Modal
        title={t(editing ? "websites.edit" : "websites.add")}
        open={open}
        onCancel={() => {
          if (!saving) setOpen(false);
        }}
        onOk={() => form.submit()}
        confirmLoading={saving}
        okText={t("websites.save")}
        cancelText={t("websites.cancel")}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={defaults}
          onFinish={save}
          disabled={saving}
        >
          <Form.Item
            name="name"
            label={t("websites.name")}
            rules={[
              {
                required: true,
                whitespace: true,
                max: 80,
                message: t("websites.nameRequired"),
              },
            ]}
          >
            <Input maxLength={80} />
          </Form.Item>
          <Form.Item
            name="url"
            label={t("websites.url")}
            rules={[
              {
                validator: async (_, value: string) => {
                  if (!externalWebsiteTarget(value, window.location.origin)) {
                    throw new Error(t("websites.urlInvalid"));
                  }
                },
              },
            ]}
          >
            <Input
              placeholder="http://intranet.example.com/"
              maxLength={2048}
            />
          </Form.Item>
          <Form.Item name="open_mode" label={t("websites.mode")}>
            <Select
              options={[
                { value: "embed", label: t("websites.embed") },
                { value: "new_tab", label: t("websites.newTab") },
              ]}
            />
          </Form.Item>
          <Form.Item name="visibility" label={t("websites.visibility")}>
            <Select
              options={[
                { value: "all", label: t("websites.all") },
                { value: "selected", label: t("websites.selected") },
              ]}
            />
          </Form.Item>
          {visibility === "selected" && (
            <Form.Item
              name="user_ids"
              label={t("websites.users")}
              rules={[
                {
                  required: true,
                  type: "array",
                  min: 1,
                  message: t("websites.usersRequired"),
                },
              ]}
            >
              <Select
                mode="multiple"
                optionFilterProp="label"
                options={users.map((u) => ({
                  value: u.id,
                  label: `${u.display_name || u.username} (${u.username})${
                    u.disabled ? ` · ${t("websites.off")}` : ""
                  }`,
                }))}
              />
            </Form.Item>
          )}
          <Form.Item name="sort_order" label={t("websites.sort")}>
            <InputNumber precision={0} min={-100000} max={100000} />
          </Form.Item>
          <Form.Item
            name="enabled"
            label={t("websites.enabled")}
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
