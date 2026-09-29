import { request } from "../request";

export interface WebsiteLink {
  website_id: string;
  name: string;
  url: string;
  open_mode: "embed" | "new_tab";
  sort_order: number;
}

export interface WebsiteInput {
  name: string;
  url: string;
  open_mode: "embed" | "new_tab";
  sort_order: number;
  enabled: boolean;
  visibility: "all" | "selected";
  user_ids: number[];
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
};
