"use client";

import { App, Button, Drawer, Form, Input, Space, Tag } from "antd";
import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { seoApi } from "@/api/seo";
import { Notice, Panel } from "@/components/ui/panel";
import { fmtDateTime } from "@/lib/datetime";
import { useSeoGoogleSettings, useSeoSettings, useSeoActions } from "@/query/seo";
import { presentMutationError } from "@/query/errors";

const PROVIDER_CODE = "dataforseo";

const DATAFORSEO_HOME = "https://dataforseo.com/";
const DATAFORSEO_DASHBOARD = "https://app.dataforseo.com/";
const GOOGLE_CLOUD_CREDENTIALS = "https://console.cloud.google.com/apis/credentials";
const GOOGLE_CLOUD_LIBRARY = "https://console.cloud.google.com/apis/library";
const SEARCH_CONSOLE_HOME = "https://search.google.com/search-console";
const GA4_HOME = "https://analytics.google.com/";

const GUIDE_LIST_STYLE: CSSProperties = { margin: "8px 0 0", paddingLeft: 20, lineHeight: 2 };

/** 注册/取凭据的外链：不写死显示文案时直接展示去掉协议的域名。 */
function ExternalLink({ href, children }: { href: string; children?: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children ?? href.replace(/^https?:\/\//, "")}
    </a>
  );
}

/** DataForSEO Key（你自带、你付费）：login:password 形式，只落密文，接口与页面都不回显。 */
function DataForSeoPanel() {
  const { message, modal } = App.useApp();
  const actions = useSeoActions();
  const query = useSeoSettings();
  const row = (query.data ?? []).find((item) => item.code === PROVIDER_CODE);
  const connected = Boolean(row?.connected);
  const [form] = Form.useForm<{ accountName: string; login: string; password: string }>();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const save = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await actions.saveProvider.mutateAsync({
        body: {
          code: PROVIDER_CODE,
          accountName: values.accountName ?? "",
          login: values.login ?? "",
          password: values.password ?? "",
        },
      });
      message.success("DataForSEO 凭据已保存（密文存储，不回显）");
      form.setFieldsValue({ login: "", password: "" });
    } catch (error) {
      if (error instanceof Error) presentMutationError(error, (t) => message.error(t));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const result = await actions.testProvider.mutateAsync({ body: { code: PROVIDER_CODE } });
      if (result?.ok) modal.success({ title: "DataForSEO 连通正常", content: result.message });
      else modal.error({ title: "DataForSEO 连通失败", content: result?.message || "请检查 login / password" });
    } catch (error) {
      if (error instanceof Error) presentMutationError(error, (t) => message.error(t));
    } finally {
      setTesting(false);
    }
  };

  const clear = () => {
    modal.confirm({
      title: "清除 DataForSEO 凭据",
      content: "清除后排名跟踪、竞品、外链等实测功能将不可用（站点体检等自有抓取不受影响）。确认清除？",
      okText: "确认清除",
      okButtonProps: { danger: true },
      onOk: async () => {
        await actions.clearProvider.mutateAsync({ body: { code: PROVIDER_CODE } });
        message.success("已清除 DataForSEO 凭据");
      },
    });
  };

  return (
    <Panel
      title="DataForSEO 数据源"
      titleExtra={connected ? <Tag color="green">已连接</Tag> : <Tag>未配置</Tag>}
    >
      <Notice variant="info">
        排名跟踪、竞品洞察、外链分析、本地 SEO 网格、关键词实测都走 DataForSEO：用你自己的
        login:password，费用由你的 DataForSEO 账户承担，本系统不另计积分。无 Key 时这些项显示「未配置数据源」，绝不造假数据。
        {row?.updatedAt ? ` · 最近更新：${fmtDateTime(row.updatedAt)}` : ""}
      </Notice>
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>还没有 DataForSEO 账号？三步拿到凭据</div>
        <ol style={GUIDE_LIST_STYLE}>
          <li>
            前往官网 <ExternalLink href={DATAFORSEO_HOME} /> 注册账号（邮箱注册，含 $1 试用额度，之后按量计费）。
          </li>
          <li>
            登录控制台 <ExternalLink href={DATAFORSEO_DASHBOARD} />，在左侧「API Access」页复制 <b>API login</b> 与{" "}
            <b>API password</b> —— 就是下面要填的 Login / Password。
          </li>
          <li>回到本页粘贴并「保存凭据」，再点「测试连通」验证；通过后排名跟踪、竞品、外链等实测功能即可用。</li>
        </ol>
      </div>
      <Form form={form} layout="vertical" style={{ marginTop: 12 }} initialValues={{ accountName: row?.accountName ?? "" }}>
        <Form.Item name="accountName" label="账户备注名">
          <Input placeholder="如：我的 DataForSEO 主账户（仅便于识别）" maxLength={80} />
        </Form.Item>
        <div className="form-2col">
          <Form.Item name="login" label="Login（API 用户名）" rules={[{ required: !connected, message: "请填写 login" }]}>
            <Input placeholder="DataForSEO 后台的 API login" autoComplete="off" />
          </Form.Item>
          <Form.Item name="password" label="Password（API 密码）" rules={[{ required: !connected, message: "请填写 password" }]}>
            <Input.Password placeholder={connected ? "已配置（留空则不修改）" : "DataForSEO 后台的 API password"} autoComplete="new-password" />
          </Form.Item>
        </div>
        <Space>
          <Button type="primary" loading={saving} onClick={() => void save()}>保存凭据</Button>
          <Button loading={testing} disabled={!connected} onClick={() => void test()}>测试连通</Button>
          {connected ? <Button danger onClick={clear}>清除凭据</Button> : null}
        </Space>
      </Form>
    </Panel>
  );
}

