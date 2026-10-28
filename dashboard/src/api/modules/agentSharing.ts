import { request } from "../request";

export interface ShareUserOption {
  id: number;
  username: string;
  display_name: string | null;
}

export interface ShareRoleOption {
  id: string;
  name: string;
}

export interface AgentShareOptions {
  users: ShareUserOption[];
  roles: ShareRoleOption[];
}

export const agentSharingApi = {
  options: () => request<AgentShareOptions>("/agents/share-options"),
};
