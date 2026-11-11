"use client";
import {
  App,
  Button,
  DatePicker,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Tag,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useState } from "react";
import {
  EXTENSION_CAPABILITY_STATUSES,
  EXTENSION_CAPABILITY_STATUS_LABELS,
} from "@enterprise/contracts";
import { Panel, Notice, EmptyState } from "@/components/ui/panel";
import {
  platformApi,
  type ExtensionCapability,
  type ExtensionCapabilitySaveBody,
} from "@/api/platform";
import { useOperationMutation } from "@/query/business";
import { PermissionNotice, useAdminData } from "./common";

/** 状态色：正常 / 灰度 / 停止派发 / 下线。 */
const STATUS_COLOR: Record<string, string> = {
  ACTIVE: "green",
  GRAY: "orange",
  DEPRECATED: "gold",
  RETIRED: "red",
};

const STATUS_OPTIONS = EXTENSION_CAPABILITY_STATUSES.map((status) => ({
  label: `${EXTENSION_CAPABILITY_STATUS_LABELS[status]}（${status}）`,
  value: status,
}));

type FormValues = {
  status: string;
  minVersion: string;
  grayOrgIdsText: string;
  forceUpgradeAt: Dayjs | null;
  note: string;
};

/**
 * 平台统一插件能力目录（§10.7）：能力定义写在契约层，本页只维护平台级覆盖——
 * 启用 / 灰度 / 强制升级 / 下线。保存后派发门槛（版本、灰度、下线）即时生效。
 */
export function ExtensionCapabilityPanel() {
  const { message } = App.useApp();
  const { data, denied, loading, reload } = useAdminData(
    "extension-catalog",
    (signal) => platformApi.extensionCatalog({ signal }),
  );
  const [editing, setEditing] = useState<ExtensionCapability | null>(null);
  const [form] = Form.useForm<FormValues>();
  const save = useOperationMutation(
    (input: { key: string; body: ExtensionCapabilitySaveBody }) =>
      platformApi.saveExtensionCapability(input.key, input.body),
    ["extension-catalog"],
  );

  const openEditor = (capability: ExtensionCapability) => {
    form.setFieldsValue({
      status: capability.status,
      minVersion: capability.minVersion,
      grayOrgIdsText: capability.grayOrgIds.join("\n"),
      forceUpgradeAt: capability.forceUpgradeAt
        ? dayjs(capability.forceUpgradeAt)
        : null,
      note: capability.note,
    });
    setEditing(capability);
  };

  const onSubmit = async (values: FormValues) => {
    if (!editing) return;
    const grayOrgIds = String(values.grayOrgIdsText || "")
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
    try {
      await save.mutateAsync({
        key: editing.key,
        body: {
          status: values.status as ExtensionCapabilitySaveBody["status"],
          minVersion: String(values.minVersion || "").trim(),
          grayOrgIds,
          forceUpgradeAt: values.forceUpgradeAt
            ? values.forceUpgradeAt.toISOString()
            : null,
          note: String(values.note || "").trim(),
        },
      });
      message.success("插件能力已更新");
      setEditing(null);
      await reload();
    } catch {
      // 失败提示由 useBusinessMutation 统一弹出，这里只保留面板不关闭
    }
  };

  return (
    <>
      <PermissionNotice denied={denied} />
      <Panel
        title="插件能力目录"
        titleBadge={<span className="text-12 muted">启用 / 灰度 / 强制升级 / 下线</span>}
      >
        <Notice variant="info">
          能力清单由契约统一定义，这里只配置平台覆盖：<strong>已启用</strong>
          正常派发；<strong>灰度中</strong>只对名单内机构派发；
          <strong>已停止派发</strong>保留入口但不再下发任务；
          <strong>已下线</strong>完全关闭。最低版本与强制升级时间用于拦截过旧插件。
        </Notice>
        {data?.release ? (
          <div className="text-12 muted" style={{ margin: "10px 0" }}>
            当前插件版本 v{data.release.version}（最低兼容 v
            {data.release.minVersion}）
            {data.release.published ? "" : " · 平台尚未发布插件包，入口不展示"}
          </div>
        ) : null}
        {loading ? (
          <EmptyState text="正在读取能力目录…" />
        ) : (
          <div style={{ display: "grid", gap: 12, marginTop: 8 }}>
            {(data?.capabilities ?? []).map((capability) => (
              <div
                key={capability.key}
                style={{
                  border: "1px solid var(--border, #f0f0f0)",
                  borderRadius: 10,
                  padding: "12px 14px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    alignItems: "center",
                  }}
                >
                  <div>
                    <Space size={8}>
                      <strong>{capability.label}</strong>
                      <Tag color={STATUS_COLOR[capability.status] || "default"}>
                        {capability.statusLabel}
                      </Tag>
                      <span className="text-12 muted">
                        最低 v{capability.minVersion}
                      </span>
                    </Space>
                    <div className="text-12 muted" style={{ marginTop: 4 }}>
                      {capability.description}
                    </div>
                  </div>
                  <Button size="small" onClick={() => openEditor(capability)}>
                    配置
                  </Button>
                </div>
                <div className="text-12 muted" style={{ marginTop: 8 }}>
                  入口 <span className="mono">{capability.entry}</span>
                  {capability.grayOrgIds.length
                    ? ` · 灰度机构 ${capability.grayOrgIds.length} 个`
                    : ""}
                  {capability.forceUpgradeAt
                    ? ` · 强制升级 ${dayjs(capability.forceUpgradeAt).format("YYYY-MM-DD HH:mm")}`
                    : ""}
                  {capability.note ? ` · 备注：${capability.note}` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Modal
        open={!!editing}
        title={editing ? `配置能力：${editing.label}` : "配置能力"}
        onCancel={() => setEditing(null)}
        onOk={() => form.submit()}
        confirmLoading={save.isPending}
        destroyOnHidden
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" onFinish={onSubmit}>
          <Form.Item
            name="status"
            label="派发状态"
            extra="已启用＝正常派发；灰度中＝只对灰度名单内机构派发；已停止派发＝保留入口不再下发；已下线＝完全关闭。"
          >
            <Select options={STATUS_OPTIONS} />
          </Form.Item>
          <Form.Item
            name="minVersion"
            label="生效最低版本"
            extra="低于该版本的插件一律不派发该能力任务；留空则回落契约默认版本。"
          >
            <Input placeholder="例如 1.3.0" maxLength={20} allowClear />
          </Form.Item>
          <Form.Item
            name="grayOrgIdsText"
            label="灰度机构（每行一个机构 userId）"
            extra="仅在状态为「灰度中」时生效：只对名单内的机构派发该能力任务。"
          >
            <Input.TextArea rows={3} placeholder={"机构 userId，每行一个"} />
          </Form.Item>
          <Form.Item
            name="forceUpgradeAt"
            label="强制升级时间"
            extra="到点后低于生效最低版本的插件一律拒绝派发；留空表示不强制。"
          >
            <DatePicker showTime allowClear style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="note" label="运营备注">
            <Input.TextArea rows={2} maxLength={300} placeholder="灰度范围 / 原因等" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