/** Google 双轨同步：① 浏览器 OAuth 授权（回调落后端）② 直接粘贴 refresh_token。 */
function GooglePanel() {
  const { message } = App.useApp();
  const actions = useSeoActions();
  const query = useSeoGoogleSettings();
  const settings = query.data;
  const [clientForm] = Form.useForm<{ clientId: string; clientSecret: string }>();
  const [savingClient, setSavingClient] = useState(false);

  const saveClient = async () => {
    try {
      const values = await clientForm.validateFields();
      setSavingClient(true);
      await actions.saveGoogleClient.mutateAsync({
        body: { clientId: values.clientId ?? "", clientSecret: values.clientSecret ?? "" },
      });
      message.success("Google OAuth 客户端已保存");
      clientForm.setFieldsValue({ clientId: "", clientSecret: "" });
    } catch (error) {
      if (error instanceof Error) presentMutationError(error, (t) => message.error(t));
    } finally {
      setSavingClient(false);
    }
  };

  const authorize = async (service: "GSC" | "GA4") => {
    try {
      const result = await seoApi.googleAuthUrl({ query: { service } });
      if (!result?.url) throw new Error("未获取到授权地址");
      window.open(result.url, "_blank", "noopener,noreferrer,width=600,height=720");
      message.info("已打开 Google 授权窗口；授权完成后回到本页点「同步」拉取数据");
    } catch (error) {
      if (error instanceof Error) presentMutationError(error, (t) => message.error(t));
    }
  };

  return (
    <Panel
      title="Google 同步（Search Console / GA4）"
      titleExtra={settings?.configured ? <Tag color="green">客户端已配置</Tag> : <Tag>未配置</Tag>}
    >
      <Notice variant="info">
        双轨任选其一：① 填好 OAuth 客户端后点「浏览器授权」，在弹窗里同意，回调会自动写入 refresh_token；
        ② 已有 refresh_token 可直接粘贴。GSC 用于查询/点击/排名与「触手可及」词，GA4 用于会话/转化。
        凭据只落密文，不回显。
      </Notice>
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>第一次接入？按下面步骤拿 OAuth 客户端与资源</div>
        <ol style={GUIDE_LIST_STYLE}>
          <li>
            打开 <ExternalLink href={GOOGLE_CLOUD_CREDENTIALS}>console.cloud.google.com</ExternalLink> 建好或选中一个项目，
            再到 <ExternalLink href={GOOGLE_CLOUD_LIBRARY}>API 库</ExternalLink> 分别启用 <b>Search Console API</b> 与{" "}
            <b>Google Analytics Data API</b>。
          </li>
          <li>
            回到 <ExternalLink href={GOOGLE_CLOUD_CREDENTIALS}>「凭据」</ExternalLink> 页创建「OAuth 客户端 ID」，应用类型选{" "}
            <b>Web 应用</b>，把下方「回调地址」原样加进「已获授权的重定向 URI」，拿到客户端 ID 与密钥后填到下面保存。
          </li>
          <li>
            准备数据源：Search Console 在 <ExternalLink href={SEARCH_CONSOLE_HOME}>search.google.com/search-console</ExternalLink>{" "}
            添加并验证站点（填 <span className="mono">sc-domain:域名</span> 或 <span className="mono">https://域名/</span>）；
            GA4 在 <ExternalLink href={GA4_HOME}>analytics.google.com</ExternalLink> 建好媒体资源并记下数字 ID（填 propertyId）。
          </li>
          <li>在对应资源的卡片上点「浏览器授权」并在弹窗里同意（回调会自动写入 refresh_token）；已有 refresh_token 的也可直接粘贴连接。</li>
        </ol>
      </div>
      <Form form={clientForm} layout="vertical" style={{ marginTop: 12 }}>
        <div className="form-2col">
          <Form.Item name="clientId" label="OAuth 客户端 ID" rules={[{ required: !settings?.configured, message: "请填写客户端 ID" }]}>
            <Input placeholder={settings?.clientIdMasked || "Google Cloud Console → 凭据 → OAuth 2.0 客户端 ID"} autoComplete="off" />
          </Form.Item>
          <Form.Item name="clientSecret" label="OAuth 客户端密钥" rules={[{ required: !settings?.configured, message: "请填写客户端密钥" }]}>
            <Input.Password placeholder={settings?.configured ? "已配置（留空则不修改）" : "OAuth 客户端密钥"} autoComplete="new-password" />
          </Form.Item>
        </div>
        {settings?.callbackUrl ? (
          <p className="text-12 muted">回调地址（需加进 Google 客户端的「已获授权的重定向 URI」）：<span className="mono">{settings.callbackUrl}</span></p>
        ) : null}
        <Button type="primary" loading={savingClient} onClick={() => void saveClient()}>保存客户端</Button>
      </Form>

      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
        {(settings?.connections ?? []).map((conn) => (
          <GoogleConnectionCard
            key={conn.service}
            service={conn.service as "GSC" | "GA4"}
            connected={conn.connected}
            propertyId={conn.propertyId}
            propertyName={conn.propertyName}
            lastSyncAt={conn.lastSyncAt}
            syncError={conn.syncError}
            clientReady={Boolean(settings?.configured)}
            onAuthorize={() => void authorize(conn.service as "GSC" | "GA4")}
          />
        ))}
      </div>
    </Panel>
  );
}

