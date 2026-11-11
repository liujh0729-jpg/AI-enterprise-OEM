"use client";

import {
  ArrowLeftOutlined,
  LockOutlined,
  MailOutlined,
  MobileOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { LoginForm, ProFormText } from "@ant-design/pro-components";
import { Alert, App, Button, Form, Result } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { LanguageSwitcher } from "@/components/language-switcher";
import { PillTabs } from "@/components/ui/panel";
import { PRODUCT_NAME } from "@/lib/brand";
import { useI18n } from "@/lib/i18n/i18n";
import { useSiteBrand } from "@/lib/site-brand";
import { authApi, type AccountConfig, type CodeChannel } from "@/api/auth";
import styles from "../login/login.module.css";

type ResetValues = {
  target?: string;
  code?: string;
  password?: string;
  confirm?: string;
  tokenPassword?: string;
  tokenConfirm?: string;
};

const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
const PASSWORD_MESSAGE = "密码至少 8 位，且需同时包含字母和数字";

const FALLBACK_CONFIG: AccountConfig = {
  registerModes: ["USERNAME"],
  availability: { USERNAME: true, EMAIL: false, PHONE: false },
  loginMethods: ["PASSWORD"],
  loginAvailability: {
    PASSWORD: true,
    EMAIL_CODE: false,
    SMS_CODE: false,
    WECHAT: false,
  },
  passwordRecovery: {
    enabled: false,
    PASSWORD: true,
    EMAIL: false,
    SMS: false,
  },
  wechat: { enabled: false },
  captchaRequired: false,
};

export default function ResetPasswordPage() {
  const { message } = App.useApp();
  const brand = useSiteBrand();
  const { t } = useI18n();
  const [form] = Form.useForm<ResetValues>();
  const [config, setConfig] = useState<AccountConfig | null>(null);
  const [channel, setChannel] = useState<CodeChannel>("EMAIL");
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [tips, setTips] = useState("");
  const [done, setDone] = useState(false);

  /** 邮件一次性链接：带 token 时只填新密码，不走验证码。 */
  const token = useMemo(() => {
    if (typeof window === "undefined") return "";
    return (
      new URLSearchParams(window.location.search).get("token") || ""
    ).trim();
  }, []);

  useEffect(() => {
    let alive = true;
    authApi
      .accountConfig()
      .then((value) => {
        if (!alive) return;
        setConfig(value);
        if (!value.passwordRecovery.EMAIL && value.passwordRecovery.SMS) {
          setChannel("SMS");
        }
      })
      .catch(() => {
        if (alive) setConfig(FALLBACK_CONFIG);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  const channels = useMemo(() => {
    const source = config ?? FALLBACK_CONFIG;
    return (["EMAIL", "SMS"] as CodeChannel[]).filter(
      (item) => source.passwordRecovery[item],
    );
  }, [config]);

  const emailChannel = channel === "EMAIL";
  const targetLabel = emailChannel ? t("邮箱") : t("手机号");

  const sendCode = useCallback(async () => {
    if (sending || busy) return;
    let target: string;
    try {
      const values = await form.validateFields(["target"]);
      target = String(values.target || "").trim();
    } catch {
      return;
    }
    setSending(true);
    setTips("");
    try {
      await authApi.forgotPassword(channel, target);
      message.success(t("验证码已发送"));
      setCountdown(60);
    } catch (error) {
      setTips(
        error instanceof Error ? error.message : t("网络异常，请稍后再试"),
      );
    } finally {
      setSending(false);
    }
  }, [busy, channel, form, message, sending, t]);

  const submit = async (values: ResetValues) => {
    setBusy(true);
    setTips("");
    try {
      if (token) {
        await authApi.resetPasswordByToken(
          token,
          String(values.tokenPassword || ""),
        );
      } else {
        await authApi.resetPassword({
          channel,
          target: String(values.target || ""),
          code: String(values.code || ""),
          password: String(values.password || ""),
        });
      }
      setDone(true);
    } catch (error) {
      setTips(
        error instanceof Error ? error.message : t("网络异常，请稍后再试"),
      );
    } finally {
      setBusy(false);
    }
  };

  const disabledByPolicy =
    !token &&
    !!config &&
    (!config.passwordRecovery.enabled ||
      !config.passwordRecovery.PASSWORD ||
      channels.length === 0);

  return (
    <div className={styles.page}>
      <div style={{ position: "absolute", top: 16, right: 16, zIndex: 2 }}>
        <LanguageSwitcher />
      </div>
      <main className={styles.main}>
        <section className={styles.authSection} aria-label={t("找回密码")}>
          <LoginForm<ResetValues>
            form={form}
            logo={
              <BrandLogo
                size={48}
                className={styles.logo}
                priority
                src={brand.siteLogo || undefined}
              />
            }
            title={
              <h1 className={styles.title}>{brand.siteName || PRODUCT_NAME}</h1>
            }
            subTitle={t("重置登录密码")}
            contentStyle={{ width: "100%", maxWidth: 368 }}
            onFinish={submit}
            disabled={busy}
            validateTrigger="onBlur"
            submitter={
              done || disabledByPolicy
                ? false
                : {
                    searchConfig: { submitText: t("重置密码") },
                    submitButtonProps: {
                      loading: busy,
                      className: styles.submit,
                    },
                  }
            }
            message={
              tips ? (
                <Alert
                  className={styles.alert}
                  title={tips}
                  type="error"
                  showIcon
                  closable
                  onClose={() => setTips("")}
                />
              ) : undefined
            }
          >
            {done ? (
              <Result
                status="success"
                title={t("密码已重置")}
                subTitle={t("请使用新密码重新登录")}
                extra={
                  <Button type="primary" href="/login">
                    {t("去登录")}
                  </Button>
                }
              />
            ) : disabledByPolicy ? (
              <>
                <Alert
                  className={styles.alert}
                  type="warning"
                  showIcon
                  title={t("密码找回未开启")}
                  description={t(
                    "请联系管理员开启「常规登录」与邮箱/手机验证码登录，并配置对应通道。",
                  )}
                />
                <Button block href="/login" icon={<ArrowLeftOutlined />}>
                  {t("返回登录")}
                </Button>
              </>
            ) : token ? (
              <>
                <Alert
                  className={styles.alert}
                  type="info"
                  showIcon
                  title={t("请设置新密码，链接 30 分钟内有效且只能使用一次。")}
                />
                <ProFormText.Password
                  name="tokenPassword"
                  fieldProps={{
                    size: "large",
                    prefix: <LockOutlined />,
                    autoComplete: "new-password",
                    "aria-label": t("新密码"),
                  }}
                  placeholder={t("新密码（至少 8 位，含字母和数字）")}
                  rules={[
                    {
                      required: true,
                      pattern: PASSWORD_PATTERN,
                      message: t(PASSWORD_MESSAGE),
                    },
                  ]}
                />
                <ProFormText.Password
                  name="tokenConfirm"
                  dependencies={["tokenPassword"]}
                  fieldProps={{
                    size: "large",
                    prefix: <LockOutlined />,
                    autoComplete: "new-password",
                    "aria-label": t("确认新密码"),
                  }}
                  placeholder={t("确认新密码")}
                  rules={[
                    { required: true, message: t("请再次输入新密码") },
                    ({ getFieldValue }) => ({
                      validator(_, value) {
                        return !value ||
                          getFieldValue("tokenPassword") === value
                          ? Promise.resolve()
                          : Promise.reject(
                              new Error(t("两次输入的密码不一致")),
                            );
                      },
                    }),
                  ]}
                />
                <Button
                  type="link"
                  block
                  href="/login"
                  icon={<ArrowLeftOutlined />}
                >
                  {t("返回登录")}
                </Button>
              </>
            ) : (
              <>
                {channels.length > 1 ? (
                  <PillTabs
                    size="small"
                    variant="soft"
                    style={{ marginBottom: 20 }}
                    items={channels.map((item) => ({
                      key: item,
                      label:
                        item === "EMAIL" ? t("邮箱验证码") : t("手机验证码"),
                    }))}
                    value={channel}
                    onChange={(value) => {
                      setChannel(value as CodeChannel);
                      setTips("");
                    }}
                  />
                ) : null}
                {channels.length === 0 ? (
                  <Alert
                    className={styles.alert}
                    type="warning"
                    showIcon
                    title={t("管理员未开启可用的找回通道，请联系管理员。")}
                  />
                ) : null}
                <ProFormText
                  name="target"
                  fieldProps={{
                    size: "large",
                    prefix: emailChannel ? (
                      <MailOutlined />
                    ) : (
                      <MobileOutlined />
                    ),
                    autoComplete: emailChannel ? "email" : "tel",
                    inputMode: emailChannel ? "email" : "tel",
                    "aria-label": targetLabel,
                  }}
                  placeholder={
                    emailChannel
                      ? t("注册时使用的邮箱")
                      : t("注册时使用的手机号")
                  }
                  rules={[
                    {
                      required: true,
                      whitespace: true,
                      message: t("请输入账号"),
                    },
                    ...(emailChannel
                      ? [
                          {
                            type: "email" as const,
                            transform: (value: string) => value?.trim(),
                            message: t("请输入有效的邮箱地址"),
                          },
                        ]
                      : [
                          {
                            pattern: /^1[3-9]\d{9}$/,
                            message: t("请输入有效的手机号"),
                          },
                        ]),
                  ]}
                />
                <div className={styles.codeRow}>
                  <ProFormText
                    name="code"
                    fieldProps={{
                      size: "large",
                      prefix: <SafetyCertificateOutlined />,
                      autoComplete: "one-time-code",
                      "aria-label": t("验证码"),
                    }}
                    placeholder={t("验证码")}
                    rules={[
                      {
                        required: true,
                        whitespace: true,
                        message: t("请输入验证码"),
                      },
                    ]}
                  />
                  <Button
                    size="large"
                    loading={sending}
                    disabled={busy || countdown > 0 || channels.length === 0}
                    onClick={() => void sendCode()}
                  >
                    {countdown > 0
                      ? `${countdown}s${t("后重发")}`
                      : t("获取验证码")}
                  </Button>
                </div>
                <ProFormText.Password
                  name="password"
                  fieldProps={{
                    size: "large",
                    prefix: <LockOutlined />,
                    autoComplete: "new-password",
                    "aria-label": t("新密码"),
                  }}
                  placeholder={t("新密码（至少 8 位，含字母和数字）")}
                  rules={[
                    {
                      required: true,
                      pattern: PASSWORD_PATTERN,
                      message: t(PASSWORD_MESSAGE),
                    },
                  ]}
                />
                <ProFormText.Password
                  name="confirm"
                  dependencies={["password"]}
                  fieldProps={{
                    size: "large",
                    prefix: <LockOutlined />,
                    autoComplete: "new-password",
                    "aria-label": t("确认新密码"),
                  }}
                  placeholder={t("确认新密码")}
                  rules={[
                    { required: true, message: t("请再次输入新密码") },
                    ({ getFieldValue }) => ({
                      validator(_, value) {
                        return !value || getFieldValue("password") === value
                          ? Promise.resolve()
                          : Promise.reject(
                              new Error(t("两次输入的密码不一致")),
                            );
                      },
                    }),
                  ]}
                />
                <Button
                  type="link"
                  block
                  href="/login"
                  icon={<ArrowLeftOutlined />}
                >
                  {t("返回登录")}
                </Button>
              </>
            )}
          </LoginForm>
        </section>
      </main>
    </div>
  );
}
