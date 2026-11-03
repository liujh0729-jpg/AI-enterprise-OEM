"use client";

import { KeyOutlined } from "@ant-design/icons";
import { App, Button, ConfigProvider, Modal, Space, Table } from "antd";
import { useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Notice, PageHero, Panel } from "@/components/ui/panel";
import { useApiKeys, useApiKeyUsage, useApiKeyActions } from '@/query/identity';
import type { EndpointResponse } from '@enterprise/contracts';
import { fmtTime } from "@/lib/datetime";
import { AipddKeyPanel } from "./_components/aipdd-key-panel";

type ApiKeyRow = NonNullable<EndpointResponse<'Identity_apiKeys'>['data']>[number];

type SecretInfo = { mode: "created" | "reset"; plainKey: string };

/** 调用记录动作文案（后端审计动作码 → 中文）。 */
const ACTION_LABELS: Record<string, string> = {
  API_CALL: "调用开放接口",
  API_KEY_CREATE: "生成 API Key",
  API_KEY_RESET: "重置 API Key",
  API_KEY_REVOKE: "吊销 API Key",
};

/** 两套 Key 各管各的：本系统 ek_ Key 自助签发，AIPDD sk- Key 由 AIPDD 平台签发后绑定。 */
const PANEL_NOTE =
  "此处生成的 ek_ Key 用于调用 Enterprise 开放接口（/api/v1），与下方 AIPDD API Key（sk-）互不通用。服务端只保存哈希摘要和脱敏值，明文仅在生成或重置时展示一次。";

