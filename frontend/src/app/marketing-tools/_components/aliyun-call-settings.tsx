"use client";

import {
  ApiOutlined,
  CheckCircleOutlined,
  ReloadOutlined,
  SaveOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { App, Button, Input, Select, Space, Tag } from "antd";
import { useCallback, useEffect, useState } from "react";
import { Notice } from "@/components/ui/panel";
import { fmtTime } from "@/lib/datetime";
import {
  OUTBOUNDBOT_REGION,
  OUTBOUNDBOT_REGION_LABEL,
  aliyunCallApi,
  type AliyunCallInstance,
  type AliyunCallSettings,
  type AliyunCallTestResult,
} from "./aliyun-call-common";

/**
 * 外呼设置：AccessKey / 地域 / 默认实例。
 * 与其他设置页签同一口径 —— 控件只改草稿，点「保存设置」才落库；Secret 留空＝不修改。
 */
export function AliyunCallSettingsPanel({
  settings,
  onSaved,
}: {
  settings: AliyunCallSettings;
  onSaved: () => Promise<void>;
}) {
  const { message } = App.useApp();
  const [accessKeyId, setAccessKeyId] = useState("");
  const [accessKeySecret, setAccessKeySecret] = useState("");
  const [instanceId, setInstanceId] = useState(settings.instanceId);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AliyunCallTestResult | null>(
    null,
  );

  const [instances, setInstances] = useState<AliyunCallInstance[]>([]);
  const [instancesLoading, setInstancesLoading] = useState(false);
  const [instancesError, setInstancesError] = useState("");

  const reloadInstances = useCallback(async () => {
    if (!settings.configured) return;
    setInstancesLoading(true);
    const result = await aliyunCallApi.instances();
    if (result.data) {
      setInstances(result.data);
      setInstancesError("");
    } else {
      setInstancesError(result.message || "业务实例读取失败");
    }
    setInstancesLoading(false);
  }, [settings.configured]);

  useEffect(() => {
    void reloadInstances();
  }, [reloadInstances, settings.updatedAt]);

  const save = async () => {
    const ak = accessKeyId.trim();
    const secret = accessKeySecret.trim();
    if (!settings.configured && !ak) {
      message.warning("请填写 AccessKeyId");
      return;
    }
    if (!settings.configured && !secret) {
      message.warning("请填写 AccessKeySecret");
      return;
    }
    setSaving(true);
    try {
      await aliyunCallApi.saveSettings({
        ...(ak ? { accessKeyId: ak } : {}),
        ...(secret ? { accessKeySecret: secret } : {}),
        region: OUTBOUNDBOT_REGION,
        instanceId,
      });
      setAccessKeyId("");
      setAccessKeySecret("");
      setTestResult(null);
      await onSaved();
      message.success("外呼设置已保存");
    } catch (error) {
      message.error((error as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await aliyunCallApi.test();
      setTestResult(result);
      if (result.ok) message.success("连通测试通过");
      else message.warning("连通测试未全部通过，请按提示逐项处理");
    } catch (error) {
      message.error((error as Error).message || "连通测试失败");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Notice variant="info">
        使用你自己的阿里云 RAM 子账号（不要用主账号）。AccessKeySecret
        只保存密文，界面只显示打码的 AccessKeyId；留空＝保持已保存的密钥不变。
      </Notice>

      <div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
          1. AccessKey
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 12,
            maxWidth: 900,
          }}
        >
          <div>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>
              AccessKeyId
            </div>
            <Input
              value={accessKeyId}
              onChange={(event) => setAccessKeyId(event.target.value)}
              placeholder={
                settings.hasSecret
                  ? `已保存 ${settings.accessKeyIdMasked}，留空不修改`
                  : "粘贴 RAM 子账号的 AccessKeyId，如 LTAI5t…"
              }
              autoComplete="off"
            />
          </div>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>
              AccessKeySecret
            </div>
            <Input.Password
              value={accessKeySecret}
              onChange={(event) => setAccessKeySecret(event.target.value)}
              placeholder={
                settings.hasSecret
                  ? "已保存密钥，留空不修改"
                  : "粘贴对应的 AccessKeySecret"
              }
              autoComplete="new-password"
            />
          </div>
        </div>
      </div>

      <div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
          2. 地域与默认实例
        </div>
        <div
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "flex-end",
          }}
        >
          <div>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>
              地域
            </div>
            <div style={{ height: 32, display: "flex", alignItems: "center" }}>
              {OUTBOUNDBOT_REGION_LABEL}
            </div>
          </div>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>
              默认实例（可留空）
            </div>
            <Space size={6} wrap>
              <Select
                style={{ width: 320 }}
                allowClear
                showSearch
                optionFilterProp="label"
                value={instanceId || undefined}
                onChange={(value) => setInstanceId(value || "")}
                loading={instancesLoading}
                placeholder={
                  settings.configured
                    ? instancesLoading
                      ? "业务实例读取中…"
                      : instancesError
                        ? "业务实例读取失败，可先保存后再读取"
                        : instances.length
                          ? "选择默认业务实例"
                          : "该账号下还没有业务实例"
                    : "保存 Key 后可读取业务实例"
                }
                options={instances.map((item) => ({
                  value: item.instanceId,
                  label: `${item.name || "未命名实例"} · ${item.instanceId}`,
                }))}
              />
              <Button
                icon={<ReloadOutlined aria-hidden />}
                disabled={!settings.configured}
                loading={instancesLoading}
                onClick={() => void reloadInstances()}
              >
                读取实例
              </Button>
            </Space>
          </div>
        </div>
        {instancesError ? (
          <div className="text-12 muted" style={{ marginTop: 6 }}>
            {instancesError}
          </div>
        ) : null}
        <div className="text-12 muted" style={{ marginTop: 6 }}>
          阿里云智能外呼目前只在华东 2（上海）开放，接口地址固定，业务实例与主叫号码都在该地域下读取。
        </div>
      </div>

      <div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
          3. 连通测试
        </div>
        <Space size={10} wrap>
          <Button
            icon={<ApiOutlined aria-hidden />}
            loading={testing}
            disabled={!settings.configured}
            onClick={() => void runTest()}
          >
            测试连通
          </Button>
          {settings.configured ? (
            <Tag
              color="green"
              icon={<CheckCircleOutlined aria-hidden />}
              style={{ marginInlineEnd: 0 }}
            >
              {`已配置 ${settings.accessKeyIdMasked}`}
            </Tag>
          ) : (
            <Tag
              color="orange"
              icon={<SafetyCertificateOutlined aria-hidden />}
              style={{ marginInlineEnd: 0 }}
            >
              尚未配置 Key
            </Tag>
          )}
          {settings.updatedAt ? (
            <span className="text-12 muted">
              最近保存：{fmtTime(settings.updatedAt)}
            </span>
          ) : null}
        </Space>
        {testResult ? (
          <div style={{ marginTop: 10 }}>
            {testResult.ok ? (
              <Notice variant="success">
                {`Key 可用：${testResult.instances.length} 个业务实例 · ${testResult.scripts.length} 个已发布话术 · ${testResult.numbers.length} 个主叫号码。`}
              </Notice>
            ) : (
              <Notice variant="warn">
                <div>连通测试未全部通过：</div>
                <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
                  {testResult.messages.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </Notice>
            )}
            {testResult.ok ? null : (
              <div className="text-12 muted" style={{ marginTop: 6 }}>
                {`已读到 ${testResult.instances.length} 个实例 · ${testResult.scripts.length} 个已发布话术 · ${testResult.numbers.length} 个主叫号码`}
              </div>
            )}
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button
          type="primary"
          icon={<SaveOutlined aria-hidden />}
          loading={saving}
          onClick={() => void save()}
        >
          保存设置
        </Button>
      </div>
    </div>
  );
}
