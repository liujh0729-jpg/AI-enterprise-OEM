"use client";

import {
  Button,
  Drawer,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  message,
} from "antd";
import { PlusOutlined, RobotOutlined, SendOutlined } from "@ant-design/icons";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { biApi, streamBiAsk } from "@/api/bi";
import { contentApi } from "@/api/content";
import { Notice, Panel, StatCard, StatGrid } from "@/components/ui/panel";
import { ChartRenderer, type ChartColumn } from "./chart-renderer";

const CHART_TYPES = [
  { value: "TABLE", label: "表格" },
  { value: "METRIC", label: "指标卡" },
  { value: "BAR", label: "柱状图" },
  { value: "LINE", label: "折线图" },
  { value: "AREA", label: "面积图" },
  { value: "PIE", label: "饼图" },
  { value: "DONUT", label: "环形图" },
  { value: "SCATTER", label: "散点图" },
  { value: "FUNNEL", label: "漏斗图" },
];

const INTERNAL_DATASETS = [
  { value: "LEADS", label: "CRM 线索" },
  { value: "CUSTOMERS", label: "CRM 客户" },
  { value: "OPPORTUNITIES", label: "CRM 商机" },
  { value: "CONTRACTS", label: "CRM 销售合同" },
  { value: "PAYMENTS", label: "CRM 回款" },
  { value: "ORDERS", label: "CRM 订单" },
];

const err = (error: unknown) => (error as Error)?.message || "操作失败";

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function BiWorkbenchTab({
  onGo,
  initial,
}: {
  onGo: (tab: string) => void;
  initial?: Awaited<ReturnType<typeof biApi.workbench>> | null;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof biApi.workbench>> | null>(initial ?? null);
  const loaded = useRef(Boolean(initial));
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void biApi.workbench().then(setData).catch((error) => message.error(err(error)));
  }, []);
  if (!data) return <div className="muted">加载中…</div>;
  if (!data.isMember) {
    return <Panel title="BI 未开通">你还没有被加入本账号的 BI，请联系管理员添加成员权限。</Panel>;
  }
  return (
    <div className="crm-stack">
      <Panel title="工作台">
        <StatGrid>
          {data.stats.map((item) => (
            <StatCard key={item.key} label={item.label} value={item.value} />
          ))}
        </StatGrid>
      </Panel>
      <div className="crm-two-col">
        <Panel title="最近问数">
          {data.recentSessions.map((item) => (
            <button type="button" className="bi-recent" key={item.id} onClick={() => onGo("chat")}>
              <b>{item.title}</b>
              <span className="muted">{item.updatedAt.replace("T", " ").slice(0, 16)}</span>
            </button>
          ))}
          {data.recentSessions.length ? null : <div className="muted">还没有问数</div>}
        </Panel>
        <Panel title="最近仪表板">
          {data.recentDashboards.map((item) => (
            <button type="button" className="bi-recent" key={item.id} onClick={() => onGo("dashboards")}>
              <b>{item.name}</b>
              <span className="muted">{item.updatedAt.replace("T", " ").slice(0, 16)}</span>
            </button>
          ))}
          {data.recentDashboards.length ? null : <div className="muted">还没有仪表板</div>}
        </Panel>
      </div>
      <Panel title="数据集" extra={<Button onClick={() => onGo("datasets")}>管理数据集</Button>}>
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={data.datasets}
          columns={[
            { title: "名称", dataIndex: "name" },
            { title: "类型", dataIndex: "typeLabel", width: 120 },
            { title: "说明", dataIndex: "description" },
          ]}
        />
      </Panel>
    </div>
  );
}

type AskResult = {
  messageId?: number;
  sql?: string;
  rows?: Record<string, unknown>[];
  columns?: ChartColumn[];
  chart?: Record<string, unknown>;
  analysis?: string;
  followups?: string[];
  rowCount?: number;
  elapsedMs?: number;
  truncated?: boolean;
};

