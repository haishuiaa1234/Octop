import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Alert, Button, Empty, Space, Tabs, Tooltip } from "antd";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  benchmarkApi,
  type BenchmarkCase,
  type BenchmarkRun,
  type Candidate,
  type CaseInput,
  type Comparison,
  type CaseSplit,
} from "../../../api/modules/benchmarks";
import CaseEditor, { emptyCase } from "./CaseEditor";
import CasesPanel from "./CasesPanel";
import CandidatesPanel from "./CandidatesPanel";
import RunsPanel from "./RunsPanel";
import ComparisonPanel from "./ComparisonPanel";

export default function Benchmark({
  agentId,
  blocked = false,
  visible = true,
  feedbackPanel,
  initialTab = "cases",
  onTabChange,
}: {
  agentId: string | null;
  blocked?: boolean;
  visible?: boolean;
  feedbackPanel?: ReactNode;
  initialTab?: string;
  onTabChange?: (tab: string) => void;
}) {
  const { t } = useTranslation();
  if ((!agentId && !feedbackPanel) || blocked)
    return <Empty description={t("benchmark.unavailable")} />;
  return (
    <Workbench
      key={agentId}
      agentId={agentId || ""}
      visible={visible}
      feedbackPanel={feedbackPanel}
      initialTab={initialTab}
      onTabChange={onTabChange}
    />
  );
}
function Workbench({
  agentId,
  visible,
  feedbackPanel,
  initialTab,
  onTabChange,
}: {
  agentId: string;
  visible: boolean;
  feedbackPanel?: ReactNode;
  initialTab: string;
  onTabChange?: (tab: string) => void;
}) {
  const { t } = useTranslation();
  const alive = useRef(true);
  const refreshQueue = useRef<Promise<void>>(Promise.resolve());
  const translate = useRef(t);
  translate.current = t;
  const [cases, setCases] = useState<BenchmarkCase[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [runs, setRuns] = useState<BenchmarkRun[]>([]);
  const [detail, setDetail] = useState<BenchmarkRun>();
  const detailId = useRef<string>();
  const [comparison, setComparison] = useState<Comparison>();
  const [editor, setEditor] = useState<{
    initial: CaseInput;
    id?: string;
    candidateId?: string;
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState(initialTab);
  const hasFeedbackPanel = Boolean(feedbackPanel);
  useEffect(() => setTab(initialTab), [initialTab]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const refresh = useCallback(() => {
    const next = refreshQueue.current.then(async () => {
      if (!alive.current || !agentId) return;
      try {
        const [c, f, r] = await Promise.all([
          benchmarkApi.cases(agentId),
          hasFeedbackPanel
            ? Promise.resolve([])
            : benchmarkApi.candidates(agentId),
          benchmarkApi.runs(agentId),
        ]);
        if (!alive.current) return;
        setCases(c);
        setCandidates(f);
        setRuns(r);
        if (detailId.current) {
          const id = detailId.current;
          const d = await benchmarkApi.run(agentId, id);
          if (alive.current && detailId.current === id) setDetail(d);
        }
      } catch (e) {
        if (alive.current)
          setError(
            e instanceof Error
              ? e.message
              : translate.current("benchmark.loadError"),
          );
      }
    });
    refreshQueue.current = next;
    return next;
  }, [agentId, hasFeedbackPanel]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const active = runs.some(
    (r) => r.status === "queued" || r.status === "running",
  );
  useEffect(() => {
    if (!active || !visible) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await refresh();
      if (!stopped) timer = setTimeout(() => void poll(), 2000);
    };
    timer = setTimeout(() => void poll(), 2000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [active, visible, refresh]);
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      if (alive.current) await refresh();
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : t("benchmark.loadError"));
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const save = (input: CaseInput) =>
    void act(async () => {
      if (!editor) return;
      if (editor.candidateId)
        await benchmarkApi.accept(agentId, editor.candidateId, input);
      else if (editor.id)
        await benchmarkApi.updateCase(agentId, editor.id, input);
      else await benchmarkApi.createCase(agentId, input);
      if (alive.current) setEditor(undefined);
    });
  const exportCases = (split: CaseSplit) =>
    void act(async () => {
      const data = await benchmarkApi.export(agentId, split);
      if (!alive.current) return;
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `benchmark-${agentId}-${split}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    });
  return (
    <Space
      direction="vertical"
      style={{ width: "100%", padding: 16, overflow: "auto" }}
    >
      {error && (
        <Alert
          type="error"
          message={error}
          closable
          onClose={() => setError("")}
        />
      )}
      {(!feedbackPanel || tab !== "candidates") && (
        <Tooltip title={t("benchmark.refresh")}>
          <Button
            aria-label={t("benchmark.refresh")}
            icon={<RefreshCw size={16} />}
            disabled={busy}
            onClick={() => void refresh()}
          />
        </Tooltip>
      )}
      <Tabs
        activeKey={tab}
        onChange={(value) => {
          setTab(value);
          onTabChange?.(value);
        }}
        items={[
          {
            key: "cases",
            label: t("benchmark.cases"),
            disabled: !agentId,
            children: (
              <CasesPanel
                cases={cases}
                busy={busy}
                onEdit={(c) =>
                  setEditor({ initial: c || { ...emptyCase }, id: c?.case_id })
                }
                onDisable={(id) =>
                  void act(() =>
                    benchmarkApi.updateCase(agentId, id, {
                      status: "disabled",
                    }),
                  )
                }
                onRun={(ids, name) =>
                  void act(async () => {
                    await benchmarkApi.createRun(agentId, {
                      name,
                      case_ids: ids,
                    });
                    if (alive.current) {
                      setTab("runs");
                      onTabChange?.("runs");
                    }
                  })
                }
                onExport={exportCases}
              />
            ),
          },
          {
            key: "candidates",
            label: t("benchmark.feedback"),
            children: feedbackPanel || (
              <CandidatesPanel
                items={candidates}
                busy={busy}
                onAccept={(id, initial) =>
                  setEditor({ initial, candidateId: id })
                }
                onIgnore={(id) =>
                  void act(() => benchmarkApi.ignore(agentId, id))
                }
              />
            ),
          },
          {
            key: "runs",
            label: t("benchmark.runs"),
            disabled: !agentId,
            children: (
              <RunsPanel
                runs={runs}
                detail={detail}
                busy={busy}
                onOpen={(id) => {
                  detailId.current = id;
                  void act(async () => {
                    const d = await benchmarkApi.run(agentId, id);
                    if (alive.current && detailId.current === id) setDetail(d);
                  });
                }}
                onClose={() => {
                  detailId.current = undefined;
                  setDetail(undefined);
                }}
                onCancel={(id) =>
                  void act(() => benchmarkApi.cancel(agentId, id))
                }
                onReview={(caseId, passed, note) =>
                  void act(() =>
                    benchmarkApi.review(
                      agentId,
                      detailId.current!,
                      caseId,
                      passed,
                      note,
                    ),
                  )
                }
              />
            ),
          },
          {
            key: "comparison",
            label: t("benchmark.comparison"),
            disabled: !agentId,
            children: (
              <ComparisonPanel
                runs={runs}
                result={comparison}
                busy={busy}
                onCompare={(baseline, candidate) =>
                  void act(async () => {
                    const result = await benchmarkApi.compare(
                      agentId,
                      baseline,
                      candidate,
                    );
                    if (alive.current) setComparison(result);
                  })
                }
              />
            ),
          },
        ].sort((a, b) =>
          a.key === "candidates" ? -1 : b.key === "candidates" ? 1 : 0,
        )}
      />
      {editor && (
        <CaseEditor
          initial={editor.initial}
          busy={busy}
          onCancel={() => setEditor(undefined)}
          onSave={save}
        />
      )}
    </Space>
  );
}
