import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { HrmScopeService, HrmOrg } from '../hrm/hrm.scope';
import type { MechanismService } from '../mechanisms/mechanism.service';
import type { AiEvalService } from '../ai/ai-eval.service';
import type { AccountCrypto } from '../account/account-crypto';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { clip, orgKey } from '../hrm/hrm.helpers';
import { kbChatMulti, parseJsonObject, resolveKbLlm } from '../kb/kb-llm';
import { httpRequest } from '../http/transport';
import type { TaskDraft } from '../task-center/task-source';
import type { Prisma } from '../../generated/prisma';

type Row = Record<string, unknown>;
type PageQuery = { page: number; pageSize: number };
const json = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue;
const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];
const text = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
};
const oneOf = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T =>
  allowed.includes(String(value) as T) ? (String(value) as T) : fallback;

type SkillInput = {
  key: string;
  label: string;
  type: 'TEXT' | 'TEXTAREA' | 'SELECT' | 'NUMBER';
  required: boolean;
  placeholder: string;
  options: string[];
};

const BUILTIN_SKILLS: Array<{
  skillKey: string;
  name: string;
  category: string;
  description: string;
  channel: string;
  promptTemplate: string;
  inputs: SkillInput[];
  outputFormat: string;
}> = [
  {
    skillKey: 'content-blog',
    name: '长文 / 博客创作',
    category: 'CONTENT',
    description: '按主题与受众产出结构化长文，含标题、大纲与正文要点。',
    channel: '官网 / 公众号',
    promptTemplate:
      '你是资深内容策划。围绕主题「{{topic}}」，面向「{{audience}}」，品牌定位「{{positioning}}」，语气「{{tone}}」。' +
      '产出结构：1 个主标题 + 3 个备选标题、5 段大纲、每段 2~3 句正文要点，结尾给行动号召。',
    inputs: [
      {
        key: 'topic',
        label: '文章主题',
        type: 'TEXT',
        required: true,
        placeholder: '例如：中小企业如何做年度内容规划',
        options: [],
      },
      {
        key: 'audience',
        label: '目标读者',
        type: 'TEXT',
        required: true,
        placeholder: '例如：市场负责人',
        options: [],
      },
      {
        key: 'positioning',
        label: '品牌定位',
        type: 'TEXTAREA',
        required: false,
        placeholder: '',
        options: [],
      },
      {
        key: 'tone',
        label: '语气风格',
        type: 'SELECT',
        required: false,
        placeholder: '',
        options: ['专业理性', '亲切口语', '犀利观点', '故事化'],
      },
    ],
    outputFormat: 'MARKDOWN',
  },
  {
    skillKey: 'social-post',
    name: '社媒多平台帖文',
    category: 'SOCIAL',
    description: '为同一活动生成公众号/小红书/微博等不同平台调性的帖文。',
    channel: '小红书 / 微博 / 公众号',
    promptTemplate:
      '你是社媒运营。活动/产品「{{topic}}」，平台「{{platform}}」，目标人群「{{audience}}」。' +
      '输出 3 条备选帖文：每条包含钩子首句、正文、3~5 个话题标签，并说明适配该平台的原因。',
    inputs: [
      {
        key: 'topic',
        label: '活动 / 产品',
        type: 'TEXT',
        required: true,
        placeholder: '',
        options: [],
      },
      {
        key: 'platform',
        label: '发布平台',
        type: 'SELECT',
        required: true,
        placeholder: '',
        options: ['小红书', '微博', '公众号', '抖音', '视频号'],
      },
      {
        key: 'audience',
        label: '目标人群',
        type: 'TEXT',
        required: false,
        placeholder: '',
        options: [],
      },
    ],
    outputFormat: 'MARKDOWN',
  },
  {
    skillKey: 'email-campaign',
    name: '邮件营销序列',
    category: 'EMAIL',
    description: '生成 3 封渐进式营销邮件：钩子、价值、转化。',
    channel: 'EDM',
    promptTemplate:
      '你是邮件营销专家。主题「{{topic}}」，受众「{{audience}}」，目标「{{goal}}」。输出 3 封邮件：' +
      '第 1 封建立认知、第 2 封给价值与案例、第 3 封转化行动；每封含主题行 A/B、正文与 CTA。',
    inputs: [
      {
        key: 'topic',
        label: '邮件主题',
        type: 'TEXT',
        required: true,
        placeholder: '',
        options: [],
      },
      {
        key: 'audience',
        label: '收件人画像',
        type: 'TEXTAREA',
        required: true,
        placeholder: '',
        options: [],
      },
      {
        key: 'goal',
        label: '转化目标',
        type: 'SELECT',
        required: false,
        placeholder: '',
        options: ['预约演示', '下载资料', '直接购买', '活动报名'],
      },
    ],
    outputFormat: 'MARKDOWN',
  },
  {
    skillKey: 'seo-brief',
    name: 'SEO 落地页简报',
    category: 'SEO',
    description: '根据关键词生成落地页 brief：搜索意图、结构、标题与内链建议。',
    channel: '官网',
    promptTemplate:
      '你是 SEO 顾问。目标关键词「{{keyword}}」，页面类型「{{pageType}}」。输出：搜索意图判断、H1/H2 结构、' +
      '标题与 meta 描述、需覆盖的长尾词 10 个、内链与外链建议、结构化数据建议。',
    inputs: [
      {
        key: 'keyword',
        label: '目标关键词',
        type: 'TEXT',
        required: true,
        placeholder: '',
        options: [],
      },
      {
        key: 'pageType',
        label: '页面类型',
        type: 'SELECT',
        required: false,
        placeholder: '',
        options: ['产品页', '专题页', '博客', '落地页'],
      },
    ],
    outputFormat: 'BRIEF',
  },
  {
    skillKey: 'seo-audit-brief',
    name: 'SEO 体检解读简报',
    category: 'SEO',
    description:
      '编排技能：选站点项目与体检批次，运行时拉取 SEO 体检数据（健康分/问题清单），再产出 prioritized 修复简报。',
    channel: '官网',
    promptTemplate:
      '你是 SEO 技术顾问。以下是站点「{{domain}}」最近一次体检的实测数据：\n{{seoData}}\n' +
      '请基于这些真实数据产出体检解读简报：1 总体健康判断、2 按严重度排序的 Top 问题与影响、3 每个问题的具体修复动作、4 两周内的优先行动清单。不要编造数据里没有的问题。',
    inputs: [
      {
        key: 'projectId',
        label: '站点项目 ID',
        type: 'NUMBER',
        required: true,
        placeholder: 'SEO 工作台里的项目 ID',
        options: [],
      },
      {
        key: 'auditId',
        label: '体检批次 ID（留空取最近一次）',
        type: 'NUMBER',
        required: false,
        placeholder: '',
        options: [],
      },
      {
        key: 'domain',
        label: '站点域名（便于识别）',
        type: 'TEXT',
        required: false,
        placeholder: 'example.com',
        options: [],
      },
    ],
    outputFormat: 'BRIEF',
  },
  {
    skillKey: 'seo-keyword-brief',
    name: 'SEO 词库机会简报',
    category: 'SEO',
    description:
      '编排技能：选站点项目，运行时拉取 SEO 词库与聚类，再产出机会词与落地页映射简报。',
    channel: '官网',
    promptTemplate:
      '你是 SEO 内容策略师。以下是站点「{{domain}}」词库的实测/估计数据：\n{{seoData}}\n' +
      '请基于这些真实词产出机会简报：1 高机会词（量级/难度/意图综合）Top 10、2 按意图聚类的落地页映射建议、3 内容缺口与优先创作顺序、4 每个机会词的标题与角度建议。标注哪些是 AI 估计而非实测，不要编造搜索量。',
    inputs: [
      {
        key: 'projectId',
        label: '站点项目 ID',
        type: 'NUMBER',
        required: true,
        placeholder: 'SEO 工作台里的项目 ID',
        options: [],
      },
      {
        key: 'focus',
        label: '聚焦主题（可选）',
        type: 'TEXT',
        required: false,
        placeholder: '如：转化词 / 长尾问答',
        options: [],
      },
      {
        key: 'domain',
        label: '站点域名（便于识别）',
        type: 'TEXT',
        required: false,
        placeholder: 'example.com',
        options: [],
      },
    ],
    outputFormat: 'BRIEF',
  },
  {
    skillKey: 'ads-copy',
    name: '广告投放文案 A/B',
    category: 'ADS',
    description: '产出 3 组广告标题与描述，给出差异化假设。',
    channel: '信息流 / 搜索',
    promptTemplate:
      '你是效果广告文案。产品卖点「{{sellingPoint}}」，投放渠道「{{channel}}」，预算敏感度「{{budget}}」。' +
      '输出 3 组 A/B 文案（标题 ≤30 字、描述 ≤60 字），每组标注假设与适配人群。',
    inputs: [
      {
        key: 'sellingPoint',
        label: '核心卖点',
        type: 'TEXTAREA',
        required: true,
        placeholder: '',
        options: [],
      },
      {
        key: 'channel',
        label: '投放渠道',
        type: 'SELECT',
        required: false,
        placeholder: '',
        options: ['信息流', '搜索', '朋友圈', '开屏'],
      },
      {
        key: 'budget',
        label: '预算水平',
        type: 'SELECT',
        required: false,
        placeholder: '',
        options: ['低', '中', '高'],
      },
    ],
    outputFormat: 'MARKDOWN',
  },
  {
    skillKey: 'market-research',
    name: '竞品调研提纲',
    category: 'RESEARCH',
    description: '围绕竞品与目标客群生成调研提纲与访谈问题。',
    channel: '调研',
    promptTemplate:
      '你是市场研究员。研究主题「{{topic}}」，已知竞品「{{competitors}}」。输出：研究目标、桌面研究清单、' +
      '竞品对比维度表建议、10 个用户访谈问题（分认知/决策/流失三组）。',
    inputs: [
      {
        key: 'topic',
        label: '研究主题',
        type: 'TEXT',
        required: true,
        placeholder: '',
        options: [],
      },
      {
        key: 'competitors',
        label: '已知竞品',
        type: 'TEXT',
        required: false,
        placeholder: '逗号分隔',
        options: [],
      },
    ],
    outputFormat: 'BRIEF',
  },
  {
    skillKey: 'sales-pitch',
    name: '销售异议应对话术',
    category: 'SALES',
    description: '针对常见客户异议，生成可复用的应对话术与证据清单。',
    channel: '销售',
    promptTemplate:
      '你是销售赋能顾问。客户异议「{{objection}}」，产品「{{product}}」。输出：异议背后的真实顾虑、' +
      '3 段应对话术（共情-证据-推进）、需要准备的证据材料清单、后续跟进动作。',
    inputs: [
      {
        key: 'objection',
        label: '客户异议',
        type: 'TEXTAREA',
        required: true,
        placeholder: '',
        options: [],
      },
      {
        key: 'product',
        label: '产品 / 方案',
        type: 'TEXT',
        required: false,
        placeholder: '',
        options: [],
      },
    ],
    outputFormat: 'MARKDOWN',
  },
];

