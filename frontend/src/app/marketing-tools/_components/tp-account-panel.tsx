"use client";

import {
  ExportOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Table,
  Tag,
} from "antd";
import type { TableProps } from "antd";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { tpApi } from "@/api/tp";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import {
  TP_CONSOLE_URL,
  TP_PRODUCT_LABELS,
  load,
  tpProductLabel,
  tpProducts,
  type TpAccount,
  type TpTestResult,
} from "./tp-common";
import { TpFieldLabel, useTpAccounts } from "./tp-ui";

/**
 * 企点连接设置：凭据按登录账号配置，一个产品一套（同一产品要跨空间就建多行）。
 * secretKey 只写不读，编辑时留空＝保留已存的值。
 */

type TpProduct = (typeof tpProducts)[number];

const PRODUCT_OPTIONS = tpProducts.map((code) => ({
  value: code as TpProduct,
  label: TP_PRODUCT_LABELS[code] || code,
}));

type Draft = {
  id: number;
  product: TpProduct;
  label: string;
  gateway: string;
  corporationId: string;
  secretId: string;
  secretKey: string;
  bizId: string;
  status: "active" | "disabled";
};

const EMPTY_DRAFT: Draft = {
  id: 0,
  product: "CDP",
  label: "",
  gateway: "https://tmc.qidian.qq.com",
  corporationId: "",
  secretId: "",
  secretKey: "",
  bizId: "",
  status: "active",
};

function draftOf(row: TpAccount): Draft {
  return {
    id: row.id,
    product: (tpProducts as readonly string[]).includes(row.product)
      ? (row.product as TpProduct)
      : "CDP",
    label: row.label,
    gateway: row.gateway,
    corporationId: row.corporationId,
    secretId: row.secretId,
    secretKey: "",
    bizId: row.bizId,
    status: row.status === "disabled" ? "disabled" : "active",
  };
}

