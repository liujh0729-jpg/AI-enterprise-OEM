"use client";

import { CheckCircleOutlined, CloseCircleOutlined } from "@ant-design/icons";
import { Tag } from "antd";
import { EmptyState, Notice, Panel, StatCard, StatGrid } from "@/components/ui/panel";
import { useSeoOverview } from "@/query/seo";
import { fmtNum, fmtPct, fmtPos } from "./seo-common";

/** 概览：项目健康分、各模块计数、排名趋势、配置清单；卡片可点跳转对应视图。 */
export function SeoOverviewView({
  projectId,
  onNavigate,
}: {
  projectId: number;
  onNavigate: (view: string) => void;
}) {
  const query = useSeoOverview(projectId);
  const data = query.data;

  if (query.isError) return <Notice variant="warn">{query.error?.message}</Notice>;
  if (!data) return <EmptyState text="正在加载概览…" />;

  const trend = data.rankTrend ?? [];
  const latest = trend.length ? trend[trend.length - 1].avgPosition : null;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <StatGrid>
        <StatCard
          label="站点健康分"
          value={data.healthScore === null ? "—" : `${data.healthScore}`}
          hint="最近一次体检"
          onClick={() => onNavigate("audit")}
        />
        <StatCard label="关键词" value={fmtNum(data.keywordCount)} onClick={() => onNavigate("keywords")} />
        <StatCard label="排名跟踪器" value={fmtNum(data.trackerCount)} onClick={() => onNavigate("rank")} />
        <StatCard label="体检次数" value={fmtNum(data.auditCount)} onClick={() => onNavigate("audit")} />
        <StatCard
          label="外链总数"
          value={data.backlinkTotal === null ? "未配置" : fmtNum(data.backlinkTotal)}
          hint={data.referringDomains === null ? undefined : `引用域 ${fmtNum(data.referringDomains)}`}
          onClick={() => onNavigate("backlinks")}
        />
        <StatCard
          label="GEO 提及率"
          value={data.geoMentionRate === null ? "—" : fmtPct(data.geoMentionRate)}
          hint="来自 GEO 工作台"
        />
        <StatCard
          label="GA4 会话"
          value={data.ga4Sessions === null ? "未连接" : fmtNum(data.ga4Sessions)}
          onClick={() => onNavigate("reports")}
        />
        <StatCard label="最新平均排名" value={fmtPos(latest)} onClick={() => onNavigate("rank")} />
      </StatGrid>

      <Panel title="配置清单">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          <Tag color={data.providerConnected ? "green" : "default"}>
            {data.providerConnected ? "DataForSEO 已连接" : "DataForSEO 未配置"}
          </Tag>
          <Tag color={data.googleConnected ? "green" : "default"}>
            {data.googleConnected ? "Google 已连接" : "Google 未连接"}
          </Tag>
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          {(data.setup ?? []).map((item) => (
            <div key={item.key} className="text-12" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {item.done ? (
                <CheckCircleOutlined style={{ color: "var(--success, #52c41a)" }} aria-hidden />
              ) : (
                <CloseCircleOutlined style={{ color: "var(--danger, #ff4d4f)" }} aria-hidden />
              )}
              <span style={{ color: item.done ? undefined : "var(--text-2, #666)" }}>{item.label}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="排名趋势（平均位置，越小越好）">
        {trend.length === 0 ? (
          <EmptyState text="暂无排名快照：在「排名跟踪」里建跟踪器并跑一次检查后，这里会显示趋势" />
        ) : (
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 120 }}>
            {trend.slice(-30).map((point) => {
              const pos = point.avgPosition;
              const height = pos === null ? 4 : Math.max(6, 110 - Math.min(pos, 100));
              return (
                <div key={point.date} style={{ flex: 1, display: "grid", justifyItems: "center", gap: 4 }}>
                  <div
                    title={`${point.date} · ${fmtPos(pos)}`}
                    style={{
                      width: "100%",
                      maxWidth: 22,
                      height,
                      borderRadius: 4,
                      background: pos === null ? "var(--line, #eee)" : "var(--primary, #1677ff)",
                      opacity: pos === null ? 0.5 : 0.85,
                    }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}