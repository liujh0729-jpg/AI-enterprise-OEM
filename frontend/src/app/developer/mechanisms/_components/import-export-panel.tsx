"use client";

import { DeleteOutlined, DownloadOutlined, InboxOutlined, UploadOutlined } from "@ant-design/icons";
import { App, Button, Checkbox, Input, Select, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useMemo, useState } from "react";
import { mechanismsApi } from "@/api/mechanisms";
import { Notice, Panel, PillTabs } from "@/components/ui/panel";
import { fmtDateTime } from "@/lib/datetime";
import {
  IMPORT_MODULES,
  IMPORT_MODULE_LABELS,
  jobStatusTag,
  mechError,
  type ExportJob,
  type ExportModule,
  type ImportJob,
  type ImportMap,
} from "./mechanisms-common";

function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return { headers: [], rows: [] };
  const split = (line: string) => {
    const out: string[] = [];
    let current = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (quoted) {
        if (char === '"' && line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else if (char === '"') {
          quoted = false;
        } else {
          current += char;
        }
      } else if (char === '"') {
        quoted = true;
      } else if (char === ",") {
        out.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    out.push(current);
    return out;
  };
  const headers = split(lines[0]).map((item) => item.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = split(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = (cells[index] ?? "").trim();
    });
    return row;
  });
  return { headers, rows };
}