const CAPABILITIES = [
  { key: 'wechat-mp', name: '微信公众号', category: 'SOCIAL' },
  { key: 'weibo', name: '微博', category: 'SOCIAL' },
  { key: 'douyin', name: '抖音', category: 'SOCIAL' },
  { key: 'xiaohongshu', name: '小红书', category: 'SOCIAL' },
  { key: 'linkedin', name: '领英', category: 'SOCIAL' },
  { key: 'x', name: 'X（Twitter）', category: 'SOCIAL' },
  { key: 'smtp', name: '邮件发送通道', category: 'EMAIL' },
  { key: 'cms-webhook', name: '站点 CMS 回调', category: 'CONTENT' },
];

/** 简易 cron（分 时 日 月 周）：支持定点 `m h * * *` 与每 N 分钟步进，其余回落每日一次。 */
function nextRunAt(cron: string, from = new Date()): Date {
  const parts = String(cron || '')
    .trim()
    .split(/\s+/);
  if (parts.length >= 2 && /^\*\/\d+$/.test(parts[0])) {
    const step = Math.max(1, Number(parts[0].slice(2)) || 60);
    return new Date(from.getTime() + step * 60_000);
  }
  const minute = Number(parts[0]);
  const hour = Number(parts[1]);
  const base = new Date(from.getTime());
  if (
    Number.isInteger(minute) &&
    Number.isInteger(hour) &&
    minute >= 0 &&
    minute < 60 &&
    hour >= 0 &&
    hour < 24
  ) {
    const next = new Date(base.getTime());
    next.setUTCSeconds(0, 0);
    next.setUTCHours(hour, minute, 0, 0);
    if (next <= base) next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }
  return new Date(base.getTime() + 86_400_000);
}

/**
 * §5.5 营销技能库：内置技能（内容/社媒/邮件/SEO/广告/调研/销售）+ 组织自定义技能；
 * 运行走统一 LLM 通道，缺 Key 时规则式产出；结果可沉淀为内容资产并发 `mkt.*` 事件。
 * 平台账号仅存密文凭据；能力调用优先走配置的 webhook，否则落本地内容资产（不外发）。
 */
/** 任务中心只用到「派发 + 回写状态」两个写入口（与 TaskCenterService 同签名）。 */
type TaskPort = {
  assign(draft: TaskDraft): Promise<unknown>;
  syncStatus(input: {
    source: string;
    sourceId: string;
    assigneeUserId: string;
    sourceStatus?: string;
    sourceStatusLabel?: string;
    terminal?: boolean;
  }): Promise<unknown>;
};

/** 审核岗位口径（docs §8.4：品牌负责人/审核岗位）：角色码或岗位名称任一命中即可。 */
const MKT_REVIEW_ROLES = [
  'ADMIN',
  'OWNER',
  'MARKETING',
  'BRAND',
  'CONTENT',
  'OPS',
  'OPERATION',
  'REVIEWER',
];
const MKT_REVIEW_KEYWORDS = ['品牌', '市场', '营销', '审核', '内容'];
/** 发布岗位口径（运营人员或代运营服务商）：角色码或岗位名称任一命中即可。 */
const MKT_PUBLISH_ROLES = [
  'ADMIN',
  'OWNER',
  'MARKETING',
  'OPS',
  'OPERATION',
  'CONTENT',
];
const MKT_PUBLISH_KEYWORDS = ['运营', '投放', '发布', '市场', '新媒体'];

