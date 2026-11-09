"use client";

import {
  ArrowRightOutlined,
  CodeOutlined,
  LockOutlined,
  MailOutlined,
  MobileOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { LoginForm, ProFormText } from "@ant-design/pro-components";
import {
  Alert,
  App,
  Button,
  Checkbox,
  Drawer,
  Empty,
  Form,
  Input,
  Spin,
  Tag,
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { LanguageSwitcher } from "@/components/language-switcher";
import { PillTabs } from "@/components/ui/panel";
import { useI18n } from "@/lib/i18n/i18n";
import { PRODUCT_NAME } from "@/lib/brand";
import { useSiteBrand } from "@/lib/site-brand";
import { safeNextPath } from "@/lib/safe-next";
import styles from "./login.module.css";
import {
  authApi,
  type AccountConfig,
  type CodeChannel,
  type LoginMethod,
  type RegisterMode,
} from "@/api/auth";
import { useSession } from "@/lib/session";

type DevAccount = {
  username: string;
  userId: string;
  displayName: string;
  role: string;
};

type AuthValues = {
  /** 常规登录：用户名 / 邮箱 / 手机号。 */
  account?: string;
  password?: string;
  /** 验证码登录：接收验证码的邮箱或手机号 + 验证码。 */
  codeTarget?: string;
  loginCode?: string;
  /** 注册：按注册方式展示的账号 / 邮箱 / 手机号 + 验证码 + 密码。 */
  rUsername?: string;
  rEmail?: string;
  rPhone?: string;
  rCode?: string;
  rPassword?: string;
  /** 邀请码（选填）：填写后记录被谁邀请注册；可从 /login?invite=CODE 链接预填。 */
  inviteCode?: string;
  /** 微信未绑定时的身份核验：账号密码或验证码两种方式。 */
  bindAccount?: string;
  bindPassword?: string;
  bindTarget?: string;
  bindCode?: string;
  /** 登录勾选：会话 30 天内免重复输入。 */
  remember?: boolean;
  /** 注册勾选：必须同意《注册协议》才能提交。 */
  agreement?: boolean;
};

/** 账号与登录配置拉不到时的保底（只开最不依赖外部通道的常规登录/用户名注册）。 */
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
  wechat: { enabled: false },
  captchaRequired: false,
};

const LOGIN_METHOD_LABEL: Record<LoginMethod, string> = {
  PASSWORD: "常规登录",
  EMAIL_CODE: "邮箱验证码",
  SMS_CODE: "手机验证码",
  WECHAT: "微信扫码",
};

const REGISTER_MODE_LABEL: Record<RegisterMode, string> = {
  USERNAME: "用户名注册",
  EMAIL: "邮箱注册",
  PHONE: "手机号注册",
};

const FIELD_NAMES: (keyof AuthValues)[] = [
  "account",
  "password",
  "codeTarget",
  "loginCode",
  "rUsername",
  "rEmail",
  "rPhone",
  "rCode",
  "rPassword",
  "inviteCode",
  "bindAccount",
  "bindPassword",
  "bindTarget",
  "bindCode",
  "remember",
  "agreement",
];

/** 密码口径与后端 assertPassword 一致：至少 8 位且同时含字母和数字。 */
const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
const PASSWORD_MESSAGE = "密码至少 8 位，且需同时包含字母和数字";

/** 演示账号分组（对齐 backend/prisma/seed 的账号口径）。 */
const GROUPS: { key: string; label: string; users: string[] }[] = [
  { key: "enterprise", label: "用户（企业 / 个体工商户 / 个人）", users: ["demo_enterprise", "demo_dual", "demo_user", "demo_individual", "demo_personal"] },
  {
    key: "provider",
    label: "服务商",
    users: [
      "demo_provider",
      "demo_tax2",
      "demo_tax3",
      "demo_tax4",
      "demo_overseas2",
      "demo_overseas3",
      "demo_logistics",
      "demo_logistics2",
      "demo_logistics3",
      "demo_legal",
      "demo_legal2",
      "demo_legal3",
      "demo_ip",
      "demo_flex",
      "demo_flex2",
      "demo_flex3",
      "demo_agent",
      "demo_asset",
      "demo_all",
    ],
  },
  {
    key: "staff",
    label: "职员 / 代理人",
    users: [
      "demo_staff",
      "demo_staff2",
      "demo_staff3",
      "demo_staff4",
      "demo_staff5",
      "demo_staff6",
      "demo_staff7",
      "demo_staff_all",
    ],
  },
  { key: "admin", label: "平台管理员", users: ["admin"] },
];

function groupOf(username: string) {
  return GROUPS.find((group) => group.users.includes(username))?.label || "其他演示账号";
}

/** 同页多处验证码倒计时共用一套实现，避免各写一遍 setTimeout。 */
function useCountdown() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (seconds <= 0) return;
    const timer = window.setTimeout(() => setSeconds(seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [seconds]);
  return [seconds, setSeconds] as const;
}

/** 登录成功后的落地：微信扫码是在 iframe 里回跳的，必须整页跳而不是只动 iframe。 */
function navigate(target: string) {
  try {
    (window.top ?? window).location.assign(target);
  } catch {
    window.location.assign(target);
  }
}

export default function LoginPage() {
  const { message } = App.useApp();
  const brand = useSiteBrand();
  const { t, lang } = useI18n();
  const [form] = Form.useForm<AuthValues>();
  const [accounts, setAccounts] = useState<DevAccount[]>([]);
  const [devMode, setDevMode] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  const { me, logout, sessionChanged } = useSession();
  const [keyword, setKeyword] = useState("");
  /** 本系统账号登录/注册（仅支持本站账号，不使用任何第三方账号登录） */
  const [mode, setMode] = useState<"login" | "register">("login");
  const [config, setConfig] = useState<AccountConfig | null>(null);
  const [loginMethod, setLoginMethod] = useState<LoginMethod>("PASSWORD");
  const [registerMode, setRegisterMode] = useState<RegisterMode>("USERNAME");
  const [bindMethod, setBindMethod] = useState<"PASSWORD" | "EMAIL_CODE" | "SMS_CODE">("PASSWORD");
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [tips, setTips] = useState("");
  const [errorClosed, setErrorClosed] = useState(false);
  const [wechatUrl, setWechatUrl] = useState("");
  const [wechatLoading, setWechatLoading] = useState(false);
  const [wechatReload, setWechatReload] = useState(0);
  const [loginCountdown, setLoginCountdown] = useCountdown();
  const [registerCountdown, setRegisterCountdown] = useCountdown();
  const [bindCountdown, setBindCountdown] = useCountdown();

  const next = useMemo(() => {
    if (typeof window === "undefined") return "/dashboard";
    const target = new URLSearchParams(window.location.search).get("next");
    return safeNextPath(target, "/dashboard");
  }, []);

  /** 微信回跳参数：ok=登录成功；bind=需要绑定已有账号；error=授权失败。 */
  const wechatQuery = useMemo(() => {
    if (typeof window === "undefined") return { status: "", reason: "", ticket: "" };
    const params = new URLSearchParams(window.location.search);
    return {
      status: params.get("wechat") || "",
      reason: params.get("reason") || "",
      ticket: params.get("ticket") || "",
    };
  }, []);
  const bindTicket = wechatQuery.status === "bind" ? wechatQuery.ticket : "";

  const wechatError = useMemo(() => {
    if (wechatQuery.status !== "error") return "";
    if (wechatQuery.reason === "state") return t("二维码已过期，请刷新后重试");
    if (wechatQuery.reason === "denied") return t("已取消微信授权");
    if (wechatQuery.reason === "disabled") return t("微信登录未开启，请联系管理员");
    return wechatQuery.reason || t("微信登录失败，请稍后重试");
  }, [wechatQuery, t]);

  /** 登录方式：只渲染管理员开启且通道可用的；只剩一种时不显示切换器。 */
  const loginOptions = useMemo<LoginMethod[]>(() => {
    const source = config ?? FALLBACK_CONFIG;
    const list = source.loginMethods.filter(
      (method) => source.loginAvailability[method] && (method !== "WECHAT" || source.wechat.enabled),
    );
    return list.length ? list : ["PASSWORD"];
  }, [config]);

  /** 注册方式：同样只列开启且通道可用的。 */
  const registerOptions = useMemo<RegisterMode[]>(() => {
    const source = config ?? FALLBACK_CONFIG;
    return source.registerModes.filter((item) => source.availability[item]);
  }, [config]);

  const bindOptions = useMemo<{ key: string; label: string }[]>(() => {
    const source = config ?? FALLBACK_CONFIG;
    return [
      { key: "PASSWORD", label: t("账号密码") },
      ...(source.loginAvailability.EMAIL_CODE ? [{ key: "EMAIL_CODE", label: t("邮箱验证码") }] : []),
      ...(source.loginAvailability.SMS_CODE ? [{ key: "SMS_CODE", label: t("手机验证码") }] : []),
    ];
  }, [config, t]);

  useEffect(() => {
    let alive = true;
    authApi
      .accountConfig()
      .then((value) => {
        if (alive) setConfig(value);
      })
      .catch(() => {
        if (alive) setConfig(FALLBACK_CONFIG);
      });
    return () => {
      alive = false;
    };
  }, []);

  // 首页「免费注册」链接 /login?mode=register：直接打开注册页签
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("mode") === "register") {
      setMode("register");
    }
  }, []);

  // 邀请链接 /login?invite=CODE：切到注册页并预填邀请码
  useEffect(() => {
    if (typeof window === "undefined") return;
    const invite = (new URLSearchParams(window.location.search).get("invite") || "").trim().toUpperCase();
    if (!invite) return;
    setMode("register");
    form.setFieldsValue({ inviteCode: invite.slice(0, 32) });
  }, [form]);

  // 配置到位后纠正失效选择：注册方式 / 登录方式都必须落在可用集合里
  useEffect(() => {
    if (!loginOptions.includes(loginMethod)) setLoginMethod(loginOptions[0]);
  }, [loginOptions, loginMethod]);
  useEffect(() => {
    if (!registerOptions.includes(registerMode)) {
      if (registerOptions.length) setRegisterMode(registerOptions[0]);
      else setMode("login");
    }
  }, [registerOptions, registerMode]);

  // 微信扫码：进入该方式时取一次性授权地址（state 由后端生成，5 分钟失效）
  useEffect(() => {
    if (me || bindTicket || mode !== "login" || loginMethod !== "WECHAT") return;
    let alive = true;
    setWechatLoading(true);
    setWechatUrl("");
    authApi
      .wechatAuthorize(next, false)
      .then((value) => {
        if (alive) setWechatUrl(value.authorizeUrl);
      })
      .catch((error: unknown) => {
        if (alive) setTips(error instanceof Error ? error.message : t("微信授权失败，请稍后重试"));
      })
      .finally(() => {
        if (alive) setWechatLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [me, bindTicket, mode, loginMethod, next, wechatReload, t]);

  // 扫码成功：后端在 iframe 里回跳到本页，这里把整页带到 next
  useEffect(() => {
    if (wechatQuery.status !== "ok") return;
    const target = safeNextPath(new URLSearchParams(window.location.search).get("next"), next);
    void sessionChanged().then(() => navigate(target));
  }, [wechatQuery, next, sessionChanged]);

  // 扫码结果（待绑定/失败）必须由父窗口整页展示，否则表单会挤在二维码 iframe 里
  useEffect(() => {
    if (typeof window === "undefined" || window.top === window.self) return;
    if (wechatQuery.status !== "bind" && wechatQuery.status !== "error") return;
    try {
      window.top?.location.replace(window.location.href);
    } catch {
      /* 跨域时留在当前窗口展示 */
    }
  }, [wechatQuery]);

  const load = useCallback(async () => {
    try {
      const accounts = await authApi.devAccounts();
      setAccounts(accounts || []);
      setDevMode(true);
    } catch {
      setDevMode(false);
    }
  }, []);

  useEffect(() => {
    void load();
    if (new URLSearchParams(window.location.search).get("reason") === "expired") {
      setTips("登录状态已过期，请重新登录");
    }
  }, [load]);

  const visible = useMemo(() => {
    const key = keyword.trim().toLowerCase();
    const list = accounts.filter(
      (account) =>
        !key ||
        account.username.toLowerCase().includes(key) ||
        account.displayName.toLowerCase().includes(key) ||
        account.userId.toLowerCase().includes(key),
    );
    return [...list].sort(
      (a, b) =>
        GROUPS.findIndex((group) => group.label === groupOf(a.username)) -
        GROUPS.findIndex((group) => group.label === groupOf(b.username)),
    );
  }, [accounts, keyword]);

  const loginAs = (username: string) => {
    window.location.assign(
      `/api/dev/session?as=${encodeURIComponent(username)}&next=${encodeURIComponent(next)}`,
    );
  };

  /** 登录/注册/绑定三条链路统一收尾：刷新会话状态后整页跳到 next。 */
  const finish = async () => {
    await sessionChanged();
    navigate(next);
  };

  /** 注册后自动登录：/api/auth/local/register 只建号不签会话，避免注册完又被踢回登录页。 */
  const autoLogin = async (identifier: string, password: string) => {
    try {
      await authApi.login({ account: identifier, password });
      return true;
    } catch {
      setMode("login");
      setLoginMethod("PASSWORD");
      form.setFieldsValue({ account: identifier });
      setTips(t("注册成功，请使用刚设置的密码登录"));
      return false;
    }
  };

  const submit = async (values: AuthValues) => {
    if (busy || sending) return false;
    setTips("");
    if (bindTicket) {
      setBusy(true);
      try {
        if (bindMethod === "PASSWORD") {
          await authApi.wechatBind({
            ticket: bindTicket,
            account: values.bindAccount,
            password: values.bindPassword,
            remember: values.remember === true,
          });
        } else {
          await authApi.wechatBind({
            ticket: bindTicket,
            channel: bindMethod === "EMAIL_CODE" ? "EMAIL" : "SMS",
            target: values.bindTarget,
            code: values.bindCode,
            remember: values.remember === true,
          });
        }
        await finish();
        return true;
      } catch (error) {
        setTips(error instanceof Error ? error.message : t("网络异常，请稍后再试"));
        return false;
      } finally {
        setBusy(false);
      }
    }
    if (mode === "login" && loginMethod === "WECHAT") return false;
    setBusy(true);
    try {
      if (mode === "login") {
        if (loginMethod === "PASSWORD") {
          await authApi.login({
            account: String(values.account || ""),
            password: values.password || "",
            remember: values.remember === true,
          });
        } else {
          await authApi.loginByCode({
            channel: loginMethod === "EMAIL_CODE" ? "EMAIL" : "SMS",
            target: String(values.codeTarget || ""),
            code: values.loginCode || "",
            remember: values.remember === true,
          });
        }
      } else {
        const password = values.rPassword || "";
        const identifier =
          registerMode === "USERNAME"
            ? String(values.rUsername || "").trim()
            : registerMode === "EMAIL"
              ? String(values.rEmail || "").trim()
              : String(values.rPhone || "").trim();
        await authApi.register({
          mode: registerMode,
          password,
          ...(registerMode === "USERNAME" ? { username: identifier } : {}),
          ...(registerMode === "EMAIL" ? { email: identifier, code: values.rCode } : {}),
          ...(registerMode === "PHONE" ? { phone: identifier, code: values.rCode } : {}),
          ...(values.inviteCode ? { inviteCode: values.inviteCode.trim().toUpperCase() } : {}),
        });
        if (!(await autoLogin(identifier, password))) return false;
      }
      await finish();
      return true;
    } catch (error) {
      setTips(error instanceof Error ? error.message : t("网络异常，请稍后再试"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const sendCode = async (
    channel: CodeChannel,
    field: keyof AuthValues,
    kind: "login" | "register" | "bind",
    setCountdown: (value: number) => void,
  ) => {
    if (sending || busy) return;
    let target: string;
    try {
      const values = await form.validateFields([field]);
      target = String(values[field] || "").trim();
    } catch {
      return;
    }
    setSending(true);
    setTips("");
    try {
      if (kind === "login") await authApi.sendLoginCode(channel, target);
      else if (kind === "register") await authApi.sendRegisterCode(channel, target);
      else await authApi.sendLoginCode(channel, target);
      message.success(t("验证码已发送"));
      setCountdown(60);
    } catch (error) {
      setTips(error instanceof Error ? error.message : t("网络异常，请稍后再试"));
    } finally {
      setSending(false);
    }
  };

  const changeMode = (value: string) => {
    setMode(value === "register" ? "register" : "login");
    setTips("");
    form.setFields(FIELD_NAMES.map((name) => ({ name, errors: [] })));
  };

  const changeLoginMethod = (value: string) => {
    setLoginMethod(value as LoginMethod);
    setTips("");
  };

  const changeRegisterMode = (value: string) => {
    setRegisterMode(value as RegisterMode);
    setTips("");
  };

  const locked = busy || sending;
  const canSwitchLogin = loginOptions.length > 1;
  const canSwitchRegister = registerOptions.length > 1;
  const emailChannel = loginMethod === "EMAIL_CODE";
  const messageText = tips || (errorClosed ? "" : wechatError);
  const submitter = me || (mode === "login" && loginMethod === "WECHAT" && !bindTicket)
    ? false
    : {
        searchConfig: {
          submitText: t(bindTicket ? "绑定并登录" : mode === "login" ? "登 录" : "注册并登录"),
        },
        submitButtonProps: {
          loading: busy,
          disabled: sending,
          className: styles.submit,
        },
      };

  return (
    <div className={styles.page}>
      <div style={{ position: "absolute", top: 16, right: 16, zIndex: 2 }}>
        <LanguageSwitcher />
      </div>
      <a href="#login-content" className={styles.skipLink}>{t("跳转到登录表单")}</a>
      <main className={styles.main} id="login-content">
        <section className={styles.authSection} aria-label={t("账号登录")}>
          <LoginForm<AuthValues>
            form={form}
            logo={<BrandLogo size={48} className={styles.logo} priority src={brand.siteLogo || undefined} />}
            title={<h1 className={styles.title}>{brand.siteName || PRODUCT_NAME}</h1>}
            subTitle={brand.siteDesc || t("一站连接企业服务，让业务协同更简单")}
            contentStyle={{ width: "100%", maxWidth: 368 }}
            onFinish={submit}
            onFinishFailed={() => setTips("")}
            disabled={busy}
            validateTrigger="onBlur"
            submitter={submitter}
            message={messageText ? (
              <Alert
                className={styles.alert}
                title={messageText}
                type="error"
                showIcon
                role="alert"
                closable={!!messageText}
                onClose={() => {
                  setTips("");
                  setErrorClosed(true);
                }}
              />
            ) : undefined}
            actions={devMode && !me && !bindTicket ? (
              <div className={styles.devEntry}>
                <Button type="text" icon={<CodeOutlined />} onClick={() => setDevOpen(true)} disabled={locked}>
                  {t("开发演示账号")}
                </Button>
              </div>
            ) : undefined}
          >
            {me ? (
              <div className={styles.current}>
                <span className={styles.currentAvatar} aria-hidden="true"><UserOutlined /></span>
                <h2>{lang === "zh-CN" ? `欢迎回来，${me.displayName || me.username}` : `${t("欢迎回来")}, ${me.displayName || me.username}`}</h2>
                <p>{t("你已登录，可以继续处理企业业务。")}</p>
                <Button type="primary" size="large" block onClick={() => (window.location.href = next)}>
                  {t("进入高管驾驶舱")} <ArrowRightOutlined />
                </Button>
                <Button type="link" onClick={logout}>
                  {t("退出并切换账号")}
                </Button>
              </div>
            ) : bindTicket ? (
              <>
                <Alert
                  className={styles.alert}
                  type="info"
                  showIcon
                  title={t("该微信尚未绑定账号，请先用已有账号确认身份，绑定后即可扫码登录。")}
                />
                {bindOptions.length > 1 ? (
                  <PillTabs
                    size="small"
                    variant="soft"
                    style={{ marginBottom: 20 }}
                    items={bindOptions}
                    value={bindMethod}
                    onChange={(value) => setBindMethod(value as "PASSWORD" | "EMAIL_CODE" | "SMS_CODE")}
                  />
                ) : null}
                {bindMethod === "PASSWORD" ? (
                  <>
                    <ProFormText
                      name="bindAccount"
                      fieldProps={{ size: "large", prefix: <UserOutlined />, autoComplete: "username", "aria-label": t("用户名 / 邮箱 / 手机号") }}
                      placeholder={t("用户名 / 邮箱 / 手机号")}
                      rules={[{ required: true, whitespace: true, message: t("请输入账号") }]}
                    />
                    <ProFormText.Password
                      name="bindPassword"
                      fieldProps={{ size: "large", prefix: <LockOutlined />, autoComplete: "current-password", "aria-label": t("密码") }}
                      placeholder={t("密码")}
                      rules={[{ required: true, message: t("请输入密码") }]}
                    />
                  </>
                ) : (
                  <>
                    <ProFormText
                      name="bindTarget"
                      fieldProps={{
                        size: "large",
                        prefix: bindMethod === "EMAIL_CODE" ? <MailOutlined /> : <MobileOutlined />,
                        autoComplete: bindMethod === "EMAIL_CODE" ? "email" : "tel",
                        inputMode: bindMethod === "EMAIL_CODE" ? "email" : "tel",
                        "aria-label": bindMethod === "EMAIL_CODE" ? t("邮箱") : t("手机号"),
                      }}
                      placeholder={bindMethod === "EMAIL_CODE" ? t("邮箱") : t("手机号")}
                      rules={[
                        { required: true, whitespace: true, message: t("请输入账号") },
                        ...(bindMethod === "EMAIL_CODE"
                          ? [{ type: "email" as const, transform: (value: string) => value?.trim(), message: t("请输入有效的邮箱地址") }]
                          : [{ pattern: /^1[3-9]\d{9}$/, message: t("请输入有效的手机号") }]),
                      ]}
                    />
                    <div className={styles.codeRow}>
                      <ProFormText
                        name="bindCode"
                        fieldProps={{ size: "large", prefix: <SafetyCertificateOutlined />, autoComplete: "one-time-code", "aria-label": t("验证码") }}
                        placeholder={t("验证码")}
                        rules={[{ required: true, whitespace: true, message: t("请输入验证码") }]}
                      />
                      <Button
                        size="large"
                        loading={sending}
                        disabled={busy || bindCountdown > 0}
                        onClick={() =>
                          void sendCode(
                            bindMethod === "EMAIL_CODE" ? "EMAIL" : "SMS",
                            "bindTarget",
                            "bind",
                            setBindCountdown,
                          )
                        }
                      >
                        {bindCountdown > 0 ? `${bindCountdown}s${t("后重发")}` : t("获取验证码")}
                      </Button>
                    </div>
                  </>
                )}
                <Form.Item name="remember" valuePropName="checked" style={{ marginBottom: 8 }}>
                  <Checkbox>{t("30 天内自动登录")}</Checkbox>
                </Form.Item>
              </>
            ) : (
              <>
                <PillTabs
                  style={{ marginBottom: 24 }}
                  items={[
                    { key: "login", label: t("账号登录") },
                    ...(registerOptions.length ? [{ key: "register", label: t("注册账号") }] : []),
                  ]}
                  value={mode}
                  onChange={changeMode}
                />
                {mode === "login" ? (
                  <>
                    {canSwitchLogin ? (
                      <PillTabs
                        size="small"
                        variant="soft"
                        style={{ marginBottom: 20 }}
                        items={loginOptions.map((method) => ({ key: method, label: t(LOGIN_METHOD_LABEL[method]) }))}
                        value={loginMethod}
                        onChange={changeLoginMethod}
                      />
                    ) : null}
                    {loginMethod === "PASSWORD" ? (
                      <>
                        <ProFormText
                          name="account"
                          fieldProps={{ size: "large", prefix: <UserOutlined />, autoComplete: "username", "aria-label": t("用户名 / 邮箱 / 手机号") }}
                          placeholder={t("用户名 / 邮箱 / 手机号")}
                          rules={[{ required: true, whitespace: true, message: t("请输入账号") }]}
                        />
                        <ProFormText.Password
                          name="password"
                          fieldProps={{ size: "large", prefix: <LockOutlined />, autoComplete: "current-password", "aria-label": t("密码") }}
                          placeholder={t("密码")}
                          rules={[{ required: true, message: t("请输入密码") }]}
                        />
                        <Form.Item name="remember" valuePropName="checked" style={{ marginBottom: 8 }}>
                          <Checkbox>{t("30 天内自动登录")}</Checkbox>
                        </Form.Item>
                      </>
                    ) : loginMethod === "WECHAT" ? (
                      <div className={styles.wechat}>
                        {wechatLoading ? (
                          <Spin tip={t("正在加载二维码…")}>
                            <div className={styles.wechatFrame} />
                          </Spin>
                        ) : wechatUrl ? (
                          <iframe
                            title={t("微信扫码登录")}
                            src={wechatUrl}
                            className={styles.wechatFrame}
                            allow="encrypted-media"
                          />
                        ) : (
                          <p className={styles.formNote}>{t("微信二维码加载失败，请刷新重试")}</p>
                        )}
                        <Button
                          type="link"
                          icon={<ReloadOutlined />}
                          disabled={wechatLoading}
                          onClick={() => setWechatReload((value) => value + 1)}
                        >
                          {t("刷新二维码")}
                        </Button>
                      </div>
                    ) : (
                      <>
                        <ProFormText
                          name="codeTarget"
                          fieldProps={{
                            size: "large",
                            prefix: emailChannel ? <MailOutlined /> : <MobileOutlined />,
                            autoComplete: emailChannel ? "email" : "tel",
                            inputMode: emailChannel ? "email" : "tel",
                            "aria-label": emailChannel ? t("邮箱") : t("手机号"),
                          }}
                          placeholder={emailChannel ? t("邮箱") : t("手机号")}
                          rules={[
                            { required: true, whitespace: true, message: t("请输入账号") },
                            ...(emailChannel
                              ? [{ type: "email" as const, transform: (value: string) => value?.trim(), message: t("请输入有效的邮箱地址") }]
                              : [{ pattern: /^1[3-9]\d{9}$/, message: t("请输入有效的手机号") }]),
                          ]}
                        />
                        <div className={styles.codeRow}>
                          <ProFormText
                            name="loginCode"
                            fieldProps={{ size: "large", prefix: <SafetyCertificateOutlined />, autoComplete: "one-time-code", "aria-label": t("验证码") }}
                            placeholder={t("验证码")}
                            rules={[{ required: true, whitespace: true, message: t("请输入验证码") }]}
                          />
                          <Button
                            size="large"
                            loading={sending}
                            disabled={busy || loginCountdown > 0}
                            onClick={() =>
                              void sendCode(
                                emailChannel ? "EMAIL" : "SMS",
                                "codeTarget",
                                "login",
                                setLoginCountdown,
                              )
                            }
                          >
                            {loginCountdown > 0 ? `${loginCountdown}s${t("后重发")}` : t("获取验证码")}
                          </Button>
                        </div>
                        <Form.Item name="remember" valuePropName="checked" style={{ marginBottom: 8 }}>
                          <Checkbox>{t("30 天内自动登录")}</Checkbox>
                        </Form.Item>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    {canSwitchRegister ? (
                      <PillTabs
                        size="small"
                        variant="soft"
                        style={{ marginBottom: 20 }}
                        items={registerOptions.map((item) => ({ key: item, label: t(REGISTER_MODE_LABEL[item]) }))}
                        value={registerMode}
                        onChange={changeRegisterMode}
                      />
                    ) : null}
                    {registerMode === "USERNAME" ? (
                      <ProFormText
                        name="rUsername"
                        fieldProps={{ size: "large", prefix: <UserOutlined />, autoComplete: "username", "aria-label": t("用户名") }}
                        placeholder={t("用户名（3-32 位字母、数字、下划线或连字符）")}
                        rules={[
                          { required: true, whitespace: true, message: t("请输入用户名") },
                          { pattern: /^[A-Za-z0-9_-]{3,32}$/, message: t("用户名需为 3-32 位字母、数字、下划线或连字符") },
                        ]}
                      />
                    ) : registerMode === "EMAIL" ? (
                      <>
                        <ProFormText
                          name="rEmail"
                          fieldProps={{ size: "large", prefix: <MailOutlined />, autoComplete: "email", inputMode: "email", "aria-label": t("邮箱") }}
                          placeholder={t("邮箱")}
                          rules={[
                            { required: true, whitespace: true, message: t("请输入邮箱") },
                            { type: "email", transform: (value: string) => value?.trim(), message: t("请输入有效的邮箱地址") },
                          ]}
                        />
                        <div className={styles.codeRow}>
                          <ProFormText
                            name="rCode"
                            fieldProps={{ size: "large", prefix: <SafetyCertificateOutlined />, autoComplete: "one-time-code", "aria-label": t("验证码") }}
                            placeholder={t("验证码")}
                            rules={[{ required: true, whitespace: true, message: t("请输入邮箱验证码") }]}
                          />
                          <Button
                            size="large"
                            loading={sending}
                            disabled={busy || registerCountdown > 0}
                            onClick={() => void sendCode("EMAIL", "rEmail", "register", setRegisterCountdown)}
                          >
                            {registerCountdown > 0 ? `${registerCountdown}s${t("后重发")}` : t("获取验证码")}
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        <ProFormText
                          name="rPhone"
                          fieldProps={{ size: "large", prefix: <MobileOutlined />, autoComplete: "tel", inputMode: "tel", "aria-label": t("手机号") }}
                          placeholder={t("手机号")}
                          rules={[
                            { required: true, whitespace: true, message: t("请输入手机号") },
                            { pattern: /^1[3-9]\d{9}$/, message: t("请输入有效的手机号") },
                          ]}
                        />
                        <div className={styles.codeRow}>
                          <ProFormText
                            name="rCode"
                            fieldProps={{ size: "large", prefix: <SafetyCertificateOutlined />, autoComplete: "one-time-code", "aria-label": t("验证码") }}
                            placeholder={t("验证码")}
                            rules={[{ required: true, whitespace: true, message: t("请输入短信验证码") }]}
                          />
                          <Button
                            size="large"
                            loading={sending}
                            disabled={busy || registerCountdown > 0}
                            onClick={() => void sendCode("SMS", "rPhone", "register", setRegisterCountdown)}
                          >
                            {registerCountdown > 0 ? `${registerCountdown}s${t("后重发")}` : t("获取验证码")}
                          </Button>
                        </div>
                      </>
                    )}
                    <ProFormText.Password
                      name="rPassword"
                      fieldProps={{ size: "large", prefix: <LockOutlined />, autoComplete: "new-password", "aria-label": t("密码") }}
                      placeholder={t("设置密码（至少 8 位，含字母和数字）")}
                      rules={[
                        { required: true, message: t("请输入密码") },
                        { pattern: PASSWORD_PATTERN, message: t(PASSWORD_MESSAGE) },
                      ]}
                    />
                    <ProFormText
                      name="inviteCode"
                      fieldProps={{ size: "large", prefix: <SafetyCertificateOutlined />, autoComplete: "off", "aria-label": t("邀请码（选填）"), maxLength: 32 }}
                      placeholder={t("邀请码（选填）")}
                    />
                    <Form.Item
                      name="agreement"
                      valuePropName="checked"
                      style={{ marginBottom: 8 }}
                      rules={[
                        {
                          validator: (_rule, value) =>
                            value
                              ? Promise.resolve()
                              : Promise.reject(new Error(t("请先阅读并同意注册协议"))),
                        },
                      ]}
                    >
                      <Checkbox>
                        {t("我已阅读并同意")}
                        <a href="/agreement/register" target="_blank" rel="noreferrer">
                          {t("《注册协议》")}
                        </a>
                      </Checkbox>
                    </Form.Item>
                  </>
                )}
              </>
            )}
          </LoginForm>
        </section>
      </main>
      <footer className={styles.footer}>
        {brand.siteName ? <span>{brand.siteName} · </span> : null}
        {brand.footerLinks?.length ? (
          <span>
            {brand.footerLinks.map((link, index) => (
              <span key={link.url}>
                {index > 0 ? ' · ' : null}
                <a href={link.url} target="_blank" rel="noreferrer" className={styles.icpLink}>
                  {link.label}
                </a>
              </span>
            ))}
          </span>
        ) : null}
        {brand.icpRecord ? (
          <>
            {brand.footerLinks?.length ? <span> · </span> : null}
            <a
              href="https://beian.miit.gov.cn/#/Integrated/index"
              target="_blank"
              rel="noreferrer"
              className={styles.icpLink}
            >
              {brand.icpRecord}
            </a>
          </>
        ) : null}
      </footer>
      <Drawer
        title="开发演示账号"
        open={devMode && devOpen}
        onClose={() => setDevOpen(false)}
        size={620}
        className={styles.devDrawer}
      >
        <p className={styles.devDescription}>选择业务身份直接进入高管驾驶舱，共 {accounts.length} 个账号。</p>
        <Input.Search
          allowClear
          placeholder="搜索用户名、名称或 ID"
          aria-label="搜索演示账号"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
        <div className={styles.accountGrid}>
          {visible.map((account) => (
            <button key={account.username} type="button" className={styles.account} onClick={() => loginAs(account.username)}>
              <span className={styles.accountName}>
                {account.displayName}
                {account.role === "admin" ? <Tag color="blue">管理员</Tag> : null}
              </span>
              <span className={styles.accountMeta}>{account.username} · {account.userId}</span>
              <span className={styles.accountGroup}>{groupOf(account.username)}</span>
            </button>
          ))}
        </div>
        {visible.length ? null : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的演示账号" />}
      </Drawer>
    </div>
  );
}
