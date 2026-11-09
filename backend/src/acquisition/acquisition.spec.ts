import {
  dedupeKeyOf,
  pageArgs,
  peerKeyOf,
  percent,
  randomIntervalMs,
  shiftIntoActiveHours,
  withinActiveHours,
} from './acquisition.helpers';
import { EMPTY_CONTEXT, levelOf, ruleScore } from './acquisition-scoring';
import {
  channelLimit,
  cleanDraftText,
  containsLink,
  findForbiddenPromise,
  ruleDrafts,
  validateDrafts,
  type DraftInput,
} from './acquisition-outreach';
import {
  detectTimeRule,
  followUpChannelOf,
  hasBuyingIntent,
  hasDelaySignal,
  resolveFollowUpAt,
} from './follow-up.service';
import { nextRunAt } from './radar.service';
import { ruleQc } from './qc.service';

const at = (
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): Date => new Date(year, month - 1, day, hour, minute, 0, 0);

describe('acquisition helpers', () => {
  it('活跃时段按左闭右开判断，跨零点时段按两段并集处理', () => {
    expect(withinActiveHours(at(2026, 11, 7, 10), '09:00', '21:00')).toBe(true);
    expect(withinActiveHours(at(2026, 11, 7, 8, 59), '09:00', '21:00')).toBe(
      false,
    );
    expect(withinActiveHours(at(2026, 11, 7, 21), '09:00', '21:00')).toBe(
      false,
    );

    expect(withinActiveHours(at(2026, 11, 7, 23), '21:00', '02:00')).toBe(true);
    expect(withinActiveHours(at(2026, 11, 7, 1), '21:00', '02:00')).toBe(true);
    expect(withinActiveHours(at(2026, 11, 7, 12), '21:00', '02:00')).toBe(
      false,
    );
    expect(withinActiveHours(at(2026, 11, 7, 2), '21:00', '02:00')).toBe(false);
  });

  it('把时间推到活跃时段：早到等起点，晚到顺延，跨零点顺延到次日起点', () => {
    const early = shiftIntoActiveHours(at(2026, 11, 7, 8), '09:00', '21:00');
    expect(early.getTime()).toBe(at(2026, 11, 7, 9).getTime());

    const late = shiftIntoActiveHours(at(2026, 11, 7, 22), '09:00', '21:00');
    expect(late.getTime()).toBe(at(2026, 11, 8, 9).getTime());

    const midday = shiftIntoActiveHours(at(2026, 11, 7, 12), '21:00', '02:00');
    expect(midday.getTime()).toBe(at(2026, 11, 8, 21).getTime());

    const inside = at(2026, 11, 7, 10);
    expect(shiftIntoActiveHours(inside, '09:00', '21:00').getTime()).toBe(
      inside.getTime(),
    );
  });

  it('插件间隔取整到毫秒，上下界写反时自动交换', () => {
    expect(randomIntervalMs(2, 2)).toBe(2000);
    const value = randomIntervalMs(5, 1);
    expect(value).toBeGreaterThanOrEqual(1000);
    expect(value).toBeLessThanOrEqual(5000);
  });

  it('分页参数统一夹在 1..200，并回填 skip/take', () => {
    expect(pageArgs({})).toEqual({ page: 1, pageSize: 20, skip: 0, take: 20 });
    expect(pageArgs({ page: '3', pageSize: '999' })).toEqual({
      page: 3,
      pageSize: 200,
      skip: 400,
      take: 200,
    });
    expect(pageArgs({ page: '0', pageSize: '0' })).toEqual({
      page: 1,
      pageSize: 1,
      skip: 0,
      take: 1,
    });
  });

  it('百分比保留两位小数，分母为 0 时返回 0', () => {
    expect(percent(1, 4)).toBe(25);
    expect(percent(1, 3)).toBe(33.33);
    expect(percent(1, 0)).toBe(0);
  });

  it('去重键与渠道会话键保留平台/渠道前缀并截断', () => {
    expect(dedupeKeyOf('XHS', 'user-1')).toBe('XHS:user-1');
    expect(peerKeyOf('WECOM', 'ext-1')).toBe('WECOM:ext-1');
    expect(peerKeyOf('WECOM', 'x'.repeat(300))).toHaveLength(166);
  });
});

