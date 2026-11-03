"use client";

import { CalendarOutlined, FileTextOutlined } from "@ant-design/icons";
import { Alert, Button, Table } from "antd";
import type { TableProps } from "antd";
import { useState } from "react";
import { taxApi } from "@/api/tax";
import { useTaxDeclarations } from "@/query/tax";
import { useBusinessQuery } from "@/query/business";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState, Panel, StatCard, StatGrid } from "@/components/ui/panel";
import {
  fmtTime,
  money,
  taxTypeLabel,
  type AccountSetRow,
  type ContractRow,
  type TaxDeclaration,
  type TaxMeta,
  type TaxPlanRow,
} from "./common";

/**
 * 账套详情（企业只读，需求 6.3）：账套 → 申报计划 → 申报单闭环。
 * 申报进度以本账套名下申报计划的状态为准（申报完成回写账套进度）；
 * 申报单为该企业全部申报单（与「报税工作台」同口径）。
 */
export function AccountSetDetail({
  set,
  contracts,
  meta,
  onBack,
  onOpenDecl,
}: {
  set: AccountSetRow;
  contracts: ContractRow[];
  meta: TaxMeta;
  onBack: () => void;
  onOpenDecl: (id: number) => void;
}) {
  const [declPage,setDeclPage] = useState(1);
  const declarationsQuery = useTaxDeclarations(set.enterpriseId,declPage);
  const decls = declarationsQuery.data?.list ?? [];
  const declTotal = declarationsQuery.data?.total ?? 0;
  const [pagination,setPagination]=useState({page:1,pageSize:20});
  const plansQuery=useBusinessQuery('tax','plans',{accountSetId:set.id,...pagination},signal=>taxApi.planList({query:{accountSetId:set.id,...pagination}},{signal}));
  const statsQuery=useBusinessQuery('tax','plan-stats',{accountSetId:set.id},signal=>taxApi.planStats({query:{accountSetId:set.id}},{signal}));
  const stats=statsQuery.data||{due:'—',in_progress:'—',done:'—',total:'—'};
  const setPlanRows=plansQuery.data?.list||[];
  const loading=plansQuery.isPending;
  // 承办服务商与对接人：以签约关系为准（未指派对接人时显示「等待指派」）
  const taxContracts = contracts.filter(
    (item) =>
      item.serviceType === "TAX_FINANCE" &&
      Number(item.enterpriseId) === Number(set.enterpriseId),
  );
  const contract =
    taxContracts.find((item) => item.status === "ACTIVE") || taxContracts[0];
  const providerName =
    contract?.provider_name || contract?.providerOrg || "—";
  const staffName = contract?.designatedStaff?.name || "";

  const planColumns: TableProps<TaxPlanRow>["columns"] = [
    {
      title: "税种（申报频率）",
      dataIndex: "tax_type_name",
      render: (value: string, row) => (
        <div>
          <div style={{ fontWeight: 600 }}>{value || row.taxType}</div>
          <div className="text-12 muted">
            {row.freq || "—"} · 模板：{row.template || "—"}
          </div>
        </div>
      ),
    },
    {
      title: "所属期",
      dataIndex: "period",
      width: 110,
      render: (value: string) => (
        <span className="mono text-12">{value || "—"}</span>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 110,
      render: (value: string) => <StatusBadge domain="taxPlan" status={value} />,
    },
    {
      title: "关联申报单",
      dataIndex: "decl_no",
      width: 170,
      render: (value: string) => (
        <span className="mono text-12">{value || "—"}</span>
      ),
    },
    {
      title: "操作",
      width: 130,
      render: (_, row) => {
        const declId = Number(row.declarationId || 0);
        return declId ? (
          <Button onClick={() => onOpenDecl(declId)}>
            查看申报单
          </Button>
        ) : (
          <span className="text-12 muted">—</span>
        );
      },
    },
  ];

  const declColumns: TableProps<TaxDeclaration>["columns"] = [
    {
      title: "申报单号",
      dataIndex: "declNo",
      width: 170,
      render: (value: string) => (
        <span className="mono text-12">{value || "—"}</span>
      ),
    },
    {
      title: "税种",
      dataIndex: "taxType",
      width: 190,
      render: (value: string) => taxTypeLabel(meta, value),
    },
    {
      title: "所属期",
      dataIndex: "period",
      width: 110,
      render: (value: string) => (
        <span className="mono text-12">{value || "—"}</span>
      ),
    },
    {
      title: "预估税额",
      dataIndex: "taxAmount",
      width: 120,
      render: (value: unknown) => (
        <span className="mono">¥{money(value)}</span>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 220,
      render: (value: string) => (
        <StatusBadge domain="taxDeclaration" status={value} />
      ),
    },
    {
      title: "操作",
      width: 100,
      render: (_, row) => (
        <Button onClick={() => onOpenDecl(row.id)}>
          查看
        </Button>
      ),
    },
  ];

  return (
    <>
      <Panel
        title={`账套详情 · ${set.name}`}
        titleBadge={`账套编号 ${set.id}`}
        extra={
          <Button onClick={onBack}>
            ← 返回列表
          </Button>
        }
      >
        <div className="text-12 muted">
          企业：{contract?.enterpriseName || "—"}｜承办服务商：{providerName}
          （对接人 {staffName || "等待指派"}）
        </div>
        <div style={{ marginTop: 14 }}>
          <StatGrid>
            <StatCard
              label="账套状态"
              value={<StatusBadge status={set.status} />}
            />
            <StatCard label="待申报" value={`${stats.due} 项`} />
            <StatCard label="申报中" value={`${stats.in_progress} 项`} />
            <StatCard label="已完成" value={`${stats.done} 项`} />
            <StatCard
              label="申报单"
              value={`${declTotal} 张`}
              hint="本企业全部申报单"
            />
            <StatCard
              label="创建时间"
              value={
                <span style={{ fontSize: 16 }}>{fmtTime(set.createdAt)}</span>
              }
            />
          </StatGrid>
        </div>
      </Panel>

      {(plansQuery.error||statsQuery.error)&&<Alert type="error" title={plansQuery.error?.message||statsQuery.error?.message} />}
      <Panel title="申报计划" titleBadge={`本账套共 ${stats.total} 项`}>
        <div className="text-12 muted" style={{ marginBottom: 12 }}>
          申报计划由承办服务商按你的纳税人性质与申报频率（月/季/年）生成，
          申报结果回写账套进度。
        </div>
        <div className="table-wrap">
          <Table<TaxPlanRow>
            rowKey="id"
            loading={loading}
            dataSource={setPlanRows}
            pagination={{current:pagination.page,pageSize:pagination.pageSize,total:plansQuery.data?.total||0,showSizeChanger:true,onChange:(page,pageSize)=>setPagination({page,pageSize})}}
            size="middle"
            scroll={{ x: "max-content" }}
            columns={planColumns}
            locale={{
              emptyText: loading ? (
                <span className="text-12 muted">正在加载申报计划…</span>
              ) : (
                <EmptyState
                  icon={<CalendarOutlined aria-hidden />}
                  text="本账套暂无申报计划：服务商在「申报计划」中填写提报后在此展示。"
                />
              ),
            }}
          />
        </div>
      </Panel>

      {declarationsQuery.isError ? <Alert type="error" message={declarationsQuery.error.message} action={<Button onClick={() => void declarationsQuery.refetch()}>重试</Button>} /> : null}
      <Panel title="申报单" titleBadge={`共 ${declTotal} 张`}>
        <div className="table-wrap">
          <Table<TaxDeclaration>
            rowKey="id"
            dataSource={decls}
            loading={declarationsQuery.isPending}
            pagination={{current:declPage,pageSize:20,total:declTotal,showSizeChanger:false,onChange:setDeclPage}}
            size="middle"
            scroll={{ x: "max-content" }}
            columns={declColumns}
            locale={{
              emptyText: (
                <EmptyState
                  icon={<FileTextOutlined aria-hidden />}
                  text="暂无申报单：服务商核对提报后在此展示，可打开查看申报表与流程。"
                />
              ),
            }}
          />
        </div>
      </Panel>
    </>
  );
}
