/** 知识库条目的存储形态：章节嵌套主题，服务层再切成「目录 / 详情 / 搜索」三种读视图。 */
export const HELP_AUDIENCES = [
  'GENERAL',
  'ENTERPRISE_USER',
  'SERVICE_PROVIDER',
  'PROVIDER_STAFF',
  'PLATFORM_ADMIN',
] as const;
export type HelpAudience = (typeof HELP_AUDIENCES)[number];

export type HelpTopicContent = {
  code: string;
  title: string;
  summary: string;
  content: string;
  routePath: string;
  keywords: string[];
};

export type HelpChapterContent = {
  code: string;
  title: string;
  intro: string;
  audience?: HelpAudience[];
  topics: HelpTopicContent[];
};
