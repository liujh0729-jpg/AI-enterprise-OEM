"use client";

import { useEffect, useState } from "react";
import {
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Table,
  Tag,
  Tooltip,
} from "antd";
import { SafetyCertificateOutlined } from "@ant-design/icons";
import { EmptyState, Notice, Panel, PanelTabs } from "@/components/ui/panel";
import {
  governanceApi,
  type AccessPolicy,
  type AiGuard,
  type FeatureNode,
  type SkillReviewRun,
} from "@/api/governance";
import { useOperationMutation } from "@/query/business";
import { presentMutationError } from "@/query/errors";
import { PermissionNotice, fmtTime, useAdminData } from "./common";

/* ============================================================
   平台管理后台「功能治理」（方案 §5.9/§5.10）：
   - 功能开关：FeatureCatalog 目录树逐项启停，关闭即后端拦截（FEATURE_CLOSED）；
   - 访问策略：Agent 出网黑名单 + 沙箱硬上限，技能与连接器运行期实时读取；
   - 技能审查：静态六红线 + LLM 判定全程留痕，needsAdmin 在这里人工放行/终裁。
   ============================================================ */

const DECISION_LABEL: Record<string, { label: string; cls: string }> = {
  pass: { label: "通过", cls: "badge-green" },
  reject: { label: "拒绝", cls: "badge-red" },
  needsAdmin: { label: "待人工", cls: "badge-orange" },
  unreviewed: { label: "未审查", cls: "badge-gray" },
};

const METRIC_LABEL: Record<string, string> = {
  skill: "技能",
  plugin: "插件",
};

/** 板块入口：三个页签同屏切换。 */
export function FeaturesTab() {
  const [tab, setTab] = useState("toggles");
  return (
    <PanelTabs
      value={tab}
      onChange={setTab}
      items={[
        { key: "toggles", label: "功能开关", children: <FeatureTogglePane /> },
        { key: "ai", label: "AI 闸门", children: <AiGuardPane /> },
        { key: "access", label: "Agent访问策略", children: <AccessPolicyPane /> },
        { key: "reviews", label: "技能审查台账", children: <SkillReviewPane /> },
      ]}
    />
  );
}

/* ---------------------------------------------------------------- 功能开关 */

type FeatureTreeRow = FeatureNode & { children?: FeatureTreeRow[] };

/** 平铺目录按 parentCode 组树；孤儿节点挂根，保证接口异常也不丢行。 */
function buildFeatureTree(nodes: FeatureNode[]): FeatureTreeRow[] {
  const byCode = new Map(nodes.map((node) => [node.code, { ...node } as FeatureTreeRow]));
  const roots: FeatureTreeRow[] = [];
  for (const node of byCode.values()) {
    const parent = node.parentCode ? byCode.get(node.parentCode) : undefined;
    if (parent && parent.code !== node.code) (parent.children ||= []).push(node);
    else roots.push(node);
  }
  const sortRows = (rows: FeatureTreeRow[]): FeatureTreeRow[] =>
    rows
      .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code))
      .map((row) => (row.children ? { ...row, children: sortRows(row.children) } : row));
  return sortRows(roots);
}

