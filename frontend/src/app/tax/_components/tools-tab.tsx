"use client";

import { SolutionOutlined } from "@ant-design/icons";
import { Panel } from "@/components/ui/panel";
import { TAX_PLANS, TAX_SERVICES } from "./common";
import { InvoiceRequestPanel } from "./invoice-request";
import { TaxCalcTools, TaxRecordsPanel } from "./tools-extra";
import {
  AnnualInspectionPanel,
  LedgerConsultPanel,
  ReportToolsPanel,
} from "./tax-tools-more";

/**
 * 企业视角：财税工具（demo tax.js toolsPanel）——服务包参考价格 + 自助工具矩阵。
 * 财税服务商资源库与「我的财税服务商」在「🏦 财税服务商」页签与首页面板（providers-tab.tsx），
 * 本页签不再罗列服务商清单。
 */
export function ToolsTab({
  enterprise,
  taxpayerType,
}: {
  enterprise: Record<string, unknown> | null;
  taxpayerType: string;
}) {
  const enterpriseId = Number(enterprise?.id || 0);
  // 纳税人性质以企业档案为准（历史数据 SMALL 归一到 SMALL_SCALE）
  const mineType =
    taxpayerType === "SMALL_SCALE" || taxpayerType === "SMALL"
      ? "SMALL"
      : "GENERAL";

  return (
    <>
      <Panel
        title={<><SolutionOutlined aria-hidden /> 财税服务包 · 参考价格</>}
        titleBadge="服务由已备案财税服务商提供，参考价格最终以签约约定为准"
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {TAX_PLANS.map((plan) => (
            <div
              key={plan.type}
              className="panel"
              style={{ margin: 0, padding: "14px 16px" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 700 }}>{plan.name}</span>
                {plan.type === mineType ? (
                  <span className="badge badge-green">您的适用档</span>
                ) : null}
              </div>
              <div style={{ marginTop: 8 }}>
                <span style={{ fontSize: 15 }}>¥</span>
                <span style={{ fontSize: 26, fontWeight: 700 }}>
                  {plan.price}
                </span>
                <span className="text-12">/年</span>
              </div>
              <div className="text-12 muted" style={{ marginTop: 6 }}>
                参考价格 · 含以下全部 13 项服务
              </div>
            </div>
          ))}
        </div>
        <div className="text-12 muted" style={{ margin: "14px 0 8px" }}>
          服务内容包括（13 项）
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {TAX_SERVICES.map((item, index) => (
            <span key={item} className="badge badge-gray">
              {index + 1}. {item}
            </span>
          ))}
        </div>
        {!taxpayerType ? (
          <p className="text-12 muted" style={{ marginTop: 10, marginBottom: 0 }}>
            提示：同步企业档案后，系统将自动标注您适用的价格档位。
          </p>
        ) : null}
      </Panel>

      <InvoiceRequestPanel mode="ENTERPRISE" enterpriseId={enterpriseId} />
      <TaxCalcTools enterprise={enterprise} />
      <ReportToolsPanel enterpriseId={enterpriseId} />
      <AnnualInspectionPanel enterprise={enterprise} />
      <LedgerConsultPanel />
      <TaxRecordsPanel />
    </>
  );
}
