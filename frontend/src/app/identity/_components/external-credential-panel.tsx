"use client";

import { SafetyCertificateOutlined } from "@ant-design/icons";
import { App, Button, Form, Input, Modal, Select, Table } from "antd";
import { useState } from "react";
import { usePasswordConfirm } from "@/components/confirm-with-password";
import { EmptyState, Notice } from "@/components/ui/panel";
import { useExternalCredentials, useExternalCredentialActions } from "@/query/workspaces";
import { type EndpointResponse } from "@enterprise/contracts";
import { useSession } from "@/lib/session";

type ExternalCredential = NonNullable<EndpointResponse<"External_listCredentials">["data"]>[number];

/** 凭据类型 → 外报通道（与后端 CHANNEL_CATALOG 的通道编码一致）。 */
const CRED_TYPES: { value: string; label: string; channel: string }[] = [
  { value: "CA", label: "企业 CA / UKey", channel: "TAX_DIRECT" },
  { value: "SERVICE_ACCOUNT", label: "电子税务局子账号", channel: "TAX_DIRECT" },
  { value: "IC_CARD", label: "电子口岸 IC 卡 / 法人卡", channel: "CUSTOMS_SP" },
];

const CRED_LABEL: Record<string, string> = Object.fromEntries(
  CRED_TYPES.map((item) => [item.value, item.label]),
);

const CHANNEL_LABEL: Record<string, string> = {
  MANUAL: "人工通道",
  TAX_DIRECT: "税企直连",
  TAX_SP: "持牌税务服务商",
  CUSTOMS_SP: "报关服务商（单一窗口）",
};

function expired(expiresAt: string | null) {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() < Date.now();
}

/**
 * 外报凭据（企业维度主数据）：CA / 电子税务局子账号 / 电子口岸 IC 卡。
 * 新增免密；修改与删除需密码。凭据内容仅提交时不加密回显，列表一律脱敏。
 */
