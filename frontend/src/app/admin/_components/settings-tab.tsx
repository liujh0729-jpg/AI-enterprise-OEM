"use client";
import { Tabs } from "antd";
import {adminApi} from '@/api/admin';

import { Panel } from "@/components/ui/panel";
import { PermissionNotice, useAdminData } from "./common";
import { OssSettingsPanel } from "./oss-settings-panel";
import { AipddPlatformKeyPanel } from "./aipdd-platform-key-panel";
import { SiteSettingsTab } from "./site-settings-tab";

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
 * 系统设置（平台级）：文件存储（OSS）/ AIPDD 平台 Key / 平台级参数 / 站点设置
 * 四个板块以页签切换。文件存储与 AIPDD 平台 Key 加密入库、只回显掩码，未保存时回退部署环境变量
 * （backend/src/oss/oss-settings.service.ts、backend/src/account/aipdd-key.service.ts）；
 * 站点设置保存后前端读取即时生效（设计 §7 站点设置）。
 * 企享云报税 API Key 与税号匹配已统一收口到「财税管理」，不在本页。
 */
export function SettingsTab() {
  const { denied } = useAdminData('settings',signal=>adminApi.settings({},{signal}));

  return (
    <>
      <PermissionNotice denied={denied} />

      <Tabs
        items={[
          { key: "oss", label: "文件存储（OSS）", children: <OssSettingsPanel /> },
          { key: "aipdd", label: "AIPDD 平台 Key", children: <AipddPlatformKeyPanel /> },
          { key: "params", label: "平台级参数", children: <PlatformParamsPanel /> },
          { key: "site", label: "站点设置", children: <SiteSettingsTab /> },
        ]}
      />
    </>
  );
}
