"use client";

import {
  AimOutlined,
  AlertOutlined,
  FundOutlined,
  ProjectOutlined,
  RadarChartOutlined,
  RiseOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { useRouter } from "next/navigation";
import type { GrowthCockpit } from "@enterprise/contracts";
import { EmptyState, Panel, StatCard, StatGrid } from "@/components/ui/panel";

const amount = (value: string | number) => {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return "—";
  if (Math.abs(num) >= 10000) return `¥${(num / 10000).toFixed(1)}万`;
  return `¥${num.toFixed(0)}`;
};

const percent = (value: number) => `${Number(value || 0).toFixed(1)}%`;

/** 首页增长驾驶舱：目标 / 销售 / 交付 / 获客 / 客服五条链路一屏，点击卡片进入对应模块。 */
export function GrowthCockpitPanel({ data }: { data: GrowthCockpit }) {
  const router = useRouter();
  const funnelMax = Math.max(1, ...data.funnel.map((item) => item.value));
  const trendMax = Math.max(1, ...data.trend.map((item) => Number(item.paidAmount || 0)));
  const alerts = data.alerts.slice(0, 6);

  return (
    <div style={{ display: "grid", gap: 20, marginBottom: 22 }}>
      <StatGrid>
        <StatCard
          label="目标进度"
          value={percent(data.goals.avgProgress)}
          hint={`${data.goals.objectives} 个目标 · ${data.goals.atRisk} 个低于 40%`}
          icon={<RadarChartOutlined aria-hidden />}
          onClick={() => router.push("/okr")}
        />
        <StatCard
          label="回款"
          value={amount(data.sales.paidAmount)}
          hint={`合同 ${amount(data.sales.contractAmount)} · 回款率 ${percent(data.sales.collectionRate)}`}
          icon={<FundOutlined aria-hidden />}
          onClick={() => router.push("/crm")}
        />
        <StatCard
          label="交付中项目"
          value={data.delivery.activeProjects}
          hint={`${data.delivery.openTasks} 个任务在办 · ${data.delivery.overdueTasks} 个超期`}
          icon={<ProjectOutlined aria-hidden />}
          onClick={() => router.push("/project?tab=projects")}
        />
        <StatCard
          label="获客转化"
          value={data.acquisition.converted}
          hint={`${data.acquisition.leads} 条线索 · 已触达 ${data.acquisition.contacted} · 已回复 ${data.acquisition.replied}`}
          icon={<AimOutlined aria-hidden />}
          onClick={() => router.push("/marketing-tools")}
        />
        <StatCard
          label="客服转线索"
          value={data.service.crmConverted}
          hint={`${data.service.conversations} 个会话 · 已结束 ${data.service.closed}`}
          icon={<TeamOutlined aria-hidden />}
          onClick={() => router.push("/service-desk")}
        />
      </StatGrid>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 20 }}>
        <Panel
          title="增长漏斗"
          titleExtra={<span className="muted text-12">{data.days} 天窗口</span>}
        >
          {data.funnel.length ? (
            <div style={{ display: "grid", gap: 12 }}>
              {data.funnel.map((item) => (
                <div key={item.key} style={{ display: "grid", gap: 5 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                    <span>{item.label}</span>
                    <b>{item.value}</b>
                  </div>
                  <div
                    style={{
                      height: 8,
                      borderRadius: 999,
                      background: "var(--border, #f0f0f0)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.max(2, (item.value / funnelMax) * 100)}%`,
                        height: "100%",
                        borderRadius: 999,
                        background: "var(--primary, #4f6ef7)",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState text="暂无漏斗数据" />
          )}
        </Panel>

        <Panel
          title="回款趋势"
          extra={
            <span className="muted text-12">
              <RiseOutlined aria-hidden /> 近 {data.trend.length} 个月
            </span>
          }
        >
          {data.trend.length ? (
            <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 170 }}>
              {data.trend.map((item) => (
                <div
                  key={item.month}
                  style={{ flex: 1, display: "grid", gap: 6, justifyItems: "center" }}
                  title={`${item.month}：${amount(item.paidAmount)}`}
                >
                  <span className="text-12 muted">{amount(item.paidAmount)}</span>
                  <div
                    style={{
                      width: "100%",
                      maxWidth: 42,
                      height: Math.max(4, (Number(item.paidAmount || 0) / trendMax) * 110),
                      borderRadius: 8,
                      background: "var(--primary, #4f6ef7)",
                      opacity: 0.85,
                    }}
                  />
                  <span className="text-12 muted">{item.month.slice(5)}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState text="暂无回款数据" />
          )}
        </Panel>
      </div>

      <Panel
        title="风险提醒"
        extra={<span className="muted text-12">按优先级给出可执行动作</span>}
      >
        {alerts.length ? (
          <div style={{ display: "grid", gap: 8 }}>
            {alerts.map((item, index) => (
              <div
                key={`${item.title}-${index}`}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  padding: "10px 12px",
                  borderRadius: 10,
                  background:
                    item.level === "WARNING"
                      ? "var(--warn-soft, #fff7e6)"
                      : "var(--primary-soft, #f0f5ff)",
                }}
              >
                <span
                  style={{
                    color: item.level === "WARNING" ? "#d46b08" : "var(--primary-strong, #2f54eb)",
                    marginTop: 2,
                  }}
                >
                  <AlertOutlined aria-hidden />
                </span>
                <div style={{ minWidth: 0 }}>
                  <b style={{ fontSize: 13 }}>{item.title}</b>
                  <div className="muted text-12">{item.detail}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState text="当前没有需要处理的增长风险" />
        )}
      </Panel>
    </div>
  );
}

export type { GrowthCockpit };