function FeatureTogglePane() {
  const { message } = App.useApp();
  const { data, denied, loading, reload } = useAdminData("platform-features", (signal) =>
    governanceApi.features({}, { signal }),
  );
  const toggle = useOperationMutation(
    (body: { code: string; state: "open" | "closed" }) =>
      governanceApi.setToggle({
        body: { code: body.code, state: body.state, scope: "PLATFORM", orgUserId: "" },
      }),
    ["platform-features", "platform-menu", "*"],
  );

  const rows = buildFeatureTree((data ?? []).slice());

  const onSwitch = async (node: FeatureNode, next: boolean) => {
    try {
      await toggle.mutateAsync({ code: node.code, state: next ? "open" : "closed" });
      message.success(
        `「${node.title}」已${next ? "开启" : "关闭"}，菜单与后端拦截即时生效`,
      );
      await reload();
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
      else await reload();
    }
  };

  return (
    <>
      <PermissionNotice denied={denied} />
      <Panel
        title="功能目录与开关"
        titleBadge={<span className="text-12 muted">关闭即拦截：菜单隐藏 + 直链/接口 FEATURE_CLOSED</span>}
        extra={<Button onClick={() => void reload()}>刷新</Button>}
      >
        <Notice variant="info">
          目录来自菜单结构自动播种，分组关闭会级联其下全部子项；标记「必留」的是登录、后台入口等平台必需功能，后端拒绝关闭。
          改动保存后即时生效，无需发布。
        </Notice>
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <Table<FeatureTreeRow>
            rowKey="code"
            loading={loading}
            dataSource={rows}
            pagination={false}
            size="middle"
            defaultExpandAllRows
            locale={{ emptyText: <EmptyState text="功能目录为空（播种未执行）" /> }}
            columns={[
              {
                title: "功能",
                render: (_, row) => (
                  <div>
                    <span style={{ fontWeight: row.kind === "GROUP" ? 600 : 400 }}>
                      {row.title}
                    </span>
                    {row.kind === "GROUP" ? <Tag style={{ marginLeft: 8 }}>分组</Tag> : null}
                  </div>
                ),
              },
              {
                title: "路径",
                width: 240,
                render: (_, row) => (
                  <span className="mono text-12 muted">{row.path || "—"}</span>
                ),
              },
              {
                title: "编码",
                width: 200,
                render: (_, row) => <span className="mono text-12">{row.code}</span>,
              },
              {
                title: "作用域",
                width: 90,
                render: (_, row) => (row.scope === "PLATFORM" ? "平台" : "企业"),
              },
              {
                title: "必留",
                width: 70,
                render: (_, row) =>
                  row.protected ? (
                    <Tooltip title="平台必需功能，不可关闭">
                      <Tag color="gold">必留</Tag>
                    </Tooltip>
                  ) : null,
              },
              {
                title: "启用",
                width: 90,
                render: (_, row) => (
                  <Switch
                    size="small"
                    checked={row.state === "open"}
                    disabled={row.protected && row.state === "open"}
                    loading={toggle.isPending && toggle.variables?.code === row.code}
                    onChange={(checked) => void onSwitch(row, checked)}
                  />
                ),
              },
            ]}
          />
        </div>
      </Panel>
    </>
  );
}

/* ---------------------------------------------------------------- AI 闸门 */

