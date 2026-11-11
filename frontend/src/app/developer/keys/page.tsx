"use client";

import { KeyOutlined } from "@ant-design/icons";
import { App, Button, ConfigProvider, InputNumber, Modal, Radio, Space, Table } from "antd";
import { useEffect, useState } from "react";
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
  API_KEY_QUOTA: "设置积分额度",
  API_KEY_REVEAL: "复制 API Key",
};

/** 两套 Key 各管各的：本系统 ek_ Key 自助签发，AIPDD sk- Key 由 AIPDD 平台签发后绑定。 */
const PANEL_NOTE =
  "此处生成的 ek_ Key 用于调用 Enterprise 开放接口（/api/v1）与模型广场，与下方 AIPDD API Key（sk-）互不通用。明文以密文保存在服务端，仅本人在此页可随时复制；给单个 Key 设「积分额度」后，对外调用累计消耗超出该额度即被拒绝。";

/** 积分展示：最多 4 位小数（与积分账本精度一致），去掉多余的 0。 */
const fmtPoints = (value: number) => String(Number(Number(value || 0).toFixed(4)));

export default function ApiKeysPage() {
  const { message, modal } = App.useApp();
  const query = useApiKeys();
  const rows = query.data || [];
  const loading = query.isPending;
  const actions = useApiKeyActions();
  const [secret, setSecret] = useState<SecretInfo | null>(null);
  const [usage, setUsage] = useState<ApiKeyRow | null>(null);
  const [quotaRow, setQuotaRow] = useState<ApiKeyRow | null>(null);
  const [quotaMode, setQuotaMode] = useState<"limited" | "unlimited">("unlimited");
  const [quotaValue, setQuotaValue] = useState<number | null>(null);
  const usageQuery = useApiKeyUsage(usage?.id);

  // 从「驾驶舱」的红色绑定按钮带 #aipdd-key 跳进来时，直接滚到绑定板块。
  useEffect(() => {
    if (window.location.hash === "#aipdd-key") {
      document
        .getElementById("aipdd-key")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

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

  /** 复制 API Key：向服务端回读本人 Key 明文再写入剪贴板。 */
  const copyKeyRow = async (row: ApiKeyRow) => {
    try {
      const result = await actions.reveal.mutateAsync(row.id);
      if (result?.plainKey) await copyKey(result.plainKey);
    } catch { /* Mutation Hook presents operation errors. */ }
  };

  const openQuota = (row: ApiKeyRow) => {
    setQuotaRow(row);
    setQuotaMode(row.pointsQuota === null ? "unlimited" : "limited");
    setQuotaValue(row.pointsQuota ?? null);
  };
  const saveQuota = async () => {
    if (!quotaRow) return;
    if (quotaMode === "limited" && !(Number(quotaValue) > 0)) {
      void message.warning("请填写大于 0 的积分额度");
      return;
    }
    try {
      await actions.quota.mutateAsync({
        id: quotaRow.id,
        pointsQuota: quotaMode === "unlimited" ? null : Number(quotaValue),
      });
      void message.success("积分额度已保存");
      setQuotaRow(null);
    } catch { /* Mutation Hook presents operation errors. */ }
  };

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
                width: 200,
                render: (value: string) => (
                  <span className="mono text-12">{value}</span>
                ),
              },
              {
                title: "状态",
                dataIndex: "status",
                width: 100,
                render: (value: string) => <StatusBadge status={value} />,
              },
              {
                title: "积分额度",
                dataIndex: "pointsQuota",
                width: 180,
                render: (value: number | null, row) => (
                  <span className="text-12">
                    {value === null
                      ? `不限额度 · 已用 ${fmtPoints(row.pointsUsed)}`
                      : `${fmtPoints(row.pointsUsed)} / ${fmtPoints(value)}`}
                  </span>
                ),
              },
              {
                title: "创建时间",
                dataIndex: "createdAt",
                width: 150,
                render: (value: string) => (
                  <span className="text-12">{fmtTime(value) || "—"}</span>
                ),
              },
              {
                title: "最近使用",
                dataIndex: "lastUsedAt",
                width: 140,
                render: (value: string | null) => (
                  <span className="text-12">
                    {value ? fmtTime(value) : "从未使用"}
                  </span>
                ),
              },
              {
                title: "操作",
                width: 380,
                render: (_, row) =>
                  row.status === "ACTIVE" ? (
                    <Space size={6} wrap>
                      <Button onClick={() => void copyKeyRow(row)}>
                        复制API Key
                      </Button>
                      <Button onClick={() => openQuota(row)}>
                        设置额度
                      </Button>
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

      <div id="aipdd-key">
        <AipddKeyPanel />
      </div>

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
        open={Boolean(quotaRow)}
        title={quotaRow ? `${quotaRow.masked} · 积分额度` : ""}
        width={520}
        onCancel={() => setQuotaRow(null)}
        footer={[
          <Button key="cancel" onClick={() => setQuotaRow(null)}>
            取消
          </Button>,
          <Button
            key="save"
            type="primary"
            loading={actions.quota.isPending}
            onClick={() => void saveQuota()}
          >
            保存
          </Button>,
        ]}
      >
        <Radio.Group
          value={quotaMode}
          onChange={(event) => setQuotaMode(event.target.value)}
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
          <Radio value="unlimited">
            不限额度：该 Key 的调用只受账号积分余额约束
          </Radio>
          <Radio value="limited">
            <span>自定义额度：累计消耗达到上限后，该 Key 的调用会被拒绝</span>
            <InputNumber
              min={0.0001}
              step={100}
              precision={4}
              value={quotaValue}
              disabled={quotaMode !== "limited"}
              onChange={(value) => setQuotaValue(value)}
              style={{ display: "block", width: 220, marginTop: 8 }}
              suffix="积分"
            />
          </Radio>
        </Radio.Group>
        <p className="text-12 muted" style={{ marginTop: 12, marginBottom: 0 }}>
          {quotaRow
            ? `该 Key 累计已消耗 ${fmtPoints(quotaRow.pointsUsed)} 积分。`
            : ""}
          额度按该 Key 对外调用（模型广场 /v1）的实际用量累计，调整后立即生效。
        </p>
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