export function ImportExportPanel() {
  const { message } = App.useApp();
  const [tab, setTab] = useState("import");

  const [module, setModule] = useState(IMPORT_MODULES[0].value);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState("");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [dryRun, setDryRun] = useState(false);
  const [saveMapAs, setSaveMapAs] = useState("");
  const [maps, setMaps] = useState<ImportMap[]>([]);
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [busy, setBusy] = useState(false);

  const [exportModules, setExportModules] = useState<ExportModule[]>([]);
  const [exportJobs, setExportJobs] = useState<ExportJob[]>([]);
  const [exportModule, setExportModule] = useState("");
  const [exportFormat, setExportFormat] = useState<"csv" | "json">("csv");

  const definition = useMemo(
    () => IMPORT_MODULES.find((item) => item.value === module) || IMPORT_MODULES[0],
    [module],
  );

  const loadMaps = useCallback(async () => {
    const data = await mechanismsApi.importMaps({ query: { module } });
    setMaps(data || []);
  }, [module]);

  const loadJobs = useCallback(async () => {
    const data = await mechanismsApi.importJobs({ query: { page: 1, pageSize: 30 } });
    setJobs(data?.list || []);
  }, []);

  const loadExports = useCallback(async () => {
    const [modulesData, jobsData] = await Promise.all([
      mechanismsApi.exportModules(),
      mechanismsApi.exportJobs({ query: { page: 1, pageSize: 30 } }),
    ]);
    setExportModules(modulesData || []);
    setExportJobs(jobsData?.list || []);
    setExportModule((current) => current || modulesData?.[0]?.module || "");
  }, []);

  useEffect(() => {
    void loadMaps().catch((err) => message.error(mechError(err)));
    void loadJobs().catch(() => setJobs([]));
    void loadExports().catch(() => undefined);
  }, [loadMaps, loadJobs, loadExports, message]);

  useEffect(() => {
    const next: Record<string, string> = {};
    definition.columns.forEach((column) => {
      if (headers.includes(column)) next[column] = column;
    });
    setMapping(next);
  }, [definition, headers]);

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCsv(String(reader.result || ""));
      setFileName(file.name);
      setHeaders(parsed.headers);
      setRows(parsed.rows);
      if (!parsed.rows.length) message.warning("没有解析到数据行，请检查 CSV 表头与内容");
    };
    reader.onerror = () => message.error("读取文件失败");
    reader.readAsText(file, "utf-8");
  };

  const applyMap = (map: ImportMap) => {
    setMapping(map.mapping);
    message.success(`已套用映射方案「${map.name}」`);
  };

  const removeMap = async (map: ImportMap) => {
    try {
      await mechanismsApi.removeImportMap({ body: { id: map.id } });
      message.success("映射方案已删除");
      await loadMaps();
    } catch (err) {
      message.error(mechError(err));
    }
  };

  const createJob = async () => {
    if (!rows.length) {
      message.warning("请先选择要导入的 CSV 文件");
      return;
    }
    setBusy(true);
    try {
      const job = await mechanismsApi.createImportJob({
        body: {
          module,
          fileName,
          mapping,
          rows,
          saveMapAs,
          dryRun,
        },
      });
      message.success(
        dryRun
          ? `试运行完成：${job?.success ?? 0} 行可导入，${job?.failed ?? 0} 行有问题`
          : `导入完成：成功 ${job?.success ?? 0} 行，失败 ${job?.failed ?? 0} 行`,
      );
      setSaveMapAs("");
      await Promise.all([loadJobs(), loadMaps()]);
    } catch (err) {
      message.error(mechError(err));
    } finally {
      setBusy(false);
    }
  };

  const removeJob = async (row: ImportJob) => {
    try {
      await mechanismsApi.removeImportJob({ body: { id: row.id } });
      message.success("导入记录已删除");
      await loadJobs();
    } catch (err) {
      message.error(mechError(err));
    }
  };

  const createExport = async () => {
    if (!exportModule) {
      message.warning("请先选择导出模块");
      return;
    }
    try {
      await mechanismsApi.createExportJob({
        body: { module: exportModule, format: exportFormat, filters: {} },
      });
      message.success("导出任务已创建");
      await loadExports();
    } catch (err) {
      message.error(mechError(err));
    }
  };

  const removeExport = async (row: ExportJob) => {
    try {
      await mechanismsApi.removeExportJob({ body: { id: row.id } });
      message.success("导出记录已删除");
      await loadExports();
    } catch (err) {
      message.error(mechError(err));
    }
  };

  const jobColumns: ColumnsType<ImportJob> = [
    {
      title: "文件 / 模块",
      dataIndex: "fileName",
      render: (_value, row) => (
        <div>
          <div>{row.fileName || "粘贴数据"}</div>
          <div className="muted text-12">{IMPORT_MODULE_LABELS[row.module] || row.module}</div>
        </div>
      ),
    },
    {
      title: "结果",
      dataIndex: "success",
      width: 160,
      render: (_value, row) => (
        <span>
          <Tag color="green">成功 {row.success}</Tag>
          {row.failed ? <Tag color="red">失败 {row.failed}</Tag> : null}
          <span className="muted text-12">共 {row.total} 行</span>
        </span>
      ),
    },
    { title: "状态", dataIndex: "status", width: 100, render: (value: string) => jobStatusTag(value) },
    { title: "时间", dataIndex: "createdAt", width: 160, render: (value: string) => fmtDateTime(value) },
    {
      title: "操作",
      width: 80,
      render: (_value, row) => (
        <Button size="small" danger icon={<DeleteOutlined aria-hidden />} onClick={() => void removeJob(row)} />
      ),
    },
  ];

  const exportColumns: ColumnsType<ExportJob> = [
    {
      title: "模块 / 格式",
      dataIndex: "module",
      render: (_value, row) => (
        <div>
          <div>{exportModules.find((item) => item.module === row.module)?.label || row.module}</div>
          <div className="muted text-12">{row.format.toUpperCase()} · {row.rowCount} 行</div>
        </div>
      ),
    },
    { title: "状态", dataIndex: "status", width: 110, render: (value: string) => jobStatusTag(value) },
    { title: "时间", dataIndex: "createdAt", width: 160, render: (value: string) => fmtDateTime(value) },
    {
      title: "文件",
      dataIndex: "fileUrl",
      render: (value: string) =>
        value ? (
          <a href={value} target="_blank" rel="noreferrer">
            <DownloadOutlined aria-hidden /> 下载
          </a>
        ) : (
          "—"
        ),
    },
    {
      title: "操作",
      width: 80,
      render: (_value, row) => (
        <Button size="small" danger icon={<DeleteOutlined aria-hidden />} onClick={() => void removeExport(row)} />
      ),
    },
  ];

  return (
    <Panel
      title="导入导出中心"
      extra={
        <PillTabs
          items={[
            { key: "import", label: "导入" },
            { key: "export", label: "导出" },
          ]}
          value={tab}
          onChange={setTab}
        />
      }
    >
      {tab === "import" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Notice variant="info">
            CSV 第一行是表头；把「目标字段」映射到你的表头列后再导入。可以先试运行，确认没问题再正式写入。
          </Notice>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Select
              style={{ width: 180 }}
              value={module}
              onChange={(value) => {
                setModule(value);
                setHeaders([]);
                setRows([]);
                setFileName("");
              }}
              options={IMPORT_MODULES.map((item) => ({ value: item.value, label: item.label }))}
            />
            <label
              style={{
                display: "inline-flex",
                gap: 6,
                alignItems: "center",
                padding: "4px 12px",
                border: "1px solid var(--border, #d9d9d9)",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              <UploadOutlined aria-hidden />
              选择 CSV 文件
              <input
                type="file"
                accept=".csv,text/csv,.txt"
                style={{ display: "none" }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) readFile(file);
                  event.target.value = "";
                }}
              />
            </label>
            <span className="muted text-12">
              {fileName ? `${fileName} · ${rows.length} 行 · ${headers.length} 列` : "尚未选择文件"}
            </span>
            {maps.length ? (
              <Select
                style={{ width: 200 }}
                placeholder="套用已保存的映射"
                value={undefined}
                onChange={(value) => {
                  const found = maps.find((item) => item.id === value);
                  if (found) applyMap(found);
                }}
                options={maps.map((item) => ({ value: item.id, label: item.name }))}
              />
            ) : null}
          </div>

          {headers.length ? (
            <div>
              <strong>字段映射</strong>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 8, marginTop: 8 }}>
                {definition.columns.map((column) => (
                  <div key={column} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span className="text-12" style={{ width: 110, flex: "none" }}>{column}</span>
                    <Select
                      size="small"
                      style={{ flex: 1 }}
                      allowClear
                      placeholder="不导入"
                      value={mapping[column]}
                      onChange={(value) =>
                        setMapping((current) => {
                          const next = { ...current };
                          if (value) next[column] = value;
                          else delete next[column];
                          return next;
                        })
                      }
                      options={headers.map((header) => ({ value: header, label: header }))}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {maps.length ? (
            <div>
              <strong>已保存的映射方案</strong>
              {maps.map((map) => (
                <div key={map.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0", borderTop: "1px dashed var(--border, #eee)" }}>
                  <span>{map.name}</span>
                  <span className="muted text-12">{Object.keys(map.mapping).length} 个字段</span>
                  <Button size="small" style={{ marginLeft: "auto" }} onClick={() => applyMap(map)}>
                    套用
                  </Button>
                  <Button size="small" danger icon={<DeleteOutlined aria-hidden />} onClick={() => void removeMap(map)} />
                </div>
              ))}
            </div>
          ) : null}

          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <Input
              style={{ width: 200 }}
              placeholder="保存映射为（选填）"
              value={saveMapAs}
              onChange={(event) => setSaveMapAs(event.target.value)}
            />
            <Checkbox checked={dryRun} onChange={(event) => setDryRun(event.target.checked)}>
              仅试运行（不写入）
            </Checkbox>
            <Button type="primary" loading={busy} onClick={() => void createJob()}>
              开始导入
            </Button>
          </div>

          <div>
            <strong>导入记录</strong>
            <Table
              style={{ marginTop: 8 }}
              rowKey="id"
              size="small"
              columns={jobColumns}
              dataSource={jobs}
              pagination={{ pageSize: 10, hideOnSinglePage: true }}
              expandable={{
                rowExpandable: (row) => row.errors.length > 0,
                expandedRowRender: (row) => (
                  <div className="text-12">
                    {row.errors.map((error, index) => (
                      <div key={`${error.row}-${index}`}>
                        第 {error.row} 行：{error.message}
                      </div>
                    ))}
                  </div>
                ),
              }}
              locale={{ emptyText: "还没有导入记录" }}
            />
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Select
              style={{ width: 200 }}
              value={exportModule}
              onChange={setExportModule}
              options={exportModules.map((item) => ({ value: item.module, label: item.label }))}
              placeholder="选择导出模块"
            />
            <Select
              style={{ width: 110 }}
              value={exportFormat}
              onChange={(value) => setExportFormat(value)}
              options={[
                { value: "csv", label: "CSV" },
                { value: "json", label: "JSON" },
              ]}
            />
            <Button type="primary" icon={<InboxOutlined aria-hidden />} onClick={() => void createExport()}>
              创建导出任务
            </Button>
            <span className="muted text-12">导出按当前组织的可见数据生成，完成后在下方下载</span>
          </div>
          <Table
            rowKey="id"
            size="small"
            columns={exportColumns}
            dataSource={exportJobs}
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            locale={{ emptyText: "还没有导出记录" }}
          />
        </div>
      )}
    </Panel>
  );
}
