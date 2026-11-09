"use client";

import { useEffect } from "react";
import {
  App,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Radio,
  Tag,
} from "antd";
import { Notice, Panel } from "@/components/ui/panel";
import {
  accountSettingsApi,
  type AccountSettingsDraft,
  type LoginMethod,
  type RegisterMode,
} from "@/api/account-settings";
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
    !!data?.availability.EMAIL ||
    !!(smtp?.host && smtp?.user && smtp?.from);
  const phoneReady =
    !!data?.availability.PHONE ||
    !!(sms?.accessKeyId && sms?.signName && sms?.templateCode);
  const wechatReady =
    !!data?.loginAvailability.WECHAT ||
    !!(wechat?.appId && (wechat?.appSecret || data?.wechat.configured));

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
          这里控制登录页与注册页展示哪些入口。邮箱通道未配置时，邮箱注册 / 邮箱验证码登录不可用；
          手机通道未配置时，手机号注册 / 手机验证码登录不可用；微信参数未配置时，微信扫码不可用。
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
              rules={[{ type: "array", min: 1, message: "至少保留一种登录方式" }]}
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
              extra={data?.smtp.configured ? "留空表示不修改已保存的密码" : undefined}
            >
              <Input.Password
                autoComplete="new-password"
                maxLength={200}
                placeholder={data?.smtp.configured ? "输入新密码" : "邮箱授权码 / 密码"}
              />
            </Form.Item>
            <Form.Item name={["smtp", "from"]} label="发件人">
              <Input placeholder="企业服务台 <no-reply@example.com>" maxLength={200} />
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
            <Form.Item name={["sms", "accessKeyId"]} label="AccessKeyId" style={{ marginTop: 10 }}>
              <Input placeholder="LTAI..." maxLength={128} autoComplete="off" />
            </Form.Item>
            <Form.Item
              name={["sms", "accessKeySecret"]}
              label="AccessKeySecret"
              extra={data?.sms.configured ? "留空表示不修改已保存的 Secret" : undefined}
            >
              <Input.Password
                autoComplete="new-password"
                maxLength={200}
                placeholder={data?.sms.configured ? "输入新的 Secret" : "阿里云 AccessKeySecret"}
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
              <Tag>{data?.wechat.provider === "WECHAT_OPEN" ? "微信开放平台网站应用" : data?.wechat.provider || "微信开放平台网站应用"}</Tag>
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
            <Form.Item name={["wechat", "appId"]} label="AppID" style={{ marginTop: 10 }}>
              <Input placeholder="wx..." maxLength={64} autoComplete="off" />
            </Form.Item>
            <Form.Item
              name={["wechat", "appSecret"]}
              label="AppSecret"
              extra={data?.wechat.configured ? "留空表示不修改已保存的 Secret" : undefined}
            >
              <Input.Password
                autoComplete="new-password"
                maxLength={200}
                placeholder={data?.wechat.configured ? "输入新的 AppSecret" : "微信开放平台 AppSecret"}
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
            <Form.Item name={["wechat", "autoRegister"]} label="扫码后未绑定账号">
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
    </>
  );
}
