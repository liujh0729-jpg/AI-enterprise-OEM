"use client";

import { Button, Table } from "antd";
import Link from "next/link";
import type { CSSProperties } from "react";
import { MCP_ENDPOINT_PATH, MCP_TOOL_NAMES, MCP_TOOLS, mcpOperations } from "@enterprise/contracts";
import { Panel } from "@/components/ui/panel";
import { joinSiteUrl, SITE_BASE_PLACEHOLDER } from "@/lib/site-url";
import { useSiteBase } from "@/lib/site-brand";

type McpToolRow = { name: string; title: string; desc: string; readOnly: boolean };
type DomainRow = { domain: string; label: string; read: number; write: number; total: number };

/** 工具文案与 MCP 服务端同源：直接读契约，界面不再抄第二份。 */
const MCP_ROWS: McpToolRow[] = MCP_TOOL_NAMES.map((name) => ({
  name,
  title: MCP_TOOLS[name].title,
  desc: MCP_TOOLS[name].description,
  readOnly: MCP_TOOLS[name].annotations.readOnlyHint === true,
}));

/** 业务能力总览：与 `list_operations` 同一份派生，域排除与 Key 动作排除已在契约里做过。 */
const DOMAIN_ROWS: DomainRow[] = (() => {
  const byDomain = new Map<string, DomainRow>();
  for (const row of mcpOperations()) {
    const item = byDomain.get(row.domain) ?? {
      domain: row.domain,
      label: row.domainLabel,
      read: 0,
      write: 0,
      total: 0,
    };
    if (row.write) item.write += 1;
    else item.read += 1;
    item.total += 1;
    byDomain.set(row.domain, item);
  }
  return [...byDomain.values()].sort(
    (left, right) => right.total - left.total || left.label.localeCompare(right.label, "zh-CN"),
  );
})();

const TOTAL = DOMAIN_ROWS.reduce((sum, row) => sum + row.total, 0);
const TOTAL_READ = DOMAIN_ROWS.reduce((sum, row) => sum + row.read, 0);
const TOTAL_WRITE = TOTAL - TOTAL_READ;

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

