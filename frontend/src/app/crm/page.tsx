"use client";

import { Button, ConfigProvider } from "antd";
import { useEffect, useState } from "react";
import { Notice, PageHero } from "@/components/ui/panel";
import { crmApi } from "@/api/crm";
import {
  CustomersTab,
  LeadsTab,
} from "./_components/crm-parties";
import {
  ContractsTab,
  OpportunitiesTab,
  OrdersTab,
  PaymentsTab,
  ProductsTab,
} from "./_components/crm-deals";
import {
  ApprovalsTab,
  ReportsTab,
  SettingsTab,
  WorkbenchTab,
} from "./_components/crm-ops";

const TABS = [
  { key: "workbench", label: "工作台" },
  { key: "leads", label: "线索" },
  { key: "customers", label: "客户" },
  { key: "opportunities", label: "商机" },
  { key: "contracts", label: "合同" },
  { key: "payments", label: "回款" },
  { key: "orders", label: "订单" },
  { key: "products", label: "产品" },
  { key: "approvals", label: "审批中心" },
  { key: "reports", label: "报表" },
  { key: "settings", label: "设置" },
];

export default function CrmPage() {
  const [tab, setTab] = useState("workbench");
  const [customers, setCustomers] = useState<{ id: number; name: string }[]>([]);
  const [isMember, setIsMember] = useState<boolean | null>(null);
  const [workbench, setWorkbench] = useState<Awaited<ReturnType<typeof crmApi.workbench>> | null>(null);
  const [gateError, setGateError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const initial = query.get("tab");
    if (initial && TABS.some((item) => item.key === initial)) setTab(initial);
    setGateError("");
    void crmApi
      .workbench({ query: { range: "month" } })
      .then((data) => {
        setIsMember(Boolean(data?.isMember));
        setWorkbench(data);
      })
      .catch((error: unknown) => {
        setIsMember(null);
        setGateError((error as Error)?.message || "CRM 状态加载失败");
      });
    void crmApi
      .customers({ query: { page: 1, pageSize: 200, view: "all" } })
      .then((data) =>
        setCustomers(
          (data?.list || []).map((item) => ({ id: item.id, name: item.name })),
        ),
      )
      .catch(() => undefined);
  }, [reloadKey]);

  return (
    <ConfigProvider button={{ autoInsertSpace: false }}>
      <PageHero
        title="CRM"
        desc="账号级客户关系管理：线索 → 客户 → 商机 → 销售合同 → 回款 → 订单。成员与权限复用本账号的「职员与代理人」，企业身份与服务商身份共用同一套人。"
        tabs={TABS}
        activeTab={tab}
        onTabChange={setTab}
      />

      {gateError ? (
        <Notice variant="error">
          {gateError} 加载失败，请稍后重试。
          <Button onClick={() => setReloadKey((key) => key + 1)}>重试</Button>
        </Notice>
      ) : null}
      {isMember === null && !gateError ? (
        <div className="panel">
          <div className="panel-body muted">正在加载 CRM…</div>
        </div>
      ) : null}

      {isMember === false && tab !== "workbench" ? (
        <div className="panel">
          <div className="panel-body muted">你还没有被加入本账号的 CRM，请联系负责人添加成员权限。</div>
        </div>
      ) : null}

      {isMember === true && tab === "workbench" ? <WorkbenchTab onGo={setTab} initial={workbench} /> : null}
      {isMember === true && tab === "leads" ? <LeadsTab customers={customers} /> : null}
      {isMember === true && tab === "customers" ? <CustomersTab customers={customers} /> : null}
      {isMember === true && tab === "opportunities" ? <OpportunitiesTab customers={customers} /> : null}
      {isMember === true && tab === "contracts" ? <ContractsTab customers={customers} /> : null}
      {isMember === true && tab === "payments" ? <PaymentsTab /> : null}
      {isMember === true && tab === "orders" ? <OrdersTab customers={customers} /> : null}
      {isMember === true && tab === "products" ? <ProductsTab /> : null}
      {isMember === true && tab === "approvals" ? <ApprovalsTab /> : null}
      {isMember === true && tab === "reports" ? <ReportsTab /> : null}
      {isMember === true && tab === "settings" ? <SettingsTab /> : null}
    </ConfigProvider>
  );
}