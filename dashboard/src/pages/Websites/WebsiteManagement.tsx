import { useCallback, useEffect, useState } from "react";
import { CopyOutlined, KeyOutlined } from "@ant-design/icons";
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
  auth_mode: "none",
  sso_callback_url: null,
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
  const [secretTarget, setSecretTarget] = useState<ManagedWebsite>();
  const [secretBusy, setSecretBusy] = useState(false);
  const [credentials, setCredentials] = useState<{
    website_id: string;
    client_secret: string;
  }>();
  const [form] = Form.useForm<WebsiteInput>();
  const visibility = Form.useWatch("visibility", form);
  const authMode = Form.useWatch("auth_mode", form);
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
    form.setFieldsValue(site ? { ...defaults, ...site } : defaults);
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
          sso_callback_url:
            input.auth_mode === "octop" ? input.sso_callback_url : null,
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
  const generateSecret = async () => {
    if (!secretTarget) return;
    setSecretBusy(true);
    try {
      const result = await websiteApi.rotateSsoSecret(secretTarget.website_id);
      setCredentials({ website_id: secretTarget.website_id, ...result });
      setSecretTarget(undefined);
    } catch {
      message.error(t("websites.ssoSecretFailed"));
    } finally {
      setSecretBusy(false);
    }
  };
  const copySecret = async () => {
    if (!credentials) return;
    try {
      await navigator.clipboard.writeText(credentials.client_secret);
      message.success(t("websites.copied"));
    } catch {
      message.error(t("websites.copyFailed"));
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
            title: t("websites.authentication"),
            render: (_, row) =>
              t(
                row.auth_mode === "octop"
                  ? "websites.authOctop"
                  : "websites.authNone",
              ),
          },
          {
            title: t("websites.actions"),
            render: (_, row) => (
              <Space>
                <Button size="small" onClick={() => edit(row)}>
                  {t("websites.edit")}
                </Button>
                {row.auth_mode === "octop" && (
                  <Button
                    size="small"
                    icon={<KeyOutlined />}
                    aria-label={t("websites.ssoSecret")}
                    onClick={() => setSecretTarget(row)}
                  >
                    {t("websites.ssoSecret")}
                  </Button>
                )}
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
          <Form.Item name="auth_mode" label={t("websites.authentication")}>
            <Select
              options={[
                { value: "none", label: t("websites.authNone") },
                { value: "octop", label: t("websites.authOctop") },
              ]}
            />
          </Form.Item>
          {authMode === "octop" && (
            <Form.Item
              name="sso_callback_url"
              label={t("websites.ssoCallback")}
              rules={[
                {
                  validator: async (_, value: string) => {
                    const app = externalWebsiteTarget(
                      form.getFieldValue("url"),
                      window.location.origin,
                    );
                    const callback = externalWebsiteTarget(
                      value,
                      window.location.origin,
                    );
                    if (
                      !app ||
                      !callback ||
                      app.origin !== callback.origin ||
                      callback.hash ||
                      callback.searchParams.has("code") ||
                      callback.searchParams.has("state")
                    ) {
                      throw new Error(t("websites.ssoCallbackInvalid"));
                    }
                  },
                },
              ]}
              dependencies={["url"]}
            >
              <Input
                maxLength={2048}
                placeholder="https://app.example.com/auth/octop/callback"
              />
            </Form.Item>
          )}
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
      <Modal
        title={t("websites.ssoSecret")}
        open={!!secretTarget}
        onCancel={() => {
          if (!secretBusy) setSecretTarget(undefined);
        }}
        onOk={() => void generateSecret()}
        confirmLoading={secretBusy}
        okText={t("websites.generate")}
        cancelText={t("websites.cancel")}
      >
        <Alert
          type="warning"
          showIcon
          message={t("websites.ssoSecretConfirm")}
        />
      </Modal>
      <Modal
        title={t("websites.ssoSecret")}
        open={!!credentials}
        destroyOnClose
        onCancel={() => setCredentials(undefined)}
        footer={
          <Button onClick={() => setCredentials(undefined)}>
            {t("websites.close")}
          </Button>
        }
      >
        <Alert
          type="warning"
          showIcon
          message={t("websites.ssoSecretNotice")}
        />
        <Form layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label={t("websites.clientId")}>
            <Input value={credentials?.website_id ?? ""} readOnly />
          </Form.Item>
          <Form.Item label={t("websites.clientSecret")}>
            <Space.Compact style={{ width: "100%" }}>
              <Input.Password
                aria-label={t("websites.clientSecret")}
                value={credentials?.client_secret ?? ""}
                readOnly
              />
              <Button
                icon={<CopyOutlined />}
                title={t("websites.copy")}
                onClick={() => void copySecret()}
              />
            </Space.Compact>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
