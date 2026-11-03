"use client";

import { CopyOutlined, SettingOutlined } from "@ant-design/icons";
import { App, Button, Modal, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { EmptyState, TabStrip } from "@/components/ui/panel";
import { SITE_BASE_PLACEHOLDER } from "@/lib/site-url";
import { useSiteBase } from "@/lib/site-brand";
import { FieldPanel } from "./field-panel";
import { SyncPanel } from "./sync-panel";
import {
  fieldTypeLabel,
  type DataTableField,
  type DataTableTable,
} from "./common";

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

const METHOD_BADGE: Record<string, string> = {
  GET: "badge badge-sky",
  POST: "badge badge-green",
  PATCH: "badge badge-orange",
};

function sortedFields(table: DataTableTable) {
  return [...table.fields].sort((a, b) => a.sortOrder - b.sortOrder);
}

function sampleValue(field: DataTableField, suffix = ""): unknown {
  switch (field.fieldType) {
    case "number":
      return 1200;
    case "boolean":
      return true;
    case "date":
      return "2026-01-15";
    case "url":
      return "https://example.com";
    case "email":
      return `user${suffix}@example.com`;
    case "json":
      return { note: "任意 JSON" };
    case "select":
      return field.options?.choices?.[0] || "选项A";
    default:
      return `示例文本${suffix}`;
  }
}

function sampleRow(fields: DataTableField[], suffix = "") {
  return Object.fromEntries(
    fields.map((field) => [field.fieldKey, sampleValue(field, suffix)]),
  );
}

/** 列键：本表全部列键与按当前列生成的写入报文。 */
function FieldKeyPanel({ table }: { table: DataTableTable }) {
  const { message } = App.useApp();
  const fields = sortedFields(table);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      message.success(`已复制列键：${value}`);
    } catch {
      message.warning(`请手动复制列键：${value}`);
    }
  };

  const columns: ColumnsType<DataTableField> = [
    {
      title: "列名",
      dataIndex: "name",
      width: 170,
      render: (value: string) => <b>{value}</b>,
    },
    {
      title: "列键",
      dataIndex: "fieldKey",
      width: 220,
      render: (value: string) => (
        <span>
          <span className="mono text-12">{value}</span>
          <Button
            type="link"
            icon={<CopyOutlined />}
            style={{ padding: "0 4px", marginLeft: 4 }}
            onClick={() => void copy(value)}
          >
            复制
          </Button>
        </span>
      ),
    },
    {
      title: "类型",
      dataIndex: "fieldType",
      width: 90,
      render: (value: string) => fieldTypeLabel(value),
    },
    {
      title: "必填",
      dataIndex: "required",
      width: 70,
      render: (value: boolean) =>
        value ? <Tag color="red">必填</Tag> : <span className="muted">—</span>,
    },
    {
      title: "候选项",
      key: "choices",
      render: (_: unknown, field) => {
        const choices = field.options?.choices || [];
        return choices.length ? choices.join(" / ") : "—";
      },
    },
  ];

  return (
    <div>
      <div className="text-12 muted" style={{ marginBottom: 12 }}>
        列键（fieldKey）是每列在行数据和接口报文里的字段名：建列时填写，之后不能改；列名可以随时改，列键保持不变。
        脚本读写、飞书同步的字段映射都用列键，不是列名。同一张表内列键唯一，只允许小写字母、数字和下划线。
      </div>
      {fields.length ? (
        <>
          <Table<DataTableField>
            rowKey="fieldKey"
            size="small"
            pagination={false}
            columns={columns}
            dataSource={fields}
          />
          <div style={{ marginTop: 16 }}>
            <b>按当前列生成的写入报文</b>
            <div className="text-12 muted" style={{ marginTop: 4 }}>
              报文里只认列键；下面的值只是按列类型给的示例，调用时换成真实值。
            </div>
            <pre className="mono" style={CODE_STYLE}>
              {JSON.stringify(sampleRow(fields), null, 2)}
            </pre>
          </div>
        </>
      ) : (
        <EmptyState text="该表还没有列；先添加列，之后这里会列出列键和写入报文" />
      )}
    </div>
  );
}

