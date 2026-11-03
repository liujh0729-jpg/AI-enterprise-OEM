"use client";

import {
  ApartmentOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  FieldTimeOutlined,
  HistoryOutlined,
  StarOutlined,
} from "@ant-design/icons";
import { Col, Row, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { EmptyState, Panel, StatCard, StatGrid } from "@/components/ui/panel";
import { fmtTime } from "@/lib/datetime";
import type { AgentOverview } from "./common";

/**
 * 概览：总量与时间窗口（近 7 天 / 近 30 天 / 活跃天数 / 未成功），
 * 外加「动作分布」＝按业务域计数 + 最常做的操作前 5 条。
 * 数据全部来自 /enterprise/agent/overview，中文标签由接口随数据下发。
 */
export function OverviewPanel({ stats }: { stats: AgentOverview | null }) {
  const total = stats?.total ?? 0;
  const lastAt = stats?.lastAt ?? "";
  const firstAt = stats?.firstAt ?? "";
  const domains = stats?.byDomain ?? [];
  const actions = (stats?.topActions ?? []).slice(0, 5);
  const columns: ColumnsType<(typeof actions)[number]> = [
    { title: "动作", dataIndex: "label", key: "label" },
    { title: "业务域", dataIndex: "domainLabel", key: "domainLabel" },
    {
      title: "次数",
      dataIndex: "count",
      key: "count",
      align: "right",
      render: (value: number) => <Tag>{value} 次</Tag>,
    },
  ];

  return (
    <Panel title="记忆概览">
      <StatGrid>
        <StatCard
          label="已记录操作"
          value={total}
          hint={total ? "你在本系统做过的每一笔写操作" : "还没有记录"}
          icon={<HistoryOutlined aria-hidden />}
        />
        <StatCard
          label="近 7 天"
          value={stats?.last7Days ?? 0}
          icon={<ClockCircleOutlined aria-hidden />}
        />
        <StatCard
          label="近 30 天"
          value={stats?.last30Days ?? 0}
          icon={<CalendarOutlined aria-hidden />}
        />
        <StatCard
          label="活跃天数"
          value={stats?.activeDays ?? 0}
          hint={firstAt ? `从 ${fmtTime(firstAt)} 开始` : undefined}
          icon={<FieldTimeOutlined aria-hidden />}
        />
        <StatCard
          label="未成功"
          value={stats?.failed ?? 0}
          hint={stats?.failed ? "在操作记录里按结果筛出这几条" : undefined}
          icon={<ExclamationCircleOutlined aria-hidden />}
        />
      </StatGrid>

      {lastAt ? (
        <div className="text-12 muted" style={{ marginTop: 12 }}>
          {`最近一次记录在 ${fmtTime(lastAt)}`}
        </div>
      ) : null}

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <div className="text-12 muted" style={{ marginBottom: 8 }}>
            <ApartmentOutlined aria-hidden /> 按业务域
          </div>
          {domains.length ? (
            <Space size={[8, 8]} wrap>
              {domains.map((item) => (
                <Tag key={item.domain} style={{ marginInlineEnd: 0 }}>
                  {`${item.label} ${item.count}`}
                </Tag>
              ))}
            </Space>
          ) : (
            <EmptyState text="还没有动作分布" />
          )}
        </Col>
        <Col xs={24} lg={12}>
          <div className="text-12 muted" style={{ marginBottom: 8 }}>
            <StarOutlined aria-hidden /> 最常做的操作
          </div>
          {actions.length ? (
            <Table
              rowKey="action"
              size="small"
              pagination={false}
              columns={columns}
              dataSource={actions}
            />
          ) : (
            <EmptyState text="还没有重复出现的操作" />
          )}
        </Col>
      </Row>
    </Panel>
  );
}