export function TpAccountPanel({
  products,
  tip,
  tabs,
  title = "企点凭据",
}: {
  /** 本张卡用到的产品：只列这些凭据，新建时也只给这些选项。 */
  products: TpProduct[];
  tip?: string;
  /** 卡片内的页签条：贴面板标题行最右。 */
  tabs?: ReactNode;
  /** 面板标题：三张企点卡都用各自的工具名，而不是「企点凭据」。 */
  title?: string;
}) {
  const { message } = App.useApp();
  const { accounts, error, loading, reload } = useTpAccounts();
  const { request: requestPassword, modal: passwordModal } = usePasswordConfirm();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState(0);
  const [testResult, setTestResult] = useState<{
    account: string;
    result: TpTestResult;
  } | null>(null);

  const rows = useMemo(
    () => (accounts || []).filter((item) => products.some((code) => code === item.product)),
    [accounts, products],
  );

  const patch = (next: Partial<Draft>) =>
    setDraft((prev) => (prev ? { ...prev, ...next } : prev));

  const commit = useCallback(
    async (body: Draft) => {
      setSaving(true);
      try {
        await tpApi.saveAccount({
          body: {
            id: body.id,
            product: body.product,
            label: body.label.trim(),
            gateway: body.gateway.trim() || "https://tmc.qidian.qq.com",
            corporationId: body.corporationId.trim(),
            secretId: body.secretId.trim(),
            secretKey: body.secretKey,
            bizId: body.bizId.trim(),
            status: body.status,
          },
        });
        message.success(body.id ? "凭据已更新" : "凭据已保存");
        setDraft(null);
        setTestResult(null);
        await reload();
      } catch (err) {
        message.error((err as Error).message || "保存失败");
      } finally {
        setSaving(false);
      }
    },
    [message, reload],
  );

  const submit = () => {
    if (!draft) return;
    if (!draft.corporationId.trim()) {
      message.warning("请填写企业ID");
      return;
    }
    if (!draft.bizId.trim()) {
      message.warning("请填写空间ID");
      return;
    }
    if (!draft.id && !draft.secretKey.trim()) {
      message.warning("请填写签名密钥 secretKey");
      return;
    }
    const body = draft;
    // 修改要口令，新建免密（与全站改删口径一致）。
    if (body.id) {
      requestPassword({
        title: "修改企点凭据",
        okText: "确认修改",
        onOk: () => commit(body),
      });
      return;
    }
    void commit(body);
  };

  const test = async (row: TpAccount) => {
    setTestingId(row.id);
    setTestResult(null);
    const result = await load(tpApi.testAccount({ params: { id: String(row.id) } }));
    setTestingId(0);
    if (result.data) {
      setTestResult({ account: row.label || row.corporationId, result: result.data });
    } else {
      setTestResult({
        account: row.label || row.corporationId,
        result: {
          ok: false,
          message: result.message || "企点凭据校验失败",
          probe: "",
          elapsedMs: 0,
        },
      });
    }
  };

  const openCreate = () => {
    setTestResult(null);
    setDraft({
      ...EMPTY_DRAFT,
      product: products.length === 1 ? products[0] : "CDP",
    });
  };

  const openConsole = () =>
    window.open(TP_CONSOLE_URL, "_blank", "noopener,noreferrer");

  const remove = (row: TpAccount) =>
    requestPassword({
      title: "删除企点凭据",
      okText: "确认删除",
      danger: true,
      content: `删除后该产品的读查询与名单执行都会失败：${tpProductLabel(row.product)} · ${row.label || row.corporationId}`,
      onOk: async () => {
        await tpApi.deleteAccount({ params: { id: String(row.id) } });
        message.success("凭据已删除");
        setTestResult(null);
        await reload();
      },
    });

  const columns: TableProps<TpAccount>["columns"] = [
    {
      title: "产品",
      dataIndex: "productLabel",
      width: 130,
      render: (_: unknown, row) => tpProductLabel(row.product),
    },
    {
      title: "名称",
      dataIndex: "label",
      width: 170,
      render: (_: unknown, row) => row.label || "未命名",
    },
    { title: "企业ID", dataIndex: "corporationId", width: 150 },
    { title: "空间ID", dataIndex: "bizId", width: 150 },
    {
      title: "secretId",
      dataIndex: "secretId",
      width: 150,
      render: (value: string) => value || "未填",
    },
    {
      title: "secretKey",
      dataIndex: "hasSecretKey",
      width: 110,
      render: (value: boolean) => (value ? "已配置" : "未配置"),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 90,
      render: (value: string) =>
        value === "active" ? (
          <Tag color="success">启用</Tag>
        ) : (
          <Tag>停用</Tag>
        ),
    },
    {
      title: "最近校验",
      dataIndex: "lastVerifiedAt",
      width: 170,
      render: (_: unknown, row) => (
        <div>
          <div className="text-12">{row.lastVerifiedAt || "未校验"}</div>
          {row.lastError ? (
            <div className="text-12 muted">{row.lastError}</div>
          ) : null}
        </div>
      ),
    },
    {
      title: "操作",
      width: 210,
      render: (_: unknown, row) => (
        <Space size={6}>
          <Button
            loading={testingId === row.id}
            disabled={row.status !== "active"}
            onClick={() => void test(row)}
          >
            测试连接
          </Button>
          <Button onClick={() => setDraft(draftOf(row))}>编辑</Button>
          <Button danger onClick={() => remove(row)}>
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Panel
      title={title}
      extra={tabs}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 10,
        }}
      >
        {tip ? <span className="text-12 muted">{tip}</span> : null}
        <Button
          type="link"
          size="small"
          icon={<ExportOutlined aria-hidden />}
          style={{ padding: 0, marginLeft: "auto" }}
          onClick={openConsole}
        >
          打开腾讯企点营销工作台
        </Button>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 10,
        }}
      >
        <span style={{ fontWeight: 600 }}>凭据</span>
        <span className="text-12 muted">
          {rows.length ? `${rows.length} 条` : "未配置"}
        </span>
        <Space size={16} style={{ marginLeft: "auto" }}>
          <Button
            type="link"
            size="small"
            icon={<ReloadOutlined aria-hidden />}
            loading={loading}
            style={{ padding: 0 }}
            onClick={() => void reload()}
          >
            刷新
          </Button>
          <Button
            type="link"
            size="small"
            icon={<PlusOutlined aria-hidden />}
            style={{ padding: 0 }}
            onClick={openCreate}
          >
            添加凭据
          </Button>
        </Space>
      </div>
      {error ? (
        <div style={{ marginBottom: 10 }}>
          <Notice variant="warn">{error}</Notice>
        </div>
      ) : null}
      {testResult ? (
        <div style={{ marginBottom: 10 }}>
          <Notice variant={testResult.result.ok ? "success" : "warn"}>
            {`${testResult.account}：${testResult.result.message}${
              testResult.result.elapsedMs
                ? `（耗时 ${(testResult.result.elapsedMs / 1000).toFixed(1)} 秒）`
                : ""
            }`}
          </Notice>
        </div>
      ) : null}
      {!loading && !rows.length ? (
        <EmptyState
          text={`还没有${products.map((item) => tpProductLabel(item)).join("、")}的凭据，点上方「添加凭据」填写企业ID、secretId、secretKey 和空间ID`}
        />
      ) : (
        <div className="table-wrap">
          <Table<TpAccount>
            rowKey="id"
            size="middle"
            loading={loading}
            dataSource={rows}
            columns={columns}
            scroll={{ x: "max-content" }}
            pagination={false}
          />
        </div>
      )}

      <Modal
        open={Boolean(draft)}
        title={draft?.id ? "编辑企点凭据" : "添加企点凭据"}
        onCancel={() => setDraft(null)}
        onOk={submit}
        okText="保存设置"
        cancelText="取消"
        confirmLoading={saving}
        destroyOnHidden
        width={560}
      >
        {draft ? (
          <Form layout="vertical" preserve={false}>
            <Form.Item label="产品">
              <Select
                value={draft.product}
                options={PRODUCT_OPTIONS.filter((item) =>
                  products.includes(item.value),
                )}
                onChange={(next) => patch({ product: next as TpProduct })}
              />
            </Form.Item>
            <Form.Item label="名称">
              <Input
                value={draft.label}
                maxLength={60}
                placeholder="例如「生产空间」"
                onChange={(event) => patch({ label: event.target.value })}
              />
            </Form.Item>
            <Form.Item label="企业ID corporationId" required>
              <Input
                value={draft.corporationId}
                maxLength={64}
                onChange={(event) => patch({ corporationId: event.target.value })}
              />
            </Form.Item>
            <Form.Item label="空间ID bizId" required>
              <Input
                value={draft.bizId}
                maxLength={64}
                onChange={(event) => patch({ bizId: event.target.value })}
              />
            </Form.Item>
            <Form.Item label="secretId">
              <Input
                value={draft.secretId}
                maxLength={128}
                onChange={(event) => patch({ secretId: event.target.value })}
              />
            </Form.Item>
            <Form.Item label="secretKey" required={!draft.id}>
              <Input.Password
                value={draft.secretKey}
                maxLength={256}
                placeholder={draft.id ? "留空＝保留已配置的密钥" : "请输入签名密钥"}
                onChange={(event) => patch({ secretKey: event.target.value })}
              />
            </Form.Item>
            <Form.Item label="网关地址">
              <Input
                value={draft.gateway}
                maxLength={191}
                onChange={(event) => patch({ gateway: event.target.value })}
              />
            </Form.Item>
            <div>
              <TpFieldLabel>启用状态</TpFieldLabel>
              <Radio.Group
                value={draft.status}
                onChange={(event) =>
                  patch({ status: event.target.value as "active" | "disabled" })
                }
                options={[
                  { value: "active", label: "启用（参与取数与执行）" },
                  { value: "disabled", label: "停用（保留配置，暂不使用）" },
                ]}
              />
            </div>
          </Form>
        ) : null}
      </Modal>
      {passwordModal}
    </Panel>
  );
}
