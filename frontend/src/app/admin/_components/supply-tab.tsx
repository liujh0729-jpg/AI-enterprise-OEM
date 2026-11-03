"use client";
import { supplyApi } from "@/api/supply";
import { adminApi } from "@/api/admin";

import {
  BankOutlined,
  CalendarOutlined,
  FileTextOutlined,
  InboxOutlined,
  ShopOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import { useMemo, useState } from "react";
import { Select, Table } from "antd";
import { demandPagination } from "@/components/demand-columns";
import { StatusBadge } from "@/components/status-badge";
import {
  EmptyState,
  Notice,
  Panel,
  StatCard,
  StatGrid,
} from "@/components/ui/panel";
import { moneyCny } from "@/lib/money";
import { statusOptions } from "@/lib/status";
import { PermissionNotice, fmtDate, fmtTime, useAdminData } from "./common";

/** GET /enterprise/supply/admin/overview 行（订货单，decorate 后带 staffName）。 */
type SupplyOrderRow = {
  id: number;
  orderNo: string;
  enterpriseName: string;
  providerUserId: string;
  staffUserId: string;
  staffName?: string;
  stationId: number;
  stationName: string;
  expectedDate: string;
  status: string;
  productAmount: string | number;
  feeAmount: string | number;
  totalAmount: string | number;
  updatedAt?: string;
  createdAt: string;
};

/** GET /enterprise/supply/admin/overview 行（服务预约单）。 */
type SupplyBookingRow = {
  id: number;
  bookingNo: string;
  enterpriseName: string;
  providerUserId: string;
  staffUserId: string;
  staffName?: string;
  stationId: number;
  stationName: string;
  serviceName: string;
  planDate: string;
  status: string;
  baseAmount: string | number;
  feeAmount: string | number;
  totalAmount: string | number;
  updatedAt?: string;
  createdAt: string;
};

/** 站点统计（snake_case：后端监管接口口径）。 */
type StationStatRow = {
  station_id: number;
  station_name: string;
  provider_user_id: string;
  region: string;
  status: string;
  order_count: number;
  booking_count: number;
  product_count: number;
};

/** 服务商统计（snake_case：后端监管接口口径；与「服务商」卡同源＝有服务站的服务商）。 */
type ProviderStatRow = {
  provider_user_id: string;
  station_count: number;
  order_count: number;
  booking_count: number;
  product_count: number;
  service_count: number;
};

const STATUS_OPTIONS = statusOptions("supply");

/**
 * 供销网络监管（平台管理员）——全网服务站 / 商品 / 服务与订货单、预约单单据总览。
 * 只读：报价由服务商或其指派职员完成，平台侧不介入单据流转。
 * 后端：GET /enterprise/supply/admin/overview?provider=&stationId=&status=。
 */
export function SupplyTab() {
  const [provider, setProvider] = useState("");
  const [stationId, setStationId] = useState("");
  const [status, setStatus] = useState("");
  const [orderPage, setOrderPage] = useState(1);
  const [bookingPage, setBookingPage] = useState(1);

  const { data, loading, denied } = useAdminData(
    "supply-overview",
    (signal) =>
      supplyApi.adminOverview(
        { query: { provider, stationId, status, summariesOnly: "1" } },
        { signal },
      ),
    { provider, stationId, status },
  );
  const orders = useAdminData(
    "supply-orders",
    (signal) =>
      supplyApi.orderPage(
        {
          query: { provider, stationId, status, page: orderPage, pageSize: 20 },
        },
        { signal },
      ),
    { provider, stationId, status, page: orderPage },
  );
  const bookings = useAdminData(
    "supply-bookings",
    (signal) =>
      supplyApi.bookingPage(
        {
          query: {
            provider,
            stationId,
            status,
            page: bookingPage,
            pageSize: 20,
          },
        },
        { signal },
      ),
    { provider, stationId, status, page: bookingPage },
  );
  const contracts = useAdminData("contracts", (signal) =>
    adminApi.contracts({}, { signal }),
  );
  const providers = useAdminData("providers", (signal) =>
    adminApi.providers({}, { signal }),
  );

  /** 服务商机构名：优先供销签约，其次备案机构名，最后回退账号 ID。 */
  const providerName = useMemo(() => {
    const byContract = new Map<string, string>();
    for (const item of contracts.data ?? []) {
      if (item.providerUserId && item.providerOrg) {
        byContract.set(item.providerUserId, item.providerOrg);
      }
    }
    const byApplication = new Map<string, string>();
    for (const item of providers.data ?? []) {
      const name = item.orgName || item.owner_name;
      if (item.userId && name) byApplication.set(item.userId, name);
    }
    return (userId: string) =>
      userId
        ? byContract.get(userId) || byApplication.get(userId) || userId
        : "—";
  }, [contracts.data, providers.data]);

  const stationStats = useMemo(() => data?.station_stats ?? [], [data]);
  const providerStats = useMemo(() => data?.provider_stats ?? [], [data]);

  const providerOptions = useMemo(() => {
    const ids = [...new Set(stationStats.map((item) => item.provider_user_id))];
    return ids.map((id) => ({ value: id, label: providerName(id) }));
  }, [stationStats, providerName]);

  const stationOptions = useMemo(
    () =>
      stationStats
        .filter((item) => !provider || item.provider_user_id === provider)
        .map((item) => ({
          value: String(item.station_id),
          label: item.station_name,
        })),
    [stationStats, provider],
  );

  const totals = data?.totals;

  const amountCell = (row: {
    totalAmount: string | number;
    feeAmount: string | number;
  }) => (
    <div>
      <div style={{ fontWeight: 600 }}>{moneyCny(row.totalAmount)}</div>
      <div className="text-12 muted">{`含其他费用 ${moneyCny(row.feeAmount)}`}</div>
    </div>
  );

  return (
    <>
      <PermissionNotice denied={denied || orders.denied || bookings.denied} />

      <Notice variant="info">
        平台可查看全网服务商 /
        服务站、在售商品与服务，以及全部订货单、预约单；单据报价与履约由服务商或其指派职员完成，平台侧只读监管。
      </Notice>

      {loading ? <Notice variant="info">数据加载中…</Notice> : null}

      <Panel title="供销网络总览">
        <StatGrid>
          <StatCard
            icon={<BankOutlined aria-hidden />}
            label="服务商"
            value={String(totals?.providers ?? "—")}
          />
          <StatCard
            icon={<ShopOutlined aria-hidden />}
            label="服务站"
            value={String(totals?.stations ?? "—")}
          />
          <StatCard
            icon={<InboxOutlined aria-hidden />}
            label="在售商品"
            value={String(totals?.products ?? "—")}
          />
          <StatCard
            icon={<ToolOutlined aria-hidden />}
            label="服务项目"
            value={String(totals?.services ?? "—")}
          />
          <StatCard
            icon={<FileTextOutlined aria-hidden />}
            label="订货单"
            value={String(totals?.orders ?? "—")}
          />
          <StatCard
            icon={<CalendarOutlined aria-hidden />}
            label="服务预约单"
            value={String(totals?.bookings ?? "—")}
          />
        </StatGrid>
      </Panel>

      <Panel
        title="单据总览"
        titleBadge={
          <span className="text-12 muted">
            按服务商 / 服务站 / 单据状态筛选，单据分页展示
          </span>
        }
        extra={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Select
              allowClear
              placeholder="全部服务商"
              style={{ width: 200 }}
              value={provider || undefined}
              onChange={(value?: string) => {
                setProvider(value || "");
                setStationId("");
                setOrderPage(1);
                setBookingPage(1);
              }}
              options={providerOptions}
            />
            <Select
              allowClear
              placeholder="全部服务站"
              style={{ width: 190 }}
              value={stationId || undefined}
              onChange={(value?: string) => {
                setStationId(value || "");
                setOrderPage(1);
                setBookingPage(1);
              }}
              options={stationOptions}
            />
            <Select
              allowClear
              placeholder="全部状态"
              style={{ width: 180 }}
              value={status || undefined}
              onChange={(value?: string) => {
                setStatus(value || "");
                setOrderPage(1);
                setBookingPage(1);
              }}
              options={STATUS_OPTIONS}
            />
          </div>
        }
      >
        <div className="ent-sub-title">
          <FileTextOutlined aria-hidden /> 商品订货单
        </div>
        <div className="table-wrap">
          <Table<SupplyOrderRow>
            rowKey="id"
            loading={orders.loading}
            dataSource={orders.data?.list ?? []}
            pagination={{
              current: orderPage,
              pageSize: 20,
              total: orders.data?.total ?? 0,
              onChange: setOrderPage,
              showSizeChanger: false,
            }}
            size="middle"
            scroll={{ x: 1180 }}
            locale={{
              emptyText: (
                <EmptyState
                  icon={<FileTextOutlined aria-hidden />}
                  text="暂无订货单"
                />
              ),
            }}
            columns={[
              {
                title: "订货单号",
                width: 160,
                render: (_, row) => (
                  <span className="mono text-12">{row.orderNo}</span>
                ),
              },
              {
                title: "订货企业",
                width: 200,
                render: (_, row) => row.enterpriseName,
              },
              {
                title: "服务商",
                width: 170,
                render: (_, row) => providerName(row.providerUserId),
              },
              {
                title: "服务站",
                width: 160,
                render: (_, row) => row.stationName || "—",
              },
              {
                title: "期望到货",
                width: 110,
                render: (_, row) => fmtDate(row.expectedDate),
              },
              {
                title: "报价金额",
                width: 150,
                render: (_, row) => amountCell(row),
              },
              {
                title: "状态",
                width: 160,
                render: (_, row) => (
                  <StatusBadge domain="supply" status={row.status} />
                ),
              },
              {
                title: "承办职员",
                width: 130,
                render: (_, row) => (
                  <span className="text-12">{row.staffName || "待指派"}</span>
                ),
              },
              {
                title: "更新时间",
                width: 150,
                render: (_, row) => (
                  <span className="text-12 muted">
                    {fmtTime(row.updatedAt || row.createdAt)}
                  </span>
                ),
              },
            ]}
          />
        </div>

        <div className="ent-sub-title" style={{ marginTop: 18 }}>
          <CalendarOutlined aria-hidden /> 服务预约单
        </div>
        <div className="table-wrap">
          <Table<SupplyBookingRow>
            rowKey="id"
            loading={bookings.loading}
            dataSource={bookings.data?.list ?? []}
            pagination={{
              current: bookingPage,
              pageSize: 20,
              total: bookings.data?.total ?? 0,
              onChange: setBookingPage,
              showSizeChanger: false,
            }}
            size="middle"
            scroll={{ x: 1180 }}
            locale={{
              emptyText: (
                <EmptyState
                  icon={<CalendarOutlined aria-hidden />}
                  text="暂无服务预约单"
                />
              ),
            }}
            columns={[
              {
                title: "预约单号",
                width: 160,
                render: (_, row) => (
                  <span className="mono text-12">{row.bookingNo}</span>
                ),
              },
              {
                title: "预约企业",
                width: 200,
                render: (_, row) => row.enterpriseName,
              },
              {
                title: "服务商",
                width: 170,
                render: (_, row) => providerName(row.providerUserId),
              },
              {
                title: "服务站",
                width: 160,
                render: (_, row) => row.stationName || "—",
              },
              {
                title: "服务项目",
                width: 180,
                render: (_, row) => row.serviceName || "—",
              },
              {
                title: "计划服务时间",
                width: 110,
                render: (_, row) => fmtDate(row.planDate),
              },
              {
                title: "报价金额",
                width: 150,
                render: (_, row) => amountCell(row),
              },
              {
                title: "状态",
                width: 160,
                render: (_, row) => (
                  <StatusBadge domain="supply" status={row.status} />
                ),
              },
              {
                title: "承办职员",
                width: 130,
                render: (_, row) => (
                  <span className="text-12">{row.staffName || "待指派"}</span>
                ),
              },
              {
                title: "更新时间",
                width: 150,
                render: (_, row) => (
                  <span className="text-12 muted">
                    {fmtTime(row.updatedAt || row.createdAt)}
                  </span>
                ),
              },
            ]}
          />
        </div>
      </Panel>

      <Panel
        title="服务商统计"
        titleBadge={
          <span className="text-12 muted">
            服务商维度的服务站 / 在售商品 / 在售服务 / 单据数量
          </span>
        }
      >
        <div className="table-wrap">
          <Table<ProviderStatRow>
            rowKey="provider_user_id"
            loading={loading}
            dataSource={providerStats}
            pagination={demandPagination}
            size="middle"
            locale={{
              emptyText: (
                <EmptyState
                  icon={<BankOutlined aria-hidden />}
                  text="暂无服务商"
                />
              ),
            }}
            columns={[
              {
                title: "服务商",
                width: 240,
                render: (_, row) => providerName(row.provider_user_id),
              },
              {
                title: "服务站",
                width: 100,
                render: (_, row) => `${row.station_count} 个`,
              },
              {
                title: "在售商品",
                width: 110,
                render: (_, row) => `${row.product_count} 个`,
              },
              {
                title: "在售服务",
                width: 110,
                render: (_, row) => `${row.service_count} 个`,
              },
              {
                title: "订货单",
                width: 100,
                render: (_, row) => `${row.order_count} 单`,
              },
              {
                title: "服务预约单",
                width: 120,
                render: (_, row) => `${row.booking_count} 单`,
              },
            ]}
          />
        </div>
      </Panel>

      <Panel
        title="服务站统计"
        titleBadge={
          <span className="text-12 muted">
            站点维度的订货单 / 预约单 / 在售商品数量
          </span>
        }
      >
        <div className="table-wrap">
          <Table<StationStatRow>
            rowKey="station_id"
            loading={loading}
            dataSource={stationStats}
            pagination={demandPagination}
            size="middle"
            locale={{
              emptyText: (
                <EmptyState
                  icon={<ShopOutlined aria-hidden />}
                  text="暂无服务站"
                />
              ),
            }}
            columns={[
              {
                title: "服务站",
                width: 200,
                render: (_, row) => row.station_name,
              },
              {
                title: "服务商",
                width: 220,
                render: (_, row) => providerName(row.provider_user_id),
              },
              {
                title: "所在地区",
                width: 160,
                render: (_, row) => row.region || "—",
              },
              {
                title: "状态",
                width: 110,
                render: (_, row) => (
                  <StatusBadge domain="supplyListing" status={row.status} />
                ),
              },
              {
                title: "订货单",
                width: 100,
                render: (_, row) => `${row.order_count} 单`,
              },
              {
                title: "服务预约单",
                width: 120,
                render: (_, row) => `${row.booking_count} 单`,
              },
              {
                title: "在售商品",
                width: 110,
                render: (_, row) => `${row.product_count} 个`,
              },
            ]}
          />
        </div>
      </Panel>
    </>
  );
}
