"use client";

import { useState } from "react";
import { PageHero } from "@/components/ui/panel";
import { QuestionBoard, type QuestionHallView } from "./_components/question-board";

/**
 * 专题大厅（工作台）：专题讨论列表 + 发起专题 + 详情（两层楼层、AI 结案、关闭/删除）。
 * 页签只切筛选条件，列表与详情都在同一个面板里。
 */
export default function QuestionHallPage() {
  const [view, setView] = useState<QuestionHallView>("all");
  return (
    <>
      <PageHero
        title="专题大厅"
        desc="每个话题就是一次专题讨论：企业内专题由本组织与签约/承办伙伴的职员参与，公开专题所有登录账号都能参与；发起人可以随时结案，由 AI 读取全部发言与回复的回复生成总结，结案后仍可继续发言、重新结案，关闭后大厅不再显示。发言可以署真名，也可以选自己的数字分身。"
        tabs={[
          { key: "all", label: "全部" },
          { key: "enterprise", label: "企业内" },
          { key: "public", label: "公开" },
          { key: "created", label: "我发起的" },
          { key: "joined", label: "我参与的" },
        ]}
        activeTab={view}
        onTabChange={(key) => setView(key as QuestionHallView)}
      />
      <QuestionBoard view={view} />
    </>
  );
}
