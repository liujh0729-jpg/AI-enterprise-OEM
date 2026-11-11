"use client";

import { useCallback, useEffect, useState } from "react";
import {
  App,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Radio,
  Space,
  Tag,
} from "antd";
import { Notice, Panel } from "@/components/ui/panel";
import {
  accountSettingsApi,
  type AccountSettingsDraft,
  type LoginMethod,
  type RegisterMode,
} from "@/api/account-settings";
import { gapsApi, gapsPublicApi, type TermsDocument } from "@/api/gaps";
import { useOperationMutation } from "@/query/business";
import { presentMutationError } from "@/query/errors";
import { PermissionNotice, useAdminData } from "./common";

const REGISTER_OPTIONS: { label: string; value: RegisterMode }[] = [
  { label: "用户名", value: "USERNAME" },
  { label: "邮箱", value: "EMAIL" },
  { label: "手机号", value: "PHONE" },
];

const LOGIN_OPTIONS: { label: string; value: LoginMethod }[] = [
  { label: "常规登录（账号 + 密码）", value: "PASSWORD" },
  { label: "邮箱验证码", value: "EMAIL_CODE" },
  { label: "手机验证码", value: "SMS_CODE" },
  { label: "微信扫码", value: "WECHAT" },
];

type FormValues = {
  registerModes: RegisterMode[];
  loginMethods: LoginMethod[];
  smtp: {
    host?: string;
    port?: number;
    secure?: boolean;
    user?: string;
    from?: string;
    password?: string;
  };
  sms: {
    accessKeyId?: string;
    accessKeySecret?: string;
    signName?: string;
    templateCode?: string;
    dailyLimit?: number;
  };
  wechat: {
    appId?: string;
    appSecret?: string;
    enabled?: boolean;
    autoRegister?: boolean;
  };
};

/**
 * 账号与登录：注册方式 / 登录方式 / SMTP / 阿里云短信 / 微信扫码。
 * 保存即生效——登录页与注册页会按这里的开关动态渲染入口。
 * 依赖未满足的选项自动禁用（邮箱验证码需先配 SMTP，手机验证码需先配短信，微信需先配 AppID/Secret）。
 */
