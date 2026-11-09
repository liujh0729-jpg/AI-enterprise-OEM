"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { gapsApi } from "@/api/gaps";
import { useSession } from "@/lib/session";

/**
 * B3#30 使用埋点：仅当后台开启埋点且当前身份可用时，按路由上报一次 page_view。
 * 辅助链路：设置或上报失败静默跳过，不影响页面。
 */
export function UsageTracker() {
  const pathname = usePathname();
  const { me } = useSession();
  const [enabled, setEnabled] = useState(false);
  const lastRoute = useRef("");

  useEffect(() => {
    if (!me?.userId) {
      setEnabled(false);
      return;
    }
    let alive = true;
    void gapsApi
      .usageSettings()
      .then((settings) => {
        if (alive) setEnabled(Boolean(settings?.enabled));
      })
      .catch(() => {
        if (alive) setEnabled(false);
      });
    return () => {
      alive = false;
    };
  }, [me?.userId]);

  useEffect(() => {
    if (!enabled || !pathname || lastRoute.current === pathname) return;
    lastRoute.current = pathname;
    void gapsApi
      .trackUsage({ body: { event: "page_view", route: pathname, targetType: "", targetId: "", metadata: {} } })
      .catch(() => undefined);
  }, [enabled, pathname]);

  return null;
}