function AiGuardPane() {
  const { message } = App.useApp();
  const { data, denied, loading, reload } = useAdminData("platform-ai-guard", (signal) =>
    governanceApi.aiGuard({}, { signal }),
  );
  const [draft, setDraft] = useState<AiGuard | null>(null);
  const [newOrg, setNewOrg] = useState("");

  useEffect(() => {
    if (data) setDraft({ ...data, orgOverrides: data.orgOverrides.map((row) => ({ ...row })) });
  }, [data]);

  const save = useOperationMutation(
    (body: AiGuard) => governanceApi.saveAiGuard({ body }),
    ["platform-ai-guard", "*"],
  );

  const patch = (part: Partial<AiGuard>) =>
    setDraft((current) => (current ? { ...current, ...part } : current));

  const addOrg = () => {
    const orgUserId = newOrg.trim();
    if (!orgUserId) return;
    if (draft?.orgOverrides.some((row) => row.orgUserId === orgUserId)) {
      message.warning("该组织已在列表中");
      return;
    }
    patch({ orgOverrides: [...(draft?.orgOverrides ?? []), { orgUserId, enabled: false }] });
    setNewOrg("");
  };

  const onSave = async () => {
    if (!draft) return;
    try {
      await save.mutateAsync(draft);
      message.success("AI 闸门已保存，统一网关与模型设置即时生效");
      await reload();
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  return (
    <>
      <PermissionNotice denied={denied} />
      <Panel
        title="AI 主开关与调用限流"
        titleBadge={<span className="text-12 muted">与积分、MCP 并列的第三闸；关闭后静默链路回落规则式产出</span>}
        extra={<Button onClick={() => void reload()}>刷新</Button>}
      >
        <Notice variant="info">
          平台总闸关闭后，所有模块都取不到 AI 模型（用户主动动作提示「已被平台关闭」，静默动作走规则兜底）；
          组织级只能收紧、不能反向打开平台总闸。限流按 60 秒滑动窗口统计，0 表示不限。
        </Notice>
        {draft ? (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                gap: 12,
                marginTop: 12,
              }}
            >
              <div>
                <div className="text-12 muted" style={{ marginBottom: 6 }}>
                  平台 AI 总开关
                </div>
                <Switch
                  checked={draft.enabled}
                  checkedChildren="开启"
                  unCheckedChildren="关闭"
                  onChange={(enabled) => patch({ enabled })}
                />
              </div>
              <div>
                <div className="text-12 muted" style={{ marginBottom: 6 }}>
                  每账号每分钟上限
                </div>
                <InputNumber
                  min={0}
                  max={600}
                  step={1}
                  style={{ width: "100%" }}
                  value={draft.userPerMinute}
                  onChange={(value) => patch({ userPerMinute: Number(value ?? 0) })}
                />
              </div>
              <div>
                <div className="text-12 muted" style={{ marginBottom: 6 }}>
                  每组织每分钟上限
                </div>
                <InputNumber
                  min={0}
                  max={20000}
                  step={10}
                  style={{ width: "100%" }}
                  value={draft.orgPerMinute}
                  onChange={(value) => patch({ orgPerMinute: Number(value ?? 0) })}
                />
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <div className="text-12 muted" style={{ marginBottom: 6 }}>
                组织级收紧（填组织主账号 ID，可按需增删）
              </div>
              <div className="table-wrap">
                <Table<AiGuard["orgOverrides"][number]>
                  rowKey="orgUserId"
                  loading={loading}
                  dataSource={draft.orgOverrides}
                  pagination={false}
                  size="middle"
                  locale={{ emptyText: <EmptyState text="暂无组织级收紧，全部跟随平台总闸" /> }}
                  columns={[
                    {
                      title: "组织账号 ID",
                      render: (_, row) => <span className="mono text-12">{row.orgUserId}</span>,
                    },
                    {
                      title: "该组织 AI",
                      width: 110,
                      render: (_, row) => (
                        <Switch
                          size="small"
                          checked={row.enabled}
                          checkedChildren="开"
                          unCheckedChildren="关"
                          onChange={(enabled) =>
                            patch({
                              orgOverrides: draft.orgOverrides.map((item) =>
                                item.orgUserId === row.orgUserId ? { ...item, enabled } : item,
                              ),
                            })
                          }
                        />
                      ),
                    },
                    {
                      title: "操作",
                      width: 80,
                      render: (_, row) => (
                        <Button
                          size="small"
                          danger
                          onClick={() =>
                            patch({
                              orgOverrides: draft.orgOverrides.filter(
                                (item) => item.orgUserId !== row.orgUserId,
                              ),
                            })
                          }
                        >
                          删除
                        </Button>
                      ),
                    },
                  ]}
                />
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <Input
                  value={newOrg}
                  placeholder="组织主账号 ID"
                  maxLength={64}
                  style={{ maxWidth: 280 }}
                  onChange={(event) => setNewOrg(event.target.value)}
                  onPressEnter={addOrg}
                />
                <Button onClick={addOrg}>添加组织</Button>
              </div>
            </div>

            <Button
              type="primary"
              style={{ marginTop: 16 }}
              loading={save.isPending}
              onClick={() => void onSave()}
            >
              保存 AI 闸门
            </Button>
          </>
        ) : (
          <EmptyState text={loading ? "加载中…" : "暂无配置（未保存时按默认：开启、30/分钟、300/分钟）"} />
        )}
      </Panel>
    </>
  );
}

