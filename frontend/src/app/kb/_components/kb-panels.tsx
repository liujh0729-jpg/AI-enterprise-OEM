"use client";

import { App, Button, Card, Col, Descriptions, Input, Row, Select, Space, Switch, Table, Tag } from "antd";
import type { TableProps } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  kbApi,
  type KbAskResult,
  type KbConsumer,
  type KbGraph,
  type KbGraphInsights,
  type KbIndexStats,
  type KbLintRun,
  type KbLogRow,
  type KbSearchResult,
} from "@/api/kb";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { KB_CONSUMER_TYPE_LABELS, timeText } from "./kb-ui";

/**
 * 知识库「检索问答 / 图谱 / 消费者 / 时间线」四个分区（「记忆」已独立到 memory-pane）。
 * 数据口径与后端 verify-kb 验收一致：读走可见性闸，写走 WRITE 身份闸。
 */

/** 分区内简单的错误提示行（接口 4xx 与网络异常统一收口在这里）。 */
function ErrorNote({ text }: { text: string }) {
  return text ? <Notice variant="warn">{text}</Notice> : null;
}

// ---------- 检索与问答 ----------
export function QaPane({ spaceId }: { spaceId: number }) {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState("");
  const [search, setSearch] = useState<KbSearchResult | null>(null);
  const [question, setQuestion] = useState("");
  const [saveAsPage, setSaveAsPage] = useState(false);
  const [asked, setAsked] = useState<KbAskResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const runSearch = async () => {
    const q = keyword.trim();
    if (!q) return;
    setBusy(true);
    try {
      setSearch(await kbApi.search({ query: { spaceId, q, topK: 8 } }));
      setError("");
    } catch (caught) {
      setSearch(null);
      setError((caught as Error).message || "检索失败");
    } finally {
      setBusy(false);
    }
  };

  const runAsk = async () => {
    const q = question.trim();
    if (!q) return;
    setBusy(true);
    try {
      const data = await kbApi.ask({
        body: { spaceId, question: q, topK: 4, saveAsPage },
      });
      setAsked(data);
      setError("");
      if (data?.savedPageId) message.success("答案已沉淀为待审页，请到「页面」复核");
    } catch (caught) {
      setAsked(null);
      setError((caught as Error).message || "问答失败");
    } finally {
      setBusy(false);
    }
  };

  const hitColumns: TableProps<KbSearchResult["hits"][number]>["columns"] = [
    { title: "页面", dataIndex: "title", render: (_, row) => `${row.title}（${row.slug}）` },
    { title: "类型", dataIndex: "type", width: 90 },
    {
      title: "融合分",
      dataIndex: "score",
      width: 160,
      render: (_, row) => `综合 ${row.score.toFixed(3)} / 词 ${row.keywordScore.toFixed(3)} / 向量 ${row.vectorScore.toFixed(3)}`,
    },
    { title: "摘要", dataIndex: "excerpt", ellipsis: true },
    { title: "引用源", dataIndex: "sourceIds", width: 90, render: (v: number[]) => v.length },
  ];

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <ErrorNote text={error} />
      <Panel title="混合检索" titleExtra="关键词 + 本地向量双路召回；embedding 缺失自动退化为关键词口径。">
        <Space.Compact style={{ width: "100%", maxWidth: 640 }}>
          <Input
            placeholder="输入检索词，如：发布会 预算"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onPressEnter={() => void runSearch()}
          />
          <Button type="primary" loading={busy} onClick={() => void runSearch()}>
            检索
          </Button>
        </Space.Compact>
        {search ? (
          <>
            <div style={{ margin: "12px 0" }}>
              命中 {search.total} 条，召回口径：
              {search.modes.map((m) => (
                <Tag key={m}>{m}</Tag>
              ))}
            </div>
            <Table
              rowKey="pageId"
              size="small"
              columns={hitColumns}
              dataSource={search.hits}
              pagination={false}
            />
          </>
        ) : (
          <EmptyState text="尚无检索结果" />
        )}
      </Panel>
      <Panel title="带引用问答" titleExtra="答案必须可溯源到具体页面；勾选沉淀后好答案会进入待审队列（人在环复利）。">
        <Space orientation="vertical" style={{ width: "100%", maxWidth: 640 }}>
          <Input.TextArea
            rows={2}
            placeholder="提出问题，如：发布会由谁负责协调？"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <Space>
            <Switch checked={saveAsPage} onChange={setSaveAsPage} />
            <span>满意后沉淀为新页（默认待审）</span>
            <Button type="primary" loading={busy} onClick={() => void runAsk()}>
              提问
            </Button>
          </Space>
        </Space>
        {asked ? (
          <div style={{ marginTop: 16 }}>
            <Card size="small" title={`回答（口径：${asked.mode === "llm" ? "模型综合" : "抽取式回落"}）`}>
              <div style={{ whiteSpace: "pre-wrap" }}>{asked.answer}</div>
            </Card>
            <div style={{ marginTop: 8 }}>
              {asked.citations.map((c) => (
                <Tag key={c.pageId} color="blue">
                  [{c.pageId}] {c.title}
                </Tag>
              ))}
            </div>
          </div>
        ) : null}
      </Panel>
    </Space>
  );
}

