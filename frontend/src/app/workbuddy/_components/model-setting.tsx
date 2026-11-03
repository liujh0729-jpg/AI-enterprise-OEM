"use client";

import { App, Button, Form, Modal, Select, Space, Tag } from "antd";
import Link from "next/link";
import { useEffect, useState } from "react";
import { workbuddyApi, type WbLlmSetting } from "./common";

/**
 * 澄清任务书用的 AIPDD 文字模型配置：Key 统一用「API Key 管理」里那把，
 * 这里只回打码串并保存默认模型；模型清单由 /models 实时拉取。
 */
export function ModelSettingModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (setting: WbLlmSetting) => void;
}) {
  const { message } = App.useApp();
  const [setting, setSetting] = useState<WbLlmSetting | null>(null);
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setLoading(true);
    void workbuddyApi.setting().then((result) => {
      setSetting(result.data);
      setModel(result.data?.model || "");
      setError(result.message);
      setLoading(false);
    });
  }, [open]);

  const pullModels = async () => {
    setLoading(true);
    const result = await workbuddyApi.llmModels();
    setModels(result.data?.models || []);
    setError(result.message);
    setLoading(false);
    if (result.data?.models.length) {
      message.success(`读到 ${result.data.models.length} 个模型`);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const saved = await workbuddyApi.saveSetting({ model });
      setSetting(saved);
      onSaved(saved);
      message.success("模型配置已保存");
      onClose();
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const clearModel = async () => {
    setSaving(true);
    try {
      await workbuddyApi.removeSetting();
      const next: WbLlmSetting = {
        configured: setting?.configured || false,
        keyMasked: setting?.keyMasked || "",
        model: "",
        baseUrl: setting?.baseUrl || "",
      };
      setSetting(next);
      setModel("");
      setModels([]);
      message.success("默认模型已清除");
      onSaved(next);
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const modelOptions = Array.from(
    new Set([...(setting?.model ? [setting.model] : []), ...models]),
  ).map((value) => ({ value, label: value }));

  return (
    <Modal
      open={open}
      title="AI 模型设置（任务书澄清）"
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          {setting?.model ? (
            <Button danger onClick={() => void clearModel()} loading={saving}>
              清除默认模型
            </Button>
          ) : null}
          <Button type="primary" loading={saving} onClick={() => void save()}>
            保存
          </Button>
        </Space>
      }
      width={620}
      destroyOnHidden
    >
      {error ? (
        <div
          className="text-12"
          style={{ color: "var(--danger)", marginBottom: 10 }}
        >
          {error}
        </div>
      ) : null}
      <Form layout="vertical">
        <Form.Item
          label={
            <Space size={6}>
              <span>API Key</span>
              {setting?.configured ? (
                <Tag color="green">已配置 {setting.keyMasked}</Tag>
              ) : (
                <Tag>未配置</Tag>
              )}
            </Space>
          }
          extra={
            setting?.configured ? (
              <>
                全站共用「API Key 管理」里那把 Key，可在{" "}
                <Link href="/developer/keys">API Key 管理</Link> 更换或吊销。
              </>
            ) : (
              <>
                还没有 API Key，请先到{" "}
                <Link href="/developer/keys">API Key 管理</Link> 生成一把。
              </>
            )
          }
        />
        <Form.Item
          label="默认模型"
          extra={
            setting?.baseUrl
              ? `服务地址固定 ${setting.baseUrl}（与 RPA 写脚本同一通道）`
              : undefined
          }
        >
          <Space.Compact style={{ width: "100%" }}>
            <Select
              style={{ flex: 1 }}
              value={model || undefined}
              placeholder={
                setting?.configured
                  ? "先拉取模型清单再选择"
                  : "生成 API Key 后才能拉取模型"
              }
              options={modelOptions}
              loading={loading}
              allowClear
              onChange={(value) => setModel(value || "")}
            />
            <Button
              onClick={() => void pullModels()}
              loading={loading}
              disabled={!setting?.configured}
            >
              拉取模型
            </Button>
          </Space.Compact>
        </Form.Item>
      </Form>
    </Modal>
  );
}
