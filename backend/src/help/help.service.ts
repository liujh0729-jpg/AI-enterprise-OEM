import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { HELP_CHAPTERS } from './help-knowledge';
import type { HelpChapterContent, HelpTopicContent } from './types';

/**
 * 帮助中心（章节知识库）：内容内置随代码版本化，不落库——
 * 前端 /help 页与 MCP（Help_* 三个只读动作）读同一份，保证「人看的页面」与「Agent 的答案」口径一致。
 * 只读服务无外部依赖，构造不需要 Prisma。
 */

type TopicIndex = { chapter: HelpChapterContent; topic: HelpTopicContent };

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
  return raw.replace(/[*_`#>-]/g, '').trim().slice(0, 160);
}

/** 分词打分：标题 8 / 关键词 6 / 摘要 4 / 正文每处 1（封顶 3），多词查询取和。 */
function scoreTopic(topic: HelpTopicContent, tokens: string[]): number {
  let score = 0;
  for (const token of tokens) {
    if (topic.title.toLowerCase().includes(token)) score += 8;
    if (topic.keywords.some((word) => word.toLowerCase().includes(token))) score += 6;
    if (topic.summary.toLowerCase().includes(token)) score += 4;
    let index = topic.content.toLowerCase().indexOf(token);
    let occurrences = 0;
    while (index >= 0 && occurrences < 3) {
      occurrences += 1;
      index = topic.content.toLowerCase().indexOf(token, index + token.length);
    }
    score += occurrences;
  }
  return score;
}

export class HelpService {
  /** 章节目录：全部章节 + 每章主题清单（不含正文）。 */
  chapters(_user: CurrentUser) {
    return HELP_CHAPTERS.map((chapter) => ({
      code: chapter.code,
      title: chapter.title,
      intro: chapter.intro,
      topics: chapter.topics.map(briefOf),
    }));
  }

  /** 主题详情：按 code 取整篇正文，附所属章节便于面包屑。 */
  topic(_user: CurrentUser, code: string) {
    const entry = topicByCode.get(code);
    if (!entry) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '帮助主题不存在或已调整');
    }
    return {
      ...entry.topic,
      chapterCode: entry.chapter.code,
      chapterTitle: entry.chapter.title,
    };
  }

  /** 全文搜索：空格分词逐主题打分排序，最多回 30 条（与契约 max(30) 对齐）。 */
  search(_user: CurrentUser, query: { keyword?: string }) {
    const keyword = String(query?.keyword || '').trim();
    if (!keyword) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请输入搜索关键词');
    }
    const tokens = keyword
      .toLowerCase()
      .split(/\s+/)
      .filter((token) => token.length > 0)
      .slice(0, 8);
    const hits: Array<ReturnType<typeof briefOf> & {
      chapterTitle: string;
      excerpt: string;
      score: number;
    }> = [];
    for (const { chapter, topic } of topicByCode.values()) {
      const score = scoreTopic(topic, tokens);
      if (score <= 0) continue;
      hits.push({
        ...briefOf(topic),
        chapterTitle: chapter.title,
        excerpt: excerptOf(topic, tokens[0]),
        score,
      });
    }
    hits.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));
    return hits.slice(0, 30).map(({ score: _score, ...hit }) => hit);
  }
}
