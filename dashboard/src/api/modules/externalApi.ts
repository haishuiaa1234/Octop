import { request } from "../request";

export interface ExternalApiConfig {
  agent_id: string;
  enabled: boolean;
  key_prefix: string | null;
  api_key?: string;
}

function configPath(agentId: string): string {
  return `/agents/${encodeURIComponent(agentId)}/external-api`;
}

export const externalApi = {
  getConfig: (agentId: string) =>
    request<ExternalApiConfig>(configPath(agentId)),
  configure: (
    agentId: string,
    config: { enabled: boolean; rotate?: boolean },
  ) =>
    request<ExternalApiConfig>(configPath(agentId), {
      method: "PUT",
      body: JSON.stringify(config),
    }),
};
