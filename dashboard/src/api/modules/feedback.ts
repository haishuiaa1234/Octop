import { request, requestBlob } from "../request";

export const feedbackReasons = [
  "factual_error",
  "unsupported",
  "misunderstood",
  "incomplete",
  "other",
] as const;
export type FeedbackReason = (typeof feedbackReasons)[number];
export type FeedbackRating = "helpful" | "unhelpful";
export interface FeedbackInput {
  message_id: string;
  rating: FeedbackRating;
  reason: FeedbackReason | "";
  comment: string;
  correction: string;
  reference: string;
}
export interface Feedback extends FeedbackInput {
  feedback_id: string;
  user_id: number;
  agent_id: string;
  agent_name: string;
  thread_id: string;
  question: string;
  answer: string;
  created_at: number;
  updated_at: number;
}
export interface FeedbackFilters {
  agent_id?: string;
  rating?: FeedbackRating;
  reason?: FeedbackReason;
  start_time?: number;
  end_time?: number;
}
export interface FeedbackPage {
  items: Feedback[];
  total: number;
  helpful: number;
  unhelpful: number;
}
const threadPath = (agent: string, thread: string) =>
  `/agents/${encodeURIComponent(agent)}/threads/${encodeURIComponent(
    thread,
  )}/feedback`;

function query(values: FeedbackFilters & { limit?: number; offset?: number }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  return params.toString();
}

export const feedbackApi = {
  list: (agent: string, thread: string) =>
    request<{ items: Feedback[] }>(threadPath(agent, thread)),
  save: (agent: string, thread: string, body: FeedbackInput) =>
    request<Feedback>(threadPath(agent, thread), {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  remove: (agent: string, thread: string, messageId: string) =>
    request<void>(
      `${threadPath(agent, thread)}?${new URLSearchParams({
        message_id: messageId,
      })}`,
      { method: "DELETE" },
    ),
  adminList: (filters: FeedbackFilters, offset = 0, limit = 20) =>
    request<FeedbackPage>(
      `/admin/feedback?${query({ ...filters, offset, limit })}`,
    ),
  export: (filters: FeedbackFilters) =>
    requestBlob(`/admin/feedback/export?${query(filters)}`),
};
