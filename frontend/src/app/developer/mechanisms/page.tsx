"use client";

import { ConfigProvider } from "antd";
import { useEffect, useState } from "react";
import { mechanismsApi } from "@/api/mechanisms";
import { Notice, PageHero, Panel, StatCard, StatGrid } from "@/components/ui/panel";
import { PAGE_META } from "@/config/routes";
import { ImportExportPanel } from "./_components/import-export-panel";
import { ReportRulesPanel } from "./_components/report-rules-panel";
import { ShareIdentityPanel } from "./_components/share-identity-panel";
import { SyncPanel } from "./_components/sync-panel";
import { WebhookPanel } from "./_components/webhook-panel";
import { mechError, type MechanismOverview } from "./_components/mechanisms-common";

const TABS = [
  { key: "overview", label: "概览" },
  { key: "webhook", label: "Webhook" },
  { key: "import-export", label: "导入导出" },
  { key: "reports-rules", label: "报表与规则" },
  { key: "shares-oidc", label: "分享与身份源" },
  { key: "sync", label: "消息同步" },
];

/**
 * 开放集成 → 平台机制：§5.8 横切能力（事件 Outbox/Webhook、导入导出中心、
 * 报表目录、规则引擎、公开分享、OIDC 身份源、附件共享策略、飞书/企微同步）。
 */
export default function MechanismsPage() {
  const [tab, setTab] = useState("overview");
  const [overview, setOverview] = useState<MechanismOverview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void mechanismsApi
      .overview()
      .then((data) => setOverview(data))
      .catch((err) => setError(mechError(err)));
  }, []);

  return (
    <ConfigProvider button={{ autoInsertSpace: false }}>
      <PageHero
        title="平台机制"
        desc={PAGE_META["/developer/mechanisms"]?.description}
        tabs={TABS}
        activeTab={tab}
        onTabChange={setTab}
      />

      {error ? <Notice variant="error">{error}</Notice> : null}

      {tab === "overview" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <StatGrid>
            <StatCard
              label="Webhook 订阅"
              value={overview?.webhooks ?? 0}
              hint={`Outbox 待投递 ${overview?.outboxPending ?? 0} · 失败 ${overview?.outboxFailed ?? 0}`}
            />
            <StatCard
              label="导入 / 导出"
              value={`${overview?.importJobs ?? 0} / ${overview?.exportJobs ?? 0}`}
              hint="累计任务数"
            />
            <StatCard label="报表目录" value={overview?.reports ?? 0} />
            <StatCard label="规则" value={overview?.rules ?? 0} />
            <StatCard label="公开分享" value={overview?.shares ?? 0} />
            <StatCard label="身份源" value={overview?.oidcProviders ?? 0} hint="OIDC 单点登录" />
          </StatGrid>

          <Panel title="这套机制怎么用">
            <div style={{ display: "grid", gap: 8 }}>
              <div>
                <strong>事件驱动</strong>：业务动作（任务创建、订单支付、库存偏低、应收逾期等）先写 Outbox，
                再按 Webhook 订阅投递；规则引擎在同一事件上按条件执行通知、洞察或建任务。
              </div>
              <div>
                <strong>批量数据</strong>：导入用 CSV + 字段映射，支持试运行与保存映射方案；导出按模块生成
                CSV/JSON，完成后直接下载。
              </div>
              <div>
                <strong>对外输出</strong>：报表目录统一管理 BI 报表入口；公开分享把报表、项目、看板、文档
                以只读链接发给外部；附件分享策略约束有效期与密码。
              </div>
              <div>
                <strong>统一身份与消息</strong>：OIDC 身份源支持单点登录与自动开户；飞书 / 企微同步把
                通讯录、考勤与消息接到本系统的人。
              </div>
            </div>
          </Panel>
        </div>
      ) : null}

      {tab === "webhook" ? <WebhookPanel /> : null}
      {tab === "import-export" ? <ImportExportPanel /> : null}
      {tab === "reports-rules" ? <ReportRulesPanel /> : null}
      {tab === "shares-oidc" ? <ShareIdentityPanel /> : null}
      {tab === "sync" ? <SyncPanel /> : null}
    </ConfigProvider>
  );
}