describe('intent scoring', () => {
  it('意向分档：70 起 HOT，40 起 WARM，其余 COLD', () => {
    expect(levelOf(70)).toBe('HOT');
    expect(levelOf(69.9)).toBe('WARM');
    expect(levelOf(40)).toBe('WARM');
    expect(levelOf(39)).toBe('COLD');
  });

  it('规则评分按关键词命中加权，评论来源不打折', () => {
    const score = ruleScore(
      [
        {
          sourceType: 'COMMENT',
          excerpt: '我们公司想买，预算多少，多少钱，求推荐，这周就要，谁能做',
          metrics: {},
        },
      ],
      EMPTY_CONTEXT,
    );
    expect(score.score).toBe(52);
    expect(score.level).toBe('WARM');
    expect(score.mode).toBe('rule');
    expect(score.tags).toEqual(['明确需求', '预算信号', '时间紧迫', '决策人']);
    expect(score.reason).toContain('证据原文');
  });

  it('搜索结果来源按 0.8 折算，同行打听会降权决策角色', () => {
    const score = ruleScore(
      [
        {
          sourceType: 'SEARCH',
          excerpt: '我也是做这行的，了解一下行情，求推荐',
          metrics: {},
        },
      ],
      EMPTY_CONTEXT,
    );
    expect(score.score).toBe(8);
    expect(score.level).toBe('COLD');
    expect(score.tags).toContain('疑似同行');
    expect(score.risk).toContain('同行');
    expect(score.dimensions[3].score).toBe(0);
  });

  it('无证据时不假装有判断，返回 0 分并说明原因', () => {
    const score = ruleScore([], EMPTY_CONTEXT);
    expect(score.score).toBe(0);
    expect(score.level).toBe('COLD');
    expect(score.reason).toContain('暂无证据原文');
  });
});

