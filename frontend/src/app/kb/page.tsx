"use client";

import { useState } from "react";
import { PageHero } from "@/components/ui/panel";
import { KbBoard, type KbTab } from "./_components/kb-board";

/**
 * 知识库（工作台）：公共知识库与知识图谱底座（方案 §10）。
 * 三层结构（原始资料→编译页面→维护规范）+ 三操作（摄取/查询/巡检），
 * 空间是权限与上下文的单元，页面写 [[链接]] 即长图谱，Agent 记忆在此沉淀回流。
 */
export default function KbPage() {
  const [tab, setTab] = useState<KbTab>("spaces");
  return (
    <>
      <PageHero
        title="知识库"
        desc="把会议纪要、文章、通话逐字稿投进知识空间，系统将其编译为可溯源的 wiki 页面：正文里的 [[链接]] 自动长出知识图谱，混合检索（关键词+向量）与带引用问答随写随可用；未配置大模型时全链路走确定性的规则式回落。智能体的办事留痕可提炼为操作记忆，回答前的上下文也从这里回流——知识只进不退（复利）。"
        tabs={[
          { key: "spaces", label: "空间" },
          { key: "sources", label: "资料" },
          { key: "pages", label: "页面" },
          { key: "qa", label: "检索问答" },
          { key: "graph", label: "图谱" },
          { key: "consumers", label: "消费者" },
          { key: "memory", label: "记忆" },
          { key: "timeline", label: "时间线" },
        ]}
        activeTab={tab}
        onTabChange={(key) => setTab(key as KbTab)}
      />
      <KbBoard tab={tab} />
    </>
  );
}
