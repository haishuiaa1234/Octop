import { useState } from "react";
import { Alert, Select } from "antd";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import PageShell from "../../layouts/PageShell";
import { useAgent } from "../../context/AgentContext";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { benchmarkApi, type CaseInput } from "../../api/modules/benchmarks";
import type { Feedback } from "../../api/modules/feedback";
import Benchmark from "../Agent/Benchmark";
import FeedbackPage from "../Admin/Feedback";
import CaseEditor, { emptyCase } from "../Agent/Benchmark/CaseEditor";

export default function EvaluationCenter() {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const { agents, loading, error: agentsError } = useAgent();
  const [params, setParams] = useSearchParams();
  const [review, setReview] = useState<Feedback>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const admin = user?.role === "admin";
  const eligible = agents.filter(
    (a) => !a.bridge && a.kind !== "team" && (admin || a.user_id === user?.id),
  );
  const requested = params.get("agent");
  const agentId =
    eligible.find((a) => a.agent_id === requested)?.agent_id ||
    (admin ? null : eligible[0]?.agent_id || null);
  const tab = params.get("tab");
  const initialTab =
    agentId && tab && ["cases", "runs", "comparison"].includes(tab)
      ? tab
      : "candidates";
  const save = async (data: CaseInput) => {
    if (!review || busy) return;
    setBusy(true);
    setError("");
    try {
      await benchmarkApi.acceptFeedback(
        review.agent_id,
        review.feedback_id,
        data,
      );
      setParams({ agent: review.agent_id, tab: "cases" });
      setRevision((value) => value + 1);
      setReview(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("benchmark.loadError"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <PageShell title={t("benchmark.centerTitle")}>
      <Select
        aria-label={t("benchmark.expert")}
        placeholder={t("benchmark.expert")}
        loading={loading}
        showSearch
        optionFilterProp="label"
        value={agentId || ""}
        style={{ width: "100%", maxWidth: 360, marginBottom: 16 }}
        options={[
          ...(admin ? [{ value: "", label: t("benchmark.allExperts") }] : []),
          ...eligible.map((a) => ({
            value: a.agent_id,
            label: `${a.name} (${a.agent_id})`,
          })),
        ]}
        onChange={(value) =>
          setParams(
            value ? { agent: value, tab: initialTab } : { tab: "candidates" },
          )
        }
      />
      {(error || agentsError) && (
        <Alert
          type="error"
          message={error || agentsError}
          closable
          onClose={() => setError("")}
        />
      )}
      <Benchmark
        key={`${agentId}:${revision}`}
        agentId={agentId}
        initialTab={initialTab}
        onTabChange={(value) =>
          setParams(agentId ? { agent: agentId, tab: value } : { tab: value }, {
            replace: true,
          })
        }
        feedbackPanel={
          admin ? (
            <FeedbackPage
              key={agentId}
              embedded
              agentId={agentId || undefined}
              onReview={(item) => {
                if (!eligible.some((a) => a.agent_id === item.agent_id)) {
                  setError(t("benchmark.unavailable"));
                  return;
                }
                setError("");
                setReview(item);
              }}
            />
          ) : undefined
        }
      />
      {review && (
        <CaseEditor
          initial={{
            ...emptyCase,
            title: review.question.slice(0, 80),
            question: review.question,
            reference_answer: review.correction,
            status: "ready",
          }}
          onSave={(data) => void save(data)}
          onCancel={() => {
            if (!busy) setReview(undefined);
          }}
          busy={busy}
          error={error}
          readyOnly
        />
      )}
    </PageShell>
  );
}
