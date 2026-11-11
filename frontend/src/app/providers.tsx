"use client";

import { AntdRegistry } from "@ant-design/nextjs-registry";
import { App, ConfigProvider } from "antd";
import type { ReactNode } from "react";
import { QueryProvider } from "@/query/client";
import { SessionProvider } from "@/lib/session";
import { PersonalizationProvider } from "@/lib/personalization";
import { SiteBrandProvider } from "@/lib/site-brand";
import { I18nProvider, useI18n } from "@/lib/i18n/i18n";

const theme = {
  token: {
    colorPrimary: "#1677ff",
    colorInfo: "#1677ff",
    colorSuccess: "#52c41a",
    colorWarning: "#faad14",
    colorError: "#ff4d4f",
    colorBgLayout: "#f5f5f5",
    borderRadius: 6,
    fontFamily:
      "AlibabaSans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif",
  },
};

/** ConfigProvider 需要读当前语言，而语言又在 I18nProvider 里——中间层桥接一下。 */
function LocaleBridge({ children }: { children: ReactNode }) {
  const { antdLocale, dir } = useI18n();
  return (
    <ConfigProvider locale={antdLocale} direction={dir} theme={theme}>
      <App>
        <QueryProvider>
          <SessionProvider>
            <PersonalizationProvider>{children}</PersonalizationProvider>
          </SessionProvider>
        </QueryProvider>
      </App>
    </ConfigProvider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AntdRegistry>
      {/* 层级：站点配置 → 多语言 → antd locale/主题 → 会话；SiteBrand/I18n 不依赖 antd 上下文，放在 ConfigProvider 之上。 */}
      <SiteBrandProvider>
        <I18nProvider>
          <LocaleBridge>{children}</LocaleBridge>
        </I18nProvider>
      </SiteBrandProvider>
    </AntdRegistry>
  );
}