/* ---------------------------------------------------------------- 访问策略 */

type BlacklistRow = AccessPolicy["blacklist"][number];
type LimitsDraft = Partial<AccessPolicy["limits"]>;

/** 本地编辑行：带上稳定 key，避免依赖 antd 已废弃的 rowKey 函数 index 参数。 */
type BlacklistRowDraft = BlacklistRow & { rowKey: string };

let blacklistRowSeq = 1;
const toBlacklistDraft = (row: BlacklistRow): BlacklistRowDraft => ({
  ...row,
  rowKey: `blacklist-${blacklistRowSeq++}`,
});

function AccessPolicyPane() {
  const { message } = App.useApp();
  const { data, denied, loading, reload } = useAdminData("platform-access-policy", (signal) =>
    governanceApi.accessPolicy({}, { signal }),
  );
  const [rows, setRows] = useState<BlacklistRowDraft[]>([]);
  const [form] = Form.useForm<LimitsDraft>();

  useEffect(() => {
    if (!data) return;
    setRows(data.blacklist.map(toBlacklistDraft));
    form.setFieldsValue({ ...data.limits, allowMethods: [...data.limits.allowMethods] });
  }, [data, form]);

  const save = useOperationMutation(
    (body: { blacklist: BlacklistRow[]; limits: LimitsDraft }) =>
      governanceApi.saveAccessPolicy({ body }),
    ["platform-access-policy", "*"],
  );

  const patchRow = (index: number, part: Partial<BlacklistRow>) =>
    setRows((list) => list.map((row, i) => (i === index ? { ...row, ...part } : row)));

  const onSave = async () => {
    const invalid = rows.find((row) => !row.value.trim());
    if (invalid) {
      message.error("黑名单条目必须有域名 / IP / CIDR 值");
      return;
    }
    try {
      await save.mutateAsync({
        blacklist: rows.map(({ type, value, reason, addedBy }) => ({
          type,
          value: value.trim(),
          reason,
          addedBy,
        })),
        limits: form.getFieldsValue(),
      });
      message.success("访问策略已保存，运行期技能实时读取");
      await reload();
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  return (
    <>
      <PermissionNotice denied={denied} />
      <Panel
        title="Agent 出网黑名单"
        titleBadge={<span className="text-12 muted">命中即拦截（含开发环境），技能与自动任务一律受限</span>}
        extra={
          <div style={{ display: "flex", gap: 8 }}>
            <Button
              onClick={() =>
                setRows((list) => [
                  ...list,
                  toBlacklistDraft({ type: "domain", value: "", reason: "", addedBy: "" }),
                ])
              }
            >
              添加条目
            </Button>
            <Button onClick={() => void reload()}>刷新</Button>
          </div>
        }
      >
        <div className="table-wrap">
          <Table<BlacklistRowDraft>
            rowKey="rowKey"
            loading={loading}
            dataSource={rows}
            pagination={false}
            size="middle"
            locale={{ emptyText: <EmptyState text="暂无黑名单条目" /> }}
            columns={[
              {
                title: "类型",
                width: 120,
                render: (_, row, index) => (
                  <Select
                    size="small"
                    value={row.type}
                    style={{ width: 100 }}
                    onChange={(value) => patchRow(index, { type: value })}
                    options={[
                      { value: "domain", label: "域名" },
                      { value: "ip", label: "IP" },
                      { value: "cidr", label: "CIDR" },
                    ]}
                  />
                ),
              },
              {
                title: "值（含子域 / 精确 IP / 网段前缀）",
                width: 260,
                render: (_, row, index) => (
                  <Input
                    size="small"
                    className="mono"
                    value={row.value}
                    placeholder="如 evil.com / 10.0.0.1 / 192.168.1."
                    onChange={(event) => patchRow(index, { value: event.target.value })}
                  />
                ),
              },
              {
                title: "原因",
                render: (_, row, index) => (
                  <Input
                    size="small"
                    value={row.reason}
                    placeholder="加入原因（审计留痕）"
                    maxLength={200}
                    onChange={(event) => patchRow(index, { reason: event.target.value })}
                  />
                ),
              },
              {
                title: "添加人",
                width: 140,
                render: (_, row) => <span className="text-12 muted">{row.addedBy || "—"}</span>,
              },
              {
                title: "操作",
                width: 80,
                render: (_, __, index) => (
                  <Button
                    size="small"
                    danger
                    onClick={() => setRows((list) => list.filter((_, i) => i !== index))}
                  >
                    删除
                  </Button>
                ),
              },
            ]}
          />
        </div>
      </Panel>

      <Panel title="沙箱硬上限" titleBadge={<span className="text-12 muted">运行期技能不可突破这些上限</span>}>
        <Form form={form} layout="vertical" disabled={loading} style={{ maxWidth: 960 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
            <Form.Item name="minIntervalMs" label="最小请求间隔（毫秒）">
              <InputNumber min={0} max={600000} step={100} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="maxConcurrency" label="最大并发">
              <InputNumber min={1} max={64} step={1} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="timeoutMs" label="单请求超时（毫秒）">
              <InputNumber min={1000} max={120000} step={1000} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="maxRequestsPerRun" label="单次运行请求上限">
              <InputNumber min={1} max={1000} step={10} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="perDomainQps" label="单域名 QPS">
              <InputNumber min={1} max={60} step={1} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="allowMethods" label="允许方法">
              <Select
                mode="multiple"
                options={[
                  { value: "GET", label: "GET" },
                  { value: "HEAD", label: "HEAD" },
                ]}
              />
            </Form.Item>
            <Form.Item name="enforceRobots" label="遵守 robots.txt" valuePropName="checked">
              <Switch checkedChildren="是" unCheckedChildren="否" />
            </Form.Item>
            <Form.Item name="botUa" label="Bot User-Agent" extra="{{site}} 占位符替换为站点域名">
              <Input maxLength={200} />
            </Form.Item>
          </div>
          <Button type="primary" icon={<SafetyCertificateOutlined aria-hidden />} loading={save.isPending} onClick={() => void onSave()}>
            保存访问策略
          </Button>
        </Form>
      </Panel>
    </>
  );
}

/* ---------------------------------------------------------------- 审查台账 */

function SkillReviewPane() {
  const { message } = App.useApp();
  const [kind, setKind] = useState("");
  const [decision, setDecision] = useState("");
  const [page, setPage] = useState(1);
  const params = {
    page,
    pageSize: 20,
    kind: kind || undefined,
    decision: decision || undefined,
  };
  const { data, denied, loading, reload } = useAdminData(
    "platform-skill-reviews",
    (signal) => governanceApi.skillReviews({ query: params }, { signal }),
    params,
  );

  const decide = useOperationMutation(
    (body: { kind: "skill" | "plugin"; itemId: number; decision: "passed" | "rejected"; note?: string }) =>
      governanceApi.reviewDecision({ body: { ...body, note: body.note || "" } }),
    ["platform-skill-reviews", "platform-features", "*"],
  );

  const onDecision = async (row: SkillReviewRun, next: "passed" | "rejected") => {
    try {
      await decide.mutateAsync({ kind: row.kind, itemId: row.itemId, decision: next });
      message.success(next === "passed" ? "已人工放行，技能进入可用集" : "已终裁拒绝");
      await reload();
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  const verdictText = (row: SkillReviewRun) => {
    const summary = row.llmVerdict.summary;
    return typeof summary === "string" && summary ? summary : "—";
  };

  return (
    <>
      <PermissionNotice denied={denied} />
      <Panel
        title="技能 / 插件审查台账"
        titleBadge={<span className="text-12 muted">静态六红线 + LLM 判定全程留痕；先审后用，未通过不放行</span>}
        extra={
          <div style={{ display: "flex", gap: 8 }}>
            <Select
              allowClear
              placeholder="全部类型"
              style={{ width: 110 }}
              value={kind || undefined}
              onChange={(value) => {
                setKind(value || "");
                setPage(1);
              }}
              options={[
                { value: "skill", label: "技能" },
                { value: "plugin", label: "插件" },
              ]}
            />
            <Select
              allowClear
              placeholder="全部决议"
              style={{ width: 130 }}
              value={decision || undefined}
              onChange={(value) => {
                setDecision(value || "");
                setPage(1);
              }}
              options={Object.entries(DECISION_LABEL).map(([value, meta]) => ({
                value,
                label: meta.label,
              }))}
            />
            <Button onClick={() => void reload()}>刷新</Button>
          </div>
        }
      >
        <div className="table-wrap">
          <Table<SkillReviewRun>
            rowKey="id"
            loading={loading}
            dataSource={data?.list ?? []}
            size="middle"
            pagination={{
              current: page,
              pageSize: 20,
              total: data?.total ?? 0,
              showSizeChanger: false,
              onChange: setPage,
            }}
            locale={{ emptyText: <EmptyState text="暂无审查记录（导入技能 / 插件后自动排队审查）" /> }}
            expandable={{
              expandedRowRender: (row) => (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div>
                    <span className="text-12 muted">静态命中：</span>
                    {row.staticHits.length ? (
                      row.staticHits.map((hit, index) => (
                        <Tag color="red" key={index}>
                          {hit.rule} @ {hit.file}
                        </Tag>
                      ))
                    ) : (
                      <span className="text-12">无</span>
                    )}
                  </div>
                  <div>
                    <span className="text-12 muted">摘要：</span>
                    <span className="text-12">{verdictText(row)}</span>
                  </div>
                  <pre className="mono text-12" style={{ maxHeight: 200, overflow: "auto", margin: 0 }}>
                    {JSON.stringify(row.llmVerdict, null, 2)}
                  </pre>
                </div>
              ),
            }}
            columns={[
              {
                title: "时间",
                width: 150,
                render: (_, row) => <span className="text-12 muted">{fmtTime(row.createdAt)}</span>,
              },
              {
                title: "对象",
                width: 140,
                render: (_, row) => (
                  <span className="mono text-12">
                    {METRIC_LABEL[row.kind] || row.kind} #{row.itemId}
                  </span>
                ),
              },
              {
                title: "静态命中",
                width: 110,
                render: (_, row) =>
                  row.staticHits.length ? (
                    <span className="badge badge-red">{row.staticHits.length} 项</span>
                  ) : (
                    <span className="badge badge-green">0</span>
                  ),
              },
              {
                title: "决议",
                width: 90,
                render: (_, row) => {
                  const meta = DECISION_LABEL[row.decision] || { label: row.decision, cls: "badge-gray" };
                  return <span className={`badge ${meta.cls}`}>{meta.label}</span>;
                },
              },
              {
                title: "风险",
                width: 90,
                render: (_, row) => row.riskLevel || "—",
              },
              {
                title: "模型",
                width: 160,
                render: (_, row) => <span className="mono text-12">{row.model || "—"}</span>,
              },
              { title: "Token", width: 90, render: (_, row) => row.tokens || 0 },
              { title: "费用", width: 90, render: (_, row) => Number(row.cost || 0).toFixed(2) },
              {
                title: "操作",
                width: 150,
                render: (_, row) =>
                  row.decision === "needsAdmin" ? (
                    <div style={{ display: "flex", gap: 8 }}>
                      <Button size="small" type="primary" loading={decide.isPending} onClick={() => void onDecision(row, "passed")}>
                        放行
                      </Button>
                      <Button size="small" danger onClick={() => void onDecision(row, "rejected")}>
                        拒绝
                      </Button>
                    </div>
                  ) : (
                    <span className="text-12 muted">—</span>
                  ),
              },
            ]}
          />
        </div>
      </Panel>
    </>
  );
}
