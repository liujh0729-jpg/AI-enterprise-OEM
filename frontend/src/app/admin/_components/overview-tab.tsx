"use client";
import {adminApi} from '@/api/admin';

import type { ReactNode } from "react";

import {
  AuditOutlined,
  BankOutlined,
  DollarOutlined,
  FileProtectOutlined,
  FileTextOutlined,
  GlobalOutlined,
  InboxOutlined,
  RobotOutlined,
  SolutionOutlined,
  TagOutlined,
  TeamOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { Button } from "antd";
import { useRouter } from "next/navigation";
import { moneyCny } from "@/lib/money";
import { ADMIN_PATH_PREFIX } from "@/config/routes";
import {
  EmptyState,
  Notice,
  Panel,
  StatCard,
  StatGrid,
} from "@/components/ui/panel";
import {
  PermissionNotice,
  SERVICE_DISTRIBUTION_LABEL,
  type AdminStats,
  useAdminData,
} from "./common";

/** 总览（demo admin.js：renderOverview）——平台数据总览 + 待办审核 + 服务商服务类型分布。 */
export function OverviewTab({
  onGoSection,
}: {
  onGoSection: (key: string) => void;
}) {
  const { data: stats, loading, denied } = useAdminData('stats',signal=>adminApi.stats({},{signal}));
  const router = useRouter();

  /** 后端返回的口径原样展示，未返回的口径保持「—」占位（不臆造数据）。 */
  const num = (key: keyof AdminStats) => {
    const value = stats?.[key];
    if (typeof value === "number") return String(value);
    if (typeof value === "string" && value) return value;
    return "—";
  };

  const cards: {
    icon: ReactNode;
    label: string;
    value: string;
    hint?: string;
    onClick?: () => void;
  }[] = [
    { icon: <TeamOutlined aria-hidden />, label: "注册用户", value: num("users"), hint: "本系统已识别账号", onClick: () => router.push(`${ADMIN_PATH_PREFIX}/users`) },
    { icon: <BankOutlined aria-hidden />, label: "用户（企业主体）", value: num("enterprises"), onClick: () => router.push(`${ADMIN_PATH_PREFIX}/enterprises`) },
    { icon: <SolutionOutlined aria-hidden />, label: "服务商", value: num("providers"), hint: "已通过备案", onClick: () => onGoSection("providers") },
    { icon: <FileProtectOutlined aria-hidden />, label: "生效签约", value: num("activeContracts"), onClick: () => router.push(`${ADMIN_PATH_PREFIX}/contracts?status=ACTIVE`) },
    { icon: <FileTextOutlined aria-hidden />, label: "申报单", value: num("declarations") },
    {
      icon: <DollarOutlined aria-hidden />,
      label: "累计申报税额",
      value: moneyCny(stats?.taxAmountTotal),
      hint: "申报单税额合计",
    },
    { icon: <GlobalOutlined aria-hidden />, label: "出海服务单", value: num("overseas") },
    { icon: <InboxOutlined aria-hidden />, label: "物流订单", value: num("logistics") },
    { icon: <RobotOutlined aria-hidden />, label: "IT服务单", value: num("smartOrders") },
    { icon: <AuditOutlined aria-hidden />, label: "法律服务商/律师", value: num("lawyers"), onClick: () => onGoSection("providers") },
    { icon: <UnorderedListOutlined aria-hidden />, label: "法律需求", value: num("legalRequests") },
    { icon: <TagOutlined aria-hidden />, label: "知产代理机构", value: num("ipAgencies"), onClick: () => onGoSection("providers") },
    { icon: <FileProtectOutlined aria-hidden />, label: "知产需求", value: num("ipRequests") },
    { icon: <TeamOutlined aria-hidden />, label: "灵活用工服务商", value: num("flexProviders"), onClick: () => onGoSection("providers") },
    { icon: <SolutionOutlined aria-hidden />, label: "用工需求", value: num("flexOrders") },
  ];

  const pendingProvider = stats?.pendingProvider ?? 0;

  /** 待办块（demo .admin-todo：徽标 + 标题 + 说明 + 「前往审核」）。 */
  const todo = (
    badgeClass: string,
    badgeText: string,
    title: string,
    desc: string,
    target?: string,
  ) => (
    <div className="todo-card">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className={`badge ${badgeClass}`}>{badgeText}</span>
        <b>{title}</b>
      </div>
      <div className="text-12 muted">{desc}</div>
      {target ? (
        <Button
          type="primary"
          style={{ marginTop: 10 }}
          onClick={() => onGoSection(target)}
        >
          前往审核
        </Button>
      ) : null}
    </div>
  );

  return (
    <>
      <PermissionNotice denied={denied} />

      {loading ? <Notice variant="info">数据加载中…</Notice> : null}

      <Panel title="平台数据总览">
        <StatGrid>
          {cards.map((card) => (
            <StatCard
              key={card.label}
              icon={card.icon}
              label={card.label}
              value={card.value}
              hint={card.hint}
              onClick={card.onClick}
            />
          ))}
        </StatGrid>
      </Panel>

      <Panel title="待办审核">
        <div className="todo-grid">
          {todo(
            "badge-orange",
            `${pendingProvider} 条待处理`,
            "服务商备案待审核",
            "备案通过后用户将自动获得服务商角色（SERVICE_PROVIDER），可与签约企业开展财税/出海/小微服务商/法律/知识产权/灵活用工服务。",
            "provider-applications",
          )}
          {todo(
            "badge-blue",
            "免审核",
            "用户信息提交即生效",
            "用户在「身份与资质」提交用户信息后立即生效并自动获得用户身份（ENTERPRISE_USER，主体类型可选企业 / 个体工商户 / 个人），无需平台审核；签约由用户发起、服务商确认。个人主体板块页面照常可看，只有财税与出海的签约 / 申报 / 账套 / 发布需求四类办理需企业与个体工商户主体。",
          )}
        </div>
      </Panel>

      {stats?.servicesByType ? (
        <Panel
          title="服务商服务类型分布"
          extra={
            <Button onClick={() => onGoSection("providers")}>
              服务商管理
            </Button>
          }
        >
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {Object.entries(stats.servicesByType).map(([type, count]) => (
              <div
                key={type}
                onClick={() => onGoSection("providers")}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onGoSection("providers");
                  }
                }}
                style={{
                  minWidth: 130,
                  textAlign: "center",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: "14px 16px",
                  cursor: "pointer",
                  transition: "border-color 0.2s, box-shadow 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--primary)";
                  e.currentTarget.style.boxShadow =
                    "0 2px 8px rgba(0,0,0,0.08)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--border)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    color: "var(--primary)",
                  }}
                >
                  {`${count} 家`}
                </div>
                <div className="text-12 muted">
                  {SERVICE_DISTRIBUTION_LABEL[type] || type}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      ) : denied ? (
        <Panel title="服务商服务类型分布">
          <EmptyState
            icon={<SolutionOutlined aria-hidden />}
            text="需要平台管理员权限，暂无服务商服务类型分布数据"
          />
        </Panel>
      ) : null}
    </>
  );
}
