import { z } from "zod";

const envelope = <T extends z.ZodType>(data: T) =>
  z.object({ code: z.number(), message: z.string(), data: data.nullable() });
const emptyQuery = z.object({});

/**
 * 帮助中心（章节化知识库）：内容以内置知识条目随代码版本化维护（backend/src/help 知识文件），
 * 前端 /help 页与 MCP（Help_* 三个只读动作）读同一份，用户直接问 Agent 也能拿到使用方式。
 * 章节按侧栏菜单的真实入口组织，正文口径与 PAGE_META 说明对齐。
 */

export const helpTopicSchema = z.object({
  /** 全局唯一主题编码，形如 "dist-extension"；MCP / 深链按 code 取详情 */
  code: z.string(),
  title: z.string(),
  /** 一句话摘要（列表与搜索结果显示，也是 Agent 快速引用的口径） */
  summary: z.string(),
  /** 正文：Markdown（支持 ## 小节、列表、链接） */
  content: z.string(),
  /** 关联站内页面路径，前端渲染「去这个页面」按钮 */
  routePath: z.string().default(""),
  /** 检索关键词（含别名/口语说法，帮 Agent 与搜索命中） */
  keywords: z.array(z.string()).default([]),
});
export type HelpTopic = z.infer<typeof helpTopicSchema>;

/** 列表瘦身：不带正文，只出章节目录。 */
export const helpTopicBriefSchema = z.object({
  code: z.string(),
  title: z.string(),
  summary: z.string(),
  routePath: z.string(),
});
export type HelpTopicBrief = z.infer<typeof helpTopicBriefSchema>;

export const helpChapterSchema = z.object({
  code: z.string(),
  title: z.string(),
  /** 章节导语，告诉用户这一章解决什么问题 */
  intro: z.string(),
  topics: z.array(helpTopicBriefSchema),
});
export type HelpChapter = z.infer<typeof helpChapterSchema>;

/** 主题详情：整篇正文 + 所属章节（面包屑）。 */
export const helpTopicDetailSchema = helpTopicSchema.extend({
  chapterCode: z.string(),
  chapterTitle: z.string(),
});
export type HelpTopicDetail = z.infer<typeof helpTopicDetailSchema>;

export const helpSearchHitSchema = helpTopicBriefSchema.extend({
  chapterTitle: z.string(),
  /** 命中上下文片段（正文里关键字附近的一行，供结果页高亮） */
  excerpt: z.string(),
  /** 归一相关度 0~1（统一检索内核口径，跨源合并用） */
  score: z.number().default(0),
});
export type HelpSearchHit = z.infer<typeof helpSearchHitSchema>;

export const helpEndpoints = {
  /** 章节目录：全部章节 + 每章主题清单（前端导航与 MCP 知识库总览同一入口）。 */
  Help_chapters: {
    method: "get" as const,
    path: "/enterprise/help/chapters",
    params: z.object({}),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(z.array(helpChapterSchema)),
  },
  /** 主题详情：按 code 取整篇 Markdown 正文。 */
  Help_topic: {
    method: "get" as const,
    path: "/enterprise/help/topics/:code",
    params: z.object({ code: z.string().min(1) }),
    query: emptyQuery,
    body: z.undefined(),
    response: envelope(helpTopicDetailSchema),
  },
  /** 全文搜索：标题/摘要/关键词/正文逐字段打分，Agent 回答使用问题先走这里。 */
  Help_search: {
    method: "get" as const,
    path: "/enterprise/help/search",
    params: z.object({}),
    query: z.object({ keyword: z.string().min(1).max(100) }),
    body: z.undefined(),
    response: envelope(z.array(helpSearchHitSchema).max(30)),
  },
};
