import { useState } from "react";
import { Button, Select, Space, Table } from "antd";
import { useTranslation } from "react-i18next";
import type { BenchmarkRun, Comparison } from "../../../api/modules/benchmarks";
export default function ComparisonPanel({
  runs,
  result,
  onCompare,
  busy,
}: {
  runs: BenchmarkRun[];
  result?: Comparison;
  onCompare: (baseline: string, candidate: string) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const [baseline, setBaseline] = useState<string>();
  const [candidate, setCandidate] = useState<string>();
  const options = runs.map((r) => ({ value: r.run_id, label: r.name }));
  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      <Space wrap>
        <Select
          aria-label={t("benchmark.baseline")}
          placeholder={t("benchmark.baseline")}
          value={baseline}
          onChange={setBaseline}
          options={options}
          style={{ width: 220 }}
        />
        <Select
          aria-label={t("benchmark.candidateRun")}
          placeholder={t("benchmark.candidateRun")}
          value={candidate}
          onChange={setCandidate}
          options={options}
          style={{ width: 220 }}
        />
        <Button
          loading={busy}
          disabled={!baseline || !candidate || baseline === candidate}
          onClick={() =>
            baseline && candidate && onCompare(baseline, candidate)
          }
        >
          {t("benchmark.compare")}
        </Button>
      </Space>
      <Table
        rowKey="case_id"
        dataSource={result?.items || []}
        scroll={{ x: 650 }}
        columns={[
          { title: t("benchmark.title"), dataIndex: "title" },
          {
            title: t("benchmark.baseline"),
            render: (_, r) =>
              r.baseline_status === null
                ? "—"
                : `${t(`benchmark.${r.baseline_status}`)} (v${
                    r.baseline_revision
                  })`,
          },
          {
            title: t("benchmark.candidateRun"),
            render: (_, r) =>
              r.candidate_status === null
                ? "—"
                : `${t(`benchmark.${r.candidate_status}`)} (v${
                    r.candidate_revision
                  })`,
          },
          {
            title: t("benchmark.change"),
            render: (_, r) =>
              t(`benchmark.${r.comparable ? r.change : "incomparable"}`),
          },
        ]}
      />
    </Space>
  );
}
