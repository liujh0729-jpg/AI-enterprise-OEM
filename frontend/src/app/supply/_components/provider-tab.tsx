"use client";

import { BankOutlined, ShopOutlined } from "@ant-design/icons";
import { Table } from "antd";
import { useMemo } from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState, Panel } from "@/components/ui/panel";
import { ServicePackagesPanel } from "@/components/service-packages";
import {
  providerLabel,
  type SupplyContract,
  type SupplyProduct,
  type SupplyService,
  type SupplyStation,
} from "./common";

/**
 * 服务商页签（企业侧第一个栏目）：以服务商为主体展示签约对象，
 * 一家服务商下有多个实体服务站——商品订货与服务预约都按服务站发起。
 */
export function ProviderTab({
  rows,
  products,
  services,
  contracts,
  loading,
}: {
  rows: SupplyStation[];
  products: SupplyProduct[];
  services: SupplyService[];
  contracts: SupplyContract[];
  loading: boolean;
}) {
  /** 服务站按服务商归集；已签约但尚未建站的服务商同样列出（避免签了约看不到对方）。 */
  const groups = useMemo(() => {
    const byProvider = new Map<string, SupplyStation[]>();
    for (const station of rows) {
      const key = station.providerUserId || "";
      byProvider.set(key, [...(byProvider.get(key) || []), station]);
    }
    for (const contract of contracts) {
      if (contract.serviceType !== "SUPPLY_NETWORK") continue;
      if (contract.status !== "ACTIVE") continue;
      const key = contract.providerUserId || "";
      if (key && !byProvider.has(key)) byProvider.set(key, []);
    }
    return [...byProvider.entries()].map(([providerUserId, stations]) => ({
      providerUserId,
      name: providerLabel(
        contracts,
        providerUserId,
        "",
        "",
      ),
      stations,
    }));
  }, [rows, contracts]);

  const stationProductCount = (stationId: number) =>
    products.filter((item) =>
      (item.stations || []).some((link) => link.stationId === stationId),
    ).length;
  const stationServiceCount = (stationId: number) =>
    services.filter((item) => item.stationId === stationId).length;

  return (
    <>
      <Panel
        title="签约服务商（供销网络）"
        titleBadge={`${groups.length} 家服务商 · ${rows.length} 个服务站`}
      >
      <div className="text-12 muted" style={{ marginBottom: 12 }}>
        企业与服务商签约后，即可在下方看到该服务商及其旗下服务站；
        「商品供应」按服务站发起订货、「服务采购」按服务站发起预约，
        报价由服务商或其承办职员完成。
      </div>
      {groups.length ? (
        groups.map((group) => (
          <div className="provider-block" key={group.providerUserId}>
            <div className="ent-sub-title">
              <span><BankOutlined aria-hidden /> {group.name}</span>
              <span className="badge badge-green">已签约供销服务</span>
              <span className="text-12 muted">
                {group.stations.length} 个服务站 ·{" "}
                {
                  products.filter(
                    (item) => item.providerUserId === group.providerUserId,
                  ).length
                }{" "}
                个在售商品 ·{" "}
                {
                  services.filter(
                    (item) => item.providerUserId === group.providerUserId,
                  ).length
                }{" "}
                个在售服务
              </span>
            </div>
            <div className="table-wrap">
              <Table<SupplyStation>
                rowKey="id"
                loading={loading}
                pagination={false}
                size="small"
                dataSource={group.stations}
                locale={{
                  emptyText: (
                    <EmptyState
                      icon={<ShopOutlined aria-hidden />}
                      text="该服务商尚未创建服务站，可先联系服务商建站后再下单。"
                    />
                  ),
                }}
                columns={[
                  {
                    title: "服务站名称",
                    dataIndex: "name",
                    width: 200,
                    render: (value: string) => (
                      <span style={{ fontWeight: 600 }}>{value || "—"}</span>
                    ),
                  },
                  {
                    title: "地区",
                    dataIndex: "region",
                    width: 130,
                    render: (value: string) => value || "—",
                  },
                  {
                    title: "详细地址",
                    dataIndex: "address",
                    ellipsis: true,
                    render: (value: string) => value || "—",
                  },
                  {
                    title: "联系人",
                    dataIndex: "contactName",
                    width: 100,
                    render: (value: string) => value || "—",
                  },
                  {
                    title: "联系电话",
                    dataIndex: "contactPhone",
                    width: 130,
                    render: (value: string) => value || "—",
                  },
                  {
                    title: "在售商品",
                    width: 90,
                    render: (_, row) => (
                      <span className="text-12">{stationProductCount(row.id)}</span>
                    ),
                  },
                  {
                    title: "在售服务",
                    width: 90,
                    render: (_, row) => (
                      <span className="text-12">{stationServiceCount(row.id)}</span>
                    ),
                  },
                  {
                    title: "状态",
                    dataIndex: "status",
                    width: 90,
                    render: (value: string) => (
                      <StatusBadge domain="supplyListing" status={value} />
                    ),
                  },
                  {
                    title: "备注",
                    dataIndex: "remark",
                    ellipsis: true,
                    render: (value: string) => value || "—",
                  },
                ]}
              />
            </div>
          </div>
        ))
      ) : (
        <EmptyState
          icon={<BankOutlined aria-hidden />}
          text="暂无签约的供销服务商：请先在「签约管理」选择供销服务并完成与服务商的签约。"
          action={<Link href="/contracts">立即去签约</Link>}
        />
      )}
      </Panel>
      <ServicePackagesPanel serviceType="SUPPLY_NETWORK" />
    </>
  );
}
