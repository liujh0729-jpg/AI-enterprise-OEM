"use client";
import { useState } from "react";
import {adminApi} from '@/api/admin';

import { Panel, PanelTabs } from "@/components/ui/panel";
import { PermissionNotice, useAdminData } from "./common";
import { OssSettingsPanel } from "./oss-settings-panel";
import { StorageLedgerPanel } from "./storage-ledger-panel";
import { AipddPlatformKeyPanel } from "./aipdd-platform-key-panel";
import { SiteSettingsTab } from "./site-settings-tab";
import { HomepageSettingsTab } from "./homepage-settings-tab";
import { AccountLoginPanel } from "./account-login-panel";

/** 平台级参数：只读展示，过滤掉 `*_updated_at` 辅助键。 */
function PlatformParamsPanel() {
  const { data } = useAdminData('settings',signal=>adminApi.settings({},{signal}));
  const entries = Object.entries(data || {}).filter(
    ([key]) => !key.endsWith("_updated_at"),
  );

  return (
    <Panel
      title="平台级参数"
      titleBadge={<span className="text-12 muted">平台级参数</span>}
    >
      {entries.length ? (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          {entries.map(([key, value]) => (
            <div key={key} className="text-12" style={{ marginBottom: 6 }}>
              <span className="mono">{key}</span>
              <span className="muted"> · </span>
              <span>{String(value) || "—"}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-12 muted" style={{ marginTop: 10 }}>
          暂无平台级参数。
        </div>
      )}
    </Panel>
  );
}

/**
 * 系统设置（平台级）：文件存储（OSS）/ AIPDD 平台 Key / 账号与登录 / 平台级参数 / 站点设置 / 首页设置
 * 六个板块以页签切换。文件存储、AIPDD 平台 Key 与账号凭据加密入库、只回显掩码，未保存时回退部署环境变量
 * （backend/src/oss/oss-settings.service.ts、backend/src/account/aipdd-key.service.ts）；
 * 站点设置保存后前端读取即时生效（设计 §7 站点设置）；账号与登录保存后登录/注册页即时生效。
 * 企享云报税 API Key 与税号匹配已统一收口到「财税管理」，不在本页。
 */
export function SettingsTab() {
  const { denied } = useAdminData('settings',signal=>adminApi.settings({},{signal}));
  const [tab, setTab] = useState("oss");

  return (
    <>
      <PermissionNotice denied={denied} />

      <PanelTabs
        value={tab}
        onChange={setTab}
        items={[
          {
            key: "oss",
            label: "文件存储（OSS）",
            children: (
              <div style={{ display: "grid", gap: 16 }}>
                <OssSettingsPanel />
                <StorageLedgerPanel />
              </div>
            ),
          },
          { key: "aipdd", label: "AIPDD 平台 Key", children: <AipddPlatformKeyPanel /> },
          { key: "account", label: "账号与登录", children: <AccountLoginPanel /> },
          { key: "params", label: "平台级参数", children: <PlatformParamsPanel /> },
          { key: "site", label: "站点设置", children: <SiteSettingsTab /> },
          { key: "homepage", label: "首页设置", children: <HomepageSettingsTab /> },
        ]}
      />
    </>
  );
}
