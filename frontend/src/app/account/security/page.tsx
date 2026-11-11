"use client";

import { LockOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { App, Button, Descriptions, Form, Input, Tag } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  accountSecurityApi,
  type AccountSecurityView,
} from "@/api/account-security";
import { Notice, PageHero, Panel, PillTabs } from "@/components/ui/panel";

type PasswordForm = {
  oldPassword?: string;
  newPassword?: string;
  confirm?: string;
};

type CodeForm = {
  code?: string;
  newPassword?: string;
  confirm?: string;
};

const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
const PASSWORD_MESSAGE = "密码至少 8 位，且需同时包含字母和数字";

function confirmRule(field: string) {
  return ({ getFieldValue }: { getFieldValue: (name: string) => unknown }) => ({
    validator(_: unknown, value: string) {
      return !value || getFieldValue(field) === value
        ? Promise.resolve()
        : Promise.reject(new Error("两次输入的密码不一致"));
    },
  });
}

/** 账号安全（/account/security）：改密与验证码设密，可用通道由后台登录策略决定。 */
export default function AccountSecurityPage() {
  const { message } = App.useApp();
  const [view, setView] = useState<AccountSecurityView | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pwdForm] = Form.useForm<PasswordForm>();
  const [codeForm] = Form.useForm<CodeForm>();
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [channel, setChannel] = useState<"EMAIL" | "SMS">("EMAIL");
  const [codeTarget, setCodeTarget] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const value = await accountSecurityApi.view();
      setView(value);
      if (!value.codeChannels.EMAIL && value.codeChannels.SMS)
        setChannel("SMS");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  const channels = useMemo(
    () =>
      (["EMAIL", "SMS"] as const).filter(
        (item) => view?.codeChannels[item] === true,
      ),
    [view],
  );

  const submitPassword = async (values: PasswordForm) => {
    setSaving(true);
    try {
      await accountSecurityApi.changePassword(
        String(values.oldPassword || ""),
        String(values.newPassword || ""),
      );
      message.success("密码已修改，其他设备需重新登录");
      pwdForm.resetFields();
      await reload();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "修改失败");
    } finally {
      setSaving(false);
    }
  };

  const sendCode = async () => {
    if (sending || countdown > 0) return;
    setSending(true);
    try {
      const result = await accountSecurityApi.sendCode(channel);
      setCodeTarget(result.target);
      message.success(`验证码已发送至 ${result.target}`);
      setCountdown(60);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "发送失败");
    } finally {
      setSending(false);
    }
  };

  const submitCode = async (values: CodeForm) => {
    setSaving(true);
    try {
      await accountSecurityApi.setByCode(
        channel,
        String(values.code || ""),
        String(values.newPassword || ""),
      );
      message.success("密码已设置，其他设备需重新登录");
      codeForm.resetFields();
      await reload();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "设置失败");
    } finally {
      setSaving(false);
    }
  };

  const currentTarget =
    channel === "EMAIL" ? view?.email || "" : view?.phone || "";

  return (
    <>
      <PageHero
        title="账号安全"
        desc="修改登录密码，或在忘记旧密码时通过已绑定的邮箱/手机验证码设置新密码。可用方式与平台管理员配置的登录策略一致。"
      />

      <Panel title="账号信息">
        {loadError ? (
          <Notice variant="error">
            {loadError}{" "}
            <Button size="small" onClick={() => void reload()}>
              重试
            </Button>
          </Notice>
        ) : loading ? (
          <span className="muted text-12">加载中…</span>
        ) : view ? (
          <Descriptions
            column={{ xs: 1, sm: 2 }}
            items={[
              { key: "username", label: "登录账号", children: view.username },
              {
                key: "email",
                label: "绑定邮箱",
                children: view.email ? (
                  <span>
                    {view.email}{" "}
                    <Tag color={view.emailVerified ? "green" : "default"}>
                      {view.emailVerified ? "已验证" : "未验证"}
                    </Tag>
                  </span>
                ) : (
                  "未绑定"
                ),
              },
              {
                key: "phone",
                label: "绑定手机",
                children: view.phone ? (
                  <span>
                    {view.phone}{" "}
                    <Tag color={view.phoneVerified ? "green" : "default"}>
                      {view.phoneVerified ? "已验证" : "未验证"}
                    </Tag>
                  </span>
                ) : (
                  "未绑定"
                ),
              },
              {
                key: "password",
                label: "登录密码",
                children: view.hasPassword ? "已设置" : "未设置",
              },
            ]}
          />
        ) : null}
      </Panel>

      {view?.hasPassword ? (
        <Panel title="修改密码">
          <Form<PasswordForm>
            form={pwdForm}
            layout="vertical"
            style={{ maxWidth: 420 }}
            onFinish={submitPassword}
          >
            <Form.Item
              name="oldPassword"
              label="原密码"
              rules={[{ required: true, message: "请输入原密码" }]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                autoComplete="current-password"
                placeholder="当前登录密码"
              />
            </Form.Item>
            <Form.Item
              name="newPassword"
              label="新密码"
              rules={[
                {
                  required: true,
                  pattern: PASSWORD_PATTERN,
                  message: PASSWORD_MESSAGE,
                },
              ]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                autoComplete="new-password"
                placeholder="至少 8 位，含字母和数字"
              />
            </Form.Item>
            <Form.Item
              name="confirm"
              label="确认新密码"
              dependencies={["newPassword"]}
              rules={[
                { required: true, message: "请再次输入新密码" },
                confirmRule("newPassword"),
              ]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                autoComplete="new-password"
              />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={saving}>
              保存新密码
            </Button>
          </Form>
        </Panel>
      ) : null}

      <Panel title="验证码设置密码">
        {!view?.passwordLoginEnabled ? (
          <Notice variant="warn">
            平台管理员未开启「常规登录（账号 +
            密码）」，验证码设置密码暂不可用。
          </Notice>
        ) : channels.length === 0 ? (
          <Notice variant="warn">
            当前账号未绑定可用的邮箱或手机，或管理员未开启对应验证码通道。请先完成绑定，或联系管理员处理。
          </Notice>
        ) : (
          <>
            <Notice variant="info">
              忘记旧密码时使用：验证码只会发送到当前账号已绑定的目标，设置成功后其他设备需重新登录。
            </Notice>
            {channels.length > 1 ? (
              <PillTabs
                size="small"
                variant="soft"
                style={{ margin: "12px 0" }}
                items={channels.map((item) => ({
                  key: item,
                  label: item === "EMAIL" ? "邮箱验证码" : "手机验证码",
                }))}
                value={channel}
                onChange={(value) => setChannel(value as "EMAIL" | "SMS")}
              />
            ) : null}
            <div className="text-12 muted" style={{ marginBottom: 12 }}>
              将发送至：{codeTarget || currentTarget || "未绑定"}
            </div>
            <Form<CodeForm>
              form={codeForm}
              layout="vertical"
              style={{ maxWidth: 420 }}
              onFinish={submitCode}
            >
              <Form.Item label="验证码" required>
                <div style={{ display: "flex", gap: 10 }}>
                  <Form.Item
                    name="code"
                    noStyle
                    rules={[
                      {
                        required: true,
                        whitespace: true,
                        message: "请输入验证码",
                      },
                    ]}
                  >
                    <Input
                      prefix={<SafetyCertificateOutlined />}
                      autoComplete="one-time-code"
                      placeholder="验证码"
                    />
                  </Form.Item>
                  <Button
                    loading={sending}
                    disabled={countdown > 0}
                    onClick={() => void sendCode()}
                  >
                    {countdown > 0 ? `${countdown}s 后重发` : "获取验证码"}
                  </Button>
                </div>
              </Form.Item>
              <Form.Item
                name="newPassword"
                label="新密码"
                rules={[
                  {
                    required: true,
                    pattern: PASSWORD_PATTERN,
                    message: PASSWORD_MESSAGE,
                  },
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined />}
                  autoComplete="new-password"
                  placeholder="至少 8 位，含字母和数字"
                />
              </Form.Item>
              <Form.Item
                name="confirm"
                label="确认新密码"
                dependencies={["newPassword"]}
                rules={[
                  { required: true, message: "请再次输入新密码" },
                  confirmRule("newPassword"),
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined />}
                  autoComplete="new-password"
                />
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={saving}>
                设置新密码
              </Button>
            </Form>
          </>
        )}
      </Panel>
    </>
  );
}
