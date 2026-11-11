import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { fieldScore } from '../ai/retrieval-kernel';
import { HELP_CHAPTERS } from './help-knowledge';
import type {
  HelpAudience,
  HelpChapterContent,
  HelpTopicContent,
} from './types';

/**
 * 帮助中心（章节知识库）：内容内置随代码版本化，不落库——
 * 前端 /help 页与 MCP（Help_* 三个只读动作）读同一份，保证「人看的页面」与「Agent 的答案」口径一致。
 * 平台管理员专区由服务端按账号角色隔离，普通帮助通过 audience 元数据在页面按角色分区。
 * 检索评分走统一检索内核（AI 底座 §4.2）：字段加权 + 归一分，与知识库/资料库同一口径。
 * 只读服务无外部依赖，构造不需要 Prisma。
 */

type TopicIndex = { chapter: HelpChapterContent; topic: HelpTopicContent };

function isPlatformAdmin(user: CurrentUser): boolean {
  return user.isAdmin();
}

function isVisible(chapter: HelpChapterContent, user: CurrentUser): boolean {
  if (isPlatformAdmin(user)) return true;
  return !(chapter.audience ?? ['GENERAL']).includes('PLATFORM_ADMIN');
}

function audienceOf(chapter: HelpChapterContent) {
  const audience = chapter.audience ?? ['GENERAL'];
  return audience.map((item) => ({ code: item, label: AUDIENCE_LABELS[item] }));
}

/** 主题 code 全局唯一（深链按 code 直达）；重名在模块加载即抛错，防止两半文件悄悄撞码。 */
const topicByCode = new Map<string, TopicIndex>();
for (const chapter of HELP_CHAPTERS) {
  for (const topic of chapter.topics) {
    if (topicByCode.has(topic.code)) {
      throw new Error(`帮助主题编码重复：${topic.code}`);
    }
    topicByCode.set(topic.code, { chapter, topic });
  }
}

const AUDIENCE_LABELS: Record<HelpAudience, string> = {
  GENERAL: '通用帮助',
  ENTERPRISE_USER: '企业/个人用户',
  SERVICE_PROVIDER: '服务商',
  PROVIDER_STAFF: '服务商职员',
  PLATFORM_ADMIN: '平台管理员',
};

function briefOf(topic: HelpTopicContent) {
  return {
    code: topic.code,
    title: topic.title,
    summary: topic.summary,
    routePath: topic.routePath,
  };
}

/** 命中上下文：正文里关键字所在的一行（去 Markdown 记号），找不到就回落到摘要。 */
function excerptOf(topic: HelpTopicContent, token: string): string {
  const lines = topic.content.split(/\r?\n/);
  const hit = lines.find((line) => line.toLowerCase().includes(token));
  const raw = hit ?? topic.summary;
  return raw
    .replace(/[*_`#>-]/g, '')
    .trim()
    .slice(0, 160);
}

export class HelpService {
  /** 章节目录：按账号层级过滤管理员专区，并返回普通帮助分区标签。 */
  chapters(user: CurrentUser) {
    return HELP_CHAPTERS.filter((chapter) => isVisible(chapter, user)).map(
      (chapter) => ({
        code: chapter.code,
        title: chapter.title,
        intro: chapter.intro,
        audience: audienceOf(chapter),
        topics: chapter.topics.map(briefOf),
      }),
    );
  }

  /** 主题详情：按 code 取整篇正文，附所属章节便于面包屑。 */
  topic(user: CurrentUser, code: string) {
    const entry = topicByCode.get(code);
    if (!entry || !isVisible(entry.chapter, user)) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '帮助主题不存在或已调整',
      );
    }
    return {
      ...entry.topic,
      audience: audienceOf(entry.chapter),
      chapterCode: entry.chapter.code,
      chapterTitle: entry.chapter.title,
    };
  }

  /** 全文搜索：统一内核字段加权打分（归一 0~1），最多回 30 条（与契约 max(30) 对齐）。 */
  search(user: CurrentUser, query: { keyword?: string }) {
    const keyword = String(query?.keyword || '').trim();
    if (!keyword) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请输入搜索关键词');
    }
    const hits: Array<
      ReturnType<typeof briefOf> & {
        chapterTitle: string;
        audience: ReturnType<typeof audienceOf>;
        excerpt: string;
        score: number;
      }
    > = [];
    for (const { chapter, topic } of topicByCode.values()) {
      if (!isVisible(chapter, user)) continue;
      const score = fieldScore(keyword, {
        title: topic.title,
        keywords: topic.keywords,
        summary: topic.summary,
        body: topic.content,
      });
      if (score <= 0) continue;
      hits.push({
        ...briefOf(topic),
        chapterTitle: chapter.title,
        audience: audienceOf(chapter),
        excerpt: excerptOf(topic, keyword.toLowerCase().slice(0, 20)),
        score,
      });
    }
    hits.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));
    return hits.slice(0, 30);
  }
}
