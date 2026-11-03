"use client";

import { Input, Select, Space, Table, Tag } from "antd";
import Link from "next/link";
import { useMemo, useState, type CSSProperties } from "react";
import {
  ErrorCode,
  MCP_API_KEY_PREFIX,
  MCP_ENDPOINT_PATH,
  mcpOperations,
  type ErrorCodeName,
} from "@enterprise/contracts";
import { PageHero, Panel } from "@/components/ui/panel";
import { SITE_BASE_PLACEHOLDER } from "@/lib/site-url";
import { useSiteBase } from "@/lib/site-brand";

type Channel = "key" | "session";

type ApiRow = {
  operationId: string;
  method: string;
  path: string;
  domain: string;
  domainLabel: string;
  label: string;
  write: boolean;
  channel: Channel;
};

/**
 * 接口清单直接从契约层派生（与 MCP 服务端 `list_operations`、`/api/openapi.json` 同源）：
 * 新增业务接口只改契约，本页自动出现，不存在需要人工维护的第二份清单。
 * 渠道口径与后端鉴权一致：`/api/v1/**` 只认 ek_ Key，其余走本站登录会话。
 */
const ALL_ROWS: ApiRow[] = mcpOperations()
  .map((row) => ({
    operationId: row.operationId,
    method: row.method,
    path: row.path,
    domain: row.domain,
    domainLabel: row.domainLabel,
    label: row.label,
    write: row.write,
    channel: (row.path.startsWith("/api/v1/") ? "key" : "session") as Channel,
  }))
  .sort((left, right) =>
    left.channel !== right.channel
      ? left.channel === "key"
        ? -1
        : 1
      : left.domainLabel.localeCompare(right.domainLabel, "zh-CN") ||
        left.path.localeCompare(right.path),
  );

const KEY_TOTAL = ALL_ROWS.filter((row) => row.channel === "key").length;
const SESSION_TOTAL = ALL_ROWS.length - KEY_TOTAL;
const WRITE_TOTAL = ALL_ROWS.filter((row) => row.write).length;

const DOMAIN_OPTIONS = (() => {
  const counts = new Map<string, { label: string; count: number }>();
  for (const row of ALL_ROWS) {
    const item = counts.get(row.domain) ?? { label: row.domainLabel, count: 0 };
    item.count += 1;
    counts.set(row.domain, item);
  }
  return [...counts.entries()]
    .sort(
      (left, right) =>
        right[1].count - left[1].count ||
        left[1].label.localeCompare(right[1].label, "zh-CN"),
    )
    .map(([value, item]) => ({ value, label: `${item.label}（${item.count}）` }));
})();

const CHANNEL_OPTIONS = [
  { value: "all" as const, label: "全部渠道" },
  { value: "key" as const, label: "API Key（/api/v1）" },
  { value: "session" as const, label: "登录会话（/enterprise）" },
];

const METHOD_COLORS: Record<string, string> = {
  get: "green",
  post: "blue",
  put: "orange",
  patch: "gold",
  delete: "red",
};

const CHANNEL_META: Record<Channel, { label: string; color: string }> = {
  key: { label: "API Key", color: "purple" },
  session: { label: "登录会话", color: "default" },
};

/** 错误码中文说明：code 与 message 读契约，说明写这里，避免页面里散落字符串。 */
const ERROR_HINTS: Record<ErrorCodeName, string> = {
  SUCCESS: "成功；data 为业务数据，无内容时为 null。",
  BAD_REQUEST: "请求参数不合法：缺参、类型错误或取值超出范围。",
  UNAUTHORIZED: "凭证无效：会话过期，或 x-api-key / Bearer 的 ek_ Key 不存在、已吊销。",
  FORBIDDEN: "当前账号身份无权执行该操作（如未开通对应业务身份、无生效签约）。",
  NOT_FOUND: "目标资源不存在，或不属于当前账号。",
  CONFLICT: "与现有数据状态冲突（如重复创建、状态已被他人变更）。",
  PAYLOAD_TOO_LARGE: "单次请求内容过大，减少上传文件数量或体积后重试。",
  VALIDATION_ERROR: "字段级校验失败，message 会指出具体字段。",
  RATE_LIMITED: "请求过于频繁，稍后重试。",
  INTERNAL_ERROR: "服务端内部错误，把 X-Request-Id 一并提供给管理员排查。",
  SERVICE_UNAVAILABLE: "依赖服务暂不可用（数据库或上游通道），稍后重试。",
  NO_ACTIVE_CONTRACT: "该业务需要生效中的签约，请先完成签约。",
  ROLE_MISMATCH: "当前身份与操作要求不匹配，切换身份后再试。",
  CONTRACT_STATE: "签约当前状态不允许该操作（如已解除）。",
  DECL_STATE: "申报单当前状态不允许该操作。",
  ORDER_STATE: "订单当前状态不允许该操作。",
  AIWORKIN_UNAVAILABLE: "AIworkin 上游通道不可用，稍后重试。",
  AIWORKIN_AUTH_FAILED: "AIworkin 上游鉴权失败：检查账号绑定的 sk- Key 是否有效。",
  POINTS_INSUFFICIENT: "积分余额不足，充值后再执行。",
  POINTS_ARREARS: "账户欠费中，该操作已被暂停。",
  NOT_IMPLEMENTED: "接口尚未实现（保留占位）。",
};

