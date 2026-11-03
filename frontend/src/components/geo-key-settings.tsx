"use client";

import { App, Button, Form, Input, Modal, Space, Table } from "antd";
import { useState } from "react";
import { geoApi } from "@/api/geo";
import { Notice, Panel } from "@/components/ui/panel";
import { fmtTime } from "@/lib/datetime";
import { useBusinessQuery, useOperationMutation } from "@/query/business";
import { presentMutationError } from "@/query/errors";

/** GET /enterprise/geo/settings 行（后端从不回密钥，只回是否已配置；数据只属于当前账号）。 */
export type GeoProviderRow = {
  code: string;
  platform: string;
  label: string;
  purpose: string;
  modelHint: string;
  defaultBaseUrl: string;
  model: string;
  baseUrl: string;
  configured: boolean;
  source: "db" | "none";
  updatedBy: string;
  updatedAt: string | null;
};

const SOURCE_BADGE: Record<GeoProviderRow["source"], string> = {
  db: "badge-blue",
  none: "badge-gray",
};

const SOURCE_TEXT: Record<GeoProviderRow["source"], string> = {
  db: "已配置",
  none: "未配置",
};

/**
 * GEO 采集平台 Key：当前账号自己的十二家采集平台 API Key / 模型 / 接口地址。
 * 入口在「营销工具 → GEO-AI引擎优化」，每个账号各配各的，管理与使用都按账号归属。
 * 后端：GET|PUT|DELETE /enterprise/geo/settings[/:code]、POST .../:code/test，
 * 取用的永远是登录账号自己的 Key——不共享、管理员也不能替别人配置、不回落 backend/.env。
 * 密钥只落 AES-256-GCM 密文，接口与页面都不回显。
 */