// ---------- 图谱与巡检 ----------
export function GraphPane({ spaceId }: { spaceId: number }) {
  const { message } = App.useApp();
  const [graph, setGraph] = useState<KbGraph | null>(null);
  const [insights, setInsights] = useState<KbGraphInsights | null>(null);
  const [runs, setRuns] = useState<KbLintRun[]>([]);
  const [stats, setStats] = useState<KbIndexStats | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setBusy(true);
    try {
      const [g, i, r, s] = await Promise.all([
        kbApi.graph({ query: { spaceId, depth: 2 } }),
        kbApi.graphInsights({ query: { spaceId } }),
        kbApi.lintRuns({ query: { spaceId, page: 1, pageSize: 10 } }),
        kbApi.indexStats({ query: { spaceId } }),
      ]);
      setGraph(g);
      setInsights(i);
      setRuns(r?.list || []);
      setStats(s);
      setError("");
    } catch (caught) {
      setError((caught as Error).message || "图谱读取失败");
    } finally {
      setBusy(false);
    }
  }, [spaceId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const runLint = async () => {
    setBusy(true);
    try {
      const run = await kbApi.lint({ body: { spaceId } });
      message.success(run?.summary || "巡检完成");
      await reload();
    } catch (caught) {
      message.error((caught as Error).message || "巡检失败");
    } finally {
      setBusy(false);
    }
  };

  const nodeById = new Map((graph?.nodes || []).map((n) => [n.id, n]));
  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <ErrorNote text={error} />
      {stats ? (
        <Descriptions
          size="small"
          column={4}
          items={[
            { key: "model", label: "向量口径", children: stats.model },
            { key: "pages", label: "页面数", children: stats.pageCount },
            { key: "chunks", label: "分块数", children: stats.chunkCount },
            { key: "dim", label: "向量维度", children: stats.embeddingDim },
          ]}
        />
      ) : null}
      <Panel
        title="知识图谱"
        titleExtra="写页时的 [[wikilink]] 会自动长出实体节点与关系边；超 200 节点按度数截断。"
        extra={
          <Button onClick={() => void runLint()} loading={busy}>
            立即巡检
          </Button>
        }
      >
        {graph && graph.nodes.length ? (
          <Row gutter={16}>
            <Col span={12}>
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={graph.nodes}
                columns={[
                  { title: "实体", dataIndex: "name" },
                  { title: "类型", dataIndex: "type", width: 90 },
                  { title: "关联页", dataIndex: "pageSlug", ellipsis: true, render: (v: string) => v || "（未建页）" },
                  { title: "度数", dataIndex: "degree", width: 70 },
                ]}
              />
            </Col>
            <Col span={12}>
              <Table
                rowKey={(e) => `${e.from}-${e.to}-${e.relation}`}
                size="small"
                pagination={{ pageSize: 8 }}
                dataSource={graph.edges}
                columns={[
                  {
                    title: "关系",
                    render: (_, e) =>
                      `${nodeById.get(e.from)?.name || e.from} —${e.relation}→ ${nodeById.get(e.to)?.name || e.to}`,
                  },
                  { title: "权重", dataIndex: "weight", width: 70 },
                ]}
              />
            </Col>
          </Row>
        ) : (
          <EmptyState text="图谱还是空的：先在「资料」摄取或到「页面」写入带 [[链接]] 的内容" />
        )}
        {graph?.truncated ? <Tag color="orange">节点超上限，已按度数截断</Tag> : null}
      </Panel>
      {insights ? (
        <Panel title="图谱洞察" titleExtra="与巡检台账互补的实时口径：枢纽 / 孤儿 / 矛盾 / 缺失交叉引用。">
          <Row gutter={16}>
            <Col span={6}>
              <Card size="small" title={`枢纽实体（${insights.hubs.length}）`}>
                {insights.hubs.map((h) => (
                  <Tag key={h.entityId}>{h.name} ·{h.inDegree}</Tag>
                ))}
              </Card>
            </Col>
            <Col span={6}>
              <Card size="small" title={`孤儿实体（${insights.orphans.length}）`}>
                {insights.orphans.map((o) => (
                  <Tag key={o.entityId}>{o.name}</Tag>
                ))}
              </Card>
            </Col>
            <Col span={6}>
              <Card size="small" title={`矛盾对（${insights.conflicts.length}）`}>
                {insights.conflicts.map((c, idx) => (
                  <div key={idx}>
                    {c.entity}：{c.note}
                  </div>
                ))}
              </Card>
            </Col>
            <Col span={6}>
              <Card size="small" title={`缺失引用（${insights.missingRefs.length}）`}>
                {insights.missingRefs.map((m, idx) => (
                  <Tag key={idx} color="red">
                    [[{m.wikilink}]]
                  </Tag>
                ))}
              </Card>
            </Col>
          </Row>
          <div style={{ marginTop: 12 }}>
            实体 {insights.stats.entities} / 关系 {insights.stats.relations} / 页 {insights.stats.pages} / 块{" "}
            {insights.stats.chunks}
          </div>
        </Panel>
      ) : null}
      <Panel title="巡检台账">
        <Table
          rowKey="id"
          size="small"
          loading={busy}
          dataSource={runs}
          pagination={false}
          columns={[
            { title: "状态", dataIndex: "status", width: 90 },
            { title: "结论", dataIndex: "summary", ellipsis: true },
            { title: "时间", dataIndex: "createdAt", width: 170, render: (v: string) => timeText(v) },
          ]}
        />
      </Panel>
    </Space>
  );
}