describe('acquisition outreach', () => {
  const draftInput = (overrides: Partial<DraftInput> = {}): DraftInput => ({
    channel: 'XHS_DM',
    action: 'COMMENT',
    platformLabel: '小红书评论',
    brand: {
      brandName: '北辰设计',
      industry: '品牌设计',
      positioning: '',
      keywords: ['包装设计'],
      regions: [],
    },
    lead: {
      nickname: '小林',
      intentLevel: 'HOT',
      intentTags: ['明确需求'],
      scoreReason: '规则式判定',
    },
    evidence: [
      {
        sourceType: 'COMMENT',
        excerpt: '预算有限，报价太高了。',
        metrics: {},
      },
    ],
    playbook: null,
    profile: null,
    ...overrides,
  });

  it('渠道字数上限与链接许可按渠道下发，未知渠道回落私信口径', () => {
    expect(channelLimit('XHS_DM')).toEqual({
      maxChars: 200,
      allowLinks: false,
      quota: 'dm',
    });
    expect(channelLimit('EMAIL')).toEqual({
      maxChars: 4000,
      allowLinks: true,
      quota: 'dm',
    });
    expect(channelLimit('UNKNOWN')).toBe(channelLimit('XHS_DM'));
  });

  it('链接识别覆盖 http(s) 与 www，普通主页文案不算链接', () => {
    expect(containsLink('看这里 https://example.com')).toBe(true);
    expect(containsLink('www.example.com')).toBe(true);
    expect(containsLink('看我的主页')).toBe(false);
  });

  it('草稿清洗去掉首尾引号、压缩空行，超长时优先在标点截断', () => {
    expect(cleanDraftText('“你好”', 100)).toBe('你好');
    expect(cleanDraftText('第一段\r\n\r\n\r\n第二段', 100)).toBe(
      '第一段\n\n第二段',
    );
    expect(cleanDraftText('第一句。第二句。第三句。', 10)).toBe(
      '第一句。第二句。',
    );
    expect(cleanDraftText('a'.repeat(200), 50)).toHaveLength(50);
    expect(cleanDraftText(null, 50)).toBe('');
  });

  it('模型草稿校验丢弃空项，保留最多三条并截断超长正文', () => {
    expect(validateDrafts({}, 100)).toBeNull();
    const drafts = validateDrafts(
      {
        drafts: [
          { angle: '共鸣式', text: '你好', why: '贴住原话' },
          { angle: '', text: '没有角度' },
          { angle: '直给式', text: '   ' },
        ],
      },
      100,
    );
    expect(drafts).toHaveLength(1);
    expect(drafts?.[0].angle).toBe('共鸣式');

    const truncated = validateDrafts(
      { drafts: [{ angle: '共鸣式', text: 'a'.repeat(200), why: 'x' }] },
      50,
    );
    expect(truncated?.[0].text).toHaveLength(50);

    const overflow = validateDrafts(
      {
        drafts: Array.from({ length: 4 }, (_, index) => ({
          angle: `角度${index}`,
          text: '正文',
          why: '理由',
        })),
      },
      100,
    );
    expect(overflow).toHaveLength(3);
  });

  it('禁词命中返回具体词，正常文案返回空串', () => {
    expect(findForbiddenPromise('我们保证效果')).toBe('保证');
    expect(findForbiddenPromise('一定能帮到你')).toBe('一定能');
    expect(findForbiddenPromise('先把情况发我，合适再谈')).toBe('');
  });

  it('无模型时规则草稿给满三个角度，且不承诺、不超渠道字数', () => {
    const drafts = ruleDrafts(draftInput());
    expect(drafts.map((item) => item.angle)).toEqual([
      '共鸣式',
      '直给式',
      '提问式',
    ]);
    const limit = channelLimit('XHS_DM').maxChars;
    for (const draft of drafts) {
      expect(draft.text.length).toBeLessThanOrEqual(limit);
      expect(findForbiddenPromise(draft.text)).toBe('');
      expect(draft.why).not.toBe('');
    }
    expect(drafts[0].text).toContain('预算有限，报价太高了');
  });

  it('没有证据原话时不硬编共鸣式，只降级为直给式与提问式', () => {
    const drafts = ruleDrafts(draftInput({ evidence: [] }));
    expect(drafts.map((item) => item.angle)).toEqual(['直给式', '提问式']);
  });
});

