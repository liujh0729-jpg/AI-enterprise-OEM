"use client";

import {
  ArrowRightOutlined,
  CodeOutlined,
  LockOutlined,
  MailOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { LoginForm, ProFormText } from "@ant-design/pro-components";
import { Alert, App, Button, Checkbox, Drawer, Empty, Form, Input, Tabs, Tag } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useI18n } from "@/lib/i18n/i18n";
import { PRODUCT_NAME } from "@/lib/brand";
import { useSiteBrand } from "@/lib/site-brand";
import { safeNextPath } from "@/lib/safe-next";
import styles from "./login.module.css";
import { authApi } from "@/api/auth";
import { useSession } from "@/lib/session";

type DevAccount = {
  username: string;
  userId: string;
  displayName: string;
  role: string;
};


type AuthValues = {
  username: string;
  password: string;
  nickname?: string;
  email?: string;
  emailCode?: string;
  /** 邀请码（选填）：填写后记录被谁邀请注册；可从 /login?invite=CODE 链接预填。 */
  inviteCode?: string;
  /** 登录勾选：会话 30 天内免重复输入。 */
  remember?: boolean;
  /** 注册勾选：必须同意《注册协议》才能提交。 */
  agreement?: boolean;
};

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

export default function LoginPage() {
  const { message } = App.useApp();
  const brand = useSiteBrand();
  const { t, lang } = useI18n();
  const [form] = Form.useForm<AuthValues>();
  const [accounts, setAccounts] = useState<DevAccount[]>([]);
  const [devMode, setDevMode] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  const {me,logout,sessionChanged} = useSession();
  const [keyword, setKeyword] = useState("");
  /** 本系统账号登录/注册（仅支持本站账号，不使用任何第三方账号登录） */
  const [mode, setMode] = useState<"login" | "register">("login");
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [tips, setTips] = useState("");

  const next = useMemo(() => {
    if (typeof window === "undefined") return "/";
    const target = new URLSearchParams(window.location.search).get("next");
    return safeNextPath(target);
  }, []);

  // 邀请链接 /login?invite=CODE：切到注册页并预填邀请码
  useEffect(() => {
    if (typeof window === "undefined") return;
    const invite = (new URLSearchParams(window.location.search).get("invite") || "").trim().toUpperCase();
    if (!invite) return;
    setMode("register");
    form.setFieldsValue({ inviteCode: invite.slice(0, 32) });
  }, [form]);

  const load=useCallback(async()=>{
    try{const accounts=await authApi.devAccounts();setAccounts(accounts||[]);setDevMode(true);}catch{setDevMode(false);}
  },[]);

  useEffect(() => {
    void load();
    if (
      new URLSearchParams(window.location.search).get("reason") === "expired"
    ) {
      setTips("登录状态已过期，请重新登录");
    }
  }, [load]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

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

  /** 本系统内登录/注册：走本系统 BFF（BFF 再代调账号服务），完成后回到 next */
  const submit = async (values: AuthValues) => {
    if (busy || sending) return false;
    setTips("");
    setBusy(true);
    try {
      if(mode==='login'){
        const target=await authApi.login({username:values.username.trim(),password:values.password,remember:values.remember===true},next);
        await sessionChanged();
        window.location.assign(target);
      }else{
        await authApi.register({username:values.username.trim(),password:values.password,nickname:values.nickname?.trim()||'',email:values.email?.trim()||'',emailCode:values.emailCode?.trim()||'',inviteCode:values.inviteCode?.trim().toUpperCase()||''});
        await sessionChanged();
        window.location.assign(next);
      }
      return true;
    } catch(error) {
      setTips(error instanceof Error?error.message:t("网络异常，请稍后再试"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const sendCode = async () => {
    if (sending || busy || countdown > 0) return;
    let email: string;
    try {
      const values = await form.validateFields(["email"]);
      email = values.email!.trim();
    } catch {
      return;
    }
    setSending(true);
    setTips("");
    try {
      await authApi.sendEmailCode(email);
      message.success("验证码已发送到邮箱");
      setCountdown(60);
    } catch(error) {
      setTips(error instanceof Error?error.message:t("网络异常，请稍后再试"));
    } finally {
      setSending(false);
    }
  };

  const changeMode = (value: string) => {
    setMode(value === "register" ? "register" : "login");
    setTips("");
    const fieldNames: (keyof AuthValues)[] = [
      "username", "password", "nickname", "email", "emailCode", "remember", "agreement",
    ];
    form.setFields(fieldNames.map((name) => ({ name, errors: [] })));
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
            submitter={me ? false : {
              searchConfig: { submitText: t(mode === "login" ? "登 录" : "注册并登录") },
              submitButtonProps: {
                loading: busy,
                disabled: sending,
                className: styles.submit,
              },
            }}
            message={tips ? <Alert className={styles.alert} title={tips} type="error" showIcon role="alert" /> : undefined}
            actions={devMode ? (
              <div className={styles.devEntry}>
                <Button type="text" icon={<CodeOutlined />} onClick={() => setDevOpen(true)} disabled={busy || sending}>
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
            ) : (
              <>
                <Tabs
                  className={styles.tabs}
                  activeKey={mode}
                  onChange={changeMode}
                  centered
                  items={[
                    { key: "login", label: t("账号登录"), disabled: busy || sending },
                    { key: "register", label: t("注册账号"), disabled: busy || sending },
                  ]}
                />
                {mode === "register" ? (
                  <ProFormText
                    name="nickname"
                    fieldProps={{ size: "large", prefix: <UserOutlined />, autoComplete: "nickname", "aria-label": t("昵称") }}
                    placeholder={t("昵称")}
                    rules={[{ required: true, whitespace: true, message: t("请输入昵称") }]}
                  />
                ) : null}
                <ProFormText
                  name="username"
                  fieldProps={{ size: "large", prefix: <UserOutlined />, autoComplete: "username", "aria-label": t(mode === "login" ? "用户名 / 邮箱 / 手机号" : "用户名") }}
                  placeholder={t(mode === "login" ? "用户名 / 邮箱 / 手机号" : "用户名")}
                  rules={[{ required: true, whitespace: true, message: t("请输入账号") }]}
                />
                {mode === "register" ? (
                  <>
                    <ProFormText
                      name="email"
                      fieldProps={{ size: "large", prefix: <MailOutlined />, autoComplete: "email", inputMode: "email", "aria-label": t("邮箱") }}
                      placeholder={t("邮箱")}
                      rules={[
                        { required: true, whitespace: true, message: t("请输入邮箱") },
                        { type: "email", transform: (value: string) => value?.trim(), message: t("请输入有效的邮箱地址") },
                      ]}
                    />
                    <div className={styles.codeRow}>
                      <ProFormText
                        name="emailCode"
                        fieldProps={{ size: "large", prefix: <SafetyCertificateOutlined />, autoComplete: "one-time-code", "aria-label": t("验证码") }}
                        placeholder={t("验证码")}
                        rules={[{ required: true, whitespace: true, message: t("请输入邮箱验证码") }]}
                      />
                      <Button size="large" loading={sending} disabled={busy || countdown > 0} onClick={() => void sendCode()}>
                        {countdown > 0 ? `${countdown}s${t("后重发")}` : t("获取验证码")}
                      </Button>
                    </div>
                  </>
                ) : null}
                <ProFormText.Password
                  name="password"
                  fieldProps={{ size: "large", prefix: <LockOutlined />, autoComplete: mode === "login" ? "current-password" : "new-password", "aria-label": t("密码") }}
                  placeholder={t("密码")}
                  rules={[{ required: true, message: t("请输入密码") }]}
                />
                {mode === "register" ? (
                  <ProFormText
                    name="inviteCode"
                    fieldProps={{ size: "large", prefix: <SafetyCertificateOutlined />, autoComplete: "off", "aria-label": t("邀请码（选填）"), maxLength: 32 }}
                    placeholder={t("邀请码（选填）")}
                  />
                ) : null}
                {mode === "login" ? (
                  <Form.Item name="remember" valuePropName="checked" style={{ marginBottom: 8 }}>
                    <Checkbox>{t("30 天内自动登录")}</Checkbox>
                  </Form.Item>
                ) : (
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
