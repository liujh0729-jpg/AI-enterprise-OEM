"use client";

import { Button, Modal, Table, Typography } from "antd";
import { useState } from "react";
import { SITE_BASE_PLACEHOLDER } from "@/lib/site-url";
import { useSiteBase } from "@/lib/site-brand";

const { Text, Title } = Typography;

type ApiRow = { method: string; path: string; desc: string };

const METHOD_BADGE: Record<string, string> = {
  GET: "badge badge-sky",
  POST: "badge badge-green",
  PATCH: "badge badge-orange",
};

const API_ROWS: ApiRow[] = [
  {
    method: "GET",
    path: "/api/v1/data-tables",
    desc: "列出可见的表：列定义、行数与当前账号的四种权限位",
  },
  {
    method: "GET",
    path: "/api/v1/data-tables/:id",
    desc: "读取表结构：列键 fieldKey、类型、单选候选项、是否必填",
  },
  {
    method: "GET",
    path: "/api/v1/data-tables/:id/rows?limit=100&offset=0",
    desc: "分页读行：按行 ID 倒序，limit 默认 100、上限 500",
  },
  {
    method: "POST",
    path: "/api/v1/data-tables/:id/rows",
    desc: "新增一行，报文 { data: { 列键: 值 } }（也可直接平铺列键）",
  },
  {
    method: "POST",
    path: "/api/v1/data-tables/:id/rows/batch",
    desc: "批量新增，报文 { rows: [ { 列键: 值 }, … ] }；单次 ≤ 200 行，整体一个事务",
  },
  {
    method: "PATCH",
    path: "/api/v1/data-tables/:id/rows/:rowId",
    desc: "修改一行，报文 { data: { 列键: 值 } }；整行覆盖，未提交的列会被清空",
  },
];

const CODE_STYLE = {
  margin: "8px 0 0",
  padding: "12px 14px",
  fontSize: 12,
  lineHeight: 1.7,
  color: "var(--text-2)",
  background: "var(--bg-muted)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  overflowX: "auto" as const,
};

/**
 * 多维表格 API 调用说明：点页头标题右侧的「API 调用说明」按钮弹出。
 * 只读文档，不发起任何请求。
 */
export function DataTableApiGuideButton() {
  const [open, setOpen] = useState(false);
  // 示例地址跟域名走：后台站点域名优先，没配按当前访问地址推导。
  const base = useSiteBase() || SITE_BASE_PLACEHOLDER;

  return (
    <>
      <Button onClick={() => setOpen(true)}>API 调用说明</Button>
      <Modal
        open={open}
        title="多维表格 API 调用说明"
        onCancel={() => setOpen(false)}
        footer={<Button onClick={() => setOpen(false)}>知道了</Button>}
        width={860}
        destroyOnHidden
      >
        <Title level={5} style={{ marginTop: 0 }}>
          基础信息
        </Title>
        <Text style={{ whiteSpace: "pre-wrap" }}>
{`• 服务地址：${base}/api/v1/data-tables（与本系统同域）
• 认证：请求头带 X-Api-Key（或 x-api-key），值是「API Key 管理」/developer/keys 里生成的 Enterprise 本地 Key（ek_ 开头）；AIworkin 平台的 sk- Key 不能用于这里
• 归属：Key 属于哪个账号，就只看得见那个账号自己建的表 + 明确授权给它的表
• 响应：统一包一层 { "code": 0, "message": "ok", "data": … }，code 非 0 时看 message`}
        </Text>

        <Title level={5} style={{ marginTop: 20 }}>
          接口清单
        </Title>
        <Table<ApiRow>
          rowKey={(row) => `${row.method} ${row.path}`}
          size="small"
          pagination={false}
          dataSource={API_ROWS}
          columns={[
            {
              title: "方法",
              dataIndex: "method",
              width: 84,
              render: (value: string) => (
                <span className={METHOD_BADGE[value] || "badge"}>{value}</span>
              ),
            },
            {
              title: "路径",
              dataIndex: "path",
              width: 320,
              render: (value: string) => (
                <span className="mono text-12">{value}</span>
              ),
            },
            { title: "说明", dataIndex: "desc" },
          ]}
        />
        <div className="text-12 muted" style={{ marginTop: 8 }}>
          机器通道只开读结构与行读写。建表、改列、授权、删行只在界面侧；没有 DELETE
          行接口。
        </div>

        <Title level={5} style={{ marginTop: 20 }}>
          调用示例
        </Title>
        <Text className="text-12">1. 先读表结构，拿到列键与类型：</Text>
        <pre className="mono" style={CODE_STYLE}>
{`curl -H "X-Api-Key: sk-你的Key" \\
  ${base}/api/v1/data-tables/12`}
        </pre>

        <Text className="text-12">2. 按列键批量写入（一次最多 200 行）：</Text>
        <pre className="mono" style={CODE_STYLE}>
{`curl -X POST -H "X-Api-Key: sk-你的Key" \\
  -H "Content-Type: application/json" \\
  -d '{"rows":[
        {"name":"张三","amount":1200,"active":true},
        {"name":"李四","amount":980,"active":false}
      ]}' \\
  ${base}/api/v1/data-tables/12/rows/batch`}
        </pre>

        <Text className="text-12">
          3. 修改一行（整行覆盖，没带上的列会被清空，必填列每次都要带）：
        </Text>
        <pre className="mono" style={CODE_STYLE}>
{`curl -X PATCH -H "X-Api-Key: sk-你的Key" \\
  -H "Content-Type: application/json" \\
  -d '{"data":{"name":"张三","amount":1300,"active":true}}' \\
  ${base}/api/v1/data-tables/12/rows/34`}
        </pre>

        <Title level={5} style={{ marginTop: 20 }}>
          写入规则
        </Title>
        <Text style={{ whiteSpace: "pre-wrap" }}>
{`• 报文的键必须是列键 fieldKey（建列时设定、之后不能改），不认识的键按 400 拒绝
• 类型：number 传数字（字符串数字也收）；boolean 传 true / false（也收 "是" / "否"、"1" / "0"）；select 必须是该列候选项之一；json 传任意 JSON；text / url / email / date 传字符串
• 空值（null / 空串 / 不传）按空处理；必填列没值按 400 拒绝
• 批量写整体一个事务：有任何一行不合法，整批都不落库
• 权限：读表 / 读行要「访问」，写行要「新增」，改行要「修改」；删行只在界面按「删除」权限操作`}
        </Text>

        <Title level={5} style={{ marginTop: 20 }}>
          常见问题
        </Title>
        <Text style={{ whiteSpace: "pre-wrap" }}>
{`Q：返回 401？
A：Key 没带、写错、已被重置或吊销。到「API Key 管理」确认当前生效的那把。

Q：提示「该多维表格归他人所有，未获授权」（20002）？
A：这把 Key 的账号既不是表归属账号，也没被授权。请表归属账号在「授权」里加上访问 / 新增 / 修改权限。

Q：写入报「列键「xxx」不属于该表」？
A：键写成了列名而不是列键，或这张表还没这列。先 GET /:id 读结构，按返回的 fieldKey 拼报文。

Q：一次能读多少行？
A：GET rows 的 limit 上限 500；用 offset 翻页。界面列表按 pageSize 上限 200，二者是不同入口。`}
        </Text>
      </Modal>
    </>
  );
}