describe('follow-up rules', () => {
  const now = at(2026, 11, 7, 10);

  it('客户说法识别时间规则，显式日期优先', () => {
    expect(detectTimeRule('')).toBe('');
    expect(detectTimeRule('后天联系我')).toBe('DAY_AFTER');
    expect(detectTimeRule('明天下午聊')).toBe('TOMORROW');
    expect(detectTimeRule('下周三可以')).toBe('NEXT_WEEK');
    expect(detectTimeRule('等发工资吧')).toBe('PAYDAY');
    expect(detectTimeRule('月底再说')).toBe('PAYDAY');
    expect(detectTimeRule('过两天联系')).toBe('IN_A_FEW_DAYS');
    expect(detectTimeRule('晚点再说')).toBe('LATER');
    expect(detectTimeRule('下午给我电话')).toBe('AFTERNOON');
    expect(detectTimeRule('晚上聊')).toBe('EVENING');
    expect(detectTimeRule('2026-11-09 联系')).toBe('EXPLICIT');
    expect(detectTimeRule('2026年11月9日')).toBe('EXPLICIT');
    expect(detectTimeRule('好的')).toBe('');
  });

  it('跟进时间按映射表推算，跨过当日截止点顺延', () => {
    const hour = (value: Date) => value.getHours();
    const day = (value: Date) => value.getDate();

    expect(resolveFollowUpAt('TOMORROW', '', now).getTime()).toBe(
      at(2026, 11, 8, 10).getTime(),
    );
    expect(resolveFollowUpAt('DAY_AFTER', '', now).getTime()).toBe(
      at(2026, 11, 9, 10).getTime(),
    );
    expect(resolveFollowUpAt('NEXT_WEEK', '', now).getTime()).toBe(
      at(2026, 11, 14, 10).getTime(),
    );
    expect(resolveFollowUpAt('PAYDAY', '', now).getTime()).toBe(
      at(2026, 11, 12, 10).getTime(),
    );
    expect(resolveFollowUpAt('IN_A_FEW_DAYS', '', now).getTime()).toBe(
      at(2026, 11, 10, 10).getTime(),
    );

    const afternoon = resolveFollowUpAt('AFTERNOON', '', now);
    expect(day(afternoon)).toBe(7);
    expect(hour(afternoon)).toBe(14);

    const afternoonCut = resolveFollowUpAt(
      'AFTERNOON',
      '',
      at(2026, 11, 7, 14),
    );
    expect(day(afternoonCut)).toBe(8);
    expect(hour(afternoonCut)).toBe(14);

    const evening = resolveFollowUpAt('EVENING', '', at(2026, 11, 7, 17));
    expect(day(evening)).toBe(7);
    expect(hour(evening)).toBe(19);

    const eveningCut = resolveFollowUpAt('EVENING', '', at(2026, 11, 7, 19));
    expect(day(eveningCut)).toBe(8);
    expect(hour(eveningCut)).toBe(19);

    const laterMorning = resolveFollowUpAt('LATER', '', now);
    expect(day(laterMorning)).toBe(7);
    expect(hour(laterMorning)).toBe(14);

    const laterAfternoon = resolveFollowUpAt('LATER', '', at(2026, 11, 7, 15));
    expect(day(laterAfternoon)).toBe(8);
    expect(hour(laterAfternoon)).toBe(10);

    expect(resolveFollowUpAt('EXPLICIT', '', now).getTime()).toBe(
      at(2026, 11, 8, 10).getTime(),
    );
    expect(resolveFollowUpAt('UNKNOWN', '', now).getTime()).toBe(
      at(2026, 11, 8, 10).getTime(),
    );
  });

  it('客户给出具体时间时直接采用，不再按规则推算', () => {
    const explicit = resolveFollowUpAt('TOMORROW', '2026-11-20T15:30:00', now);
    expect(explicit.getTime()).toBe(at(2026, 11, 20, 15, 30).getTime());
  });

  it('购买与拖延信号按关键词判定', () => {
    expect(hasBuyingIntent('多少钱一套')).toBe(true);
    expect(hasBuyingIntent('怎么合作')).toBe(true);
    expect(hasBuyingIntent('随便看看')).toBe(false);

    expect(hasDelaySignal('我再考虑一下')).toBe(true);
    expect(hasDelaySignal('明天再说')).toBe(true);
    expect(hasDelaySignal('现在就买')).toBe(false);
  });

  it('渠道会话键映射到可外发渠道，官网访客不自动建跟进', () => {
    expect(followUpChannelOf('WECOM:ext-1')).toBe('WECOM');
    expect(followUpChannelOf('wechat:ext-1')).toBe('WECOM');
    expect(followUpChannelOf('XHS:user-1')).toBe('XHS_DM');
    expect(followUpChannelOf('EMAIL:a@b.com')).toBe('EMAIL');
    expect(followUpChannelOf('WEB:visitor-1')).toBe('');
    expect(followUpChannelOf('XHS')).toBe('');
  });
});

