"use client";

import { GiftOutlined } from "@ant-design/icons";
import { Button, Table } from "antd";
import { useRouter } from "next/navigation";
import { EmptyState, PageHero, Panel } from "@/components/ui/panel";
import type { ServicePackageOrder, ServicePackageOrderItem } from "@/api/service-packages";
import { servicePackagesApi } from "@/api/service-packages";
import { fmtTime } from "@/lib/datetime";
import { FULFILLMENT_STATUS, ITEM_STATE, boardLabel, deliveryCodeLabel } from "@/lib/service-packages";
import { useBusinessQuery } from "@/query/business";

function fmtPoints(value: number | null | undefined) {
  if (value === null || value === undefined) return "--";
  return Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 4 });
}

function statusBadge(status: string) {
  const hit = FULFILLMENT_STATUS[status];
  return <span className={`badge ${hit?.cls || "badge-gray"}`}>{hit?.label || status}</span>;
}

function itemStateBadge(state: string) {
  const hit = ITEM_STATE[state];
  return <span className={`badge ${hit?.cls || "badge-gray"}`}>{hit?.label || state}</span>;
}

/**
 * 「我的套餐」（独立菜单 /my-packages）：企业已购官方服务套餐与逐项交付进度。
 * 交付明细状态实时读取关联签约（待匹配 → 签约待确认 → 已生效），跳「签约管理」跟踪。
 */
export default function MyPackagesPage() {
  const router = useRouter();
  const query = useBusinessQuery("service-packages", "mine", {}, (signal) =>
    servicePackagesApi.mine({ signal }),
  );
  const rows = query.data ?? [];

  return (
    <>
      <PageHero
        title="我的套餐"
        desc="已购官方服务套餐与交付进度：套餐由平台整合优质服务商完成交付，平台主持企业与服务商签约；签约须服务商确认后才生效，进度可在「签约管理」跟踪。"
      />
      <Panel
        title={<><GiftOutlined aria-hidden /> 套餐订单</>}
        titleBadge={`${rows.length} 个订单 · 交付状态实时读取签约进度`}
      >
        <div className="table-wrap">
          <Table<ServicePackageOrder>
            rowKey="id"
            loading={query.isPending}
            dataSource={rows}
            size="middle"
            pagination={false}
            locale={{ emptyText: <EmptyState text="暂无已购套餐，可在各业务板块的「官方服务套餐」中积分购买" /> }}
            expandable={{
              rowExpandable: (row) => row.items.length > 0,
              expandedRowRender: (row) => (
                <div className="table-wrap">
                  <Table<ServicePackageOrderItem>
                    rowKey="id"
                    size="small"
                    pagination={false}
                    dataSource={row.items}
                    columns={[
                      {
                        title: "交付项",
                        width: 180,
                        render: (_, item) => item.label || deliveryCodeLabel(item.code),
                      },
                      {
                        title: "承办服务商",
                        width: 220,
                        render: (_, item) =>
                          item.providerName || item.providerOrg || (
                            <span className="text-12 muted">待匹配</span>
                          ),
                      },
                      {
                        title: "交付进度",
                        width: 140,
                        render: (_, item) => itemStateBadge(item.state),
                      },
                      {
                        title: "签约单",
                        width: 160,
                        render: (_, item) =>
                          item.contractNo ? (
                            <span className="mono text-12">{item.contractNo}</span>
                          ) : (
                            "—"
                          ),
                      },
                      {
                        title: "等待",
                        width: 100,
                        render: (_, item) =>
                          item.pendingHours > 0 && item.state !== "ACTIVE"
                            ? `${Math.round(item.pendingHours)} 小时`
                            : "—",
                      },
                      {
                        title: "操作",
                        width: 140,
                        render: () => (
                          <Button size="small" onClick={() => router.push("/contracts")}>
                            查看签约
                          </Button>
                        ),
                      },
                    ]}
                  />
                </div>
              ),
            }}
            columns={[
              {
                title: "订单号",
                width: 190,
                render: (_, row) => <span className="mono text-12">{row.orderNo}</span>,
              },
              {
                title: "套餐",
                render: (_, row) => (
                  <div>
                    <div style={{ fontWeight: 600 }}>{row.packageName}</div>
                    <div className="text-12 muted">{boardLabel(row.serviceType)}</div>
                  </div>
                ),
              },
              {
                title: "所属企业",
                width: 200,
                render: (_, row) => row.enterpriseName || `#${row.enterpriseId}`,
              },
              {
                title: "积分",
                width: 160,
                render: (_, row) => (
                  <div>
                    <div>{fmtPoints(row.pointsAmount)}</div>
                    {row.refundedPointsAmount > 0 ? (
                      <div className="text-12 muted">
                        已退 {fmtPoints(row.refundedPointsAmount)} · 可退{" "}
                        {fmtPoints(row.refundableAmount)}
                      </div>
                    ) : null}
                  </div>
                ),
              },
              {
                title: "状态",
                width: 170,
                render: (_, row) =>
                  row.status === "REFUNDED" ? (
                    <span className="badge badge-red">已全额退款</span>
                  ) : row.status === "PARTIAL_REFUNDED" ? (
                    <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {statusBadge(row.fulfillmentStatus)}
                      <span className="badge badge-orange">部分退款</span>
                    </span>
                  ) : (
                    statusBadge(row.fulfillmentStatus)
                  ),
              },
              {
                title: "购买时间",
                width: 160,
                render: (_, row) => <span className="text-12 muted">{fmtTime(row.createdAt)}</span>,
              },
              {
                title: "操作",
                width: 140,
                render: () => (
                  <Button size="small" onClick={() => router.push("/contracts")}>
                    跟踪交付
                  </Button>
                ),
              },
            ]}
          />
        </div>
      </Panel>
    </>
  );
}
