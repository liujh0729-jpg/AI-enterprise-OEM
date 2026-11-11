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
import { Button, Segmented, Space, Table, Tag } from "antd";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { GrowthCockpit } from "@enterprise/contracts";
import { growthApi } from "@/api/growth";
import { EmptyState, Panel, StatCard, StatGrid } from "@/components/ui/panel";
import { FulfillmentAdvisorPanel } from "./fulfillment-advisor-panel";

type Fulfillment = Awaited<ReturnType<typeof growthApi.fulfillment>>;
type RiskReport = Awaited<ReturnType<typeof growthApi.risks>>;
type FulfillmentRow = NonNullable<Fulfillment>["list"][number];
type RiskRow = NonNullable<RiskReport>["list"][number];

const SEVERITY_COLOR: Record<string, string> = {
  HIGH: "red",
  MEDIUM: "orange",
  LOW: "default",
};

const GAP_COLOR: Record<string, string> = {
  SIGNED: "gold",
  DELIVERED: "blue",
  ACCEPTED: "geekblue",
  SETTLED: "orange",
  DONE: "green",
};

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

  const [fulfillment, setFulfillment] = useState<Fulfillment | null>(null);
  const [fulfillmentError, setFulfillmentError] = useState("");
  const [gapFilter, setGapFilter] = useState("");
  const [risks, setRisks] = useState<RiskReport | null>(null);
  const [riskError, setRiskError] = useState("");
  const [riskKind, setRiskKind] = useState("");
  const [scanning, setScanning] = useState(false);

  const loadFulfillment = useCallback(async () => {
    try {
      setFulfillment(await growthApi.fulfillment({ query: { days: 90 } }));
      setFulfillmentError("");
    } catch (error) {
      setFulfillmentError((error as Error).message || "履约视图加载失败");
    }
  }, []);

  const loadRisks = useCallback(async (kind: string) => {
    try {
      setRisks(await growthApi.risks({ query: kind ? { kind } : {} }));
      setRiskError("");
    } catch (error) {
      setRiskError((error as Error).message || "经营异常加载失败");
    }
  }, []);

  useEffect(() => {
    void loadFulfillment();
    void loadRisks("");
  }, [loadFulfillment, loadRisks]);

  const scan = async () => {
    try {
      setScanning(true);
      const result = await growthApi.scanRisks({ body: {} });
      await loadRisks(riskKind);
      window.alert(
        `本次扫描发现 ${result?.total ?? 0} 条异常，已按负责人派发责任任务。`,
      );
    } catch (error) {
      window.alert((error as Error).message || "扫描失败");
    } finally {
      setScanning(false);
    }
  };

  const fulfillmentRows = (fulfillment?.list || []).filter(
    (row) => !gapFilter || row.gap === gapFilter,
  );
  const gapOptions = [
    { value: "", label: `全部 ${fulfillment?.list.length ?? 0}` },
    ...["SIGNED", "DELIVERED", "ACCEPTED", "SETTLED", "DONE"].map((gap) => ({
      value: gap,
      label: `${
        fulfillment?.list.find((row) => row.gap === gap)?.gapLabel || gap
      } ${(fulfillment?.list || []).filter((row) => row.gap === gap).length}`,
    })),
  ];

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
        title="合同履约四态"
        titleExtra={
          <span className="muted text-12">
            签约完成 / 服务已交付 / 客户验收通过 / 财务结算完成；只读聚合，不新增状态机
          </span>
        }
        extra={
          <Segmented
            size="small"
            value={gapFilter}
            onChange={(value) => setGapFilter(String(value))}
            options={gapOptions}
          />
        }
      >
        {fulfillmentError ? (
          <EmptyState text={`履约视图暂不可用：${fulfillmentError}`} />
        ) : (
          <>
            <StatGrid>
              <StatCard
                label="签约完成"
                value={fulfillment?.summary.signed ?? 0}
                hint={`签约金额 ${amount(fulfillment?.summary.signedAmount ?? "0")} / 共 ${fulfillment?.summary.total ?? 0} 份合同`}
              />
              <StatCard
                label="服务已交付"
                value={fulfillment?.summary.delivered ?? 0}
                hint="关联项目已进入待验收或已结项"
              />
              <StatCard
                label="客户验收通过"
                value={fulfillment?.summary.accepted ?? 0}
                hint="关联项目已结项"
              />
              <StatCard
                label="财务结算完成"
                value={fulfillment?.summary.settled ?? 0}
                hint={`已回款 ${amount(fulfillment?.summary.receivedAmount ?? "0")}`}
              />
            </StatGrid>
            <Table
              rowKey="contractId"
              size="small"
              dataSource={fulfillmentRows}
              locale={{ emptyText: "窗口内还没有签约完成的合同" }}
              pagination={{ pageSize: 8, hideOnSinglePage: true }}
              columns={[
                {
                  title: "合同",
                  dataIndex: "contractName",
                  render: (value: string, row: FulfillmentRow) => (
                    <div>
                      <div>{value}</div>
                      <div className="muted text-12">
                        {row.customerName} · {row.signedAt.slice(0, 10)}
                      </div>
                    </div>
                  ),
                },
                {
                  title: "金额",
                  dataIndex: "amount",
                  width: 110,
                  render: (value: string) => amount(value),
                },
                {
                  title: "回款",
                  width: 140,
                  render: (_: unknown, row: FulfillmentRow) =>
                    `${amount(row.receivedAmount)} / ${amount(row.receivableAmount)}`,
                },
                {
                  title: "四态",
                  width: 260,
                  render: (_: unknown, row: FulfillmentRow) => (
                    <Space size={4} wrap>
                      {(
                        [
                          ["签约", row.signed],
                          ["交付", row.delivered],
                          ["验收", row.accepted],
                          ["结算", row.settled],
                        ] as const
                      ).map(([label, hit]) => (
                        <Tag key={label} color={hit ? "green" : "default"}>
                          {label}
                        </Tag>
                      ))}
                    </Space>
                  ),
                },
                {
                  title: "卡点",
                  dataIndex: "gapLabel",
                  width: 100,
                  render: (value: string, row: FulfillmentRow) => (
                    <Tag color={GAP_COLOR[row.gap] || "default"}>{value}</Tag>
                  ),
                },
              ]}
            />
          </>
        )}
      </Panel>

      <FulfillmentAdvisorPanel />

      <Panel
        title="经营异常"
        titleExtra={
          <span className="muted text-12">
            应收 / 应付逾期、项目超预算、库存低于补货点、任务超期；扫描会给负责人派责任任务，异常未消除前任务不能关闭
          </span>
        }
        extra={
          <Space size={8}>
            <Segmented
              size="small"
              value={riskKind}
              onChange={(value) => {
                const next = String(value);
                setRiskKind(next);
                void loadRisks(next);
              }}
              options={[
                { value: "", label: `全部 ${risks?.total ?? 0}` },
                ...(risks?.byKind || []).map((item) => ({
                  value: item.kind,
                  label: `${item.kindLabel} ${item.count}`,
                })),
              ]}
            />
            <Button loading={scanning} onClick={() => void scan()}>
              扫描并派单
            </Button>
          </Space>
        }
      >
        {riskError ? (
          <EmptyState text={`经营异常暂不可用：${riskError}`} />
        ) : risks?.list.length ? (
          <Table
            rowKey={(row: RiskRow) => `${row.kind}:${row.entityKey}`}
            size="small"
            dataSource={risks.list}
            pagination={{ pageSize: 8, hideOnSinglePage: true }}
            columns={[
              {
                title: "级别",
                dataIndex: "severity",
                width: 80,
                render: (value: string) => (
                  <Tag color={SEVERITY_COLOR[value] || "default"}>
                    {value === "HIGH" ? "高" : value === "MEDIUM" ? "中" : "低"}
                  </Tag>
                ),
              },
              { title: "类型", dataIndex: "kindLabel", width: 120 },
              {
                title: "异常",
                dataIndex: "title",
                render: (value: string, row: RiskRow) => (
                  <div>
                    <div>{value}</div>
                    <div className="muted text-12">{row.detail}</div>
                  </div>
                ),
              },
              {
                title: "金额",
                dataIndex: "amount",
                width: 110,
                render: (value: string) => (value ? amount(value) : "—"),
              },
              { title: "负责人", dataIndex: "ownerName", width: 120 },
              {
                title: "处理",
                width: 90,
                render: (_: unknown, row: RiskRow) => (
                  <Button type="link" size="small" onClick={() => router.push(row.link)}>
                    去处理
                  </Button>
                ),
              },
            ]}
          />
        ) : (
          <EmptyState text="当前没有经营异常，或异常已全部处置" />
        )}
      </Panel>

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