export class MktService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: HrmScopeService,
    private readonly mechanisms: MechanismService,
    private readonly aiEval: AiEvalService,
    private readonly crypto: AccountCrypto,
    /** 任务中心（docs §8.4）：内容生成→审核→渠道发布的任务派发与收口。 */
    private readonly tasks?: TaskPort,
  ) {}

  private async org(user: CurrentUser): Promise<HrmOrg> {
    return this.scope.resolve(user);
  }

  private emit(org: HrmOrg, event: string, payload: Row) {
    void this.mechanisms.dispatch(org, event, payload).catch(() => undefined);
  }

  /** 按「角色码 → 岗位名称关键词」找承办人；找不到回落组织负责人。 */
  private async staffOf(
    org: HrmOrg,
    roles: readonly string[],
    keywords: readonly string[],
  ): Promise<string> {
    const rows = await this.prisma.orgStaff.findMany({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        status: 'ACTIVE',
      },
      select: { memberUserId: true, roles: true, positions: true },
    });
    const hit = rows.find((row) => {
      const codes = Array.isArray(row.roles)
        ? (row.roles as unknown[]).map((item) => String(item).toUpperCase())
        : [];
      if (codes.some((code) => roles.includes(code))) return true;
      const names = Array.isArray(row.positions)
        ? (row.positions as { name?: unknown }[])
            .map((item) =>
              typeof item?.name === 'string' ? item.name.toLowerCase() : '',
            )
            .filter(Boolean)
        : [];
      return names.some((name) =>
        keywords.some((keyword) => name.includes(keyword)),
      );
    });
    return hit?.memberUserId || org.orgUserId;
  }

  /** 审核权限：组织管理员或审核岗位（角色码/岗位名称任一命中）。 */
  private canReview(org: HrmOrg): boolean {
    if (org.isAdmin || org.isOwner) return true;
    const roles = org.roles.map((role) => role.toUpperCase());
    if (roles.some((role) => MKT_REVIEW_ROLES.includes(role))) return true;
    return org.positions.some((position) =>
      MKT_REVIEW_KEYWORDS.some((keyword) =>
        position.toLowerCase().includes(keyword),
      ),
    );
  }

  /** 内容生成完成 → 「内容审核」待办（幂等锚＝资产 + 审核轮次）。 */
  private async openReviewTask(
    org: HrmOrg,
    artifact: { id: number; title: string; reviewRound: number },
  ) {
    if (!this.tasks) return;
    const assignee = await this.staffOf(
      org,
      MKT_REVIEW_ROLES,
      MKT_REVIEW_KEYWORDS,
    );
    await this.tasks
      .assign({
        assigneeUserId: assignee,
        source: 'mkt',
        sourceId: `review:${artifact.id}:r${artifact.reviewRound}`,
        title: `内容审核：${artifact.title}`,
        description: `生成完成的内容资产 #${artifact.id} 待审核；通过后自动派发渠道发布待办，驳回则退回修改。`,
        link: '/marketing-tools',
        category: 'audit',
        priority: 'HIGH',
        createdBy: org.actorId,
        sourceStatus: 'PENDING',
        sourceStatusLabel: '待审核',
      })
      .catch(() => null);
  }

  /** 内容审核通过 → 「渠道发布」待办（幂等锚＝资产 + 审核轮次）。 */
  private async openPublishTask(
    org: HrmOrg,
    artifact: { id: number; title: string; reviewRound: number },
  ) {
    if (!this.tasks) return;
    const assignee = await this.staffOf(
      org,
      MKT_PUBLISH_ROLES,
      MKT_PUBLISH_KEYWORDS,
    );
    await this.tasks
      .assign({
        assigneeUserId: assignee,
        source: 'mkt',
        sourceId: `publish:${artifact.id}:r${artifact.reviewRound}`,
        title: `渠道发布：${artifact.title}`,
        description: `内容已审核通过，请按渠道发布并在内容资产回填执行回执（渠道、结果）。`,
        link: '/marketing-tools',
        category: 'matter',
        priority: 'HIGH',
        createdBy: org.actorId,
        sourceStatus: 'PENDING',
        sourceStatusLabel: '待发布',
      })
      .catch(() => null);
  }

  /** 审核/发布任务回写：同一轮次的任务终态收口（状态文案留痕）。 */
  private async syncArtifactTask(
    org: HrmOrg,
    kind: 'review' | 'publish',
    artifactId: number,
    round: number,
    label: string,
    terminal: boolean,
  ) {
    if (!this.tasks) return;
    const assignee =
      kind === 'review'
        ? await this.staffOf(org, MKT_REVIEW_ROLES, MKT_REVIEW_KEYWORDS)
        : await this.staffOf(org, MKT_PUBLISH_ROLES, MKT_PUBLISH_KEYWORDS);
    await this.tasks
      .syncStatus({
        source: 'mkt',
        sourceId: `${kind}:${artifactId}:r${round}`,
        assigneeUserId: assignee,
        sourceStatusLabel: label,
        terminal,
      })
      .catch(() => null);
  }

  private async ensureBuiltinSkills(org: HrmOrg) {
    for (const skill of BUILTIN_SKILLS) {
      await this.prisma.mktSkill.upsert({
        where: {
          orgType_orgUserId_skillKey: {
            orgType: org.orgType,
            orgUserId: org.orgUserId,
            skillKey: skill.skillKey,
          },
        },
        create: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          skillKey: skill.skillKey,
          name: skill.name,
          category: skill.category,
          description: skill.description,
          channel: skill.channel,
          promptTemplate: skill.promptTemplate,
          inputs: json(skill.inputs),
          outputFormat: skill.outputFormat,
          builtin: true,
          enabled: true,
          createdBy: org.actorId,
        },
        update: {},
      });
    }
  }

  private skillView(row: {
    id: number;
    skillKey: string;
    name: string;
    category: string;
    description: string;
    channel: string;
    promptTemplate: string;
    inputs: unknown;
    outputFormat: string;
    builtin: boolean;
    enabled: boolean;
    runCount: number;
    updatedAt: Date;
  }) {
    const inputs: SkillInput[] = Array.isArray(row.inputs)
      ? (row.inputs as Row[]).map((item) => ({
          key: clip(item.key, 40),
          label: clip(item.label, 60),
          type: oneOf(
            item.type,
            ['TEXT', 'TEXTAREA', 'SELECT', 'NUMBER'] as const,
            'TEXT',
          ),
          required: item.required !== false,
          placeholder: clip(item.placeholder, 120),
          options: strArr(item.options)
            .slice(0, 20)
            .map((option) => clip(option, 60)),
        }))
      : [];
    return {
      id: row.id,
      key: row.skillKey,
      name: row.name,
      category: row.category,
      description: row.description,
      channel: row.channel,
      promptTemplate: row.promptTemplate,
      inputs,
      outputFormat: row.outputFormat,
      builtin: row.builtin,
      enabled: row.enabled,
      runCount: row.runCount,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async listSkills(
    user: CurrentUser,
    query: { category?: string; q?: string; enabled?: boolean },
  ) {
    const org = await this.org(user);
    await this.ensureBuiltinSkills(org);
    const where: Prisma.MktSkillWhereInput = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
    };
    if (query.category) where.category = query.category;
    if (typeof query.enabled === 'boolean') where.enabled = query.enabled;
    if (query.q) {
      where.OR = [
        { name: { contains: query.q } },
        { description: { contains: query.q } },
        { skillKey: { contains: query.q } },
      ];
    }
    const rows = await this.prisma.mktSkill.findMany({
      where,
      orderBy: [{ builtin: 'desc' }, { id: 'asc' }],
    });
    return rows.map((row) => this.skillView(row));
  }

  private async requireSkill(org: HrmOrg, key: string) {
    await this.ensureBuiltinSkills(org);
    const row = await this.prisma.mktSkill.findUnique({
      where: {
        orgType_orgUserId_skillKey: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          skillKey: clip(key, 40),
        },
      },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '技能不存在');
    return row;
  }

  async getSkill(user: CurrentUser, key: string) {
    const org = await this.org(user);
    return this.skillView(await this.requireSkill(org, key));
  }

  async saveSkill(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    await this.ensureBuiltinSkills(org);
    const id = num(body.id);
    const skillKey = clip(body.key, 40);
    const data = {
      skillKey,
      name: clip(body.name, 60),
      category: oneOf(
        body.category,
        [
          'CONTENT',
          'SOCIAL',
          'EMAIL',
          'SEO',
          'ADS',
          'RESEARCH',
          'SALES',
        ] as const,
        'CONTENT',
      ),
      description: clip(body.description, 500),
      channel: clip(body.channel, 40),
      promptTemplate: clip(body.promptTemplate, 8000),
      inputs: json(Array.isArray(body.inputs) ? body.inputs.slice(0, 12) : []),
      outputFormat: oneOf(
        body.outputFormat,
        ['TEXT', 'MARKDOWN', 'JSON', 'BRIEF'] as const,
        'MARKDOWN',
      ),
      enabled: body.enabled !== false,
    };
    if (!skillKey || !data.name)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写技能编码与名称',
      );
    if (data.promptTemplate.length < 5)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '提示词至少 5 个字符');
    if (id) {
      const existing = await this.prisma.mktSkill.findFirst({
        where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
      });
      if (!existing)
        throw new BusinessException(ErrorCode.NOT_FOUND, '技能不存在');
      const row = await this.prisma.mktSkill.update({ where: { id }, data });
      return this.skillView(row);
    }
    const existing = await this.prisma.mktSkill.findUnique({
      where: {
        orgType_orgUserId_skillKey: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          skillKey,
        },
      },
    });
    if (existing)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '技能编码已存在，请换一个编码',
      );
    const row = await this.prisma.mktSkill.create({
      data: { ...orgKey(org), ...data, builtin: false, createdBy: org.actorId },
    });
    return this.skillView(row);
  }

  private async brandContext(org: HrmOrg) {
    const row = await this.prisma.mktContext.findUnique({
      where: {
        orgType_orgUserId: { orgType: org.orgType, orgUserId: org.orgUserId },
      },
    });
    return {
      brandName: row?.brandName || '',
      industry: row?.industry || '',
      positioning: row?.positioning || '',
      tone: row?.tone || '',
      audiences: strArr(row?.audiences),
      keywords: strArr(row?.keywords),
      competitors: strArr(row?.competitors),
    };
  }

  /** 编排技能运行时取数：按 org 隔离读 SEO 体检/词库，拼成紧凑文本注入 prompt（不改技能机制）。 */
  private async seoBriefData(
    org: HrmOrg,
    skillKey: string,
    input: Record<string, string>,
  ): Promise<string> {
    const projectId = Number(input.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0)
      return '（未提供有效的站点项目 ID，无法取数；请在 SEO 工作台确认项目 ID 后重试）';
    const project = await this.prisma.seoProject.findFirst({
      where: { id: projectId, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!project) return '（未找到该站点项目，或当前组织无权访问；不编造数据）';
    const head = `站点：${project.domain}${project.brandName ? `（${project.brandName}）` : ''}`;

    if (skillKey === 'seo-audit-brief') {
      const auditId = Number(input.auditId);
      const audit = await this.prisma.seoAudit.findFirst({
        where: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          projectId,
          ...(Number.isInteger(auditId) && auditId > 0
            ? { id: auditId }
            : { status: 'DONE' }),
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!audit)
        return `${head}\n（该项目尚无已完成的体检批次；请先在 SEO 工作台跑一次站点体检）`;
      const issues = await this.prisma.seoAuditIssue.findMany({
        where: { auditId: audit.id },
        orderBy: [{ severity: 'asc' }, { id: 'asc' }],
        take: 40,
      });
      const lines = issues.map(
        (i) =>
          `- [${i.severity}] ${i.type} @ ${i.url || '全站'}：${clip(i.detail, 160)}${i.fixHint ? `（建议：${clip(i.fixHint, 120)}）` : ''}`,
      );
      return clip(
        [
          head,
          `体检批次 #${audit.id} · 健康分 ${audit.healthScore ?? '—'} · 抓取 ${audit.pageCount} 页 · 问题 ${audit.issueCount}（严重 ${audit.criticalCount} / 警告 ${audit.warningCount}）`,
          '问题清单（按严重度，最多 40 条）：',
          ...(lines.length ? lines : ['（本次体检未发现问题）']),
        ].join('\n'),
        6000,
      );
    }

    const keywords = await this.prisma.seoKeyword.findMany({
      where: { orgType: org.orgType, orgUserId: org.orgUserId, projectId },
      orderBy: [{ volume: 'desc' }, { id: 'asc' }],
      take: 60,
    });
    const clusters = await this.prisma.seoKeywordCluster.findMany({
      where: { orgType: org.orgType, orgUserId: org.orgUserId, projectId },
      take: 30,
    });
    if (keywords.length === 0)
      return `${head}\n（该项目词库为空；请先在 SEO 工作台做关键词研究并入库）`;
    const sourceLabel: Record<string, string> = {
      DATAFORSEO: '实测',
      AI: 'AI估计',
      GSC: 'GSC',
    };
    const kwLines = keywords.map(
      (k) =>
        `- ${k.keyword} · 量 ${k.volume ?? '—'} · 难度 ${k.difficulty ?? '—'} · CPC ${k.cpc ?? '—'} · 意图 ${k.intent || '—'} · 来源 ${sourceLabel[k.source] || k.source}`,
    );
    const clusterLines = clusters.map(
      (c) =>
        `- 簇「${c.name}」意图 ${c.intent || '—'} → ${c.mappedPageUrl || '未映射页面'}`,
    );
    return clip(
      [
        head,
        `词库（最多 60 条，按搜索量降序；标注实测/AI估计）：`,
        ...kwLines,
        ...(clusterLines.length ? ['聚类与落地页映射：', ...clusterLines] : []),
      ].join('\n'),
      6000,
    );
  }

  private renderPrompt(
    template: string,
    skill: { name: string; outputFormat: string },
    input: Record<string, string>,
    context: Awaited<ReturnType<MktService['brandContext']>>,
  ) {
    let text = String(template || '');
    for (const [key, value] of Object.entries(input)) {
      text = text.split(`{{${key}}}`).join(String(value ?? ''));
    }
    text = text.replace(/\{\{\w+\}\}/g, '（未提供）');
    const contextLine = [
      context.brandName ? `品牌：${context.brandName}` : '',
      context.industry ? `行业：${context.industry}` : '',
      context.positioning ? `定位：${context.positioning}` : '',
      context.tone ? `语气：${context.tone}` : '',
      context.audiences.length ? `受众：${context.audiences.join('、')}` : '',
      context.keywords.length ? `关键词：${context.keywords.join('、')}` : '',
    ]
      .filter(Boolean)
      .join('；');
    return `任务：${skill.name}（输出格式 ${skill.outputFormat}）\n${contextLine ? `品牌背景：${contextLine}\n` : ''}${text}`;
  }

  /** 无 Key / LLM 失败时的规则式产出：按技能类目给可执行结构。 */
  private ruleOutput(
    skill: { name: string; category: string; inputs: SkillInput[] },
    input: Record<string, string>,
  ) {
    const filled = skill.inputs
      .map((item) => `${item.label}：${input[item.key] || '（未提供）'}`)
      .join('\n');
    const framework: Record<string, string[]> = {
      CONTENT: [
        '主标题 + 3 个备选标题',
        '5 段大纲：痛点 → 洞察 → 方法 → 案例 → 行动',
        '每段给 2~3 句正文要点',
      ],
      SOCIAL: [
        '钩子首句（前 15 字抓注意）',
        '正文 3 句：场景 → 价值 → 行动',
        '3~5 个话题标签',
      ],
      EMAIL: [
        '主题行 A/B（≤30 字）',
        '正文：问题共鸣 → 解决方案 → 证据',
        '单一 CTA 与发送节奏建议',
      ],
      SEO: [
        '搜索意图与目标读者',
        'H1/H2 结构 + 标题/meta 描述',
        '长尾词 10 个与内链建议',
      ],
      ADS: ['核心卖点一句话', '3 组标题/描述 A/B', '每组假设与适配人群'],
      RESEARCH: [
        '研究目标与决策问题',
        '桌面研究清单与竞品维度',
        '访谈问题 10 个（认知/决策/流失）',
      ],
      SALES: [
        '异议背后的真实顾虑',
        '共情-证据-推进三段话术',
        '证据材料与跟进动作',
      ],
    };
    return [
      `# ${skill.name}`,
      '',
      '## 输入要点',
      filled || '（未填写）',
      '',
      '## 建议框架',
      ...(framework[skill.category] || framework.CONTENT).map(
        (line, index) => `${index + 1}. ${line}`,
      ),
      '',
      '## 备注',
      '当前未接入大模型或调用失败，以上为规则式提纲；配置可用的模型通道后可生成完整文案。',
    ].join('\n');
  }

  private runView(row: {
    id: number;
    skillId: number;
    skillKey: string;
    skillName: string;
    status: string;
    mode: string;
    input: unknown;
    output: string;
    artifactId: number | null;
    tokens: number;
    points: number;
    error: string;
    createdAt: Date;
  }) {
    const input =
      row.input && typeof row.input === 'object' && !Array.isArray(row.input)
        ? Object.fromEntries(
            Object.entries(row.input as Record<string, unknown>).map(
              ([key, value]) => [key, text(value)],
            ),
          )
        : {};
    return {
      id: row.id,
      skillId: row.skillId,
      skillKey: row.skillKey,
      skillName: row.skillName,
      status: row.status as 'RUNNING' | 'DONE' | 'FAILED',
      mode: row.mode as 'llm' | 'rule',
      input,
      output: row.output,
      artifactId: row.artifactId,
      tokens: row.tokens,
      points: row.points,
      error: row.error,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async runSkill(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const skill = await this.requireSkill(org, text(body.skillKey));
    if (!skill.enabled)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '技能已停用，请先在技能库启用',
      );
    const input =
      body.input && typeof body.input === 'object' && !Array.isArray(body.input)
        ? Object.fromEntries(
            Object.entries(body.input as Record<string, unknown>).map(
              ([key, value]) => [key, clip(value, 4000)],
            ),
          )
        : {};
    const run = await this.prisma.mktSkillRun.create({
      data: {
        ...orgKey(org),
        skillId: skill.id,
        skillKey: skill.skillKey,
        skillName: skill.name,
        status: 'RUNNING',
        input: json(input),
        createdBy: org.actorId,
      },
    });
    const context = await this.brandContext(org);
    const inputs = Array.isArray(skill.inputs)
      ? (skill.inputs as SkillInput[])
      : [];
    if (
      skill.skillKey === 'seo-audit-brief' ||
      skill.skillKey === 'seo-keyword-brief'
    ) {
      input.seoData = await this.seoBriefData(org, skill.skillKey, input);
    }
    const prompt = this.renderPrompt(
      skill.promptTemplate,
      skill,
      input,
      context,
    );
    const channel = await resolveKbLlm(this.prisma, user.userId);
    const llm = await kbChatMulti(
      channel,
      [
        {
          role: 'system',
          content:
            '你是企业营销内容助手。严格按用户给出的结构与输出格式生成中文内容；不要编造未提供的品牌事实，缺失信息用「待补充」标注。',
        },
        { role: 'user', content: prompt },
      ],
      user.userId,
      1600,
    );
    const mode: 'llm' | 'rule' = llm ? 'llm' : 'rule';
    const output = llm
      ? llm.reply.trim()
      : this.ruleOutput({ ...skill, inputs }, input);
    let artifactId: number | null = null;
    if (body.persistArtifact !== false) {
      const artifact = await this.prisma.mktArtifact.create({
        data: {
          ...orgKey(org),
          title: clip(
            `${skill.name} · ${Object.values(input)[0] || new Date().toISOString().slice(0, 10)}`,
            120,
          ),
          kind: 'COPY',
          body: output,
          status: 'READY',
          sourceRunId: run.id,
          // 生成完成即进入内容审核（docs §8.4）；审核通过后再派渠道发布待办。
          reviewStatus: 'PENDING',
          reviewRound: 1,
          publishStatus: 'NONE',
          createdBy: org.actorId,
        },
      });
      artifactId = artifact.id;
      await this.openReviewTask(org, artifact);
    }
    const tokens = llm
      ? (llm.promptTokens || 0) + (llm.completionTokens || 0)
      : 0;
    let points = 0;
    if (llm) {
      const charged = await this.aiEval
        .chargeByUsage(
          user.userId,
          'mkt_skill_run',
          {
            tokenIn: llm.promptTokens,
            tokenOut: llm.completionTokens,
            call: 1,
          },
          `mkt-run:${run.id}`,
        )
        .catch(() => 0);
      points = Math.round(charged);
    }
    const updated = await this.prisma.mktSkillRun.update({
      where: { id: run.id },
      data: {
        status: 'DONE',
        mode,
        output,
        artifactId,
        tokens,
        points,
        finishedAt: new Date(),
      },
    });
    await this.prisma.mktSkill.update({
      where: { id: skill.id },
      data: { runCount: { increment: 1 } },
    });
    this.emit(org, 'mkt.skill.run', {
      runId: run.id,
      skillKey: skill.skillKey,
      mode,
      artifactId,
      tokens,
    });
    return this.runView(updated);
  }

  async listRuns(
    user: CurrentUser,
    query: PageQuery & { skillKey?: string; status?: string },
  ) {
    const org = await this.org(user);
    const where: Prisma.MktSkillRunWhereInput = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
    };
    if (query.skillKey) where.skillKey = query.skillKey;
    if (query.status) where.status = query.status;
    const [total, rows] = await Promise.all([
      this.prisma.mktSkillRun.count({ where }),
      this.prisma.mktSkillRun.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      list: rows.map((row) => this.runView(row)),
    };
  }

  private artifactView(row: {
    id: number;
    title: string;
    kind: string;
    body: string;
    status: string;
    sourceRunId: number | null;
    reviewStatus: string;
    reviewRound: number;
    reviewerId: string;
    reviewedAt: Date | null;
    reviewNote: string;
    publishStatus: string;
    publishChannel: string;
    publishNote: string;
    publishedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      title: row.title,
      kind: row.kind,
      body: row.body,
      status: row.status as 'DRAFT' | 'READY' | 'ARCHIVED',
      sourceRunId: row.sourceRunId,
      reviewStatus: row.reviewStatus as
        'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED',
      reviewRound: row.reviewRound,
      reviewerId: row.reviewerId,
      reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : '',
      reviewNote: row.reviewNote,
      publishStatus: row.publishStatus as 'NONE' | 'PENDING' | 'PUBLISHED',
      publishChannel: row.publishChannel,
      publishNote: row.publishNote,
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : '',
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async listArtifacts(
    user: CurrentUser,
    query: PageQuery & {
      kind?: string;
      status?: string;
      reviewStatus?: string;
      publishStatus?: string;
      q?: string;
    },
  ) {
    const org = await this.org(user);
    const where: Prisma.MktArtifactWhereInput = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
    };
    if (query.kind) where.kind = query.kind;
    if (query.status) where.status = query.status;
    if (query.reviewStatus) where.reviewStatus = query.reviewStatus;
    if (query.publishStatus) where.publishStatus = query.publishStatus;
    if (query.q)
      where.OR = [
        { title: { contains: query.q } },
        { body: { contains: query.q } },
      ];
    const [total, rows] = await Promise.all([
      this.prisma.mktArtifact.count({ where }),
      this.prisma.mktArtifact.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      list: rows.map((row) => this.artifactView(row)),
    };
  }

  async saveArtifact(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const id = num(body.id);
    const data = {
      title: clip(body.title, 120),
      kind: clip(body.kind, 24) || 'COPY',
      body: clip(body.body, 20000),
      status: oneOf(
        body.status,
        ['DRAFT', 'READY', 'ARCHIVED'] as const,
        'DRAFT',
      ),
      sourceRunId: num(body.sourceRunId) || null,
    };
    if (!data.title || !data.body)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写标题与内容');
    if (id) {
      const existing = await this.prisma.mktArtifact.findFirst({
        where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
      });
      if (!existing)
        throw new BusinessException(ErrorCode.NOT_FOUND, '内容资产不存在');
      // 已进入审核链路的内容（生成产出）一改就要重新审：内容版本变了，
      // 原审核结论不再成立；旧轮次的审核/发布任务就地收口，避免留下僵尸待办。
      const changed =
        data.body !== existing.body ||
        data.title !== existing.title ||
        data.kind !== existing.kind;
      const needsReview = changed && existing.reviewStatus !== 'NONE';
      const roundBump =
        needsReview &&
        (existing.reviewStatus === 'APPROVED' ||
          existing.reviewStatus === 'REJECTED');
      const reviewRound = roundBump
        ? existing.reviewRound + 1
        : existing.reviewRound;
      const row = await this.prisma.mktArtifact.update({
        where: { id },
        data: {
          ...data,
          ...(needsReview
            ? {
                status: 'READY',
                reviewStatus: 'PENDING',
                reviewRound,
                reviewerId: '',
                reviewedAt: null,
                reviewNote: '',
                publishStatus: 'NONE',
                publishChannel: '',
                publishNote: '',
                publishedAt: null,
              }
            : {}),
        },
      });
      if (roundBump) {
        await this.syncArtifactTask(
          org,
          'review',
          existing.id,
          existing.reviewRound,
          '内容已更新，原审核结论失效',
          true,
        );
        await this.syncArtifactTask(
          org,
          'publish',
          existing.id,
          existing.reviewRound,
          '内容已更新，需重新审核后发布',
          true,
        );
      }
      if (needsReview) await this.openReviewTask(org, row);
      return this.artifactView(row);
    }
    const row = await this.prisma.mktArtifact.create({
      data: { ...orgKey(org), ...data, createdBy: org.actorId },
    });
    return this.artifactView(row);
  }

  /**
   * 内容审核（docs §8.4）：通过 → 资产可用并派「渠道发布」待办；驳回 → 退回草稿。
   * 审核结论与内容版本绑在资产上，任务中心只做派发与收口。
   */
  async reviewArtifact(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    if (!this.canReview(org)) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只有品牌负责人或审核岗位可以审核内容',
      );
    }
    const decision =
      body.decision === 'approve'
        ? 'approve'
        : body.decision === 'reject'
          ? 'reject'
          : '';
    if (!decision) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择审核结论');
    }
    const id = num(body.id);
    const row = await this.prisma.mktArtifact.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '内容资产不存在');
    if (row.reviewStatus !== 'PENDING') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        row.reviewStatus === 'APPROVED'
          ? '该内容已审核通过，无需重复审核'
          : row.reviewStatus === 'REJECTED'
            ? '该内容已被驳回，请修改后重新提交审核'
            : '该内容不在待审核状态',
      );
    }
    const approve = decision === 'approve';
    const note = clip(body.note, 500);
    const updated = await this.prisma.mktArtifact.update({
      where: { id: row.id },
      data: {
        reviewStatus: approve ? 'APPROVED' : 'REJECTED',
        reviewerId: org.actorId,
        reviewedAt: new Date(),
        reviewNote: note,
        status: approve ? 'READY' : 'DRAFT',
        publishStatus: approve ? 'PENDING' : 'NONE',
        ...(approve
          ? {}
          : {
              publishChannel: '',
              publishNote: '',
              publishedAt: null,
            }),
      },
    });
    await this.syncArtifactTask(
      org,
      'review',
      row.id,
      row.reviewRound,
      approve ? '审核通过' : '审核驳回',
      true,
    );
    if (approve) {
      await this.openPublishTask(org, updated);
    }
    this.emit(
      org,
      approve ? 'mkt.artifact.approved' : 'mkt.artifact.rejected',
      {
        artifactId: row.id,
        reviewRound: row.reviewRound,
        reviewerId: org.actorId,
        note,
      },
    );
    return this.artifactView(updated);
  }

  /** 渠道发布回执（docs §8.4）：审核通过后回填渠道与执行结果，发布任务收口。 */
  async publishArtifact(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const id = num(body.id);
    const row = await this.prisma.mktArtifact.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '内容资产不存在');
    if (row.publishStatus === 'PUBLISHED') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该内容已发布，请勿重复回填',
      );
    }
    if (row.reviewStatus !== 'APPROVED') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '内容需审核通过后才能发布',
      );
    }
    const channel = clip(body.channel, 60).trim();
    if (!channel) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写发布渠道');
    }
    const note = clip(body.note, 500);
    const updated = await this.prisma.mktArtifact.update({
      where: { id: row.id },
      data: {
        publishStatus: 'PUBLISHED',
        publishChannel: channel,
        publishNote: note,
        publishedAt: new Date(),
      },
    });
    await this.syncArtifactTask(
      org,
      'publish',
      row.id,
      row.reviewRound,
      `已发布：${channel}`,
      true,
    );
    this.emit(org, 'mkt.artifact.published', {
      artifactId: row.id,
      channel,
      publishRound: row.reviewRound,
    });
    return this.artifactView(updated);
  }

  async readContext(user: CurrentUser) {
    const org = await this.org(user);
    const context = await this.brandContext(org);
    const row = await this.prisma.mktContext.findUnique({
      where: {
        orgType_orgUserId: { orgType: org.orgType, orgUserId: org.orgUserId },
      },
    });
    return { ...context, updatedAt: row ? row.updatedAt.toISOString() : '' };
  }

  async updateContext(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const data = {
      brandName: clip(body.brandName, 80),
      industry: clip(body.industry, 60),
      positioning: clip(body.positioning, 500),
      tone: clip(body.tone, 200),
      audiences: json(
        strArr(body.audiences)
          .slice(0, 20)
          .map((item) => clip(item, 60)),
      ),
      keywords: json(
        strArr(body.keywords)
          .slice(0, 30)
          .map((item) => clip(item, 60)),
      ),
      competitors: json(
        strArr(body.competitors)
          .slice(0, 20)
          .map((item) => clip(item, 60)),
      ),
    };
    const row = await this.prisma.mktContext.upsert({
      where: {
        orgType_orgUserId: { orgType: org.orgType, orgUserId: org.orgUserId },
      },
      create: { ...orgKey(org), ...data },
      update: data,
    });
    return {
      brandName: row.brandName,
      industry: row.industry,
      positioning: row.positioning,
      tone: row.tone,
      audiences: strArr(row.audiences),
      keywords: strArr(row.keywords),
      competitors: strArr(row.competitors),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async listCapabilities(user: CurrentUser) {
    const org = await this.org(user);
    const rows = await this.prisma.mktCapabilityAccount.findMany({
      where: { orgType: org.orgType, orgUserId: org.orgUserId },
    });
    const byKey = new Map(rows.map((row) => [row.capabilityKey, row]));
    return CAPABILITIES.map((item) => {
      const row = byKey.get(item.key);
      return {
        key: item.key,
        name: item.name,
        category: item.category,
        connected: row?.connected || false,
        accountName: row?.accountName || '',
        connectedAt: row?.connectedAt ? row.connectedAt.toISOString() : '',
        lastSyncAt: row?.lastSyncAt ? row.lastSyncAt.toISOString() : '',
        note: row?.note || '',
      };
    });
  }

  async connectAccount(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const key = clip(body.key, 40);
    const capability = CAPABILITIES.find((item) => item.key === key);
    if (!capability)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '未知的平台能力');
    const accountName = clip(body.accountName, 80);
    if (!accountName)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写账号名称');
    const credential = clip(body.credential, 2000);
    const row = await this.prisma.mktCapabilityAccount.upsert({
      where: {
        orgType_orgUserId_capabilityKey: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          capabilityKey: key,
        },
      },
      create: {
        ...orgKey(org),
        capabilityKey: key,
        accountName,
        credentialCipher: credential ? this.crypto.encrypt(credential) : '',
        connected: true,
        connectedAt: new Date(),
        lastSyncAt: new Date(),
      },
      update: {
        accountName,
        credentialCipher: credential ? this.crypto.encrypt(credential) : '',
        connected: true,
        connectedAt: new Date(),
        lastSyncAt: new Date(),
      },
    });
    this.emit(org, 'mkt.capability.connected', { key, accountName });
    return {
      key: row.capabilityKey,
      name: capability.name,
      category: capability.category,
      connected: row.connected,
      accountName: row.accountName,
      connectedAt: row.connectedAt ? row.connectedAt.toISOString() : '',
      lastSyncAt: row.lastSyncAt ? row.lastSyncAt.toISOString() : '',
      note: row.note,
    };
  }

  async disconnectAccount(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const key = clip(body.key, 40);
    const capability = CAPABILITIES.find((item) => item.key === key);
    if (!capability)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '未知的平台能力');
    const row = await this.prisma.mktCapabilityAccount.upsert({
      where: {
        orgType_orgUserId_capabilityKey: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          capabilityKey: key,
        },
      },
      create: {
        ...orgKey(org),
        capabilityKey: key,
        accountName: '',
        connected: false,
      },
      update: { connected: false, credentialCipher: '' },
    });
    this.emit(org, 'mkt.capability.disconnected', { key });
    return {
      key: row.capabilityKey,
      name: capability.name,
      category: capability.category,
      connected: row.connected,
      accountName: row.accountName,
      connectedAt: row.connectedAt ? row.connectedAt.toISOString() : '',
      lastSyncAt: row.lastSyncAt ? row.lastSyncAt.toISOString() : '',
      note: row.note,
    };
  }

  /** 能力调用：优先向账号配置的 webhook 真实投递；无 webhook 时写入内容资产（不外发）。 */
  async callCapability(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const key = clip(body.key, 40);
    const action = clip(body.action, 60);
    const payload =
      body.payload &&
      typeof body.payload === 'object' &&
      !Array.isArray(body.payload)
        ? (body.payload as Row)
        : {};
    const row = await this.prisma.mktCapabilityAccount.findUnique({
      where: {
        orgType_orgUserId_capabilityKey: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          capabilityKey: key,
        },
      },
    });
    if (!row || !row.connected)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '该平台尚未连接');
    let webhook = '';
    let token = '';
    if (row.credentialCipher) {
      const plain = this.crypto.decrypt(row.credentialCipher);
      if (/^https?:\/\//i.test(plain)) webhook = plain;
      else {
        try {
          const parsed = JSON.parse(plain) as Row;
          webhook = clip(parsed.webhook, 500);
          token = clip(parsed.token, 500);
        } catch {
          token = plain;
        }
      }
    }
    if (webhook && /^https?:\/\//i.test(webhook)) {
      const response = await httpRequest<string>(webhook, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          capability: key,
          action,
          payload,
          at: new Date().toISOString(),
        }),
        timeoutMs: 15_000,
        readAs: 'text',
        operation: 'mkt-capability-call',
        maxBytes: 512 * 1024,
      }).catch(() => null);
      await this.prisma.mktCapabilityAccount.update({
        where: { id: row.id },
        data: { lastSyncAt: new Date() },
      });
      if (!response) {
        return {
          ok: false,
          action,
          result: '平台回调地址请求失败或超时，未完成投递',
        };
      }
      const text = clip(String(response.data || ''), 500);
      this.emit(org, 'mkt.capability.called', {
        key,
        action,
        status: response.status,
      });
      return {
        ok: response.ok,
        action,
        result: `平台回调 HTTP ${response.status}${text ? `：${text}` : ''}`,
      };
    }
    const bodyText =
      typeof payload.body === 'string'
        ? payload.body
        : typeof payload.content === 'string'
          ? payload.content
          : JSON.stringify(payload, null, 2);
    const artifact = await this.prisma.mktArtifact.create({
      data: {
        ...orgKey(org),
        title: clip(
          typeof payload.title === 'string' && payload.title.trim()
            ? payload.title
            : `${action} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
          120,
        ),
        kind: action.toUpperCase().slice(0, 24) || 'COPY',
        body: bodyText || '（空内容）',
        status: 'DRAFT',
        createdBy: org.actorId,
      },
    });
    await this.prisma.mktCapabilityAccount.update({
      where: { id: row.id },
      data: { lastSyncAt: new Date() },
    });
    this.emit(org, 'mkt.capability.called', {
      key,
      action,
      artifactId: artifact.id,
    });
    return {
      ok: true,
      action,
      result: `未配置平台回调地址，内容已写入内容资产 #${artifact.id}，可在资产库继续编辑后再发布`,
    };
  }

  private loopView(
    row: {
      id: number;
      skillKey: string;
      name: string;
      cron: string;
      enabled: boolean;
      lastRunAt: Date | null;
      nextRunAt: Date | null;
      createdAt: Date;
    },
    skillName = '',
  ) {
    return {
      id: row.id,
      skillKey: row.skillKey,
      skillName,
      name: row.name,
      cron: row.cron,
      enabled: row.enabled,
      lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : '',
      nextRunAt: row.nextRunAt ? row.nextRunAt.toISOString() : '',
      createdAt: row.createdAt.toISOString(),
    };
  }

  async listLoops(user: CurrentUser) {
    const org = await this.org(user);
    const [rows, skills] = await Promise.all([
      this.prisma.mktLoop.findMany({
        where: { orgType: org.orgType, orgUserId: org.orgUserId },
        orderBy: { id: 'desc' },
      }),
      this.prisma.mktSkill.findMany({
        where: { orgType: org.orgType, orgUserId: org.orgUserId },
      }),
    ]);
    const nameOf = new Map(skills.map((row) => [row.skillKey, row.name]));
    return rows.map((row) =>
      this.loopView(row, nameOf.get(row.skillKey) || ''),
    );
  }

  async saveLoop(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const skillKey = clip(body.skillKey, 40);
    await this.requireSkill(org, skillKey);
    const id = num(body.id);
    const cron = clip(body.cron, 60) || '0 9 * * *';
    const name = clip(body.name, 80);
    if (!name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写循环名称');
    const enabled = body.enabled !== false;
    const data = {
      skillKey,
      name,
      cron,
      enabled,
      nextRunAt: enabled ? nextRunAt(cron) : null,
    };
    const row = id
      ? await this.prisma.mktLoop.update({ where: { id }, data })
      : await this.prisma.mktLoop.create({ data: { ...orgKey(org), ...data } });
    const skill = await this.prisma.mktSkill.findUnique({
      where: {
        orgType_orgUserId_skillKey: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          skillKey,
        },
      },
    });
    return this.loopView(row, skill?.name || '');
  }

  async removeLoop(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const id = num(body.id);
    const row = await this.prisma.mktLoop.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '循环任务不存在');
    await this.prisma.mktLoop.delete({ where: { id } });
    return { id };
  }

  async runEval(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const runId = num(body.runId);
    const run = await this.prisma.mktSkillRun.findFirst({
      where: { id: runId, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!run)
      throw new BusinessException(ErrorCode.NOT_FOUND, '运行记录不存在');
    const context = await this.brandContext(org);
    const output = run.output || '';
    const lengths = { short: output.length < 200, long: output.length > 6000 };
    const keywordHits = context.keywords.filter((word) =>
      output.includes(word),
    ).length;
    const structureHits = ['#', '-', '1.', '：', 'CTA', '行动'].filter((mark) =>
      output.includes(mark),
    ).length;
    const baseScore = Math.max(
      30,
      Math.min(
        95,
        Math.round(
          50 +
            Math.min(20, output.length / 200) +
            (context.keywords.length
              ? (keywordHits / context.keywords.length) * 15
              : 5) +
            structureHits * 4 -
            (lengths.short ? 15 : 0) -
            (lengths.long ? 8 : 0),
        ),
      ),
    );
    const dimensions = [
      {
        name: '完整性',
        score: Math.min(
          100,
          Math.round(
            40 + Math.min(40, output.length / 120) + structureHits * 4,
          ),
        ),
        note: lengths.short
          ? '内容偏短，建议补充案例与细节'
          : '结构与篇幅基本完整',
      },
      {
        name: '品牌一致性',
        score: context.keywords.length
          ? Math.round(50 + (keywordHits / context.keywords.length) * 50)
          : 60,
        note: context.keywords.length
          ? `命中品牌关键词 ${keywordHits}/${context.keywords.length}`
          : '尚未配置品牌关键词，无法精确评估',
      },
      {
        name: '可执行性',
        score: Math.min(100, 45 + structureHits * 8),
        note:
          structureHits >= 3
            ? '包含清晰结构，可直接落地'
            : '建议补充步骤与行动号召',
      },
    ];
    let mode: 'llm' | 'rule' = 'rule';
    let score = baseScore;
    let suggestions = [
      lengths.short
        ? '扩写主体内容，至少补充 1 个真实案例或数据点'
        : '保持当前篇幅，发布前做一次事实核对',
      context.keywords.length
        ? '检查品牌关键词是否自然融入首段与结尾'
        : '在品牌背景中补充关键词，便于一致性评分',
      '发布前确认行动号召与目标转化路径一致',
    ];
    const channel = await resolveKbLlm(this.prisma, user.userId);
    const llm = await kbChatMulti(
      channel,
      [
        {
          role: 'system',
          content:
            '你是营销内容评审。根据品牌背景与输出内容评分，只输出 JSON：{"score":0-100,"dimensions":[{"name":"","score":0,"note":""}],"suggestions":[""]}。',
        },
        {
          role: 'user',
          content: JSON.stringify({
            skill: run.skillName,
            context,
            output: output.slice(0, 6000),
            baseline: { score, dimensions },
          }),
        },
      ],
      user.userId,
      900,
    );
    if (llm) {
      const parsed = parseJsonObject(llm.reply);
      if (parsed) {
        mode = 'llm';
        if (Number.isFinite(Number(parsed.score))) {
          score = Math.max(0, Math.min(100, Math.round(Number(parsed.score))));
        }
        if (Array.isArray(parsed.dimensions)) {
          const rows = (parsed.dimensions as Row[])
            .map((item) => ({
              name: clip(item.name, 40),
              score: Math.max(0, Math.min(100, Math.round(num(item.score)))),
              note: clip(item.note, 300),
            }))
            .filter((item) => item.name);
          if (rows.length) dimensions.splice(0, dimensions.length, ...rows);
        }
        const list = strArr(parsed.suggestions)
          .slice(0, 8)
          .map((item) => clip(item, 300));
        if (list.length) suggestions = list;
        await this.aiEval
          .chargeByUsage(
            user.userId,
            'mkt_skill_eval',
            {
              tokenIn: llm.promptTokens,
              tokenOut: llm.completionTokens,
              call: 1,
            },
            `mkt-eval:${run.id}`,
          )
          .catch(() => undefined);
      }
    }
    return {
      runId: run.id,
      mode,
      score,
      dimensions,
      suggestions,
      generatedAt: new Date().toISOString(),
    };
  }
}