export default function ApiKeysPage() {
  const { message, modal } = App.useApp();
  const query = useApiKeys();
  const rows = query.data || [];
  const loading = query.isPending;
  const actions = useApiKeyActions();
  const [secret, setSecret] = useState<SecretInfo | null>(null);
  const [usage, setUsage] = useState<ApiKeyRow | null>(null);
  const usageQuery = useApiKeyUsage(usage?.id);

  const copyKey = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      message.success("已复制");
    } catch {
      message.warning("请手动复制");
    }
  };

  const createKey = async () => {
    try {
      const result = await actions.create.mutateAsync();
      if (result) setSecret({mode:'created',plainKey:result.plainKey});
    } catch { /* Mutation Hook presents operation errors. */ }
  };
  const resetKey = (row:ApiKeyRow) => modal.confirm({
    title:'重置 API Key', okText:'确认重置',cancelText:'取消',okButtonProps:{danger:true},
    content:`重置后 ${row.masked} 将立即失效，并生成新 Key。确定重置吗？`,
    onOk:async()=>{
      const result=await actions.reset.mutateAsync(row.id);
      if(result)setSecret({mode:'reset',plainKey:result.plainKey});
    },
  });
  const revokeKey = (row:ApiKeyRow) => modal.confirm({
    title:'吊销 API Key',okText:'确认吊销',cancelText:'取消',okButtonProps:{danger:true},
    content:`吊销后 ${row.masked} 将无法继续访问开放接口，且不可恢复。确定吊销吗？`,
    onOk:async()=>{await actions.revoke.mutateAsync(row.id);void message.success('Key 已吊销');},
  });

  return (
    // 按钮文案与 demo 逐字一致：关闭 antd 对 2 个汉字按钮自动插入空格的行为
    <ConfigProvider button={{ autoInsertSpace: false }}>
      <PageHero
        title="API Key 管理"
        desc="两套 Key 分别管理：本系统 ek_ Key 用于调用开放接口（/api/v1），AIPDD API Key（sk-）绑定后解锁同步发布到 AIworkin 等上游能力。"
      />

      <Panel
        title="我的 API Key"
        extra={
          <Button type="primary" loading={actions.create.isPending} onClick={() => void createKey()}>
            ＋ 生成新 Key
          </Button>
        }
      >
        <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          {PANEL_NOTE}
        </p>
        {query.error && <Notice variant="error">加载失败：{query.error.message}</Notice>}
        <div className="table-wrap">
          <Table<ApiKeyRow>
            rowKey="id"
            loading={loading}
            dataSource={rows}
            pagination={false}
            size="middle"
            locale={{
              emptyText: (
                <div className="empty">
                  <div className="empty-ico"><KeyOutlined aria-hidden /></div>
                  <div>暂无 API Key</div>
                  <div className="text-12">点击右上角「生成新 Key」创建</div>
                </div>
              ),
            }}
            columns={[
              {
                title: "Key（脱敏）",
                dataIndex: "masked",
                width: 220,
                render: (value: string) => (
                  <span className="mono text-12">{value}</span>
                ),
              },
              {
                title: "状态",
                dataIndex: "status",
                width: 110,
                render: (value: string) => <StatusBadge status={value} />,
              },
              {
                title: "创建时间",
                dataIndex: "createdAt",
                width: 180,
                render: (value: string) => (
                  <span className="text-12">{fmtTime(value) || "—"}</span>
                ),
              },
              {
                title: "最近使用",
                dataIndex: "lastUsedAt",
                width: 180,
                render: (value: string | null) => (
                  <span className="text-12">
                    {value ? fmtTime(value) : "从未使用"}
                  </span>
                ),
              },
              {
                title: "操作",
                width: 240,
                render: (_, row) =>
                  row.status === "ACTIVE" ? (
                    <Space size={6} wrap>
                      <Button onClick={() => setUsage(row)}>
                        使用记录
                      </Button>
                      <Button onClick={() => resetKey(row)}>
                        重置
                      </Button>
                      <Button danger onClick={() => revokeKey(row)}>
                        吊销
                      </Button>
                    </Space>
                  ) : (
                    <span className="text-12">—</span>
                  ),
              },
            ]}
          />
        </div>
      </Panel>

      <AipddKeyPanel />

      <Modal
        open={secret?.mode === "created"}
        title="API Key 已生成"
        width={620}
        onCancel={() => setSecret(null)}
        footer={[
          <Button
            key="copy"
            type="primary"
            onClick={() => void copyKey(secret?.plainKey || "")}
          >
            复制 Key
          </Button>,
          <Button key="close" onClick={() => setSecret(null)}>
            我已保存，关闭
          </Button>,
        ]}
      >
        <div
          style={{
            background: "var(--bg-muted)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "12px 14px",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>
            您的明文 API Key（仅展示这一次，请妥善保存）
          </div>
          <div
            className="mono"
            style={{ fontSize: 13, marginTop: 6, wordBreak: "break-all" }}
          >
            {secret?.plainKey || ""}
          </div>
        </div>
        <div className="text-12" style={{ marginTop: 8 }}>
          调用示例（将 ENTERPRISE_API_BASE 设为实际后端地址）：
        </div>
        <pre
          className="mono"
          style={{
            margin: "8px 0 0",
            padding: "12px 14px",
            fontSize: 12,
            lineHeight: 1.7,
            color: "var(--text-2)",
            background: "var(--bg-muted)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            overflowX: "auto",
          }}
        >
          {`curl "$ENTERPRISE_API_BASE/users/me" \\\n  -H "X-Api-Key: ${secret?.plainKey || ""}"`}
        </pre>
      </Modal>

      <Modal
        open={secret?.mode === "reset"}
        title="Key 已重置"
        width={560}
        onCancel={() => setSecret(null)}
        footer={[
          <Button key="close" type="primary" onClick={() => setSecret(null)}>
            关闭
          </Button>,
        ]}
      >
        <div
          style={{
            background: "var(--bg-muted)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "12px 14px",
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>
            新的明文 API Key（仅展示这一次）
          </div>
          <div
            className="mono"
            style={{ fontSize: 13, marginTop: 6, wordBreak: "break-all" }}
          >
            {secret?.plainKey || ""}
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(usage)}
        title={usage ? `${usage.masked} · 本账号 API 记录` : ""}
        width={620}
        onCancel={() => setUsage(null)}
        footer={[
          <Button key="close" type="primary" onClick={() => setUsage(null)}>
            关闭
          </Button>,
        ]}
      >
        <p className="text-12 muted">
          展示本账号最近 20 条 API 相关审计记录，包含 Key 管理和调用动作，不按当前 Key 筛选。
        </p>
        {usageQuery.error ? <Notice variant="error">使用记录加载失败：{usageQuery.error.message}</Notice> : usageQuery.isFetching ? <div>加载中…</div> : usageQuery.data?.length ? (
          usageQuery.data.map((log, index) => (
            <div
              key={index}
              style={{
                display: "flex",
                gap: 10,
                alignItems: "baseline",
                padding: "7px 0",
                borderBottom: "1px dashed var(--border)",
              }}
            >
              <span className="mono text-12">
                {fmtTime(log.createdAt)}
              </span>
              <span style={{ fontSize: 13 }}>
                {ACTION_LABELS[log.action || ""] || log.action || "—"}
              </span>
              <span className="text-12">{log.detail || "—"}</span>
            </div>
          ))
        ) : (
          <div className="muted" style={{ fontSize: 13 }}>
            暂无调用记录
          </div>
        )}
      </Modal>
    </ConfigProvider>
  );
}
