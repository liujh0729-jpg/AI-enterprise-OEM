"use client";

import { BankOutlined, FileTextOutlined, UnorderedListOutlined } from "@ant-design/icons";
import { Button, ConfigProvider, Spin } from "antd";
import { useRef, useState } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { useSession } from "@/lib/session";
import { MobileOrderCreate } from "../_components/order-create";
import { MobileOrderMine } from "../_components/order-my";

/**
 * 供销订货 H5（微信服务号菜单入口，`/m/order`）：
 * 未登录由 `src/proxy.ts` 挡到 `/login?next=/m/order`，登录后原路返回本页直接可用。
 */
export default function MobileOrderPage() {
  const { me, loading, switchIdentity } = useSession();
  const [view, setView] = useState<"create" | "mine">("create");
  /** 切到「我的订货单」后保持挂载，来回切换不丢购物车与列表状态。 */
  const [mineVisited, setMineVisited] = useState(false);
  /** 提交成功后切到「我的订货单」并触发刷新。 */
  const [mineToken, setMineToken] = useState(0);
  const [switching, setSwitching] = useState(false);
  const scrollRef = useRef<HTMLElement | null>(null);

  const roles = me?.roles || [];
  const isEnterprise = me?.currentIdentity === "ENTERPRISE_USER";
  const canSwitch = (me?.identities || []).includes("ENTERPRISE_USER");
  const roleText = roles.includes("ENTERPRISE_USER")
    ? "当前身份不是用户"
    : "当前账号没有用户身份";

  const switchToEnterprise = async () => {
    setSwitching(true);
    try {
      await switchIdentity("ENTERPRISE_USER");
    } finally {
      setSwitching(false);
    }
  };

  const goView = (next: "create" | "mine") => {
    if (next === "mine") setMineVisited(true);
    setView(next);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  return (
    <ConfigProvider button={{ autoInsertSpace: false }}>
      <div className="m-app">
        <header className="m-head">
          <div className="m-head-row">
            <BrandLogo size={34} />
            <div>
              <div className="m-head-title">供销订货</div>
              <div className="m-head-sub">
                {me?.enterprise?.name
                  ? String(me.enterprise.name)
                  : me?.displayName || "用户订货"}
              </div>
            </div>
          </div>
        </header>

        {loading ? (
          <div className="m-loading">
            <Spin />
          </div>
        ) : !isEnterprise ? (
          <div className="m-scroll">
            <div className="m-empty">
              <div className="m-empty-icon"><BankOutlined aria-hidden /></div>
              <div className="m-empty-title">{roleText}</div>
              <p className="m-empty-text">
                {canSwitch
                  ? "供销订货以用户身份发起：切换身份后即可按签约服务商下单。"
                  : "供销订货以用户身份发起：需要与服务站所属服务商存在生效中的「供销服务」签约。"}
              </p>
              {canSwitch ? (
                <Button
                  type="primary"
                  loading={switching}
                  onClick={() => void switchToEnterprise()}
                >
                  切换为用户身份
                </Button>
              ) : (
                <Button type="primary" href="/identity">
                  去完善用户信息
                </Button>
              )}
            </div>
          </div>
        ) : (
          <>
            <main className="m-scroll" ref={scrollRef}>
              <div className="m-slot" hidden={view !== "create"}>
                <MobileOrderCreate
                  onSubmitted={() => {
                    setMineToken((token) => token + 1);
                    goView("mine");
                  }}
                  onOpenMine={() => goView("mine")}
                />
              </div>
              {mineVisited ? (
                <div className="m-slot" hidden={view !== "mine"}>
                  <MobileOrderMine
                    refreshToken={mineToken}
                    onGoCreate={() => goView("create")}
                  />
                </div>
              ) : null}
            </main>

            <nav className="m-tabbar">
              <button
                type="button"
                className={`m-tab ${view === "create" ? "is-active" : ""}`}
                onClick={() => goView("create")}
              >
                <span className="m-tab-icon"><FileTextOutlined aria-hidden /></span>
                <span>下单</span>
              </button>
              <button
                type="button"
                className={`m-tab ${view === "mine" ? "is-active" : ""}`}
                onClick={() => goView("mine")}
              >
                <span className="m-tab-icon"><UnorderedListOutlined aria-hidden /></span>
                <span>我的订货单</span>
              </button>
            </nav>
          </>
        )}
      </div>
    </ConfigProvider>
  );
}