export function AccountLoginPanel() {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const { data, denied, loading, reload } = useAdminData(
    "account-settings",
    (signal) => accountSettingsApi.view({ signal }),
  );
  const save = useOperationMutation(
    (body: AccountSettingsDraft) => accountSettingsApi.save(body),
    ["admin", "account-settings", "*"],
  );

  const smtp = Form.useWatch("smtp", form);
  const sms = Form.useWatch("sms", form);
  const wechat = Form.useWatch("wechat", form);
  // 正在编辑的凭据也算「已具备」：允许一次保存里同时配通道并开启对应登录方式
  const emailReady =
    !!data?.availability.EMAIL || !!(smtp?.host && smtp?.user && smtp?.from);
  const phoneReady =
    !!data?.availability.PHONE ||
    !!(sms?.accessKeyId && sms?.signName && sms?.templateCode);
  const wechatReady =
    !!data?.loginAvailability.WECHAT ||
    !!(wechat?.appId && (wechat?.appSecret || data?.wechat.configured));
  const loginMethods =
    Form.useWatch("loginMethods", form) ?? data?.loginMethods ?? [];
  const passwordLogin = loginMethods.includes("PASSWORD");
  const emailRecovery =
    passwordLogin && loginMethods.includes("EMAIL_CODE") && emailReady;
  const smsRecovery =
    passwordLogin && loginMethods.includes("SMS_CODE") && phoneReady;

  useEffect(() => {
    if (!data) return;
    form.setFieldsValue({
      registerModes: data.registerModes,
      loginMethods: data.loginMethods,
      smtp: {
        host: data.smtp.host,
        port: data.smtp.port ?? 465,
        secure: data.smtp.secure ?? true,
        user: data.smtp.user,
        from: data.smtp.from,
        password: "",
      },
      sms: {
        accessKeyId: data.sms.accessKeyId,
        accessKeySecret: "",
        signName: data.sms.signName,
        templateCode: data.sms.templateCode,
        dailyLimit: data.sms.dailyLimit ?? 10,
      },
      wechat: {
        appId: data.wechat.appId,
        appSecret: "",
        enabled: data.wechat.enabled,
        autoRegister: data.wechat.autoRegister,
      },
    });
  }, [data, form]);

  const onSubmit = async (values: FormValues) => {
    const draft: AccountSettingsDraft = {
      registerModes: values.registerModes,
      loginMethods: values.loginMethods,
    };
    const s = values.smtp;
    if (s?.host && s?.user && s?.from) {
      draft.smtp = {
        host: s.host.trim(),
        port: Number(s.port) || 465,
        secure: s.secure !== false,
        user: s.user.trim(),
        from: s.from.trim(),
        password: s.password || undefined,
      };
    }
    const m = values.sms;
    if (m?.accessKeyId && m?.signName && m?.templateCode) {
      draft.sms = {
        accessKeyId: m.accessKeyId.trim(),
        accessKeySecret: m.accessKeySecret || undefined,
        signName: m.signName.trim(),
        templateCode: m.templateCode.trim(),
        dailyLimit: Number(m.dailyLimit) > 0 ? Number(m.dailyLimit) : 10,
      };
    }
    const w = values.wechat;
    if (w?.appId) {
      draft.wechat = {
        provider: "WECHAT_OPEN",
        appId: w.appId.trim(),
        appSecret: w.appSecret || undefined,
        enabled: w.enabled === true,
        scopes: "snsapi_login",
        autoRegister: w.autoRegister !== false,
      };
    }
    try {
      await save.mutateAsync(draft);
      message.success("账号与登录设置已保存，登录/注册页即时生效");
      await reload();
    } catch (error) {
      if (error instanceof Error)
        presentMutationError(error, (text) => message.error(text));
    }
  };

  return (
    <>
      <PermissionNotice denied={denied} />
      <Panel
        title="账号与登录"
        titleBadge={<span className="text-12 muted">保存即生效</span>}
      >
        <Notice variant="info">
          这里控制登录页与注册页展示哪些入口。邮箱通道未配置时，邮箱注册 /
          邮箱验证码登录不可用； 手机通道未配置时，手机号注册 /
          手机验证码登录不可用；微信参数未配置时，微信扫码不可用。
          敏感项加密保存，留空表示保留原值，只回显「已配置」。
        </Notice>
        <Form<FormValues>
          form={form}
          layout="vertical"
          disabled={loading}
          onFinish={onSubmit}
          style={{ marginTop: 16, maxWidth: 720 }}
        >
          <section style={{ marginBottom: 20 }}>
            <strong style={{ fontSize: 13 }}>注册方式</strong>
            <div className="text-12 muted" style={{ margin: "4px 0 8px" }}>
              注册页按勾选顺序展示可选方式；未配置通道的方式自动禁用。
            </div>
            <Form.Item
              name="registerModes"
              rules={[
                { type: "array", min: 1, message: "至少保留一种注册方式" },
              ]}
              style={{ marginBottom: 0 }}
            >
              <Checkbox.Group
                options={REGISTER_OPTIONS.map((option) => ({
                  ...option,
                  disabled:
                    (option.value === "EMAIL" && !emailReady) ||
                    (option.value === "PHONE" && !phoneReady),
                }))}
              />
            </Form.Item>
          </section>

          <section style={{ marginBottom: 20 }}>
            <strong style={{ fontSize: 13 }}>登录方式</strong>
            <div className="text-12 muted" style={{ margin: "4px 0 8px" }}>
              登录页只渲染勾选的方式；依赖未满足的方式自动禁用。
            </div>
            <Form.Item
              name="loginMethods"
              rules={[
                { type: "array", min: 1, message: "至少保留一种登录方式" },
              ]}
              style={{ marginBottom: 0 }}
            >
              <Checkbox.Group
                options={LOGIN_OPTIONS.map((option) => ({
                  ...option,
                  disabled:
                    (option.value === "EMAIL_CODE" && !emailReady) ||
                    (option.value === "SMS_CODE" && !phoneReady) ||
                    (option.value === "WECHAT" && !wechatReady),
                }))}
              />
            </Form.Item>
          </section>

          <section style={{ marginBottom: 20 }}>
            <strong style={{ fontSize: 13 }}>找回密码 / 验证码设密</strong>
            <div className="text-12 muted" style={{ margin: "4px 0 8px" }}>
              与登录方式同源：未勾选「常规登录」时整体关闭；关闭邮箱 /
              手机验证码会同步关闭对应找回入口。
            </div>
            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                marginBottom: 8,
              }}
            >
              <Tag color={passwordLogin ? "green" : "default"}>
                {passwordLogin ? "常规登录已开启" : "常规登录未开启"}
              </Tag>
              <Tag color={emailRecovery ? "green" : "default"}>
                邮箱找回：{emailRecovery ? "可用" : "不可用"}
              </Tag>
              <Tag color={smsRecovery ? "green" : "default"}>
                手机找回：{smsRecovery ? "可用" : "不可用"}
              </Tag>
            </div>
            {!passwordLogin ? (
              <Notice variant="warn">
                未勾选「常规登录（账号 +
                密码）」：登录页不显示「忘记密码」，账号安全页也不能用验证码设置密码。
              </Notice>
            ) : !emailRecovery && !smsRecovery ? (
              <Notice variant="warn">
                当前没有可用的找回通道：登录页不显示「忘记密码」。请勾选邮箱 /
                手机验证码登录并配好对应通道。
              </Notice>
            ) : null}
          </section>

          <section style={{ marginBottom: 20 }}>
            <strong style={{ fontSize: 13 }}>邮箱（SMTP）</strong>
            <div style={{ margin: "6px 0 10px" }}>
              <Tag color={data?.smtp.configured ? "green" : "default"}>
                {data?.smtp.configured ? "已配置" : "未配置"}
              </Tag>
            </div>
            {!data?.smtp.configured ? (
              <Notice variant="warn">
                尚未配置 SMTP：邮箱注册、邮箱验证码登录、邮箱找回密码均不可用。
              </Notice>
            ) : null}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 120px",
                gap: 12,
                marginTop: 10,
              }}
            >
              <Form.Item name={["smtp", "host"]} label="SMTP 服务器">
                <Input placeholder="smtp.example.com" maxLength={128} />
              </Form.Item>
              <Form.Item name={["smtp", "port"]} label="端口">
                <InputNumber min={1} max={65535} style={{ width: "100%" }} />
              </Form.Item>
            </div>
            <Form.Item name={["smtp", "secure"]} label="连接方式">
              <Radio.Group
                options={[
                  { label: "SSL（常用 465）", value: true },
                  { label: "普通 / STARTTLS（常用 587）", value: false },
                ]}
              />
            </Form.Item>
            <Form.Item name={["smtp", "user"]} label="账号">
              <Input placeholder="no-reply@example.com" maxLength={160} />
            </Form.Item>
            <Form.Item
              name={["smtp", "password"]}
              label="密码"
              extra={
                data?.smtp.configured ? "留空表示不修改已保存的密码" : undefined
              }
            >
              <Input.Password
                autoComplete="new-password"
                maxLength={200}
                placeholder={
                  data?.smtp.configured ? "输入新密码" : "邮箱授权码 / 密码"
                }
              />
            </Form.Item>
            <Form.Item name={["smtp", "from"]} label="发件人">
              <Input
                placeholder="企业服务台 <no-reply@example.com>"
                maxLength={200}
              />
            </Form.Item>
          </section>

          <section style={{ marginBottom: 20 }}>
            <strong style={{ fontSize: 13 }}>阿里云短信</strong>
            <div style={{ margin: "6px 0 10px" }}>
              <Tag color={data?.sms.configured ? "green" : "default"}>
                {data?.sms.configured ? "已配置" : "未配置"}
              </Tag>
            </div>
            {!data?.sms.configured ? (
              <Notice variant="warn">
                尚未配置短信：手机号注册、手机验证码登录、短信找回密码均不可用。
              </Notice>
            ) : null}
            <Form.Item
              name={["sms", "accessKeyId"]}
              label="AccessKeyId"
              style={{ marginTop: 10 }}
            >
              <Input placeholder="LTAI..." maxLength={128} autoComplete="off" />
            </Form.Item>
            <Form.Item
              name={["sms", "accessKeySecret"]}
              label="AccessKeySecret"
              extra={
                data?.sms.configured
                  ? "留空表示不修改已保存的 Secret"
                  : undefined
              }
            >
              <Input.Password
                autoComplete="new-password"
                maxLength={200}
                placeholder={
                  data?.sms.configured
                    ? "输入新的 Secret"
                    : "阿里云 AccessKeySecret"
                }
              />
            </Form.Item>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <Form.Item name={["sms", "signName"]} label="短信签名">
                <Input placeholder="已审核通过的签名" maxLength={64} />
              </Form.Item>
              <Form.Item name={["sms", "templateCode"]} label="模板 Code">
                <Input placeholder="SMS_000000000" maxLength={64} />
              </Form.Item>
            </div>
            <Form.Item
              name={["sms", "dailyLimit"]}
              label="单目标日上限"
              extra="同一手机号每天最多接收的验证码条数。"
            >
              <InputNumber min={1} max={100} style={{ width: 160 }} />
            </Form.Item>
          </section>

          <section style={{ marginBottom: 20 }}>
            <strong style={{ fontSize: 13 }}>微信扫码</strong>
            <div style={{ margin: "6px 0 10px" }}>
              <Tag>
                {data?.wechat.provider === "WECHAT_OPEN"
                  ? "微信开放平台网站应用"
                  : data?.wechat.provider || "微信开放平台网站应用"}
              </Tag>
              <Tag color={data?.wechat.configured ? "green" : "default"}>
                {data?.wechat.configured ? "已配置" : "未配置"}
              </Tag>
            </div>
            {!data?.wechat.configured ? (
              <Notice variant="warn">
                尚未配置微信：需在微信开放平台（open.weixin.qq.com）创建「网站应用」并通过审核，
                把授权回调域设为本站域名，再把 AppID / AppSecret 填到这里。
              </Notice>
            ) : null}
            <Form.Item
              name={["wechat", "appId"]}
              label="AppID"
              style={{ marginTop: 10 }}
            >
              <Input placeholder="wx..." maxLength={64} autoComplete="off" />
            </Form.Item>
            <Form.Item
              name={["wechat", "appSecret"]}
              label="AppSecret"
              extra={
                data?.wechat.configured
                  ? "留空表示不修改已保存的 Secret"
                  : undefined
              }
            >
              <Input.Password
                autoComplete="new-password"
                maxLength={200}
                placeholder={
                  data?.wechat.configured
                    ? "输入新的 AppSecret"
                    : "微信开放平台 AppSecret"
                }
              />
            </Form.Item>
            <Form.Item name={["wechat", "enabled"]} label="启用微信扫码登录">
              <Radio.Group
                options={[
                  { label: "启用（登录页出现「微信扫码」入口）", value: true },
                  { label: "不启用（不展示该入口）", value: false },
                ]}
              />
            </Form.Item>
            <Form.Item
              name={["wechat", "autoRegister"]}
              label="扫码后未绑定账号"
            >
              <Radio.Group
                options={[
                  { label: "自动注册新账号（一键即用）", value: true },
                  { label: "引导绑定已有账号（更稳妥）", value: false },
                ]}
              />
            </Form.Item>
          </section>

          <Button type="primary" htmlType="submit" loading={save.isPending}>
            保存账号与登录设置
          </Button>
        </Form>
      </Panel>
      <RegisterAgreementEditor />
    </>
  );
}

