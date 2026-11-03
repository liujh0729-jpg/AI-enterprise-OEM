"use client";

import { CopyOutlined, LinkOutlined } from "@ant-design/icons";
import { App, Button, Descriptions, Input, Space } from "antd";
import { useCallback, useEffect, useState } from "react";
import { aipddKeyApi, type AipddKeyStatus } from "@/api/aipdd-key";
import { Notice, Panel } from "@/components/ui/panel";
import { fmtTime } from "@/lib/datetime";

/** 面板说明（原独立页的页头描述，并入功能板块内） */
const PANEL_NOTE =
  "绑定 AIPDD 平台签发的 API Key（sk-），才能使用「同步发布到 AIworkin」「服务商数据同步」「查看建联资源」等上游能力；本地注册、社交、供求广场与招聘发布不绑定也全可用。Key 经 AES-256-GCM 加密保存，界面与接口永不回显原文。所在省 / 市等基础数据由平台统一 Key 提供（平台管理后台 → 系统配置 → AIPDD 平台 Key），不绑定也能填表单。";

/**
 * AIPDD API Key 绑定（原「开放集成 → AIPDD Key 绑定」独立页，已并入「API Key 管理」）：
 * 上游动作的唯一用户凭证入口，本地功能不绑定也全可用。
 * 面板同时承担注册引导：管理员在「站点设置」配了 AIPDD 推荐码后，引导新用户去
 * www.aipdd.work 注册并填写推荐码——邀请注册佣金归管理员，新用户获赠算力。
 */
export function AipddKeyPanel() {
  const { message, modal } = App.useApp();
  const [status, setStatus] = useState<AipddKeyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>("");
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      setStatus(await aipddKeyApi.status());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const copyCode = async () => {
    const code = status?.referralCode || "";
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      message.success("推荐码已复制");
    } catch {
      message.warning("浏览器不允许剪贴板，请手动复制");
    }
  };

  const bind = async () => {
    const key = keyInput.trim();
    if (!key) {
      message.warning("请先粘贴 AIPDD 平台的 API Key（sk- 开头）");
      return;
    }
    setBusy(true);
    try {
      setStatus(await aipddKeyApi.bind(key));
      setKeyInput("");
      message.success(status?.bound ? "换绑成功" : "绑定成功");
    } catch (error) {
      if (error instanceof Error) message.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const unbind = () =>
    modal.confirm({
      title: "解绑 AIPDD API Key",
      okText: "确认解绑",
      cancelText: "取消",
      okButtonProps: { danger: true },
      content:
        "解绑后同步发布到 AIworkin、服务商数据同步等上游功能将不可用（本地功能不受影响）。确定解绑吗？",
      onOk: async () => {
        try {
          await aipddKeyApi.unbind();
          message.success("已解绑");
          await reload();
        } catch (error) {
          message.error(error instanceof Error ? error.message : "解绑失败");
          throw error;
        }
      },
    });

  const referralCode = status?.referralCode || "";
  const registerUrl = status?.registerUrl || "https://www.aipdd.work";

  return (
    <Panel
      title="AIPDD API Key 绑定"
      titleExtra={<span className="muted text-12">多个用户可绑同一把 Key（N:1）</span>}
    >
      <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
        {PANEL_NOTE}
      </p>

      {loadError ? (
        <Notice variant="error">
          {loadError} <Button size="small" onClick={() => void reload()}>重试</Button>
        </Notice>
      ) : loading ? (
        <span className="muted text-12">加载中…</span>
      ) : status?.bound ? (
        <Descriptions column={1} size="small" bordered style={{ marginBottom: 14 }}>
          <Descriptions.Item label="当前 Key">{status.masked}</Descriptions.Item>
          <Descriptions.Item label="AIPDD 账号">
            {String(status.profile?.nickName || status.profile?.username || "") ||
              status.aipddUserId ||
              "—"}
          </Descriptions.Item>
          <Descriptions.Item label="绑定时间">{fmtTime(status.boundAt || "")}</Descriptions.Item>
          <Descriptions.Item label="最近验真">
            {status.lastVerifiedAt ? fmtTime(status.lastVerifiedAt) : "—"}
          </Descriptions.Item>
          <Descriptions.Item label="同 Key 绑定用户">{status.sharedWith ?? 1} 人</Descriptions.Item>
        </Descriptions>
      ) : (
        <Notice variant="info">当前尚未绑定 AIPDD API Key，按下方步骤注册并粘贴 Key 绑定。</Notice>
      )}

      <Space.Compact style={{ width: "min(560px, 100%)", marginTop: 4 }}>
        <Input.Password
          value={keyInput}
          onChange={(event) => setKeyInput(event.target.value)}
          placeholder={
            status?.bound
              ? "粘贴新的 AIPDD API Key 换绑"
              : "粘贴 AIPDD API Key（sk- 开头 51 位）"
          }
          maxLength={200}
          disabled={loading || busy}
          onPressEnter={() => void bind()}
        />
        <Button type="primary" loading={busy} disabled={loading} onClick={() => void bind()}>
          {status?.bound ? "换绑" : "绑定"}
        </Button>
      </Space.Compact>
      {status?.bound ? (
        <div style={{ marginTop: 12 }}>
          <Button danger onClick={unbind}>解绑</Button>
        </div>
      ) : null}

      <div style={{ marginTop: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
          还没有 AIPDD 账号？三步注册并绑定
        </div>
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 2 }}>
          <li>
            前往{" "}
            <a href={registerUrl} target="_blank" rel="noreferrer">
              {registerUrl.replace(/^https?:\/\//, "")}
            </a>{" "}
            注册账号
            {referralCode ? (
              <>
                ，注册时填写推荐码{" "}
                <Space size={6}>
                  <span
                    style={{
                      fontFamily: "monospace",
                      fontSize: 14,
                      padding: "2px 8px",
                      border: "1px solid var(--line, #d9d9d9)",
                      borderRadius: 6,
                      background: "rgba(0,0,0,0.02)",
                    }}
                  >
                    {referralCode}
                  </span>
                  <Button size="small" icon={<CopyOutlined aria-hidden />} onClick={() => void copyCode()}>
                    复制推荐码
                  </Button>
                </Space>
                ，即可<b>获赠算力</b>
              </>
            ) : null}
            。
          </li>
          <li>登录后在 AIPDD 平台的「API Key 管理」创建 API Key（sk- 开头的 51 位字符）。</li>
          <li>回到本页粘贴 Key 绑定即可；Key 经 AES-256-GCM 加密保存，界面与接口永不回显原文。</li>
        </ol>
        {!referralCode && !loading && !loadError ? (
          <Notice variant="info">
            管理员尚未在「平台管理后台 → 站点设置」配置 AIPDD 推荐码；配置后这里会展示推荐码与赠算力引导。
          </Notice>
        ) : null}
      </div>

      <div className="muted text-12" style={{ marginTop: 12, display: "flex", gap: 4, alignItems: "center" }}>
        <LinkOutlined aria-hidden />
        绑定即代表同意由本站代为调用 AIPDD 上游接口；本系统不托管上游账号密码，也不涉币。
      </div>
    </Panel>
  );
}