// ---------- 消费者绑定 ----------
export function ConsumersPane({ spaceId }: { spaceId: number }) {
  const { message, modal } = App.useApp();
  const [rows, setRows] = useState<KbConsumer[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [targetId, setTargetId] = useState("");
  const [consumerType, setConsumerType] = useState<KbConsumer["consumerType"]>("AGENT");
  const [role, setRole] = useState<"READ" | "WRITE">("READ");

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await kbApi.listConsumers({ query: { spaceId } })) || []);
      setError("");
    } catch (caught) {
      setRows([]);
      setError((caught as Error).message || "消费者列表读取失败");
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const bind = async () => {
    const id = targetId.trim();
    if (!id) {
      message.warning("请填写消费者账号 ID");
      return;
    }
    try {
      await kbApi.bindConsumer({
        body: { spaceId, consumerType, consumerId: id, role, priority: 5 },
      });
      message.success("绑定成功");
      setTargetId("");
      await reload();
    } catch (caught) {
      message.error((caught as Error).message || "绑定失败");
    }
  };

  const unbind = (row: KbConsumer) => {
    modal.confirm({
      title: `解绑 ${row.consumerId}？`,
      content: row.role === "WRITE" ? "该账号对本空间的写权限将立即回收" : "该账号将失去本空间读取上下文的能力",
      onOk: async () => {
        await kbApi.unbindConsumer({ body: { id: row.id } });
        await reload();
      },
    });
  };

  return (
    <Panel title="消费者绑定" titleExtra="把分身 / 智能体 / AI客服 / ERP / CRM 挂到本空间：READ=可检索引用，WRITE=账号可直接写页。">
      <ErrorNote text={error} />
      <Space style={{ marginBottom: 12 }} wrap>
        <Input
          style={{ width: 220 }}
          placeholder="消费者账号 ID（登录用户名对应 id）"
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
        />
        <SelectLike value={consumerType} onChange={(v) => setConsumerType(v as KbConsumer["consumerType"])} options={KB_CONSUMER_TYPE_LABELS} />
        <SelectLike value={role} onChange={(v) => setRole(v as "READ" | "WRITE")} options={{ READ: "READ 只读引用", WRITE: "WRITE 可写页" }} />
        <Button type="primary" onClick={() => void bind()}>
          绑定
        </Button>
      </Space>
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={rows}
        pagination={false}
        columns={[
          { title: "类型", dataIndex: "consumerType", width: 110, render: (v: string) => KB_CONSUMER_TYPE_LABELS[v] || v },
          { title: "消费者 ID", dataIndex: "consumerId" },
          {
            title: "角色",
            dataIndex: "role",
            width: 130,
            render: (v: string) => <Tag color={v === "WRITE" ? "green" : "blue"}>{v}</Tag>,
          },
          { title: "优先级", dataIndex: "priority", width: 80 },
          { title: "绑定时间", dataIndex: "createdAt", width: 170, render: (v: string) => timeText(v) },
          {
            title: "操作",
            width: 80,
            render: (_, row) => (
              <Button danger size="small" onClick={() => unbind(row)}>
                解绑
              </Button>
            ),
          },
        ]}
      />
    </Panel>
  );
}

