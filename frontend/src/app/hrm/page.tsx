"use client";

import { ConfigProvider } from "antd";
import { useEffect, useState } from "react";
import { PageHero } from "@/components/ui/panel";
import { HrmProfilesTab } from "./_components/hrm-profiles";
import { HrmAttendanceTab } from "./_components/hrm-attendance";
import { HrmRecruitTab } from "./_components/hrm-recruit";
import { HrmInterviewsTab } from "./_components/hrm-interviews";
import { HrmLifecycleTab } from "./_components/hrm-lifecycle";
import { GapsAppointmentsTab } from "./_components/gaps-appointments";
import { GapsOnboardingTab } from "./_components/gaps-onboarding";
import { GapsTranscriptsTab } from "./_components/gaps-transcripts";

const TABS = [
  { key: "profiles", label: "员工档案" },
  { key: "attendance", label: "假勤" },
  { key: "recruit", label: "招聘漏斗" },
  { key: "interviews", label: "面试评分" },
  { key: "lifecycle", label: "Offer 与盘点" },
  { key: "appointments", label: "预约管理" },
  { key: "onboarding", label: "入职引导" },
  { key: "transcripts", label: "语音转写" },
];

/**
 * HR工作台（方案 §5.1/L4）：档案、假勤、招聘、面试、Offer/述职五段式，
 * 全部数据挂在组织成员（OrgStaff）上；管理员与成员的能力边界由后端服务收口。
 */
export default function HrmPage() {
  const [tab, setTab] = useState("profiles");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const initial = query.get("tab");
    if (initial && TABS.some((item) => item.key === initial)) setTab(initial);
  }, []);

  return (
    <ConfigProvider button={{ autoInsertSpace: false }}>
      <PageHero
        title="HR工作台"
        desc="员工档案、假勤审批、招聘漏斗、面试评分与 Offer/述职盘点：数据统一挂在组织成员（企业正式职员或代理人）上，AI 评估只给参考分，录用与权限由人决定。"
        tabs={TABS}
        activeTab={tab}
        onTabChange={(key) => {
          setTab(key);
          setReloadKey((value) => value + 1);
        }}
      />
      {tab === "profiles" ? <HrmProfilesTab reloadKey={reloadKey} /> : null}
      {tab === "attendance" ? <HrmAttendanceTab reloadKey={reloadKey} /> : null}
      {tab === "recruit" ? <HrmRecruitTab reloadKey={reloadKey} /> : null}
      {tab === "interviews" ? <HrmInterviewsTab reloadKey={reloadKey} /> : null}
      {tab === "lifecycle" ? <HrmLifecycleTab reloadKey={reloadKey} /> : null}
      {tab === "appointments" ? <GapsAppointmentsTab /> : null}
      {tab === "onboarding" ? <GapsOnboardingTab /> : null}
      {tab === "transcripts" ? <GapsTranscriptsTab /> : null}
    </ConfigProvider>
  );
}