export function BiChatTab() {
  const [datasets, setDatasets] = useState<Array<{ id: number; name: string }>>([]);
  const [sessions, setSessions] = useState<Array<{ id: number; title: string; datasetName: string; updatedAt: string }>>([]);
  const [datasetId, setDatasetId] = useState(0);
  const [sessionId, setSessionId] = useState(0);
  const [question, setQuestion] = useState("");
  const [lastAsked, setLastAsked] = useState("");
  const [result, setResult] = useState<AskResult | null>(null);
  const [messages, setMessages] = useState<Array<Record<string, unknown>>>([]);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [channels, setChannels] = useState<Array<{ value: number; label: string }>>([]);
  const [channelId, setChannelId] = useState(0);
  const [models, setModels] = useState<Array<{ value: string; label: string }>>([]);
  const [model, setModel] = useState("");
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadModels = async (nextChannelId: number, preferred?: string) => {
    setModelsLoading(true);
    setModelsError("");
    try {
      const data = await contentApi.models({ query: { channelId: nextChannelId } });
      const list = (data?.models || [])
        .filter((item) => item.kind === "text")
        .map((item) => ({ value: item.id, label: item.id }));
      setModels(list);
      setModel((prev) => {
        if (preferred && list.some((item) => item.value === preferred)) return preferred;
        if (prev && list.some((item) => item.value === prev)) return prev;
        return list[0]?.value || "";
      });
    } catch {
      setModels([]);
      setModelsError(
        nextChannelId === 0
          ? "当前登录账号还没有可用的 API Key，取不到文本模型清单：请先到「API Key 管理」生成一把 sk- Key"
          : "这个渠道的文本模型清单读取失败：请到「模型设置」检查渠道地址与 Key",
      );
    } finally {
      setModelsLoading(false);
    }
  };

  const load = async () => {
    try {
      const [datasetData, sessionData] = await Promise.all([
        biApi.datasets({ query: { page: 1, pageSize: 200 } }),
        biApi.sessions({ query: { page: 1, pageSize: 30 } }),
      ]);
      setDatasets((datasetData?.list || []).map((item) => ({ id: item.id, name: item.name })));
      setSessions((sessionData?.list || []) as never);
      if (!datasetId && datasetData?.list?.length) setDatasetId(datasetData.list[0].id);
    } catch (error) {
      message.error(err(error));
    }
  };

  useEffect(() => {
    void load();
    void (async () => {
      try {
        const settings = await contentApi.settings();
        if (!settings) return;
        setChannels(
          settings.channels.map((item) => ({
            value: item.id,
            label: item.id === 0 ? `${item.name}（内置）` : item.name,
          })),
        );
        const slot = settings.slots.find((item) => item.mediaType === "text");
        const nextChannelId = slot?.channelId ?? 0;
        setChannelId(nextChannelId);
        await loadModels(nextChannelId, slot?.model || "");
      } catch {
        // 读不到模型清单时仍可浏览历史；发送前会提示先选模型
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 首屏只跑一次
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, result, busy]);

  const openSession = async (id: number) => {
    try {
      const data = await biApi.session({ params: { id: String(id) } });
      setSessionId(id);
      setDatasetId(data!.session.datasetId || datasetId);
      setMessages((data!.messages || []) as Array<Record<string, unknown>>);
      setResult(null);
      setLastAsked("");
    } catch (error) {
      message.error(err(error));
    }
  };

  const resetConversation = () => {
    setSessionId(0);
    setMessages([]);
    setResult(null);
    setLastAsked("");
    setQuestion("");
  };

  const ask = async () => {
    if (!question.trim()) return;
    if (!datasetId && !sessionId) {
      message.warning("请先选择数据集");
      return;
    }
    if (!model) {
      message.warning("请先选择渠道和文本模型");
      return;
    }
    const asked = question.trim();
    setBusy(true);
    setStage("正在理解问题…");
    setResult(null);
    setLastAsked(asked);
    try {
      await streamBiAsk(
        {
          sessionId,
          datasetId,
          question: asked,
          channelId,
          model,
        },
        (event, data) => {
          if (event === "status") setStage(String(data.message || ""));
          if (event === "result") {
            setResult(data as AskResult);
            setQuestion("");
            void load();
            if (data.sessionId) setSessionId(Number(data.sessionId));
          }
          if (event === "error") message.error(String(data.message || "问数失败"));
        },
      );
    } catch (error) {
      message.error(err(error));
    } finally {
      setBusy(false);
      setStage("");
    }
  };

  const activeSession = sessions.find((item) => item.id === sessionId);
  const activeDataset = datasets.find((item) => item.id === datasetId);

  const renderResult = (data: AskResult) => (
    <>
      <div className="bi-result-head">
        <span>
          查询 {data.rowCount || 0} 行 · {data.elapsedMs || 0} ms
          {data.truncated ? " · 结果已截断" : ""}
        </span>
        {data.messageId ? (
          <Button
            size="small"
            onClick={async () => {
              try {
                const file = await biApi.createExport({ body: { type: "ASK", id: Number(data.messageId) } });
                downloadText(file!.filename, file!.content);
              } catch (error) {
                message.error(err(error));
              }
            }}
          >
            导出结果
          </Button>
        ) : null}
      </div>
      <ChartRenderer
        type={String(data.chart?.type || "TABLE")}
        columns={data.columns || []}
        rows={data.rows || []}
        config={data.chart as never}
      />
      {data.analysis ? <div className="bi-analysis">{data.analysis}</div> : null}
      {data.followups?.length ? (
        <div className="bi-followups">
          {data.followups.map((item) => (
            <Button key={item} onClick={() => setQuestion(item)}>
              {item}
            </Button>
          ))}
        </div>
      ) : null}
      {data.sql ? (
        <details className="bi-sql">
          <summary>查看 SQL</summary>
          <pre>{data.sql}</pre>
        </details>
      ) : null}
    </>
  );

  return (
    <div className="agent-shell">
      <Panel
        title="会话"
        extra={
          <Button icon={<PlusOutlined aria-hidden />} onClick={resetConversation}>
            新建
          </Button>
        }
      >
        <div className="agent-conv-list">
          {sessions.map((item) => (
            <div
              key={item.id}
              className={`agent-conv${sessionId === item.id ? " active" : ""}`}
              onClick={() => void openSession(item.id)}
            >
              <span className="agent-conv-title">{item.title || "未命名"}</span>
              <span className="text-12 muted">
                {item.updatedAt.replace("T", " ").slice(5, 16)}
              </span>
            </div>
          ))}
          {sessions.length ? null : (
            <div className="text-12 muted">还没有问数，点「新建」或直接问一个问题</div>
          )}
        </div>
      </Panel>

      <Panel
        title="对话"
        titleExtra={
          <span className="text-12 muted">
            {activeSession?.datasetName || activeDataset?.name
              ? `数据集：${activeSession?.datasetName || activeDataset?.name}`
              : "选择数据集后用自然语言提问"}
          </span>
        }
      >
        <div className="agent-thread">
          {!messages.length && !result && !busy ? (
            <div className="agent-empty">
              <div className="agent-empty-icon">
                <RobotOutlined aria-hidden />
              </div>
              <div className="agent-empty-title">问一个业务问题</div>
              <p className="agent-empty-desc">
                选择数据集，用自然语言提问，例如「本月各阶段商机金额」。BI 会生成 SQL，并把结果画成图表、给出分析。
              </p>
            </div>
          ) : null}

          {messages.map((item) =>
            item.role === "user" ? (
              <article className="agent-turn agent-turn-user" key={String(item.id)}>
                <div className="agent-turn-meta">
                  <span className="agent-turn-name">我</span>
                </div>
                <div className="agent-bubble agent-bubble-user">
                  {String(item.question || "")}
                </div>
              </article>
            ) : (
              <article className="agent-turn agent-turn-agent" key={String(item.id)}>
                <div className="agent-avatar" aria-hidden>
                  <RobotOutlined />
                </div>
                <div className="agent-turn-main">
                  <div className="agent-turn-meta">
                    <span className="agent-turn-name">BI</span>
                  </div>
                  <div className="agent-bubble agent-bubble-agent">
                    {String(item.analysis || item.error || "—")}
                    {item.sqlText ? (
                      <details className="bi-sql">
                        <summary>查看 SQL</summary>
                        <pre>{String(item.sqlText)}</pre>
                      </details>
                    ) : null}
                  </div>
                </div>
              </article>
            ),
          )}

          {lastAsked && result ? (
            <article className="agent-turn agent-turn-user">
              <div className="agent-turn-meta">
                <span className="agent-turn-name">我</span>
              </div>
              <div className="agent-bubble agent-bubble-user">{lastAsked}</div>
            </article>
          ) : null}
          {result ? (
            <article className="agent-turn agent-turn-agent">
              <div className="agent-avatar" aria-hidden>
                <RobotOutlined />
              </div>
              <div className="agent-turn-main">
                <div className="agent-turn-meta">
                  <span className="agent-turn-name">BI</span>
                </div>
                <div
                  className="agent-bubble agent-bubble-agent"
                  style={{ maxWidth: "100%", width: "100%" }}
                >
                  {renderResult(result)}
                </div>
              </div>
            </article>
          ) : null}

          {busy ? (
            <article className="agent-turn agent-turn-agent">
              <div className="agent-avatar" aria-hidden>
                <RobotOutlined />
              </div>
              <div className="agent-turn-main">
                <div className="agent-turn-meta">
                  <span className="agent-turn-name">BI</span>
                  <span className="agent-running">{stage || "正在查询…"}</span>
                </div>
                <div className="agent-bubble agent-bubble-agent">
                  <span className="agent-typing" aria-label="正在查询">
                    <span />
                    <span />
                    <span />
                  </span>
                </div>
              </div>
            </article>
          ) : null}
          <div ref={bottomRef} />
        </div>

        <div
          style={{
            display: "grid",
            gap: 8,
            marginTop: 16,
            padding: 12,
            background: "var(--card, #fff)",
            border: "1px solid var(--border, #f0f0f0)",
            borderRadius: 12,
          }}
        >
          <Input.TextArea
            value={question}
            autoSize={{ minRows: 2, maxRows: 6 }}
            placeholder="用自然语言提问；Enter 换行，点「发送」查询"
            onChange={(event) => setQuestion(event.target.value)}
          />
          {modelsError ? (
            <Notice variant="error">
              {modelsError}{" "}
              {channelId === 0 ? (
                <Link href="/developer/keys">去「API Key 管理」</Link>
              ) : (
                <Link href="/model-settings">去「模型设置」</Link>
              )}
            </Notice>
          ) : null}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Select
              style={{ width: 220 }}
              prefix="数据集"
              value={datasetId || undefined}
              placeholder={datasets.length ? "选择数据集" : "还没有数据集"}
              options={datasets.map((item) => ({ value: item.id, label: item.name }))}
              onChange={setDatasetId}
            />
            <Select
              style={{ width: 160 }}
              prefix="渠道"
              value={channelId}
              placeholder="先选渠道"
              options={channels}
              onChange={(value: number) => {
                setChannelId(value);
                void loadModels(value);
              }}
            />
            <Select
              style={{ width: 200 }}
              prefix="文本模型"
              value={model || undefined}
              placeholder={
                modelsLoading
                  ? "正在读取模型…"
                  : models.length
                    ? "选择模型"
                    : "该渠道没有文本模型"
              }
              options={models}
              loading={modelsLoading}
              disabled={!models.length}
              showSearch
              optionFilterProp="label"
              onChange={setModel}
            />
            <Button
              type="primary"
              icon={<SendOutlined aria-hidden />}
              disabled={!question.trim() || !model || busy}
              loading={busy}
              style={{ marginLeft: "auto" }}
              onClick={() => void ask()}
            >
              发送
            </Button>
          </div>
        </div>
      </Panel>
    </div>
  );
}

export function BiDatasetsTab() {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [datasources, setDatasources] = useState<Array<Record<string, unknown>>>([]);
  const [tables, setTables] = useState<Array<Record<string, unknown>>>([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    name: "",
    type: "INTERNAL",
    internalKey: "LEADS",
    datasourceId: 0,
    tableIds: [] as number[],
    sqlText: "",
    description: "",
  });
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof biApi.dataset>> | null>(null);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof biApi.previewDataset>> | null>(null);
  const [rowFilter, setRowFilter] = useState("");

  const load = async () => {
    try {
      const [data, sources] = await Promise.all([
        biApi.datasets({ query: { page: 1, pageSize: 100 } }),
        biApi.datasources(),
      ]);
      setRows((data?.list || []) as Array<Record<string, unknown>>);
      setDatasources((sources || []) as Array<Record<string, unknown>>);
    } catch (error) {
      message.error(err(error));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!draft.datasourceId) {
      setTables([]);
      return;
    }
    void biApi
      .datasourceTables({ params: { id: String(draft.datasourceId) } })
      .then((data) => setTables((data || []) as Array<Record<string, unknown>>))
      .catch(() => setTables([]));
  }, [draft.datasourceId]);

  const openDetail = async (id: number) => {
    try {
      const data = await biApi.dataset({ params: { id: String(id) } });
      setDetail(data);
      setPreview(null);
      const analyst = data?.permissions.find((item) => item.role === "ANALYST");
      setRowFilter(String(analyst?.rowFilter || ""));
    } catch (error) {
      message.error(err(error));
    }
  };

  return (
    <div className="crm-stack">
      <Panel title="数据集" extra={<Button onClick={() => setOpen(true)}>新建数据集</Button>}>
        <Table
          rowKey="id"
          size="middle"
          dataSource={rows}
          pagination={false}
          columns={[
            { title: "名称", dataIndex: "name" },
            { title: "类型", dataIndex: "typeLabel", width: 110 },
            { title: "数据源", dataIndex: "datasourceName", width: 160 },
            { title: "字段", dataIndex: "fieldCount", width: 80 },
            { title: "图表", dataIndex: "chartCount", width: 80 },
            {
              title: "操作",
              width: 140,
              render: (_: unknown, row: Record<string, unknown>) => (
                <Space size={0}>
                  <Button type="link" size="small" onClick={() => void openDetail(Number(row.id))}>详情</Button>
                  <Button
                    type="link"
                    size="small"
                    danger
                    onClick={async () => {
                      await biApi.removeDataset({ params: { id: String(row.id) } });
                      void load();
                    }}
                  >
                    删除
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Panel>

      <Modal
        open={open}
        title="新建数据集"
        width={720}
        onCancel={() => setOpen(false)}
        onOk={async () => {
          try {
            await biApi.createDataset({
              body: {
                name: draft.name,
                groupId: 0,
                type: draft.type as never,
                internalKey: draft.internalKey,
                datasourceId: draft.datasourceId,
                tableIds: draft.tableIds,
                sqlText: draft.sqlText,
                description: draft.description,
              },
            });
            setOpen(false);
            void load();
          } catch (error) {
            message.error(err(error));
          }
        }}
      >
        <Space orientation="vertical" style={{ width: "100%" }}>
          <Input placeholder="数据集名称" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          <Select
            value={draft.type}
            onChange={(value) => setDraft({ ...draft, type: value })}
            options={[
              { value: "INTERNAL", label: "内置策展数据集（CRM）" },
              { value: "TABLE", label: "外部表数据集" },
              { value: "SQL", label: "外部 SQL 数据集（只读）" },
            ]}
          />
          {draft.type === "INTERNAL" ? (
            <Select value={draft.internalKey} onChange={(value) => setDraft({ ...draft, internalKey: value })} options={INTERNAL_DATASETS} />
          ) : (
            <>
              <Select
                placeholder="选择外部数据源"
                value={draft.datasourceId || undefined}
                onChange={(value) => setDraft({ ...draft, datasourceId: value, tableIds: [] })}
                options={datasources
                  .filter((item) => item.kind === "EXTERNAL")
                  .map((item) => ({ value: Number(item.id), label: String(item.name) }))}
              />
              {draft.type === "TABLE" ? (
                <Select
                  mode="multiple"
                  placeholder="选择表"
                  value={draft.tableIds}
                  onChange={(value) => setDraft({ ...draft, tableIds: value })}
                  options={tables.map((item) => ({ value: Number(item.id), label: String(item.tableName) }))}
                />
              ) : (
                <Input.TextArea
                  rows={6}
                  placeholder="只读 SQL，例如 SELECT * FROM orders WHERE amount > 0"
                  value={draft.sqlText}
                  onChange={(event) => setDraft({ ...draft, sqlText: event.target.value })}
                />
              )}
            </>
          )}
          <Input placeholder="说明" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
        </Space>
      </Modal>

      <Drawer
        open={Boolean(detail)}
        size={1000}
        title={detail?.dataset.name}
        onClose={() => setDetail(null)}
        extra={
          <Space>
            <Button
              onClick={async () => {
                if (!detail) return;
                try {
                  setPreview(await biApi.previewDataset({ params: { id: String(detail.dataset.id) }, query: { limit: 20 } }));
                } catch (error) {
                  message.error(err(error));
                }
              }}
            >
              预览
            </Button>
          </Space>
        }
      >
        {detail ? (
          <Tabs
            items={[
              {
                key: "fields",
                label: `字段（${detail.fields.length}）`,
                children: (
                  <Table
                    rowKey="fieldKey"
                    size="small"
                    pagination={false}
                    dataSource={detail.fields}
                    columns={[
                      { title: "标识", dataIndex: "fieldKey", width: 180 },
                      { title: "名称", dataIndex: "name", width: 160 },
                      { title: "类型", dataIndex: "type", width: 120 },
                      { title: "角色", dataIndex: "role", width: 100 },
                      { title: "聚合", dataIndex: "aggregate", width: 90 },
                      { title: "注释", dataIndex: "comment" },
                    ]}
                  />
                ),
              },
              {
                key: "preview",
                label: "预览",
                children: preview ? (
                  <ChartRenderer type="TABLE" columns={preview.columns} rows={preview.rows} />
                ) : (
                  <div className="muted">点右上角「预览」查看前 20 行</div>
                ),
              },
              {
                key: "permission",
                label: "行权限",
                children: (
                  <Space orientation="vertical" style={{ width: "100%" }}>
                    <div className="muted">
                      按 ANALYST 级别配置行过滤，可用 {"${userId}"} 引用当前用户。留空表示不额外限制；CRM 数据仍套用 CRM 数据范围。
                    </div>
                    <Input.TextArea rows={4} value={rowFilter} onChange={(event) => setRowFilter(event.target.value)} />
                    <Button
                      type="primary"
                      onClick={async () => {
                        await biApi.saveDatasetPermission({
                          params: { id: String(detail.dataset.id) },
                          body: { role: "ANALYST", rowFilter, columnRules: {} },
                        });
                        message.success("已保存");
                      }}
                    >
                      保存行权限
                    </Button>
                  </Space>
                ),
              },
            ]}
          />
        ) : null}
      </Drawer>
    </div>
  );
}

export function BiChartsTab() {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [datasets, setDatasets] = useState<Array<{ id: number; name: string }>>([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    id: 0,
    datasetId: 0,
    name: "",
    chartType: "BAR",
    dimensions: [] as string[],
    measures: [] as string[],
  });
  const [fields, setFields] = useState<Array<Record<string, unknown>>>([]);
  const [data, setData] = useState<Awaited<ReturnType<typeof biApi.chartData>> | null>(null);

  const load = async () => {
    try {
      const [chartData, datasetData] = await Promise.all([
        biApi.charts({ query: { page: 1, pageSize: 100 } }),
        biApi.datasets({ query: { page: 1, pageSize: 200 } }),
      ]);
      setRows((chartData?.list || []) as Array<Record<string, unknown>>);
      setDatasets((datasetData?.list || []).map((item) => ({ id: item.id, name: item.name })));
    } catch (error) {
      message.error(err(error));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!draft.datasetId) {
      setFields([]);
      return;
    }
    void biApi
      .datasetFields({ params: { id: String(draft.datasetId) } })
      .then((items) => setFields((items || []) as Array<Record<string, unknown>>))
      .catch(() => setFields([]));
  }, [draft.datasetId]);

  return (
    <div className="crm-stack">
      <Panel
        title="图表"
        extra={
          <Button
            onClick={() => {
              setDraft({ id: 0, datasetId: datasets[0]?.id || 0, name: "", chartType: "BAR", dimensions: [], measures: [] });
              setData(null);
              setOpen(true);
            }}
          >
            新建图表
          </Button>
        }
      >
        <Table
          rowKey="id"
          size="middle"
          dataSource={rows}
          pagination={false}
          columns={[
            { title: "名称", dataIndex: "name" },
            { title: "数据集", dataIndex: "datasetName", width: 180 },
            { title: "类型", dataIndex: "chartTypeLabel", width: 100 },
            {
              title: "操作",
              width: 180,
              render: (_: unknown, row: Record<string, unknown>) => (
                <Space size={0}>
                  <Button
                    type="link"
                    size="small"
                    onClick={async () => {
                      setData(await biApi.chartData({ params: { id: String(row.id) } }));
                      setDraft({
                        id: Number(row.id),
                        datasetId: Number(row.datasetId),
                        name: String(row.name),
                        chartType: String(row.chartType),
                        dimensions: ((row.config as Record<string, unknown>)?.dimensions as string[]) || [],
                        measures: (((row.config as Record<string, unknown>)?.measures as Array<Record<string, unknown>>) || []).map((item) => String(item.key)),
                      });
                      setOpen(true);
                    }}
                  >
                    打开
                  </Button>
                  <Button
                    type="link"
                    size="small"
                    danger
                    onClick={async () => {
                      await biApi.removeChart({ params: { id: String(row.id) } });
                      void load();
                    }}
                  >
                    删除
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Panel>

      <Modal
        open={open}
        title={draft.id ? "编辑图表" : "新建图表"}
        width={860}
        onCancel={() => setOpen(false)}
        onOk={async () => {
          try {
            await biApi.saveChart({
              body: {
                ...(draft.id ? { id: draft.id } : {}),
                datasetId: draft.datasetId,
                name: draft.name || "未命名图表",
                chartType: draft.chartType as never,
                config: {
                  dimensions: draft.dimensions,
                  measures: draft.measures.map((key) => ({ key, aggregate: "SUM" })),
                },
              },
            });
            setOpen(false);
            void load();
            message.success("已保存");
          } catch (error) {
            message.error(err(error));
          }
        }}
      >
        <Space orientation="vertical" style={{ width: "100%" }}>
          <Input placeholder="图表名称" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          <Space wrap>
            <Select
              style={{ width: 220 }}
              value={draft.datasetId || undefined}
              placeholder="数据集"
              onChange={(value) => setDraft({ ...draft, datasetId: value, dimensions: [], measures: [] })}
              options={datasets.map((item) => ({ value: item.id, label: item.name }))}
            />
            <Select style={{ width: 160 }} value={draft.chartType} onChange={(value) => setDraft({ ...draft, chartType: value })} options={CHART_TYPES} />
          </Space>
          <Select
            mode="multiple"
            placeholder="维度"
            value={draft.dimensions}
            onChange={(value) => setDraft({ ...draft, dimensions: value })}
            options={fields.filter((item) => item.role === "DIMENSION").map((item) => ({ value: String(item.fieldKey), label: String(item.name) }))}
          />
          <Select
            mode="multiple"
            placeholder="指标"
            value={draft.measures}
            onChange={(value) => setDraft({ ...draft, measures: value })}
            options={fields.filter((item) => item.role === "MEASURE").map((item) => ({ value: String(item.fieldKey), label: String(item.name) }))}
          />
          {data ? (
            <ChartRenderer
              type={data.chart.chartType}
              columns={data.columns}
              rows={data.rows}
              config={data.chart.config as never}
            />
          ) : null}
        </Space>
      </Modal>
    </div>
  );
}

export function BiDashboardsTab() {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [charts, setCharts] = useState<Array<Record<string, unknown>>>([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    id: 0,
    name: "",
    components: [] as Array<Record<string, unknown>>,
  });
  const [data, setData] = useState<Awaited<ReturnType<typeof biApi.dashboardData>> | null>(null);

  const load = async () => {
    try {
      const [dashboardData, chartData] = await Promise.all([
        biApi.dashboards({ query: { page: 1, pageSize: 100 } }),
        biApi.charts({ query: { page: 1, pageSize: 200 } }),
      ]);
      setRows((dashboardData?.list || []) as Array<Record<string, unknown>>);
      setCharts((chartData?.list || []) as Array<Record<string, unknown>>);
    } catch (error) {
      message.error(err(error));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const openDashboard = async (id: number) => {
    const detail = await biApi.dashboard({ params: { id: String(id) } });
    setDraft({
      id,
      name: detail?.dashboard.name || "",
      components: (detail?.components || []).map((item) => ({
        id: item.id,
        chartId: item.chartId,
        type: item.type,
        title: item.title,
        position: item.position,
        config: item.config,
      })),
    });
    setData(null);
    setOpen(true);
  };

  const move = (index: number, direction: -1 | 1) => {
    const next = [...draft.components];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setDraft({ ...draft, components: next });
  };

  return (
    <div className="crm-stack">
      <Panel
        title="仪表板"
        extra={
          <Button
            onClick={() => {
              setDraft({ id: 0, name: "", components: [] });
              setData(null);
              setOpen(true);
            }}
          >
            新建仪表板
          </Button>
        }
      >
        <Table
          rowKey="id"
          size="middle"
          dataSource={rows}
          pagination={false}
          columns={[
            { title: "名称", dataIndex: "name" },
            { title: "组件", dataIndex: "componentCount", width: 80 },
            { title: "更新时间", dataIndex: "updatedAt", width: 170, render: (value: string) => value?.replace("T", " ").slice(0, 16) },
            {
              title: "操作",
              width: 180,
              render: (_: unknown, row: Record<string, unknown>) => (
                <Space size={0}>
                  <Button type="link" size="small" onClick={() => void openDashboard(Number(row.id))}>打开</Button>
                  <Button
                    type="link"
                    size="small"
                    danger
                    onClick={async () => {
                      await biApi.removeDashboard({ params: { id: String(row.id) } });
                      void load();
                    }}
                  >
                    删除
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Panel>

      <Modal
        open={open}
        title={draft.id ? "编辑仪表板" : "新建仪表板"}
        width={1080}
        onCancel={() => setOpen(false)}
        onOk={async () => {
          try {
            await biApi.saveDashboard({
              body: {
                ...(draft.id ? { id: draft.id } : {}),
                name: draft.name || "未命名仪表板",
                config: {},
                layout: draft.components.map((item, index) => ({ index })),
                components: draft.components.map((item, index) => ({
                  ...(item.id ? { id: Number(item.id) } : {}),
                  chartId: Number(item.chartId) || 0,
                  type: String(item.type || "CHART") as never,
                  title: String(item.title || ""),
                  position: { order: index, width: Number((item.position as Record<string, unknown>)?.width || 6) },
                  config: (item.config || {}) as never,
                  sort: index,
                })),
              },
            });
            setOpen(false);
            void load();
            message.success("已保存");
          } catch (error) {
            message.error(err(error));
          }
        }}
      >
        <Space orientation="vertical" style={{ width: "100%" }}>
          <Input placeholder="仪表板名称" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          <Space wrap>
            <Select
              style={{ width: 240 }}
              placeholder="添加图表组件"
              value={undefined}
              onChange={(value) => {
                const chart = charts.find((item) => Number(item.id) === value);
                if (!chart) return;
                setDraft({
                  ...draft,
                  components: [
                    ...draft.components,
                    {
                      chartId: value,
                      type: "CHART",
                      title: String(chart.name),
                      position: { width: 6 },
                      config: {},
                    },
                  ],
                });
              }}
              options={charts.map((item) => ({ value: Number(item.id), label: String(item.name) }))}
            />
            <Button
              onClick={() =>
                setDraft({
                  ...draft,
                  components: [...draft.components, { type: "TEXT", title: "说明", position: { width: 12 }, config: { text: "这里写说明" } }],
                })
              }
            >
              添加文本
            </Button>
            <Button
              onClick={async () => {
                if (!draft.id) {
                  message.warning("先保存仪表板再预览");
                  return;
                }
                setData(await biApi.dashboardData({ params: { id: String(draft.id) } }));
              }}
            >
              预览数据
            </Button>
          </Space>
          {draft.components.map((item, index) => (
            <div className="bi-component-row" key={`${item.chartId}-${index}`}>
              <b>{String(item.title || item.type)}</b>
              <Select
                style={{ width: 110 }}
                value={Number((item.position as Record<string, unknown>)?.width || 6)}
                onChange={(value) => {
                  const next = [...draft.components];
                  next[index] = { ...next[index], position: { width: value } };
                  setDraft({ ...draft, components: next });
                }}
                options={[3, 4, 6, 8, 12].map((value) => ({ value, label: `${value} / 12 宽` }))}
              />
              <Space size={0}>
                <Button type="link" size="small" onClick={() => move(index, -1)}>上移</Button>
                <Button type="link" size="small" onClick={() => move(index, 1)}>下移</Button>
                <Button
                  type="link"
                  size="small"
                  danger
                  onClick={() => setDraft({ ...draft, components: draft.components.filter((_, i) => i !== index) })}
                >
                  移除
                </Button>
              </Space>
            </div>
          ))}
          {data ? (
            <div className="bi-dashboard-preview">
              {data.components.map((item) => (
                <div
                  className="bi-dashboard-card"
                  key={item.id}
                  style={{ gridColumn: `span ${Math.min(12, Math.max(3, Number((item.position as Record<string, unknown>)?.width || 6)))}` }}
                >
                  <div className="bi-dashboard-title">{item.title || item.chart?.name}</div>
                  {item.error ? (
                    <div className="muted">{item.error}</div>
                  ) : item.type === "TEXT" ? (
                    <div>{String((item.config as Record<string, unknown>)?.text || "")}</div>
                  ) : item.chart ? (
                    <ChartRenderer
                      type={item.chart.chartType}
                      columns={item.columns}
                      rows={item.rows}
                      config={item.chart.config as never}
                      height={220}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </Space>
      </Modal>
    </div>
  );
}

export function BiDatasourcesTab() {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    id: 0,
    name: "",
    type: "PG",
    host: "",
    port: 5432,
    database: "",
    schema: "public",
    username: "",
    password: "",
    ssl: false,
  });
  const [tables, setTables] = useState<Array<Record<string, unknown>> | null>(null);
  const [current, setCurrent] = useState<Record<string, unknown> | null>(null);

  const load = async () => {
    try {
      setRows((await biApi.datasources()) as Array<Record<string, unknown>>);
    } catch (error) {
      message.error(err(error));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="crm-stack">
      <Panel
        title="数据源"
        extra={
          <Button
            onClick={() => {
              setDraft({ id: 0, name: "", type: "PG", host: "", port: 5432, database: "", schema: "public", username: "", password: "", ssl: false });
              setOpen(true);
            }}
          >
            新增外部数据源
          </Button>
        }
      >
        <Table
          rowKey="id"
          size="middle"
          dataSource={rows}
          pagination={false}
          columns={[
            { title: "名称", dataIndex: "name" },
            { title: "类型", dataIndex: "typeLabel", width: 130 },
            { title: "主机", dataIndex: "host", width: 180 },
            { title: "库", dataIndex: "database", width: 140 },
            { title: "表", dataIndex: "tableCount", width: 70 },
            {
              title: "状态",
              width: 100,
              render: (_: unknown, row: Record<string, unknown>) =>
                row.kind === "INTERNAL" ? <Tag color="blue">内置</Tag> : <Tag color={row.status === "ACTIVE" ? "green" : "red"}>{row.status === "ACTIVE" ? "正常" : "异常"}</Tag>,
            },
            {
              title: "操作",
              width: 320,
              render: (_: unknown, row: Record<string, unknown>) => {
                if (row.kind === "INTERNAL") return <span className="muted">平台维护，只读</span>;
                return (
                  <Space size={0}>
                    <Button
                      type="link"
                      size="small"
                      onClick={async () => {
                        try {
                          const result = await biApi.testDatasource({ params: { id: String(row.id) } });
                          message[result!.ok ? "success" : "error"](result!.message);
                          void load();
                        } catch (error) {
                          message.error(err(error));
                        }
                      }}
                    >
                      测试
                    </Button>
                    <Button
                      type="link"
                      size="small"
                      onClick={async () => {
                        try {
                          const result = await biApi.syncDatasource({ params: { id: String(row.id) } });
                          message.success(`已同步 ${result!.tables} 张表、${result!.fields} 个字段`);
                          void load();
                        } catch (error) {
                          message.error(err(error));
                        }
                      }}
                    >
                      同步表结构
                    </Button>
                    <Button
                      type="link"
                      size="small"
                      onClick={async () => {
                        setCurrent(row);
                        setTables((await biApi.datasourceTables({ params: { id: String(row.id) } })) as Array<Record<string, unknown>>);
                      }}
                    >
                      表
                    </Button>
                    <Button
                      type="link"
                      size="small"
                      onClick={() => {
                        setDraft({
                          id: Number(row.id),
                          name: String(row.name),
                          type: String(row.type),
                          host: String(row.host),
                          port: Number(row.port),
                          database: String(row.database),
                          schema: String(row.schema),
                          username: String(row.username),
                          password: "",
                          ssl: Boolean(row.ssl),
                        });
                        setOpen(true);
                      }}
                    >
                      编辑
                    </Button>
                    <Button
                      type="link"
                      size="small"
                      danger
                      onClick={async () => {
                        await biApi.removeDatasource({ params: { id: String(row.id) } });
                        void load();
                      }}
                    >
                      删除
                    </Button>
                  </Space>
                );
              },
            },
          ]}
        />
      </Panel>

      <Modal
        open={open}
        title={draft.id ? "编辑数据源" : "新增数据源"}
        width={720}
        onCancel={() => setOpen(false)}
        onOk={async () => {
          try {
            const body = { ...draft } as Record<string, unknown>;
            delete body.id;
            if (draft.id) await biApi.updateDatasource({ params: { id: String(draft.id) }, body: body as never });
            else await biApi.createDatasource({ body: body as never });
            setOpen(false);
            void load();
          } catch (error) {
            message.error(err(error));
          }
        }}
      >
        <Space orientation="vertical" style={{ width: "100%" }}>
          <Input placeholder="名称" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          <Select
            value={draft.type}
            onChange={(value) => setDraft({ ...draft, type: value, port: value === "PG" ? 5432 : 3306 })}
            options={[
              { value: "PG", label: "PostgreSQL" },
              { value: "MYSQL", label: "MySQL" },
            ]}
          />
          <Input placeholder="主机" value={draft.host} onChange={(event) => setDraft({ ...draft, host: event.target.value })} />
          <InputNumber style={{ width: "100%" }} placeholder="端口" value={draft.port} onChange={(value) => setDraft({ ...draft, port: Number(value || 0) })} />
          <Input placeholder="库名" value={draft.database} onChange={(event) => setDraft({ ...draft, database: event.target.value })} />
          {draft.type === "PG" ? <Input placeholder="schema" value={draft.schema} onChange={(event) => setDraft({ ...draft, schema: event.target.value })} /> : null}
          <Input placeholder="用户名" value={draft.username} onChange={(event) => setDraft({ ...draft, username: event.target.value })} />
          <Input.Password placeholder={draft.id ? "留空表示不修改密码" : "密码"} value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} />
          <Space>
            <span>SSL</span>
            <Switch checked={draft.ssl} onChange={(value) => setDraft({ ...draft, ssl: value })} />
          </Space>
        </Space>
      </Modal>

      <Drawer open={Boolean(tables)} size={760} title={`${current?.name || ""} 表结构`} onClose={() => setTables(null)}>
        {tables?.map((table) => (
          <Panel key={String(table.id)} title={String(table.tableName)} titleExtra={String(table.tableComment || "")}>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={(table.fields as Array<Record<string, unknown>>) || []}
              columns={[
                { title: "字段", dataIndex: "fieldName" },
                { title: "类型", dataIndex: "fieldType", width: 160 },
                { title: "注释", dataIndex: "fieldComment" },
              ]}
            />
          </Panel>
        ))}
      </Drawer>
    </div>
  );
}

export function BiSettingsTab() {
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [draft, setDraft] = useState({ defaultTextChannelId: 0, defaultTextModel: "", maxRows: 10000, queryTimeoutMs: 30000 });
  const [members, setMembers] = useState<{ rows: Array<Record<string, unknown>>; candidates: Array<Record<string, unknown>> } | null>(null);
  const [terms, setTerms] = useState<Array<Record<string, unknown>>>([]);
  const [trainings, setTrainings] = useState<Array<Record<string, unknown>>>([]);
  const [recommended, setRecommended] = useState<Array<Record<string, unknown>>>([]);
  const [logs, setLogs] = useState<Array<Record<string, unknown>>>([]);
  const [memberDraft, setMemberDraft] = useState({ memberUserId: "", role: "ANALYST" });
  const [termDraft, setTermDraft] = useState({ term: "", definition: "" });
  const [trainingDraft, setTrainingDraft] = useState({ question: "", sqlText: "" });
  const [questionDraft, setQuestionDraft] = useState("");

  const load = async () => {
    try {
      const [settingData, memberData, termData, trainingData, questionData, logData] = await Promise.all([
        biApi.settings(),
        biApi.members(),
        biApi.terms({ query: {} }),
        biApi.trainings({ query: {} }),
        biApi.recommendedQuestions({ query: {} }),
        biApi.queryLogs({ query: { page: 1, pageSize: 50 } }),
      ]);
      setSettings(settingData as Record<string, unknown>);
      setDraft({
        defaultTextChannelId: Number((settingData || {}).defaultTextChannelId || 0),
        defaultTextModel: String((settingData || {}).defaultTextModel || ""),
        maxRows: Number((settingData || {}).maxRows || 10000),
        queryTimeoutMs: Number((settingData || {}).queryTimeoutMs || 30000),
      });
      setMembers(memberData as never);
      setTerms((termData || []) as Array<Record<string, unknown>>);
      setTrainings((trainingData || []) as Array<Record<string, unknown>>);
      setRecommended((questionData || []) as Array<Record<string, unknown>>);
      setLogs((logData?.list || []) as Array<Record<string, unknown>>);
    } catch (error) {
      message.error(err(error));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (!settings) return <div className="muted">加载中…</div>;

  return (
    <Tabs
      items={[
        {
          key: "model",
          label: "模型与设置",
          children: (
            <Panel title="模型与查询限制">
              <Space orientation="vertical" style={{ width: 420 }}>
                <InputNumber
                  style={{ width: "100%" }}
                  placeholder="默认文本渠道 ID（0＝AIPDD）"
                  value={draft.defaultTextChannelId}
                  onChange={(value) => setDraft({ ...draft, defaultTextChannelId: Number(value || 0) })}
                />
                <Input placeholder="默认文本模型" value={draft.defaultTextModel} onChange={(event) => setDraft({ ...draft, defaultTextModel: event.target.value })} />
                <InputNumber style={{ width: "100%" }} min={100} max={50000} value={draft.maxRows} onChange={(value) => setDraft({ ...draft, maxRows: Number(value || 10000) })} />
                <InputNumber style={{ width: "100%" }} min={1000} max={120000} value={draft.queryTimeoutMs} onChange={(value) => setDraft({ ...draft, queryTimeoutMs: Number(value || 30000) })} />
                <Button
                  type="primary"
                  onClick={async () => {
                    await biApi.saveSettings({ body: draft });
                    message.success("已保存");
                    void load();
                  }}
                >
                  保存设置
                </Button>
              </Space>
            </Panel>
          ),
        },
        {
          key: "members",
          label: "成员",
          children: (
            <Panel title="成员与权限">
              <Space wrap style={{ marginBottom: 12 }}>
                <Select
                  style={{ width: 220 }}
                  placeholder="选择成员"
                  value={memberDraft.memberUserId || undefined}
                  onChange={(value) => setMemberDraft({ ...memberDraft, memberUserId: value })}
                  options={(members?.candidates || []).map((item) => ({ value: String(item.memberUserId), label: String(item.name) }))}
                />
                <Select
                  style={{ width: 140 }}
                  value={memberDraft.role}
                  onChange={(value) => setMemberDraft({ ...memberDraft, role: value })}
                  options={[
                    { value: "ADMIN", label: "管理员" },
                    { value: "EDITOR", label: "编辑" },
                    { value: "ANALYST", label: "分析" },
                    { value: "VIEWER", label: "只读" },
                  ]}
                />
                <Button
                  type="primary"
                  onClick={async () => {
                    await biApi.saveMember({ body: memberDraft as never });
                    void load();
                  }}
                >
                  添加
                </Button>
              </Space>
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={members?.rows || []}
                columns={[
                  { title: "成员", dataIndex: "memberName" },
                  { title: "权限", dataIndex: "roleLabel" },
                  {
                    title: "",
                    width: 80,
                    render: (_: unknown, row: Record<string, unknown>) => (
                      <Button
                        type="link"
                        size="small"
                        danger
                        onClick={async () => {
                          await biApi.removeMember({ params: { id: String(row.id) } });
                          void load();
                        }}
                      >
                        移除
                      </Button>
                    ),
                  },
                ]}
              />
            </Panel>
          ),
        },
        {
          key: "terms",
          label: "术语/训练/推荐",
          children: (
            <div className="crm-stack">
              <Panel title="术语库">
                <Space wrap>
                  <Input placeholder="术语" value={termDraft.term} onChange={(event) => setTermDraft({ ...termDraft, term: event.target.value })} />
                  <Input placeholder="定义" value={termDraft.definition} onChange={(event) => setTermDraft({ ...termDraft, definition: event.target.value })} />
                  <Button
                    onClick={async () => {
                      await biApi.saveTerm({ body: { datasetId: 0, term: termDraft.term, definition: termDraft.definition, synonyms: [], enabled: true } });
                      setTermDraft({ term: "", definition: "" });
                      void load();
                    }}
                  >
                    添加
                  </Button>
                </Space>
                <Table
                  rowKey="id"
                  size="small"
                  pagination={false}
                  dataSource={terms}
                  columns={[
                    { title: "术语", dataIndex: "term" },
                    { title: "定义", dataIndex: "definition" },
                    {
                      title: "操作",
                      width: 80,
                      render: (_: unknown, row: Record<string, unknown>) => (
                        <Button type="link" size="small" danger onClick={async () => { await biApi.removeTerm({ params: { id: String(row.id) } }); void load(); }}>删除</Button>
                      ),
                    },
                  ]}
                />
              </Panel>
              <Panel title="SQL 示例训练">
                <Space wrap>
                  <Input placeholder="示例问题" value={trainingDraft.question} onChange={(event) => setTrainingDraft({ ...trainingDraft, question: event.target.value })} />
                  <Input placeholder="SQL（SELECT ... FROM dataset）" value={trainingDraft.sqlText} onChange={(event) => setTrainingDraft({ ...trainingDraft, sqlText: event.target.value })} />
                  <Button
                    onClick={async () => {
                      await biApi.saveTraining({ body: { datasetId: 0, question: trainingDraft.question, sqlText: trainingDraft.sqlText, enabled: true } });
                      setTrainingDraft({ question: "", sqlText: "" });
                      void load();
                    }}
                  >
                    添加
                  </Button>
                </Space>
                <Table
                  rowKey="id"
                  size="small"
                  pagination={false}
                  dataSource={trainings}
                  columns={[
                    { title: "问题", dataIndex: "question" },
                    { title: "SQL", dataIndex: "sqlText" },
                    {
                      title: "操作",
                      width: 80,
                      render: (_: unknown, row: Record<string, unknown>) => (
                        <Button type="link" size="small" danger onClick={async () => { await biApi.removeTraining({ params: { id: String(row.id) } }); void load(); }}>删除</Button>
                      ),
                    },
                  ]}
                />
              </Panel>
              <Panel title="推荐问题">
                <Space wrap>
                  <Input placeholder="推荐问题" value={questionDraft} onChange={(event) => setQuestionDraft(event.target.value)} />
                  <Button
                    onClick={async () => {
                      await biApi.saveRecommendedQuestion({ body: { datasetId: 0, question: questionDraft, sort: 0 } });
                      setQuestionDraft("");
                      void load();
                    }}
                  >
                    添加
                  </Button>
                </Space>
                <Table
                  rowKey="id"
                  size="small"
                  pagination={false}
                  dataSource={recommended}
                  columns={[
                    { title: "问题", dataIndex: "question" },
                    {
                      title: "操作",
                      width: 80,
                      render: (_: unknown, row: Record<string, unknown>) => (
                        <Button type="link" size="small" danger onClick={async () => { await biApi.removeRecommendedQuestion({ params: { id: String(row.id) } }); void load(); }}>删除</Button>
                      ),
                    },
                  ]}
                />
              </Panel>
            </div>
          ),
        },
        {
          key: "logs",
          label: "查询审计",
          children: (
            <Panel title="查询审计">
              <Table
                rowKey="id"
                size="small"
                dataSource={logs}
                pagination={{ pageSize: 20 }}
                columns={[
                  { title: "时间", dataIndex: "createdAt", width: 160, render: (value: string) => value?.replace("T", " ").slice(0, 19) },
                  { title: "渠道", dataIndex: "channel", width: 80 },
                  { title: "状态", dataIndex: "status", width: 80 },
                  { title: "行数", dataIndex: "rows", width: 80 },
                  { title: "耗时", dataIndex: "elapsedMs", width: 80 },
                  { title: "SQL", dataIndex: "sqlText", ellipsis: true },
                  { title: "错误", dataIndex: "error", ellipsis: true },
                ]}
              />
            </Panel>
          ),
        },
      ]}
    />
  );
}