export function GeoKeySettingsPanel() {
  const saveMutation = useOperationMutation(geoApi.saveSettings, ["*"]);
  const clearMutation = useOperationMutation(geoApi.clearSettings, ["*"]);
  const testMutation = useOperationMutation(geoApi.testSettings, []);

  const { message, modal } = App.useApp();
  const query = useBusinessQuery("geo", "settings", {}, (signal) =>
    geoApi.settings({}, { signal }),
  );
  const providers = query.data?.providers ?? [];
  const loading = query.isPending;
  const denied = query.error?.message || "";
  const configuredCount = providers.filter((row) => row.configured).length;
  // 前台可用性 = 配了 Key 且填了模型，与后端 availablePlatforms() 同口径
  const usableCount = providers.filter(
    (row) => row.configured && row.model,
  ).length;

  const [editing, setEditing] = useState<GeoProviderRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState("");
  const [form] = Form.useForm<{
    apiKey?: string;
    model?: string;
    baseUrl?: string;
  }>();

  const openConfig = (row: GeoProviderRow) => {
    setEditing(row);
    form.setFieldsValue({
      apiKey: "",
      model: row.model || "",
      baseUrl: row.baseUrl || "",
    });
  };

  const submit = async () => {
    try {
      if (!editing) return;
      const values = await form.validateFields();
      setSaving(true);
      try {
        await saveMutation.mutateAsync({
          params: { code: editing.code },
          body: {
            ...(values.apiKey?.trim() ? { apiKey: values.apiKey.trim() } : {}),
            model: values.model ?? "",
            baseUrl: values.baseUrl ?? "",
          },
        });

        message.success(`已保存「${editing.label}」的配置`);
        setEditing(null);
      } finally {
        setSaving(false);
      }
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  const test = async (row: GeoProviderRow) => {
    setTesting(row.code);
    try {
      const result = await testMutation.mutateAsync({
        params: { code: row.code },
      });
      if (!result) throw new Error("调用未返回结果");
      modal.success({
        title: `连通正常 · ${row.label}`,
        content: (
          <div className="text-12">
            <div>
              模型：<span className="mono">{result.model}</span>
            </div>
            <div>密钥来源：我的账号（仅本人使用）</div>
            <div>耗时：{result.elapsedMs} ms</div>
            {result.reply ? <div>应答：{result.reply}</div> : null}
          </div>
        ),
      });
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    } finally {
      setTesting("");
    }
  };

  /** 只要存过一行（Key 或模型 / 接口地址）就需要「清除」入口。 */
  const hasOverride = (row: GeoProviderRow) =>
    row.source === "db" || Boolean(row.model) || Boolean(row.baseUrl);

  const clear = (row: GeoProviderRow) => {
    modal.confirm({
      title: "清除平台配置",
      okText: "确认清除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      content: `清除后你账号下「${row.label}」的 Key 与模型 / 接口地址一并去掉，该平台在你的 GEO 项目里立即变为不可用（不能选为监控平台、不参与自动采集）。确定清除吗？`,
      onOk: async () => {
        await clearMutation.mutateAsync({
          params: { code: row.code },
        });

        message.success(`已清除「${row.label}」的平台配置`);
      },
    });
  };

  return (
    <Panel
      title="GEO 采集平台 API Key"
      titleBadge={
        <span className="badge badge-blue">
          {`我的 Key ${configuredCount} 家 · 可用 ${usableCount} / ${providers.length} 家`}
        </span>
      }
    >
      {denied ? <Notice variant="error">{denied}</Notice> : null}
      <Notice variant="info">
        <div style={{ fontWeight: 600 }}>
          这里配置的是<b>我自己的</b> Key，只用于我建的 GEO
          项目；别人（包括管理员）看不到也用不了
        </div>
        <div className="text-12" style={{ marginTop: 4 }}>
          ① 采集＝去各家平台提问（谁的回答只能问谁，没有单一模型可代采）；
          观测解析统一用豆包（火山方舟）文本模型把回答解析成观测字段。
          <br />
          ② 密钥按 AES-256-GCM
          密文落库，页面与接口都不回显（只显示是否已配置）；
          保存即时生效，不用改 .env、不用重启。
          <br />③ 可用口径：本平台 Key
          <b>与模型都配好</b>，我的 GEO 项目（监控平台、自动采集）才用得了；
          没在这里配置的平台一律不可用，<b>不会再借用别人的 Key 或 backend/.env</b>。
          <br />④ 模型 /
          接入点按各家官方文档填写（火山方舟填已开通的文本模型或接入点
          ep-xxxxxxxx）；境外平台（GPT / Claude / Gemini /
          Grok）若本机网络不可达， 可把「接口地址」改成可访问的中转网关。
        </div>
      </Notice>

      <div className="table-wrap" style={{ marginTop: 12 }}>
        <Table<GeoProviderRow>
          rowKey="code"
          loading={loading}
          dataSource={providers}
          pagination={false}
          size="middle"
          columns={[
            {
              title: "采集平台",
              width: 250,
              render: (_, row) => (
                <div>
                  <div style={{ fontWeight: 600 }}>{row.label}</div>
                  <div className="text-12 muted" style={{ marginTop: 4 }}>
                    {row.purpose}
                  </div>
                </div>
              ),
            },
            {
              title: "API Key",
              width: 260,
              render: (_, row) => (
                <div>
                  <span className={`badge ${SOURCE_BADGE[row.source]}`}>
                    {SOURCE_TEXT[row.source]}
                  </span>
                  <div className="text-12 muted" style={{ marginTop: 4 }}>
                    {row.source === "db"
                      ? `我的账号保存 · ${fmtTime(row.updatedAt) || "—"}`
                      : "不可用：请先在这里保存 Key 并填写模型"}
                  </div>
                </div>
              ),
            },
            {
              title: "前台可用性",
              width: 150,
              render: (_, row) => {
                const usable = row.configured && Boolean(row.model);
                return (
                  <span
                    className={`badge ${usable ? "badge-green" : "badge-orange"}`}
                  >
                    {usable
                      ? "可用"
                      : row.configured
                        ? "缺模型 · 不可用"
                        : "未配置 · 不可用"}
                  </span>
                );
              },
            },
            {
              title: "模型 / 接入点",
              width: 220,
              render: (_, row) =>
                row.model ? (
                  <span className="mono text-12">{row.model}</span>
                ) : (
                  <span className="text-12 muted">{row.modelHint}</span>
                ),
            },
            {
              title: "接口地址",
              width: 260,
              render: (_, row) => (
                <div>
                  <span className="mono text-12">
                    {row.baseUrl || row.defaultBaseUrl}
                  </span>
                  <div className="text-12 muted" style={{ marginTop: 4 }}>
                    {row.baseUrl ? "自定义" : "平台默认"}
                  </div>
                </div>
              ),
            },
            {
              title: "操作",
              width: 210,
              render: (_, row) => (
                <Space size={6} wrap>
                  <Button onClick={() => openConfig(row)}>配置</Button>
                  <Button
                    disabled={!row.configured || !row.model}
                    loading={testing === row.code}
                    onClick={() => void test(row)}
                  >
                    测试连通
                  </Button>
                  {hasOverride(row) ? (
                    <Button danger onClick={() => clear(row)}>
                      清除
                    </Button>
                  ) : null}
                </Space>
              ),
            },
          ]}
        />
      </div>
      <p className="text-12 muted" style={{ marginBottom: 0 }}>
        「测试连通」用我当前保存的 Key / 模型 /
        接口地址真发一次最小请求（回复四个字），
        只验证连通，不产生观测数据；要填模型 /
        接入点后才能测。采集出来的观测直接落 GEO-AI引擎优化 →
        采集批次，可人工改删。
      </p>

      <Modal
        open={Boolean(editing)}
        title={`配置采集平台 · ${editing?.label || ""}`}
        width={560}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
        onCancel={() => setEditing(null)}
        onOk={() => void submit()}
      >
        <p className="text-12 muted" style={{ marginTop: 0 }}>
          {`接口：${editing?.defaultBaseUrl || ""}（留空接口地址＝用平台默认）。Key 只保存在我的账号下，保存后立即生效，可在列表点「测试连通」验证。`}
        </p>
        <Form form={form} layout="vertical">
          <Form.Item
            name="apiKey"
            label="API Key"
            extra={
              editing?.configured
                ? "留空＝保留现有 Key；填写即覆盖（任何接口都不会回显已保存的 Key）。"
                : "当前未配置：保存后按此 Key 调用，仅我的账号可用。"
            }
          >
            <Input.Password
              autoComplete="new-password"
              placeholder={
                editing?.configured
                  ? "留空＝保留现有 Key"
                  : "粘贴平台控制台申请的 API Key"
              }
            />
          </Form.Item>
          <Form.Item
            name="model"
            label="模型 / 接入点"
            extra={`方舟可填接入点 ep-xxxxxxxx；示例：${editing?.modelHint || ""}`}
          >
            <Input placeholder={editing?.modelHint || ""} />
          </Form.Item>
          <Form.Item
            name="baseUrl"
            label="接口地址（可空，默认用官方地址）"
            extra={`默认：${editing?.defaultBaseUrl || ""}`}
          >
            <Input placeholder="https://..." />
          </Form.Item>
        </Form>
      </Modal>
    </Panel>
  );
}
