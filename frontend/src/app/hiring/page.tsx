"use client";

import { ConfigProvider } from "antd";
import { useState } from "react";
import { PageHero } from "@/components/ui/panel";
import { PAGE_META } from "@/config/routes";
import { HiringTab } from "./_components/hiring-tab";
import { RecruitAiTab } from "./_components/recruit-ai-tab";

const TABS = [
  { key: "plaza", label: "招聘广场" },
  { key: "ai", label: "AI 简历代投" },
];

/**
 * 招聘专区（商务人脉 → 招聘，移植 SNS 的 HiringPost）：岗位本地免 Key 发布进招聘广场，
 * 候选人靠站内私信对接（对话里可附 HTML 简历投递）；已绑定 AIPDD APIKey 时可把岗位同步成 AIworkin 的用工需求。
 * 「AI 简历代投」是求职者视角：画像、岗位匹配、投递确认与漏斗洞察。
 */
export default function HiringPage() {
  const [tab, setTab] = useState("plaza");
  return (
    <ConfigProvider button={{ autoInsertSpace: false }}>
      <PageHero
        title="招聘"
        desc={PAGE_META["/hiring"]?.description}
        tabs={TABS}
        activeTab={tab}
        onTabChange={setTab}
      />
      {tab === "plaza" ? <HiringTab /> : <RecruitAiTab />}
    </ConfigProvider>
  );
}