const ERROR_ROWS = (Object.keys(ErrorCode) as ErrorCodeName[]).map((name) => ({
  name,
  code: ErrorCode[name].code,
  httpStatus: ErrorCode[name].httpStatus,
  hint: ERROR_HINTS[name],
}));

const CODE_BLOCK: CSSProperties = {
  margin: 0,
  padding: "12px 14px",
  fontSize: 12,
  lineHeight: 1.7,
  color: "var(--text-2)",
  background: "var(--bg-muted)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  overflowX: "auto",
};

export default function ApiDocsPage() {
  // 示例里的 base 跟域名走：后台站点域名优先，没配按当前访问地址推导。
  const apiBase = useSiteBase() || SITE_BASE_PLACEHOLDER;
  const [keyword, setKeyword] = useState("");
  const [channel, setChannel] = useState<"all" | Channel>("all");
  const [domain, setDomain] = useState("all");
  const [page, setPage] = useState(1);

  const rows = useMemo(() => {
    const text = keyword.trim().toLowerCase();
    return ALL_ROWS.filter((row) => {
      if (channel !== "all" && row.channel !== channel) return false;
      if (domain !== "all" && row.domain !== domain) return false;
      if (!text) return true;
      return (
        row.path.toLowerCase().includes(text) ||
        row.operationId.toLowerCase().includes(text) ||
        row.label.toLowerCase().includes(text) ||
        row.domainLabel.toLowerCase().includes(text) ||
        row.method.includes(text)
      );
    });
  }, [keyword, channel, domain]);

  /** 任一筛选条件变化都回到第一页，避免停在越界页码。 */
  const applyFilter = (apply: () => void) => {
    apply();
    setPage(1);
  };

  return (
    <>
      <PageHero
        title="API 文档"
        desc="本系统实际对外提供的接口清单：由契约层派生，与 MCP 服务端 list_operations、OpenAPI 文档同源。"
      />

      <Panel title="接入信息" extra={`${ALL_ROWS.length} 个接口 · ${DOMAIN_OPTIONS.length} 个业务域`}>
        <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          本系统有两条调用通道，鉴权方式不同、互不替代：<br />
          <Tag color="purple">API Key</Tag> 机器通道前缀 <span className="mono">/api/v1/</span>，
          必须带 <span className="mono">ek_</span> 开头的 Key（<span className="mono">x-api-key</span> 或
          <span className="mono"> Authorization: Bearer</span> 两种写法等价），身份即 Key 所属账号，
          不需要浏览器会话；共 {KEY_TOTAL} 个接口，适合脚本、RPA 与 MCP 客户端。<br />
          <Tag>登录会话</Tag> 站内通道前缀 <span className="mono">/enterprise/</span>，
          必须携带本站登录会话，本站前端一律经 <span className="mono">/api/backend</span> 前缀调用
          （由 Next.js 反向代理到后端）；共 {SESSION_TOTAL} 个接口，覆盖工作台与全部业务板块。
        </p>
        <pre className="mono" style={CODE_BLOCK}>
          {`# ① 机器通道（API Key）：/api/v1/**，Key 在「API Key 管理」生成
curl "${apiBase}/api/v1/..." \\
  -H "x-api-key: ${MCP_API_KEY_PREFIX}你的Key" \\
  -H "Content-Type: application/json"

# ② 站内通道（登录会话）：/enterprise/**，本站前端经 /api/backend 前缀调用
curl "${apiBase}/api/backend/enterprise/..." \\
  -H "Authorization: Bearer <本站登录令牌>"

# 统一响应信封
{ "code": 0, "message": "ok", "data": ... }

# 排障：响应头 X-Request-Id 与后端访问日志一一对应
# OpenAPI 3.0 文档（公开，含参数与响应结构）：${apiBase}/api/openapi.json`}
        </pre>
        <p className="muted" style={{ fontSize: 13, marginTop: 12, marginBottom: 0 }}>
          Key 在 <Link href="/developer/keys">API Key 管理</Link> 生成，明文只在生成时返回一次；
          MCP 端点 <span className="mono">{MCP_ENDPOINT_PATH}</span> 与 REST 共用同一把 Key，
          工具清单见 <Link href="/developer/mcp">MCP Server</Link>。
        </p>
      </Panel>

      <Panel
        title="接口清单"
        extra={`共 ${ALL_ROWS.length} 个 · 读 ${ALL_ROWS.length - WRITE_TOTAL} / 写 ${WRITE_TOTAL}`}
      >
        <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          清单由契约层 <span className="mono">mcpOperations()</span> 派生，与外部客户端调
          <span className="mono"> list_operations</span> 得到的是同一份，新增接口自动进入本页；
          路径里的 <span className="mono">:参数名</span> 是路径参数。
          平台管理后台、智能体记忆自身、MCP 端点自身、应用市场镜像与邮箱配置不在清单内
          （邮箱走 MCP 的五个 mail_* 专用工具），Key 的铸造 / 重置 / 吊销与上游 Key 同步也不对外列出。
        </p>
        <Space wrap style={{ marginBottom: 12 }}>
          <Input
            allowClear
            placeholder="搜索路径 / operationId / 动作名 / 业务域"
            value={keyword}
            onChange={(event) => applyFilter(() => setKeyword(event.target.value))}
            style={{ width: 320 }}
          />
          <Select
            value={channel}
            onChange={(value) => applyFilter(() => setChannel(value))}
            options={CHANNEL_OPTIONS}
            style={{ width: 200 }}
          />
          <Select
            value={domain}
            onChange={(value) => applyFilter(() => setDomain(value))}
            options={[{ value: "all", label: "全部业务域" }, ...DOMAIN_OPTIONS]}
            showSearch
            optionFilterProp="label"
            style={{ width: 240 }}
          />
        </Space>
        <div className="table-wrap">
          <Table<ApiRow>
            rowKey="operationId"
            dataSource={rows}
            size="middle"
            pagination={{
              current: page,
              pageSize: 20,
              showSizeChanger: false,
              showTotal: (total) => `共 ${total} 条`,
              onChange: (next) => setPage(next),
            }}
            columns={[
              {
                title: "方法",
                dataIndex: "method",
                width: 90,
                render: (method: string) => (
                  <Tag color={METHOD_COLORS[method] || "default"}>
                    {method.toUpperCase()}
                  </Tag>
                ),
              },
              {
                title: "路径",
                dataIndex: "path",
                width: 360,
                render: (path: string) => <span className="mono text-12">{path}</span>,
              },
              { title: "动作", dataIndex: "label", width: 140 },
              { title: "业务域", dataIndex: "domainLabel", width: 150 },
              {
                title: "渠道",
                dataIndex: "channel",
                width: 110,
                render: (value: Channel) => (
                  <Tag color={CHANNEL_META[value].color}>{CHANNEL_META[value].label}</Tag>
                ),
              },
              {
                title: "operationId",
                dataIndex: "operationId",
                width: 240,
                render: (value: string) => <span className="mono text-12">{value}</span>,
              },
            ]}
          />
        </div>
      </Panel>

      <Panel title="业务错误码" extra="code 非 0 即失败">
        <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          失败响应同样是统一信封：<span className="mono">{"{ code, message, data: null }"}</span>，
          业务码与 HTTP 状态码可能不同（例如无生效签约时 HTTP 403 + code 20001），
          请先判 <span className="mono">code !== 0</span> 再看 <span className="mono">message</span>。
        </p>
        <div className="table-wrap">
          <Table
            rowKey="name"
            dataSource={ERROR_ROWS}
            size="middle"
            pagination={false}
            columns={[
              { title: "code", dataIndex: "code", width: 90 },
              { title: "HTTP", dataIndex: "httpStatus", width: 90 },
              {
                title: "标识",
                dataIndex: "name",
                width: 220,
                render: (value: string) => <span className="mono text-12">{value}</span>,
              },
              { title: "说明", dataIndex: "hint" },
            ]}
          />
        </div>
      </Panel>

      <Panel title="接口边界">
        <ul className="muted" style={{ fontSize: 13, margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
          <li>
            机器通道的身份恒为 Key 所属账号：读不到别人账号的数据，也调不到平台管理后台接口。
          </li>
          <li>
            <span className="mono">/api/v1/</span> 之外的接口只认本站登录会话，
            用 Key 直调会返回 401；反过来，带着会话调 <span className="mono">/api/v1/</span> 也必须带 Key。
          </li>
          <li>
            公开白名单只有健康检查、类目字典与飞书 / IM 回调、Agent 助理回填，其余一律需要凭证。
          </li>
          <li>
            写动作是否需要二次确认由业务状态机决定（如签约成立、报税提交、开票核准），接口层只校验身份与状态。
          </li>
        </ul>
      </Panel>
    </>
  );
}