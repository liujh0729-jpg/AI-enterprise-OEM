"use client";

import { BankOutlined, ClockCircleOutlined, TeamOutlined } from "@ant-design/icons";
import { StatCard, StatGrid, Panel } from "@/components/ui/panel";

/** 团队概览：在职职员 / 已分配企业 / 待分配企业（对齐 demo statBox）。 */
export function TeamOverview({
  staffCount,
  assigned,
  unassigned,
}: {
  staffCount: number;
  assigned: number;
  unassigned: number;
}) {
  return (
    <Panel title="团队概览">
      <StatGrid>
        <StatCard icon={<TeamOutlined aria-hidden />} label="在职职员" value={staffCount} />
        <StatCard icon={<BankOutlined aria-hidden />} label="已分配企业" value={assigned} />
        <StatCard icon={<ClockCircleOutlined aria-hidden />} label="待分配企业" value={unassigned} />
      </StatGrid>
    </Panel>
  );
}