describe('radar schedule', () => {
  const from = at(2026, 11, 7, 10);

  it('空表达式不排期，别名按固定间隔顺延', () => {
    expect(nextRunAt('')).toBeNull();
    expect(nextRunAt('daily', from)?.getTime()).toBe(
      from.getTime() + 86_400_000,
    );
    expect(nextRunAt('weekly', from)?.getTime()).toBe(
      from.getTime() + 7 * 86_400_000,
    );
  });

  it('*/N 按分钟步长，定点 cron 在当天已过时顺延到次日', () => {
    expect(nextRunAt('*/15 * * * *', from)?.getTime()).toBe(
      from.getTime() + 15 * 60_000,
    );
    expect(nextRunAt('30 11 * * *', from)?.getTime()).toBe(
      at(2026, 11, 7, 11, 30).getTime(),
    );
    expect(nextRunAt('30 9 * * *', from)?.getTime()).toBe(
      at(2026, 11, 8, 9, 30).getTime(),
    );
  });

  it('无法识别的表达式按每日兜底，不返回空导致不再调度', () => {
    expect(nextRunAt('bad', from)?.getTime()).toBe(from.getTime() + 86_400_000);
  });
});

describe('reception QC', () => {
  const messages = (rows: Array<[string, string]>) =>
    rows.map(([role, text]) => ({
      role: role as 'visitor' | 'agent' | 'ai' | 'system',
      text,
      at: at(2026, 11, 7, 10),
    }));

  it('规则质检五维齐全，正向会话在信息完整与共情上得分更高', () => {
    const outcome = ruleQc(
      messages([
        ['visitor', '价格是多少？'],
        ['visitor', '有点担心，怕不合适'],
        [
          'agent',
          '价格是多少，以合同为准。理解您担心，您方便告诉我大概用量吗？确认后我发您方案，下一步安排试用。',
        ],
      ]),
      '',
    );
    expect(outcome.mode).toBe('rule');
    expect(outcome.dimensions.map((item) => item.key)).toEqual([
      'DEMAND',
      'COMPLETENESS',
      'BOUNDARY',
      'PACE',
      'EMOTION',
    ]);
    const scoreOf = (key: string) =>
      outcome.dimensions.find((item) => item.key === key)?.score;
    expect(scoreOf('DEMAND')).toBe(16);
    expect(scoreOf('COMPLETENESS')).toBe(14);
    expect(scoreOf('BOUNDARY')).toBe(20);
    expect(scoreOf('PACE')).toBe(18);
    expect(scoreOf('EMOTION')).toBe(20);
    expect(outcome.issues).toHaveLength(0);
    for (const dimension of outcome.dimensions) {
      expect(dimension.score).toBeGreaterThanOrEqual(0);
      expect(dimension.score).toBeLessThanOrEqual(20);
    }
  });

  it('绝对化承诺与忽视顾虑会被扣分并留下可复核问题', () => {
    const outcome = ruleQc(
      messages([
        ['visitor', '太贵了，算了'],
        ['agent', '保证百分百有效，绝对是最低价。'],
      ]),
      '',
    );
    const scoreOf = (key: string) =>
      outcome.dimensions.find((item) => item.key === key)?.score;
    expect(scoreOf('BOUNDARY')).toBe(0);
    expect(scoreOf('EMOTION')).toBe(9);
    expect(outcome.issues.map((item) => item.dimension)).toEqual([
      '边界合规',
      '情绪处理',
    ]);
    expect(outcome.issues[0].problem).toContain('绝对化承诺');
    expect(outcome.suggestions.length).toBeGreaterThanOrEqual(3);
  });

  it('空会话不抛错，各维度仍落在 0..20 区间', () => {
    const outcome = ruleQc([], '');
    expect(outcome.dimensions).toHaveLength(5);
    for (const dimension of outcome.dimensions) {
      expect(dimension.score).toBeGreaterThanOrEqual(0);
      expect(dimension.score).toBeLessThanOrEqual(20);
    }
  });
});
