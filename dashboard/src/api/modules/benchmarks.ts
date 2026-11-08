import { request } from "../request";
export type CaseSplit = "train" | "dev" | "test";
export type CaseStatus = "draft" | "needs_info" | "ready" | "disabled";
export interface CaseInput {
  title: string;
  question: string;
  context: string;
  reference_answer: string;
  rubric: string;
  match_mode: "exact" | "contains" | "manual";
  keywords: string[];
  tags: string[];
  split: CaseSplit;
  status: CaseStatus;
}
export interface BenchmarkCase extends CaseInput {
  case_id: string;
  agent_id: string;
  revision: number;
  source: "manual" | "feedback";
  source_feedback_id?: string | null;
  source_snapshot: Record<string, unknown>;
  created_at: number;
  updated_at: number;
}
export interface FeedbackSnapshot {
  question?: string;
  answer?: string;
  rating?: string;
  reason?: string;
  comment?: string;
  correction?: string;
  reference?: string;
}
export interface Candidate {
  candidate_id: string;
  status: "pending" | "accepted" | "ignored";
  snapshot: FeedbackSnapshot;
  case_id?: string | null;
}
export type ResultStatus =
  | "pending"
  | "running"
  | "passed"
  | "failed"
  | "needs_review"
  | "error"
  | "cancelled";
export interface BenchmarkResult {
  case_id: string;
  revision: number;
  case_snapshot: CaseInput;
  status: ResultStatus;
  answer: string;
  error: string;
  duration_ms: number;
  note: string;
}
export interface BenchmarkRun {
  run_id: string;
  name: string;
  status: "queued" | "running" | "completed" | "cancelled" | "interrupted";
  config_snapshot: {
    mode?: string;
    model_ref?: string;
    instruction_hash?: string;
  };
  results: BenchmarkResult[];
  created_at: number;
  finished_at?: number | null;
  total: number;
  completed: number;
  passed: number;
  failed: number;
  errors: number;
  needs_review: number;
}
export interface Comparison {
  baseline: BenchmarkRun;
  candidate: BenchmarkRun;
  items: {
    case_id: string;
    title: string;
    comparable: boolean;
    baseline_status: ResultStatus | null;
    candidate_status: ResultStatus | null;
    baseline_revision: number | null;
    candidate_revision: number | null;
    change: "improved" | "regressed" | "unchanged" | "incomparable";
  }[];
}
const base = (agent: string) =>
  `/agents/${encodeURIComponent(agent)}/benchmarks`;
const post = (body?: unknown) => ({
  method: "POST",
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
export const benchmarkApi = {
  cases: (a: string) => request<BenchmarkCase[]>(`${base(a)}/cases`),
  createCase: (a: string, body: CaseInput) =>
    request<BenchmarkCase>(`${base(a)}/cases`, post(body)),
  updateCase: (a: string, id: string, body: Partial<CaseInput>) =>
    request<BenchmarkCase>(`${base(a)}/cases/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  candidates: (a: string) => request<Candidate[]>(`${base(a)}/candidates`),
  accept: (a: string, id: string, body: CaseInput) =>
    request<BenchmarkCase>(
      `${base(a)}/candidates/${encodeURIComponent(id)}/accept`,
      post(body),
    ),
  ignore: (a: string, id: string) =>
    request<Candidate>(
      `${base(a)}/candidates/${encodeURIComponent(id)}/ignore`,
      post(),
    ),
  runs: (a: string) => request<BenchmarkRun[]>(`${base(a)}/runs`),
  createRun: (a: string, body: { name: string; case_ids: string[] }) =>
    request<BenchmarkRun>(`${base(a)}/runs`, post(body)),
  run: (a: string, id: string) =>
    request<BenchmarkRun>(`${base(a)}/runs/${encodeURIComponent(id)}`),
  cancel: (a: string, id: string) =>
    request<BenchmarkRun>(
      `${base(a)}/runs/${encodeURIComponent(id)}/cancel`,
      post(),
    ),
  review: (
    a: string,
    id: string,
    caseId: string,
    passed: boolean,
    note: string,
  ) =>
    request<BenchmarkRun>(
      `${base(a)}/runs/${encodeURIComponent(id)}/results/${encodeURIComponent(
        caseId,
      )}/review`,
      post({ passed, note }),
    ),
  export: (a: string, split: CaseSplit) =>
    request<BenchmarkCase[]>(`${base(a)}/export?split=${split}`),
  compare: (a: string, baseline: string, candidate: string) =>
    request<Comparison>(
      `${base(a)}/compare?${new URLSearchParams({ baseline, candidate })}`,
    ),
};