/** 机器通道：本表的 API Key 鉴权、端点清单、调用示例与写入规则。 */
function MachineChannelPanel({ table }: { table: DataTableTable }) {
  const fields = sortedFields(table);
  const base = `/api/v1/data-tables/${table.id}`;
  // curl 示例里的域名跟站点域名一致，不写死本站地址
  const siteBase = useSiteBase() || SITE_BASE_PLACEHOLDER;
  const sample = fields.length ? sampleRow(fields) : null;
  const endpoints = [
    {
      method: "GET",
      path: base,
      desc: "读取表结构：列名、列键、类型、必填、单选候选项与当前账号的权限位",
    },
    {
      method: "GET",
      path: `${base}/rows?limit=100&offset=0`,
      desc: "分页读行：按行 ID 倒序；limit 1–500（默认 100），用 offset 翻页",
    },
    {
      method: "POST",
      path: `${base}/rows`,
      desc: "新增一行：body 直接写 { 列键: 值 }，也可以包一层 { data: { 列键: 值 } }",
    },
    {
      method: "POST",
      path: `${base}/rows/batch`,
      desc: "批量新增：body 为 { rows: [ { 列键: 值 }, … ] }，单次 1–200 行，整批一个事务",
    },
    {
      method: "PATCH",
      path: `${base}/rows/{rowId}`,
      desc: "修改一行：body 为 { data: { 列键: 值 } }；整行覆盖，没带上的列会被清空",
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <b>鉴权</b>
        <div className="text-12 muted" style={{ marginTop: 4 }}>
          请求头带 <code>X-Api-Key: ek_你的Key</code>。Key 在「API Key 管理」里生成，明文只显示一次；
          这里的 Key 是本系统的 <code>ek_</code> Key，AIworkin 平台的 <code>sk-</code> Key 不能用于机器通道。
          Key 属于哪个账号，就按那个账号的权限看表、写表；表归属账号能看自己的全部表，被授权成员只能看授权过的表。
        </div>
      </div>

      <b>本表的接口地址</b>
      <Table
        rowKey={(row) => `${row.method} ${row.path}`}
        size="small"
        pagination={false}
        style={{ marginTop: 6 }}
        dataSource={endpoints}
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
            width: 340,
            render: (value: string) => (
              <span className="mono text-12">{value}</span>
            ),
          },
          { title: "说明", dataIndex: "desc" },
        ]}
      />
      <div className="text-12 muted" style={{ marginTop: 8 }}>
        响应统一包一层 <code>{`{ "code": 0, "message": "ok", "data": … }`}</code>；
        <code>code</code> 非 0 时看 <code>message</code>。机器通道只开放读结构与行读写，
        建表、改列、授权、删行只在界面按权限操作，没有删除行的接口。
      </div>

      <div style={{ marginTop: 18 }}>
        <b>调用示例</b>
      </div>
      <div className="text-12 muted" style={{ marginTop: 4 }}>
        1. 先读表结构，确认列键与类型（服务地址与页面同域）：
      </div>
      <pre className="mono" style={CODE_STYLE}>
        {`curl -H "X-Api-Key: ek_你的Key" \\
  ${siteBase}${base}`}
      </pre>

      {sample ? (
        <>
          <div className="text-12 muted" style={{ marginTop: 8 }}>
            2. 批量写行：把下面报文存成 <code>rows.json</code>，一次最多 200 行，整批一个事务：
          </div>
          <pre className="mono" style={CODE_STYLE}>
            {JSON.stringify({ rows: [sample, sampleRow(fields, "2")] }, null, 2)}
          </pre>
          <pre className="mono" style={CODE_STYLE}>
            {`curl -X POST -H "X-Api-Key: ek_你的Key" \\
  -H "Content-Type: application/json" \\
  --data-binary @rows.json \\
  ${siteBase}${base}/rows/batch`}
          </pre>

          <div className="text-12 muted" style={{ marginTop: 8 }}>
            3. 改一行：先 GET 行列表拿 <code>id</code>（行 ID）与全部列值，整行覆盖提交：
          </div>
          <pre className="mono" style={CODE_STYLE}>
            {JSON.stringify({ data: sample }, null, 2)}
          </pre>
          <pre className="mono" style={CODE_STYLE}>
            {`curl -X PATCH -H "X-Api-Key: ek_你的Key" \\
  -H "Content-Type: application/json" \\
  --data-binary @row.json \\
  ${siteBase}${base}/rows/行ID`}
          </pre>
        </>
      ) : (
        <div className="text-12 muted" style={{ marginTop: 8 }}>
          该表还没有列；添加列后，这里会按真实列键生成写入与修改的报文示例。
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <b>写入规则</b>
        <div className="text-12 muted" style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>
          {`• 报文的键必须是列键（fieldKey），不认识或已删除的列键按 400 拒绝
• 类型：数字列传数字（数字字符串也收）；是/否列传 true / false（也收 "是" / "否"、"1" / "0"）；日期列传可解析的日期文本（如 2026-01-15）；链接列只收 http(s)；邮箱列校验格式；JSON 列传任意 JSON；单选列必须是该列候选项之一
• 空值（null、空串、不传）按空处理；必填列没值按 400 拒绝
• PATCH 是整行覆盖：没带上的列会被清空，必填列每次都要带
• 批量写整体一个事务：任意一行不合法，整批都不落库
• 权限：读结构 / 读行要「访问」，写行要「新增」，改行要「修改」；删行只在界面按「删除」权限操作`}
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <b>常见错误</b>
        <div className="text-12 muted" style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>
          {`• 401：没带 X-Api-Key，或 Key 写错、已重置、已吊销。到「API Key 管理」确认当前生效的那把
• 20002：这把 Key 的账号既不是表归属账号，也没被授权。请表归属账号在「共享授权」里加对应权限
• 400「列键「xxx」不属于该表」：写成了列名而不是列键，或该列已被删除。先 GET 表结构，按返回的 fieldKey 拼报文
• 读行条数：limit 上限 500，用 offset 翻页；界面列表按 pageSize 上限 200，两者是不同入口`}
        </div>
      </div>
    </div>
  );
}

