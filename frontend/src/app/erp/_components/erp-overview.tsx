"use client";

import { Button, Select, Tag } from "antd";
import { useEffect, useState } from "react";
import { erpApi } from "@/api/erp";
import { Notice, Panel, StatCard, StatGrid } from "@/components/ui/panel";
import { erpError, money, type ErpInsight, type ErpOverview } from "./erp-common";

const KINDS = [
  { value: "inventory", label: "库存与补货" },
  { value: "purchase", label: "采购节奏" },
  { value: "receivable", label: "应收风险" },
  { value: "cashflow", label: "现金流" },
];

export function ErpOverviewTab({
  overview,
  reload,
}: {
  overview: ErpOverview;
  reload: () => void;
}) {
  const [kind, setKind] = useState("inventory");
  const [insight, setInsight] = useState<ErpInsight | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setInsight(null);
  }, [kind]);

  const run = async () => {
    setBusy(true);
    try {
      setInsight(await erpApi.aiInsight({ body: { kind: kind as "inventory", horizonDays: 90 } }));
      setError("");
    } catch (err) {
      setError(erpError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <StatGrid>
        <StatCard label="商品数" value={overview.products} />
        <StatCard label="仓库数" value={overview.warehouses} />
        <StatCard label="库存货值" value={money(overview.stockValue)} />
        <StatCard label="低库存预警" value={overview.lowStock} />
        <StatCard label="待处理采购" value={overview.pendingPurchase} />
        <StatCard label="应收未收" value={money(overview.receivableOpen)} />
        <StatCard label="应付未付" value={money(overview.payableOpen)} />
        <StatCard label="逾期应收" value={money(overview.overdueReceivable)} />
        <StatCard label="本月采购" value={money(overview.monthPurchase)} />
        <StatCard label="本月销售" value={money(overview.monthSales)} />
      </StatGrid>

      <Panel
        title="AI 经营评估"
        extra={
          <div style={{ display: "flex", gap: 8 }}>
            <Select value={kind} onChange={setKind} options={KINDS} style={{ width: 150 }} />
            <Button type="primary" loading={busy} onClick={() => void run()}>
              运行评估
            </Button>
          </div>
        }
      >
        {error ? <Notice variant="error">{error}</Notice> : null}
        {!insight ? (
          <span className="muted">
            选择评估方向后运行：规则式结果可复现，配置模型后叠加 LLM 建议；结果同时记录在 AI 洞察台账。
          </span>
        ) : (
          <>
            <p style={{ marginTop: 0 }}>{insight.summary}</p>
            <div className="muted text-12" style={{ marginBottom: 8 }}>
              模式：{insight.mode === "llm" ? "模型 + 规则" : "规则"} · 生成于 {insight.generatedAt}
            </div>
            {insight.findings.map((item, index) => (
              <div key={`${item.title}-${index}`} style={{ padding: "6px 0", borderTop: "1px dashed var(--border, #eee)" }}>
                <Tag color={item.level === "HIGH" ? "red" : item.level === "WARN" ? "gold" : "blue"}>
                  {item.title}
                </Tag>
                <span>{item.detail}</span>
              </div>
            ))}
            <div style={{ marginTop: 8 }}>
              <strong>建议：</strong>
              {insight.suggestions.length ? insight.suggestions.join("；") : "暂无"}
            </div>
            <div className="muted text-12" style={{ marginTop: 6 }}>
              {Object.entries(insight.metrics)
                .map(([key, value]) => `${key}=${value}`)
                .join(" · ")}
            </div>
          </>
        )}
      </Panel>

      <div style={{ marginTop: 12 }}>
        <Button onClick={reload}>刷新总览</Button>
      </div>
    </>
  );
}
