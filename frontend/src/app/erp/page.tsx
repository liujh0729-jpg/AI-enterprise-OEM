"use client";

import { ConfigProvider } from "antd";
import { useCallback, useEffect, useState } from "react";
import { erpApi } from "@/api/erp";
import { Notice, PageHero } from "@/components/ui/panel";
import { ErpCatalogTab } from "./_components/erp-catalog";
import { ErpFinanceTab } from "./_components/erp-finance";
import { ErpOverviewTab } from "./_components/erp-overview";
import { ErpPurchaseTab } from "./_components/erp-purchase";
import { ErpSettingsTab } from "./_components/erp-settings";
import { ErpStockTab } from "./_components/erp-stock";
import { erpError, type ErpOverview } from "./_components/erp-common";

const TABS = [
  { key: "overview", label: "概览" },
  { key: "catalog", label: "商品与主数据" },
  { key: "stock", label: "库存" },
  { key: "purchase", label: "采购" },
  { key: "finance", label: "应收应付" },
  { key: "settings", label: "税务与价格" },
];

/**
 * ERP 进销存（方案 §5.4）：商品/变体/仓库 → 库存流水与领用 → 采购与入库 → 应收应付与报销，
 * 组织键与 HRM 共用；AI 经营评估规则可复现，配置模型后叠加 LLM 建议。
 */
export default function ErpPage() {
  const [tab, setTab] = useState("overview");
  const [overview, setOverview] = useState<ErpOverview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const initial = query.get("tab");
    if (initial && TABS.some((item) => item.key === initial)) setTab(initial);
  }, []);

  const load = useCallback(async () => {
    try {
      setOverview(await erpApi.overview());
      setError("");
    } catch (err) {
      setError(erpError(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ConfigProvider button={{ autoInsertSpace: false }}>
      <PageHero
        title="ERP 进销存"
        desc="商品与变体、仓库与库存流水、领用审批、供应商与采购入库、应收应付与费用报销，配套税率与价格策略；AI 经营评估覆盖库存、采购、应收与现金流。"
        tabs={TABS}
        activeTab={tab}
        onTabChange={setTab}
      />

      {error ? <Notice variant="error">{error}</Notice> : null}

      {tab === "overview" && overview ? (
        <ErpOverviewTab overview={overview} reload={() => void load()} />
      ) : null}
      {tab === "overview" && !overview && !error ? (
        <div className="panel">
          <div className="panel-body muted">正在加载 ERP 总览…</div>
        </div>
      ) : null}
      {tab === "catalog" ? <ErpCatalogTab /> : null}
      {tab === "stock" ? <ErpStockTab /> : null}
      {tab === "purchase" ? <ErpPurchaseTab /> : null}
      {tab === "finance" ? <ErpFinanceTab /> : null}
      {tab === "settings" ? <ErpSettingsTab /> : null}
    </ConfigProvider>
  );
}