/** 模型服务 → API-MCP-Skill → MCP Server：接入地址、鉴权、工具清单与业务能力总览。 */
export function McpTab({ onOpenApi }: { onOpenApi: () => void }) {
  // 接入地址跟域名走：后台配了站点域名就用它，没配按当前访问地址推导（/api/* 已由同域代理到后端）。
  const base = useSiteBase();
  const endpoint = joinSiteUrl(base || SITE_BASE_PLACEHOLDER, MCP_ENDPOINT_PATH);
  return (
    <>
      <Panel title="接入信息">
        <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          服务端 <span className="mono">aiworkin-enterprise-mcp 1.0.0</span>，协议版本 <span className="mono">2025-06-18</span>，
          只对外暴露一个端点 <span className="mono">POST /api/v1/mcp</span>：一次请求一条 JSON-RPC 2.0 消息，
          支持 initialize / ping / tools/list / tools/call。鉴权与 REST 开放 API 相同，同一把 <span className="mono">ek_</span> Key，
          <span className="mono">X-Api-Key</span> 与 <span className="mono">Authorization: Bearer</span> 两种写法等价，
          工具看到的身份就是 Key 所属的登录账号，看不到其他账号的数据。
        </p>
        <pre className="mono" style={CODE_BLOCK}>
          {`MCP 接入端点：${endpoint}
鉴权请求头：Authorization: Bearer <Enterprise ek_ Key>
            X-Api-Key: <Enterprise ek_ Key>`}
        </pre>
        <p className="muted" style={{ fontSize: 13, margin: "12px 0 8px" }}>
          MCP 客户端配置示例（Streamable HTTP 接入方式，Url 已是本站实际地址，换域名后自动跟着变）：
        </p>
        <pre className="mono" style={CODE_BLOCK}>
          {`{
  "mcpServers": {
    "aiworkin-enterprise": {
      "type": "http",
      "url": "${endpoint}",
      "headers": { "Authorization": "Bearer ek_你的Key" }
    }
  }
}`}
        </pre>
        <p className="muted" style={{ fontSize: 13, marginTop: 12, marginBottom: 0 }}>
          Key 在 <Link href="/developer/keys">API Key 管理</Link> 生成，明文只在生成时返回一次；
          REST 接口清单与业务错误码见{" "}
          <Button type="link" style={{ padding: 0, height: "auto" }} onClick={onOpenApi}>
            API
          </Button>
          。
        </p>
      </Panel>

      <Panel
        title="业务能力总览"
        extra={`${DOMAIN_ROWS.length} 个业务域 · ${TOTAL} 个接口`}
      >
        <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          6 个元工具背后是 {TOTAL} 个业务接口（读 {TOTAL_READ} / 写 {TOTAL_WRITE}），分布在 {DOMAIN_ROWS.length} 个业务域，
          覆盖驾驶舱、工作台（Agent、Workbuddy 企业云、内容创作、多维表格、RPA 自动化、营销工具、数字资产）
          与全部业务服务（财税、出海、物流、法律、知产、灵活用工、智库、IT服务、营销、资产、供销）。
          下表与外部客户端调 <span className="mono">list_operations</span> 得到的是同一份，新增接口自动进入；
          平台管理后台、智能体记忆自身、MCP 端点自身以及 Key 铸造/吊销动作不在清单内。
          审批结论、资金收付、库存流水这类直接改动账面的动作（含 ERP 库存 / 采购 / 入库 / 报销审批、核销收付款、出入库流水）在清单里可见可读，
          但属于永久排除项：永远不会无人值守执行，必须由本人在界面上确认。
        </p>
        <div className="table-wrap">
          <Table<DomainRow>
            rowKey="domain"
            dataSource={DOMAIN_ROWS}
            pagination={false}
            size="middle"
            columns={[
              { title: "业务域", dataIndex: "label", width: 200 },
              {
                title: "域标识",
                dataIndex: "domain",
                width: 170,
                render: (value: string) => <span className="mono text-12">{value}</span>,
              },
              { title: "读", dataIndex: "read", width: 80 },
              { title: "写", dataIndex: "write", width: 80 },
              { title: "合计", dataIndex: "total", width: 90 },
            ]}
          />
        </div>
      </Panel>

      <Panel title="工具清单">
        <div className="table-wrap">
          <Table<McpToolRow>
            rowKey="name"
            dataSource={MCP_ROWS}
            pagination={false}
            size="middle"
            columns={[
              { title: "工具名", dataIndex: "name", width: 220, render: (value: string) => <span className="mono text-12">{value}</span> },
              { title: "名称", dataIndex: "title", width: 110 },
              { title: "说明", dataIndex: "desc" },
              {
                title: "副作用",
                dataIndex: "readOnly",
                width: 100,
                render: (readOnly: boolean) => (readOnly ? "只读" : "需授权"),
              },
            ]}
          />
        </div>
        <p className="text-12 muted" style={{ marginTop: 8, marginBottom: 0 }}>
          tools/call 的结果同时放在 structuredContent 与 content 里，请优先读 structuredContent；
          写动作的授权与草案口径写在 initialize 返回的 instructions 中。
        </p>
      </Panel>

      <Panel title="Agent 里的 MCP 连接器">
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
          <Link href="/agent">Agent</Link> 的「MCP连接器」页签内置「本站 MCP Server」，
          就是本页这个服务端，只读、不能改也不能删。同一个页签还能用「添加MCP」接入自定义的外部 MCP 服务：
          支持 Streamable HTTP 与旧版 HTTP+SSE 两种接入方式，请求头加密保存、只回显名称；
          外部工具统一命名为 <span className="mono">mcp__c&lt;连接器 ID&gt;__&lt;工具名&gt;</span>，
          单账号最多 20 个连接器、每个连接器最多 40 个工具。外部服务连不上只影响它自己的工具，
          本站工具照常可用。
        </p>
      </Panel>

      <Panel title="调用示例">
        <pre className="mono" style={CODE_BLOCK}>
          {`# ENTERPRISE_API_BASE 与 ENTERPRISE_API_KEY 由调用环境提供，不在脚本中保存真实 Key
curl "$ENTERPRISE_API_BASE/mcp" \\
  -H "Authorization: Bearer $ENTERPRISE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`}
        </pre>
      </Panel>
    </>
  );
}