function GoogleConnectionCard({
  service,
  connected,
  propertyId,
  propertyName,
  lastSyncAt,
  syncError,
  clientReady,
  onAuthorize,
}: {
  service: "GSC" | "GA4";
  connected: boolean;
  propertyId: string;
  propertyName: string;
  lastSyncAt: string | null;
  syncError: string;
  clientReady: boolean;
  onAuthorize: () => void;
}) {
  const { message } = App.useApp();
  const actions = useSeoActions();
  const [form] = Form.useForm<{ propertyId: string; propertyName: string; refreshToken: string }>();
  const [busy, setBusy] = useState("");
  const label = service === "GSC" ? "Search Console" : "GA4 分析";

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
    } catch (error) {
      if (error instanceof Error) presentMutationError(error, (t) => message.error(t));
    } finally {
      setBusy("");
    }
  };

  const paste = async () => {
    const values = await form.validateFields();
    await run("paste", async () => {
      await actions.connectGoogle.mutateAsync({
        body: {
          service,
          propertyId: values.propertyId ?? "",
          propertyName: values.propertyName ?? "",
          refreshToken: values.refreshToken ?? "",
        },
      });
      message.success(`${label} 已连接`);
      form.setFieldsValue({ refreshToken: "" });
    });
  };

  return (
    <div style={{ border: "1px solid var(--line, #f0f0f0)", borderRadius: 10, padding: 14 }}>
      <Space style={{ marginBottom: 8 }}>
        <strong>{label}</strong>
        {connected ? <Tag color="green">已连接</Tag> : <Tag>未连接</Tag>}
        {propertyName ? <span className="text-12 muted">{propertyName}</span> : null}
      </Space>
      {connected ? (
        <p className="text-12 muted" style={{ margin: "0 0 8px" }}>
          资源：<span className="mono">{propertyId || "（默认匹配站点域名）"}</span>
          {lastSyncAt ? ` · 最近同步：${fmtDateTime(lastSyncAt)}` : " · 尚未同步"}
        </p>
      ) : null}
      {syncError ? <Notice variant="warn">同步报错：{syncError}</Notice> : null}
      <Space wrap style={{ marginBottom: 10 }}>
        <Button disabled={!clientReady} onClick={onAuthorize}>浏览器授权</Button>
        <Button
          loading={busy === "sync"}
          disabled={!connected}
          onClick={() => void run("sync", async () => {
            const r = await actions.syncGoogle.mutateAsync({ body: { service } });
            message.success(r?.message || `${label} 同步完成`);
          })}
        >
          同步
        </Button>
        {connected ? (
          <Button
            danger
            loading={busy === "disconnect"}
            onClick={() => void run("disconnect", async () => {
              await actions.disconnectGoogle.mutateAsync({ body: { service } });
              message.success(`${label} 已断开`);
            })}
          >
            断开
          </Button>
        ) : null}
      </Space>
      <Form form={form} layout="vertical" initialValues={{ propertyId, propertyName }}>
        <div className="form-2col">
          <Form.Item name="propertyId" label={service === "GSC" ? "资源（sc-domain:example.com 或 https://example.com/）" : "GA4 媒体资源 ID（如 123456789）"}>
            <Input placeholder={service === "GSC" ? "sc-domain:example.com" : "GA4 propertyId"} />
          </Form.Item>
          <Form.Item name="propertyName" label="资源备注名">
            <Input placeholder="便于识别的名称" />
          </Form.Item>
        </div>
        <Form.Item name="refreshToken" label="refresh_token（双轨之二：直接粘贴）" rules={[{ required: !connected, message: "粘贴 refresh_token，或改用上方「浏览器授权」" }]}>
          <Input.Password placeholder={connected ? "已配置（留空则不修改）" : "已有的 Google refresh_token"} autoComplete="new-password" />
        </Form.Item>
        <Button loading={busy === "paste"} onClick={() => void paste()}>{connected ? "更新连接" : "粘贴连接"}</Button>
      </Form>
    </div>
  );
}

/** 数据源设置抽屉：低频配置不进页签，集中在右上角抽屉里。 */
export function SeoSettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Drawer open={open} onClose={onClose} title="SEO 数据源设置（我的账号 / 本组织）" size="min(900px, 96vw)">
      <div style={{ display: "grid", gap: 16 }}>
        <DataForSeoPanel />
        <GooglePanel />
      </div>
    </Drawer>
  );
}