export function ExternalCredentialPanel() {
  const { message } = App.useApp();
  const { me } = useSession();
  const { request: requestPassword, modal: passwordModal } = usePasswordConfirm();
  const [editing, setEditing] = useState<ExternalCredential | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form] = Form.useForm();
  const enterpriseId = Number(
    (me?.enterprise as { id?: number } | null)?.id || 0,
  );

  const credentialsQuery = useExternalCredentials(enterpriseId);
  const actions = useExternalCredentialActions(enterpriseId);
  const submitting = actions.save.isPending;
  const rows = credentialsQuery.data ?? [];
  const loading = enterpriseId > 0 && credentialsQuery.isPending;
  const load = async () => { await credentialsQuery.refetch(); };

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ cred_type: "CA", expiry: "" });
    setFormOpen(true);
  };

  const openEdit = (row: ExternalCredential) => {
    setEditing(row);
    form.setFieldsValue({
      cred_type: row.credType,
      label: row.label,
      secret: "",
      expiry: row.expiresAt ? String(row.expiresAt).slice(0, 10) : "",
    });
    setFormOpen(true);
  };

  const save = async () => {
    const values = await form.validateFields();
    const credType = String(values.cred_type || "");
    const channel =
      CRED_TYPES.find((item) => item.value === credType)?.channel || "MANUAL";
    const secret = String(values.secret || "").trim();
    if (!secret) {
      message.warning("请填写凭据内容（仅密文入库，界面不回显）");
      return;
    }
    const body = {
      enterpriseId,
      // 编辑沿用餐次原通道，避免唯一键变化产生重复记录
      channelCode: editing ? editing.channelCode : channel,
      credType,
      label: String(values.label || "").trim() || CRED_LABEL[credType] || credType,
      secret,
      extra: {},
      // 外报模块的请求体字段为 camelCase（expiresAt），空串按「长期有效」提交
      expiresAt: String(values.expiry || "").trim() || null,
    };
    if (!editing) {
      try {
        await actions.save.mutateAsync(body);
        message.success("外报凭据已保存（密文存储）");
        setFormOpen(false);
      } catch { /* 统一 Mutation Hook 已展示错误。 */ }
      return;
    }
    const target = editing;
    requestPassword({
      title: "修改外报凭据（需密码）",
      content: `确认覆盖「${target.label}」的凭据内容？修改后原凭据内容不可恢复。`,
      okText: "保存修改",
      onOk: async () => {
        await actions.save.mutateAsync(body);
        message.success("外报凭据已更新（密文存储）");
        setFormOpen(false);
        setEditing(null);
      },
    });
  };

  const remove = (row: ExternalCredential) => {
    requestPassword({
      title: "删除外报凭据",
      danger: true,
      okText: "确认删除",
      content: `删除后该凭据在系统中即失效（外报需重新录入）。确定删除「${row.label}」？`,
      onOk: async () => {
        await actions.remove.mutateAsync(row.id);
        message.success("外报凭据已删除");
      },
    });
  };

  if (!enterpriseId) {
    return (
      <Notice variant="info">
        请先提交企业信息，再维护外报凭据（企业 CA / 电子税务局子账号 / 电子口岸 IC 卡）。
      </Notice>
    );
  }

  return (
    <>
      {credentialsQuery.isError ? <Notice variant="error">{credentialsQuery.error.message} <Button onClick={() => void load()}>重试</Button></Notice> : null}
      <Notice variant="info">
        外报凭据仅企业本人与平台管理员可见：内容以 AES-256-GCM
        密文入库，列表不回显明文；新增免密，修改与删除需密码。
      </Notice>
      <div style={{ margin: "12px 0" }}>
        <Button type="primary" onClick={openCreate}>
          ＋ 新增外报凭据
        </Button>
      </div>
      <div className="table-wrap">
        <Table<ExternalCredential>
          rowKey="id"
          loading={loading}
          pagination={false}
          size="middle"
          dataSource={rows}
          locale={{
            emptyText: (
              <EmptyState
                icon={<SafetyCertificateOutlined aria-hidden />}
                text="尚未配置外报凭据。人工通道报送无需凭据；开通税企直连 / 电子口岸前可先行登记。"
              />
            ),
          }}
          columns={[
            {
              title: "凭据类型",
              dataIndex: "credType",
              width: 190,
              render: (value: string, row: ExternalCredential) => (
                <div>
                  <span className="badge badge-sky">
                    {CRED_LABEL[value] || value}
                  </span>
                  <div className="text-12 muted" style={{ marginTop: 4 }}>
                    {CHANNEL_LABEL[row.channelCode] || row.channelCode}
                  </div>
                </div>
              ),
            },
            {
              title: "标签 / 备注",
              dataIndex: "label",
              ellipsis: true,
            },
            {
              title: "到期时间",
              dataIndex: "expiresAt",
              width: 130,
              render: (value: string | null) => (
                <span className="text-12">
                  {value ? String(value).slice(0, 10) : "长期有效"}
                </span>
              ),
            },
            {
              title: "状态",
              width: 100,
              render: (_: unknown, row: ExternalCredential) =>
                expired(row.expiresAt) ? (
                  <span className="badge badge-orange">已过期</span>
                ) : (
                  <span className="badge badge-green">已配置</span>
                ),
            },
            {
              title: "更新时间",
              dataIndex: "updatedAt",
              width: 160,
              render: (value: string) => (
                <span className="text-12 muted">
                  {value ? new Date(value).toLocaleString("zh-CN") : "—"}
                </span>
              ),
            },
            {
              title: "操作",
              width: 150,
              render: (_: unknown, row: ExternalCredential) => (
                <div style={{ display: "flex", gap: 6 }}>
                  <Button onClick={() => openEdit(row)}>
                    编辑
                  </Button>
                  <Button danger onClick={() => remove(row)}>
                    删除
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </div>

      <Modal
        open={formOpen}
        title={editing ? "修改外报凭据（需密码）" : "新增外报凭据"}
        width={560}
        confirmLoading={submitting}
        onCancel={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        okText={editing ? "保存修改（需密码）" : "保存凭据"}
        onOk={() => void save()}
      >
        <Notice variant="warn">
          凭据内容仅用于后续对接税务 / 海关系统；提交后密文入库，任何界面与日志都不回显明文。
        </Notice>
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item
            name="cred_type"
            label="凭据类型"
            rules={[{ required: true, message: "请选择凭据类型" }]}
          >
            <Select
              disabled={Boolean(editing)}
              options={CRED_TYPES.map((item) => ({
                value: item.value,
                label: `${item.label}（${CHANNEL_LABEL[item.channel]}）`,
              }))}
            />
          </Form.Item>
          <Form.Item name="label" label="标签 / 备注">
            <Input
              disabled={Boolean(editing)}
              placeholder="如：总机构 CA、上海分公司子账号（留空取凭据类型名）"
            />
          </Form.Item>
          <Form.Item
            name="secret"
            label="凭据内容"
            rules={[{ required: true, message: "凭据内容必填" }]}
            extra={
              editing
                ? "修改会覆盖原凭据内容（密文重新写入），原内容不可查看"
                : "如 UKey 序列号 / 子账号密码 / IC 卡编号，仅密文入库"
            }
          >
            <Input.Password placeholder="仅提交时可见，保存后不回显" />
          </Form.Item>
          <Form.Item name="expiry" label="到期时间" extra="格式 YYYY-MM-DD，留空表示长期有效">
            <Input placeholder="如：2027-12-31" />
          </Form.Item>
        </Form>
      </Modal>

      {passwordModal}
    </>
  );
}
