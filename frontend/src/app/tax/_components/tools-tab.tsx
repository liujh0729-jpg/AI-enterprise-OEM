"use client";

import { ServicePackagesPanel } from "@/components/service-packages";
import { InvoiceRequestPanel } from "./invoice-request";
import { TaxCalcTools, TaxRecordsPanel } from "./tools-extra";
import {
  AnnualInspectionPanel,
  LedgerConsultPanel,
  ReportToolsPanel,
} from "./tax-tools-more";

/**
 * 企业视角：财税工具（demo tax.js toolsPanel）——官方财税服务包（积分直购）+ 自助工具矩阵。
 * 服务包目录由平台后台「服务套餐」按板块 TAX_FINANCE 维护：人民币价 + 官方汇率积分价，
 * 按企业纳税人档标记「您的适用档」，购买后由平台主持企业与优质财税服务商签约交付。
 * 财税服务商资源库与「我的财税服务商」在「🏦 财税服务商」页签与首页面板（providers-tab.tsx）。
 */
export function ToolsTab({
  enterprise,
  taxpayerType,
}: {
  enterprise: Record<string, unknown> | null;
  taxpayerType: string;
}) {
  const enterpriseId = Number(enterprise?.id || 0);

  return (
    <>
      <ServicePackagesPanel
        serviceType="TAX_FINANCE"
        title="财税服务包 · 参考价格"
        badge="按纳税人类型匹配适用档；服务由已备案财税服务商承办，平台主持签约交付"
        taxpayerType={taxpayerType}
      />

      <InvoiceRequestPanel mode="ENTERPRISE" enterpriseId={enterpriseId} />
      <TaxCalcTools enterprise={enterprise} />
      <ReportToolsPanel enterpriseId={enterpriseId} />
      <AnnualInspectionPanel enterprise={enterprise} />
      <LedgerConsultPanel />
      <TaxRecordsPanel />
    </>
  );
}
