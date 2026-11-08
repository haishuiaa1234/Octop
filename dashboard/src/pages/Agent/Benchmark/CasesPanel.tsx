import { useState } from "react";
import { Button, Input, Select, Space, Table, Tag, Tooltip } from "antd";
import { Download, Pencil, Plus, Play, Ban } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { BenchmarkCase, CaseSplit } from "../../../api/modules/benchmarks";
export default function CasesPanel({
  cases,
  busy,
  onEdit,
  onDisable,
  onRun,
  onExport,
}: {
  cases: BenchmarkCase[];
  busy: boolean;
  onEdit: (item?: BenchmarkCase) => void;
  onDisable: (id: string) => void;
  onRun: (ids: string[], name: string) => void;
  onExport: (split: CaseSplit) => void;
}) {
  const { t } = useTranslation();
  const [split, setSplit] = useState<CaseSplit>("dev");
  const [status, setStatus] = useState<string>();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<React.Key[]>([]);
  const [name, setName] = useState("");
  const rows = cases.filter(
    (c) =>
      c.split === split &&
      (!status || c.status === status) &&
      `${c.title} ${c.question} ${c.tags.join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const ids = selected
    .map(String)
    .filter((id) =>
      cases.some(
        (c) => c.case_id === id && c.status === "ready" && c.split === split,
      ),
    );
  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      <Space wrap>
        <Select
          value={split}
          onChange={(v) => {
            setSplit(v);
            setSelected([]);
          }}
          options={["train", "dev", "test"].map((value) => ({
            value,
            label: t(`benchmark.${value}`),
          }))}
        />
        <Select
          allowClear
          placeholder={t("benchmark.status")}
          value={status}
          onChange={setStatus}
          style={{ width: 150 }}
          options={["draft", "needs_info", "ready", "disabled"].map(
            (value) => ({ value, label: t(`benchmark.${value}`) }),
          )}
        />
        <Input.Search
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("benchmark.search")}
          style={{ width: 220 }}
        />
        <Button icon={<Plus size={16} />} onClick={() => onEdit()}>
          {t("benchmark.createCase")}
        </Button>
        <Tooltip title={t("benchmark.export")}>
          <Button
            aria-label={t("benchmark.export")}
            icon={<Download size={16} />}
            onClick={() => onExport(split)}
          />
        </Tooltip>
      </Space>
      <Space wrap>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("benchmark.runName")}
          style={{ width: 220 }}
        />
        <Button
          type="primary"
          icon={<Play size={16} />}
          disabled={!ids.length || busy || !name.trim()}
          onClick={() => onRun(ids, name.trim())}
        >
          {t("benchmark.startRun")}
        </Button>
        <Tag>{t("benchmark.textOnly")}</Tag>
      </Space>
      <Table
        rowKey="case_id"
        dataSource={rows}
        scroll={{ x: 650 }}
        rowSelection={{
          selectedRowKeys: ids,
          onChange: setSelected,
          getCheckboxProps: (c) => ({ disabled: c.status !== "ready" }),
        }}
        columns={[
          { title: t("benchmark.title"), dataIndex: "title" },
          {
            title: t("benchmark.status"),
            dataIndex: "status",
            render: (v: string) => t(`benchmark.${v}`),
          },
          { title: t("benchmark.revision"), dataIndex: "revision" },
          {
            title: t("benchmark.actions"),
            render: (_, c) => (
              <Space>
                <Tooltip title={t("benchmark.editCase")}>
                  <Button
                    aria-label={t("benchmark.editCase")}
                    icon={<Pencil size={15} />}
                    onClick={() => onEdit(c)}
                  />
                </Tooltip>
                <Tooltip title={t("benchmark.disable")}>
                  <Button
                    aria-label={t("benchmark.disable")}
                    disabled={c.status === "disabled"}
                    icon={<Ban size={15} />}
                    onClick={() => onDisable(c.case_id)}
                  />
                </Tooltip>
              </Space>
            ),
          },
        ]}
      />
    </Space>
  );
}
