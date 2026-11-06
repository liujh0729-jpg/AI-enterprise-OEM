import { HELP_CHAPTERS_PART_ONE } from './help-knowledge.part1';
import { HELP_CHAPTERS_PART_TWO } from './help-knowledge.part2';
import type { HelpChapterContent } from './types';

/**
 * 帮助中心知识库（章节化）：上半讲用户侧动线，下半讲管理/集成与 FAQ。
 * 章节顺序＝推荐阅读顺序（新用户从第一章往下走）；主题 code 全局唯一，MCP 与 /help 深链都按 code 取。
 */
export const HELP_CHAPTERS: HelpChapterContent[] = [
  ...HELP_CHAPTERS_PART_ONE,
  ...HELP_CHAPTERS_PART_TWO,
];
