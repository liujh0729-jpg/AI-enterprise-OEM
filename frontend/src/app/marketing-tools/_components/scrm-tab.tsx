"use client";

import { useState } from "react";
import { Space } from "antd";
import { PillTabs } from "@/components/ui/panel";
import { ScrmOverviewView } from "./scrm-overview-view";
import { ScrmContactsView } from "./scrm-contacts-view";
import { ScrmChatsView } from "./scrm-chats-view";
import { ScrmCodesView } from "./scrm-codes-view";
import { ScrmMassView } from "./scrm-mass-view";
import { ScrmTransfersView } from "./scrm-transfers-view";
import { ScrmSopsView } from "./scrm-sops-view";
import { ScrmComplianceView } from "./scrm-compliance-view";

/**
 * 企微原生 SCRM：客户以企微为唯一同步源，本地只做镜像与运营。
 * 概览页的同步会自增 tick，其余视图据此重新拉取，避免切页签看到旧数据。
 */

type ViewKey =
  | "overview"
  | "contacts"
  | "chats"
  | "codes"
  | "mass"
  | "transfers"
  | "sops"
  | "compliance";

const VIEWS = [
  { key: "overview", label: "概览" },
  { key: "contacts", label: "客户" },
  { key: "chats", label: "客户群" },
  { key: "codes", label: "活码与欢迎语" },
  { key: "mass", label: "群发" },
  { key: "transfers", label: "分配与继承" },
  { key: "sops", label: "SOP" },
  { key: "compliance", label: "合规质检" },
];

export function ScrmTab() {
  const [view, setView] = useState<ViewKey>("overview");
  const [tick, setTick] = useState(0);
  const bump = () => setTick((value) => value + 1);

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <PillTabs items={VIEWS} value={view} onChange={(key) => setView(key as ViewKey)} />
      {view === "overview" ? <ScrmOverviewView onChanged={bump} /> : null}
      {view === "contacts" ? <ScrmContactsView tick={tick} /> : null}
      {view === "chats" ? <ScrmChatsView tick={tick} /> : null}
      {view === "codes" ? <ScrmCodesView tick={tick} /> : null}
      {view === "mass" ? <ScrmMassView tick={tick} /> : null}
      {view === "transfers" ? <ScrmTransfersView tick={tick} /> : null}
      {view === "sops" ? <ScrmSopsView tick={tick} /> : null}
      {view === "compliance" ? <ScrmComplianceView tick={tick} /> : null}
    </Space>
  );
}
