"use client";

import { PageHero } from "@/components/ui/panel";
import { PAGE_META } from "@/config/routes";
import { HiringTab } from "./_components/hiring-tab";

/**
 * 招聘专区（商务人脉 → 招聘，移植 SNS 的 HiringPost）：岗位本地免 Key 发布进招聘广场，
 * 候选人靠站内私信对接（对话里可附 HTML 简历投递）；已绑定 AIPDD APIKey 时可把岗位同步成 AIworkin 的用工需求。
 */
export default function HiringPage() {
  return (
    <>
      <PageHero title="招聘" desc={PAGE_META["/hiring"]?.description} />
      <HiringTab />
    </>
  );
}
