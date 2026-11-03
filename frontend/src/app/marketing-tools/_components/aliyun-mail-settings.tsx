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
  DIRECTMAIL_REGIONS,
  aliyunMailApi,
  type AliyunMailReceiver,
  type AliyunMailSettings,
  type AliyunMailTestResult,
} from "./aliyun-mail-common";

/**
 * 邮件设置：AccessKey / 地域 / 默认收件人列表。
 * 与其他设置页签同一口径 —— 控件只改草稿，点「保存设置」才落库；Secret 留空＝不修改。
 */
export function AliyunMailSettingsPanel({
  settings,
  onSaved,
}: {
  settings: AliyunMailSettings;
  onSaved: () => Promise<void>;
}) {
  const { message } = App.useApp();
  const [accessKeyId, setAccessKeyId] = useState("");
  const [accessKeySecret, setAccessKeySecret] = useState("");
  const [region, setRegion] = useState(settings.region);
  const [defaultReceiverId, setDefaultReceiverId] = useState(
    settings.defaultReceiverId,
  );
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<AliyunMailTestResult | null>(
    null,
  );

  const [lists, setLists] = useState<AliyunMailReceiver[]>([]);
  const [listsLoading, setListsLoading] = useState(false);
  const [listsError, setListsError] = useState("");

  const reloadLists = useCallback(async () => {
    if (!settings.configured) return;
    setListsLoading(true);
    const result = await aliyunMailApi.receiverLists("");
    if (result.data) {
      setLists(result.data);
      setListsError("");
    } else {
      setListsError(result.message || "收件人列表读取失败");
    }
    setListsLoading(false);
  }, [settings.configured]);

  useEffect(() => {
    void reloadLists();
  }, [reloadLists, settings.updatedAt]);

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
    const receiverChanged =
      defaultReceiverId !== settings.defaultReceiverId ||
      (defaultReceiverId !== "" && region !== settings.region);
    setSaving(true);
    try {
      await aliyunMailApi.saveSettings({
        ...(ak ? { accessKeyId: ak } : {}),
        ...(secret ? { accessKeySecret: secret } : {}),
        region,
        ...(receiverChanged
          ? {
              defaultReceiverId,
              defaultReceiverName:
                lists.find((item) => item.receiverId === defaultReceiverId)
                  ?.receiverName || "",
            }
          : {}),
      });
      setAccessKeyId("");
      setAccessKeySecret("");
      setTestResult(null);
      await onSaved();
      message.success("邮件设置已保存");
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
      const result = await aliyunMailApi.test();
      setTestResult(result);
      if (result.ok) message.success("连通测试通过");
      else message.warning("连通测试未通过，请按提示处理");
    } catch (error) {
      message.error((error as Error).message || "连通测试失败");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Notice variant="info">
        使用你自己的阿里云 RAM 子账号（不要用主账号），并给该子账号开通邮件推送的
        ListReceivers / CreateReceiver / SaveReceiverDetail / QueryMailAddress
        权限。AccessKeySecret 只保存密文；留空＝保持已保存的密钥不变。
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
                settings.hasAccessKeySecret
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
                settings.hasAccessKeySecret
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
          2. 地域与默认收件人列表
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
            <Select
              style={{ width: 200 }}
              value={region}
              onChange={(value) => {
                setRegion(value);
                setDefaultReceiverId("");
              }}
              options={DIRECTMAIL_REGIONS}
            />
          </div>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 4 }}>
              默认收件人列表（可留空）
            </div>
            <Space size={6} wrap>
              <Select
                style={{ width: 320 }}
                allowClear
                showSearch
                optionFilterProp="label"
                value={defaultReceiverId || undefined}
                onChange={(value) => setDefaultReceiverId(value || "")}
                loading={listsLoading}
                placeholder={
                  settings.configured
                    ? listsLoading
                      ? "收件人列表读取中…"
                      : listsError
                        ? "列表读取失败，可先保存后再读取"
                        : lists.length
                          ? "选择默认收件人列表"
                          : "该账号下还没有收件人列表"
                    : "保存 Key 后可读取收件人列表"
                }
                options={lists.map((item) => ({
                  value: item.receiverId,
                  label: `${item.receiverName} · ${item.count} 人`,
                }))}
              />
              <Button
                icon={<ReloadOutlined aria-hidden />}
                disabled={!settings.configured}
                loading={listsLoading}
                onClick={() => void reloadLists()}
              >
                读取列表
              </Button>
            </Space>
          </div>
        </div>
        {listsError ? (
          <div className="text-12 muted" style={{ marginTop: 6 }}>
            {listsError}
          </div>
        ) : null}
        <div className="text-12 muted" style={{ marginTop: 6 }}>
          地域必须与阿里云控制台里发信地址所在区域一致，否则接口会报找不到资源。
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
                {`Key 可用：账号下有 ${testResult.receiverCount} 个收件人列表。`}
              </Notice>
            ) : (
              <Notice variant="warn">
                <div>连通测试未通过：</div>
                <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
                  {testResult.messages.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </Notice>
            )}
            {testResult.ok && testResult.messages.length ? (
              <div className="text-12 muted" style={{ marginTop: 6 }}>
                {testResult.messages.join("；")}
              </div>
            ) : null}
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
