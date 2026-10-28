import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Select, Switch } from "antd";
import {
  agentSharingApi,
  type AgentShareOptions,
} from "../../../api/modules/agentSharing";

export default function ShareTargetsField() {
  const { t } = useTranslation();
  const [options, setOptions] = useState<AgentShareOptions>({
    users: [],
    roles: [],
  });

  useEffect(() => {
    let cancelled = false;
    void agentSharingApi
      .options()
      .then((next) => {
        if (!cancelled) setOptions(next);
      })
      .catch(() => {
        if (!cancelled) setOptions({ users: [], roles: [] });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <Form.Item
        name="is_shared"
        label={t("experts.share.toggle")}
        extra={t("experts.share.allUsers")}
        valuePropName="checked"
      >
        <Switch />
      </Form.Item>
      <Form.Item name="shared_user_ids" label={t("experts.share.users")}>
        <Select
          mode="multiple"
          allowClear
          aria-label={t("experts.share.users")}
          options={options.users.map((user) => ({
            value: user.id,
            label: user.display_name
              ? `${user.display_name} (${user.username})`
              : user.username,
          }))}
          placeholder={t("experts.share.usersPlaceholder")}
        />
      </Form.Item>
      <Form.Item name="shared_role_ids" label={t("experts.share.roles")}>
        <Select
          mode="multiple"
          allowClear
          aria-label={t("experts.share.roles")}
          options={options.roles.map((role) => ({
            value: role.id,
            label: role.name,
          }))}
          placeholder={t("experts.share.rolesPlaceholder")}
        />
      </Form.Item>
    </>
  );
}