/**
 * 单张多维表格的设置入口：列定义、列键、机器通道、飞书同步都收在这里。
 * 按钮放在表头「导出 CSV」右侧；非归属账号只有列键与机器通道两个只读页签。
 */
export function TableSettingsButton({
  table,
  onChanged,
}: {
  table: DataTableTable;
  onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("fields");

  const items = [
    ...(table.owner ? [{ key: "fields", label: "列定义" }] : []),
    { key: "keys", label: "列键（脚本用的键）" },
    { key: "channel", label: "机器通道（API Key 鉴权）" },
    ...(table.owner ? [{ key: "feishu", label: "飞书多维表格同步" }] : []),
  ];
  const active = items.some((item) => item.key === tab) ? tab : items[0].key;

  return (
    <>
      <Button icon={<SettingOutlined />} onClick={() => setOpen(true)}>
        设置
      </Button>
      <Modal
        open={open}
        title={`表格设置 · ${table.name}`}
        width={1080}
        onCancel={() => setOpen(false)}
        footer={<Button onClick={() => setOpen(false)}>关闭</Button>}
        destroyOnHidden
        styles={{
          body: {
            maxHeight: "calc(100vh - 220px)",
            overflowY: "auto",
            paddingRight: 8,
          },
        }}
      >
        <TabStrip
          items={items}
          value={active}
          onChange={setTab}
          style={{ marginBottom: 16 }}
        />
        {active === "fields" && table.owner ? (
          <FieldPanel table={table} onChanged={onChanged} />
        ) : null}
        {active === "keys" ? <FieldKeyPanel table={table} /> : null}
        {active === "channel" ? <MachineChannelPanel table={table} /> : null}
        {active === "feishu" && table.owner ? (
          <SyncPanel table={table} onChanged={onChanged} />
        ) : null}
      </Modal>
    </>
  );
}
