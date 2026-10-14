import { request } from "../request";

export interface WebsiteLink {
  website_id: string;
  name: string;
  url: string;
  open_mode: "embed" | "new_tab";
  sort_order: number;
  auth_mode?: "none" | "octop";
  sso_callback_url?: string | null;
}

export interface WebsiteInput {
  name: string;
  url: string;
  open_mode: "embed" | "new_tab";
  sort_order: number;
  enabled: boolean;
  visibility: "all" | "selected";
  user_ids: number[];
  auth_mode?: "none" | "octop";
  sso_callback_url?: string | null;
}

export interface WebsiteSsoCode {
  code: string;
  state: string;
  expires_in: number;
  callback_url: string;
}

export interface ManagedWebsite extends WebsiteInput {
  website_id: string;
}

export interface WebsiteUser {
  id: number;
  username: string;
  display_name: string | null;
  disabled: boolean;
}

export const WEBSITES_CHANGED = "octop:websites-changed";
export const websiteApi = {
  list: () => request<WebsiteLink[]>("/websites"),
  get: (id: string) =>
    request<WebsiteLink>(`/websites/${encodeURIComponent(id)}`),
  manage: () => request<ManagedWebsite[]>("/admin/websites"),
  users: () => request<WebsiteUser[]>("/admin/websites/users"),
  save: (input: WebsiteInput, id?: string) =>
    request<ManagedWebsite>(
      id ? `/admin/websites/${encodeURIComponent(id)}` : "/admin/websites",
      { method: id ? "PUT" : "POST", body: JSON.stringify(input) },
    ),
  remove: (id: string) =>
    request<void>(`/admin/websites/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  issueSsoCode: (
    id: string,
    challenge: { state: string; code_challenge: string },
  ) =>
    request<WebsiteSsoCode>(`/websites/${encodeURIComponent(id)}/sso/code`, {
      method: "POST",
      body: JSON.stringify(challenge),
    }),
  rotateSsoSecret: (id: string) =>
    request<{ client_secret: string }>(
      `/admin/websites/${encodeURIComponent(id)}/sso-secret`,
      { method: "POST" },
    ),
};