/* ------------------------------------------------- 注册协议与隐私政策 */

/** 注册前必读的两份协议：编码与登录页勾选、注册接口强校验一一对应。 */
const CONSENT_DOCS = [
  {
    code: "USER_REGISTRATION",
    label: "用户注册协议",
    category: "REGISTRATION" as const,
    path: "/agreement/register",
  },
  {
    code: "USER_PRIVACY",
    label: "隐私政策",
    category: "PRIVACY" as const,
    path: "/agreement/privacy",
  },
];

/** 下一版本号：v1.0 → v1.1；非 vX.Y 形态则追加 .1，便于版本历史在留痕里可读。 */
const nextVersion = (current: string) => {
  const match = /^v(\d+)\.(\d+)$/.exec(current.trim());
  return match ? `v${match[1]}.${Number(match[2]) + 1}` : `${current.trim()}.1`;
};

type AgreementFormValues = {
  version: string;
  title: string;
  content: string;
};

/**
 * 注册协议与隐私政策：平台管理员在这里维护正文，保存即生成新的生效版本，
 * 旧版本自动归档；新注册用户按最新版本留痕，勾选认可后才能注册。
 */
function RegisterAgreementEditor() {
  const { message } = App.useApp();
  const [rows, setRows] = useState<TermsDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<{
    code: string;
    fallbackTitle: string;
    category: "REGISTRATION" | "PRIVACY";
    path: string;
    doc: TermsDocument | null;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<AgreementFormValues>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await gapsApi.termsDocuments({ query: {} });
      setRows(
        (list ?? []).filter((row) =>
          CONSENT_DOCS.some((doc) => doc.code === row.code),
        ),
      );
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : "协议加载失败，请稍后重试",
      );
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeOf = (code: string) =>
    rows.find((row) => row.code === code && row.status === "ACTIVE") ?? null;

  const openEditor = async (
    doc: (typeof CONSENT_DOCS)[number],
  ) => {
    const current = activeOf(doc.code);
    // 后台还没发布过时，先把平台默认文本拉出来作为草稿正文
    let content = current?.content ?? "";
    if (!current) {
      try {
        content = (await gapsPublicApi.terms(doc.code)).content;
      } catch {
        content = "";
      }
    }
    setEditing({
      code: doc.code,
      fallbackTitle: doc.label,
      category: doc.category,
      path: doc.path,
      doc: current,
    });
    form.setFieldsValue({
      version: current ? nextVersion(current.version) : "v1.0",
      title: current?.title || doc.label,
      content,
    });
  };

  const submit = async () => {
    if (!editing) return;
    const values = await form.validateFields();
    setSaving(true);
    try {
      await gapsApi.saveTermsDocument({
        body: {
          id: 0,
          code: editing.code,
          version: values.version.trim(),
          title: values.title.trim(),
          category: editing.category,
          content: values.content,
          requireReaccept: true,
          effectiveAt: new Date().toISOString(),
          status: "ACTIVE",
        },
      });
      message.success("协议已发布为新版本，登录页勾选项即时生效");
      setEditing(null);
      await load();
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : "协议保存失败，请稍后重试",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Panel
        title="注册协议与隐私政策"
        titleBadge={
          <span className="text-12 muted">
            注册前必读，保存即发布新版本
          </span>
        }
      >
        <Notice variant="info">
          未单独发布时，注册页与协议页展示平台内置的标准文本；
          在这里保存后即以本站正文为准，旧版本自动归档，已接受旧版本的用户记录保留。
        </Notice>
        <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
          {CONSENT_DOCS.map((doc) => {
            const active = activeOf(doc.code);
            return (
              <div
                key={doc.code}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                  padding: "12px 14px",
                  border: "1px solid rgba(5, 5, 5, 0.06)",
                  borderRadius: 8,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>
                    {active?.title || doc.label}
                    <Tag
                      color={active ? "green" : "default"}
                      style={{ marginInlineStart: 8 }}
                    >
                      {active ? `已发布 ${active.version}` : "平台默认文本"}
                    </Tag>
                  </div>
                  <div className="text-12 muted" style={{ marginTop: 4 }}>
                    编码 {doc.code} · 注册页勾选链接{" "}
                    <a href={doc.path} target="_blank" rel="noreferrer">
                      {doc.path}
                    </a>
                  </div>
                </div>
                <Space>
                  <Button
                    onClick={() => window.open(doc.path, "_blank")}
                  >
                    查看全文
                  </Button>
                  <Button
                    type="primary"
                    ghost
                    loading={loading}
                    onClick={() => void openEditor(doc)}
                  >
                    {active ? "编辑并发布新版本" : "编辑并发布"}
                  </Button>
                </Space>
              </div>
            );
          })}
        </div>
      </Panel>
      {editing ? (
        <Panel
          title={`${editing.fallbackTitle} · ${
            editing.doc ? "发布新版本" : "首次发布"
          }`}
          extra={
            <Space>
              <Button onClick={() => setEditing(null)}>取消</Button>
              <Button type="primary" loading={saving} onClick={() => void submit()}>
                发布
              </Button>
            </Space>
          }
        >
          <Form<AgreementFormValues> form={form} layout="vertical">
            <div
              style={{ display: "grid", gridTemplateColumns: "1fr 200px", gap: 12 }}
            >
              <Form.Item
                name="title"
                label="标题"
                rules={[{ required: true, message: "请填写标题" }]}
              >
                <Input maxLength={160} />
              </Form.Item>
              <Form.Item
                name="version"
                label="版本号"
                rules={[{ required: true, message: "请填写版本号" }]}
                extra="注册留痕按版本记录，发布后不可复用同一版本号"
              >
                <Input maxLength={24} />
              </Form.Item>
            </div>
            <Form.Item
              name="content"
              label="协议全文"
              rules={[{ required: true, message: "请填写协议正文" }]}
              extra="支持多段文本：以「一、二、三」等序号开头的行会作为小标题展示"
            >
              <Input.TextArea rows={18} maxLength={200000} />
            </Form.Item>
          </Form>
        </Panel>
      ) : null}
    </>
  );
}
