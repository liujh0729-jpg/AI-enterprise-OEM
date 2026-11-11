import { HELP_CHAPTERS_PART_ONE } from './help-knowledge.part1';
import { HELP_CHAPTERS_PART_TWO } from './help-knowledge.part2';
import type { HelpChapterContent } from './types';

/**
 * 帮助中心知识库（章节化）：上半讲用户侧动线，下半讲管理/集成与 FAQ。
 * 章节顺序＝推荐阅读顺序（新用户从第一章往下走）；主题 code 全局唯一，MCP 与 /help 深链都按 code 取。
 */
const CHAPTER_AUDIENCES: Record<string, HelpChapterContent['audience']> = {
  'quick-start': ['GENERAL'],
  workbench: ['GENERAL'],
  'content-marketing': ['ENTERPRISE_USER'],
  distribution: ['ENTERPRISE_USER'],
  acquisition: ['ENTERPRISE_USER', 'SERVICE_PROVIDER'],
  'chrome-rpa': ['GENERAL'],
  'business-services': ['ENTERPRISE_USER', 'SERVICE_PROVIDER'],
  network: ['GENERAL'],
  'admin-settings': ['ENTERPRISE_USER', 'SERVICE_PROVIDER', 'PROVIDER_STAFF'],
  integration: ['GENERAL'],
  hardware: ['GENERAL'],
  'platform-admin': ['PLATFORM_ADMIN'],
  faq: ['GENERAL'],
};

export const HELP_CHAPTERS: HelpChapterContent[] = [
  ...HELP_CHAPTERS_PART_ONE,
  ...HELP_CHAPTERS_PART_TWO,
].map((chapter) => ({
  ...chapter,
  audience: CHAPTER_AUDIENCES[chapter.code] ?? ['GENERAL'],
}));