/** 轻量下拉：统一选项口径。 */
function SelectLike({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Record<string, string>;
}) {
  return (
    <Select value={value} onChange={onChange} style={{ width: 170 }} options={Object.entries(options).map(([k, label]) => ({ value: k, label }))} />
  );
}

// ---------- 时间线 ----------
export function TimelinePane({ spaceId }: { spaceId: number }) {
  const [rows, setRows] = useState<KbLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    kbApi
      .logs({ query: { spaceId, page, pageSize: 20 } })
      .then((data) => {
        if (!alive) return;
        setRows(data?.list || []);
        setTotal(data?.total || 0);
        setError("");
      })
      .catch((caught) => {
        if (!alive) return;
        setRows([]);
        setError((caught as Error).message || "时间线读取失败");
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [spaceId, page]);

  return (
    <Panel title="空间时间线" titleExtra="写页 / 摄取 / 评审 / 检索 / 巡检 / 绑定 / 提炼七类操作全量留痕。">
      <ErrorNote text={error} />
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={rows}
        pagination={{ current: page, pageSize: 20, total, onChange: setPage, showSizeChanger: false }}
        columns={[
          { title: "操作", dataIndex: "kind", width: 120, render: (v: string) => <Tag>{v}</Tag> },
          { title: "摘要", dataIndex: "summary", ellipsis: true },
          { title: "执行人", dataIndex: "actorUserId", width: 140 },
          { title: "时间", dataIndex: "createdAt", width: 170, render: (v: string) => timeText(v) },
        ]}
      />
    </Panel>
  );
}
