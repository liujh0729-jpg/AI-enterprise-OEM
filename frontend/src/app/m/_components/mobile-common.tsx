"use client";

import { ArrowLeftOutlined } from "@ant-design/icons";
import { Button, ConfigProvider, Spin } from "antd";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { useSession } from "@/lib/session";

/** 微信内置浏览器：仅在该环境尝试网页授权静默登录。 */
function isWechatBrowser() {
  return typeof navigator !== "undefined" && /MicroMessenger/i.test(navigator.userAgent);
}

export function MobileShell({
  title,
  sub,
  backHref,
  children,
}: {
  title: string;
  sub?: string;
  backHref?: string;
  children: ReactNode;
}) {
  return (
    <ConfigProvider button={{ autoInsertSpace: false }}>
      <div className="m-app">
        <header className="m-head">
          <div className="m-head-row">
            {backHref ? (
              <Link href={backHref} className="m-head-back" aria-label="返回">
                <ArrowLeftOutlined />
              </Link>
            ) : (
              <span className="m-head-logo">
                <BrandLogo size={20} className="m-head-brand" />
              </span>
            )}
            <div style={{ minWidth: 0 }}>
              <div className="m-head-title">{title}</div>
              {sub ? <div className="m-head-sub">{sub}</div> : null}
            </div>
          </div>
        </header>
        <main className="m-scroll">{children}</main>
      </div>
    </ConfigProvider>
  );
}

/**
 * H5 登录门禁：会话 Cookie 有效时直接渲染。
 * 微信内优先走服务号网页授权（snsapi_base）静默登录；其他环境引导到 /login?next=当前页。
 * sessionStorage 记录一次尝试，避免授权失败后回跳形成循环。
 */
export function MobileAuthGate({ children }: { children: ReactNode }) {
  const { me, loading } = useSession();
  const pathname = usePathname() || "/m/inbox";
  const [wechat, setWechat] = useState(false);

  useEffect(() => {
    setWechat(isWechatBrowser());
  }, []);

  useEffect(() => {
    if (loading || me || !wechat) return;
    const key = `wechat-mp-oauth:${pathname}`;
    let tried = "";
    try {
      tried = sessionStorage.getItem(key) || "";
    } catch {
      return;
    }
    if (tried) return;
    try {
      sessionStorage.setItem(key, "1");
    } catch {
      return;
    }
    window.location.href = `/api/public/wechat-mp/oauth/start?next=${encodeURIComponent(pathname)}`;
  }, [loading, me, wechat, pathname]);

  if (loading) {
    return (
      <div className="m-loading">
        <Spin />
      </div>
    );
  }

  if (!me) {
    const loginHref = `/login?next=${encodeURIComponent(pathname)}`;
    const oauthHref = `/api/public/wechat-mp/oauth/start?next=${encodeURIComponent(pathname)}`;
    return (
      <div className="m-empty">
        <div className="m-empty-icon">🔐</div>
        <div className="m-empty-title">需要登录</div>
        <p className="m-empty-text">
          {wechat
            ? "正在尝试微信免登录；若未自动跳转，可点击下方按钮重新授权，或使用账号密码登录。"
            : "登录后即可查看并处理消息。登录成功会回到当前页面。"}
        </p>
        <div className="m-inline-actions">
          <Button type="primary" href={loginHref}>
            账号登录
          </Button>
          {wechat ? (
            <Button href={oauthHref}>微信免登录</Button>
          ) : null}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

/** 通知台面链接 → 手机可处理的 H5 路由；无对应页面时返回空串。 */
export function mobileTarget(link: string, entityType: string, entityId: string) {
  if (entityType === "my_task" && entityId) return `/m/task/${entityId}`;
  const oa = /^\/oa[^?]*\?(?:[^#]*&)?id=(\d+)/.exec(link);
  if (oa) return `/m/oa/${oa[1]}`;
  const service = /^\/service-desk\?(?:[^#]*&)?conversation=(\d+)/.exec(link);
  if (service) return `/m/service/${service[1]}`;
  return "";
}

export function fmtMobileTime(value: string) {
  if (!value) return "";
  return value.slice(5, 16).replace("T", " ");
}
