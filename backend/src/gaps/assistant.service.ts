import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import { aiChat } from '../ai/ai-gateway';
import type { GapScopeService } from './gaps.scope';
import { asInt, asText, clip, iso, pageParams, Row } from './gaps.helpers';

type RegistryEntry = {
  route: string;
  title: string;
  domain: string;
  entityType: string;
};

/**
 * 页面注册表：助手按当前路由回答「这一页能做什么、数据从哪来、下一步去哪」。
 * 只登记稳定路由，具体控件由前端补进 `context`，后端不猜 DOM。
 */
const REGISTRY: RegistryEntry[] = [
  {
    route: '/crm',
    title: 'CRM 客户经营',
    domain: '客户/商机/报价/合同',
    entityType: 'crm_opportunity',
  },
  {
    route: '/crm/quotations',
    title: 'CRM 报价单',
    domain: '报价模板与发送跟踪',
    entityType: 'crm_quotation',
  },
  {
    route: '/hrm',
    title: '人力资源',
    domain: '档案/考勤/招聘/面试/员工全周期',
    entityType: 'hrm_employee',
  },
  {
    route: '/project',
    title: '项目与任务',
    domain: '项目/任务/工时/三方同步',
    entityType: 'pj_project',
  },
  {
    route: '/erp',
    title: 'ERP 进销存',
    domain: '商品/库存/采购/销售/应收应付',
    entityType: 'erp_product',
  },
  {
    route: '/finance',
    title: '财务与税务',
    domain: '报税/开票/账套',
    entityType: 'tax_declaration',
  },
  {
    route: '/service-desk',
    title: '服务台',
    domain: '会话/工单/售后',
    entityType: 'service_ticket',
  },
  {
    route: '/market',
    title: '供需市场',
    domain: '需求/服务/市集/评价',
    entityType: 'market_listing',
  },
  {
    route: '/points',
    title: '积分中心',
    domain: '余额/流水/兑换码/计费规则',
    entityType: 'point_account',
  },
  {
    route: '/oa',
    title: '协同办公',
    domain: '审批/公告/日程',
    entityType: 'oa_approval',
  },
  {
    route: '/kb',
    title: '知识库',
    domain: '文档/检索/问答',
    entityType: 'kb_document',
  },
  {
    route: '/mail',
    title: 'AI 邮箱',
    domain: '收发信/草稿/模板',
    entityType: 'mail_account',
  },
  {
    route: '/marketing-tools',
    title: '营销工具',
    domain: '内容创作/多平台分发/问卷',
    entityType: 'mkt_tool',
  },
  {
    route: '/acquisition',
    title: '营销获客',
    domain: '线索雷达/触达/客户档案',
    entityType: 'acquisition_lead',
  },
  {
    route: '/wecom-scrm',
    title: '企业微信 SCRM',
    domain: '客户/群/活码/群发/SOP',
    entityType: 'scrm_contact',
  },
  {
    route: '/help',
    title: '帮助中心',
    domain: '使用手册/更新日志',
    entityType: 'help_topic',
  },
];

const matchRoute = (route: string): RegistryEntry | null => {
  const normalized = `/${String(route || '')
    .split('?')[0]
    .replace(/^\/+/, '')}`;
  return (
    REGISTRY.filter(
      (entry) =>
        normalized === entry.route || normalized.startsWith(`${entry.route}/`),
    ).sort((a, b) => b.route.length - a.route.length)[0] || null
  );
};

/**
 * B2#15 页面感知助手：以「当前路由 + 记录上下文 + 用户问题」为输入，
 * 走统一 AI 网关作答；没有可用模型时给规则式导航答案，不让入口变成死按钮。
 */
export class PageAssistantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: GapScopeService,
  ) {}

  registry() {
    return REGISTRY;
  }

  async ask(user: CurrentUser, body: Row) {
    const org = await this.scope.resolve(user);
    const route = clip(body.route, 200).trim() || '/';
    const entityType = clip(body.entityType, 32);
    const entityId = clip(body.entityId, 64);
    const question = clip(body.question, 1000).trim();
    const page = matchRoute(route);
    const context = [
      { label: '当前页面', value: page ? `${page.title}（${route}）` : route },
      { label: '业务域', value: page?.domain || '未登记页面' },
      ...(entityType
        ? [{ label: '当前记录', value: `${entityType} #${entityId || '-'}` }]
        : []),
      { label: '操作人', value: user.username || user.userId },
    ];
    let answer = '';
    let model = '';
    let source = 'fallback';
    try {
      const result = await aiChat(this.prisma, {
        userId: user.userId,
        model: asText(body.model) || undefined,
        channelId: asInt(body.channelId) || undefined,
        module: 'assistant',
        operation: 'page_ask',
        messages: [
          {
            role: 'system',
            content:
              '你是企业管理系统的页面内助手。只回答与当前页面和本系统有关的问题；' +
              '不确定的数据不要编造，说明去哪一页查看。回答用中文，先给结论，再给 2-4 条可执行步骤。',
          },
          {
            role: 'user',
            content: `页面：${page?.title || route}\n业务域：${page?.domain || '未登记'}\n记录：${
              entityType ? `${entityType}#${entityId}` : '无'
            }\n问题：${question}`,
          },
        ],
      });
      answer = result.reply.trim();
      model = result.model;
      source = result.source;
    } catch {
      answer = page
        ? `这里是「${page.title}」，主要处理${page.domain}。可以先用页面内的筛选缩小范围；如果问题涉及具体记录，点开记录后再次提问，我会带上该记录的上下文。也可以在「帮助中心」搜索对应章节。`
        : '当前页面的助手知识还没有登记。请把页面路径反馈给管理员，或到「帮助中心」按模块名搜索。';
    }
    await this.prisma.assistantPageQuery.create({
      data: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        userId: user.userId,
        route,
        entityType,
        entityId,
        question,
        answer,
        model,
      },
    });
    return { answer, model, source, context };
  }

  async history(user: CurrentUser, query: Row) {
    const { page, pageSize, offset } = pageParams(query, 20);
    const where = { userId: user.userId };
    const [total, rows] = await Promise.all([
      this.prisma.assistantPageQuery.count({ where }),
      this.prisma.assistantPageQuery.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: offset,
        take: pageSize,
      }),
    ]);
    return {
      list: rows.map((row) => ({
        id: row.id,
        route: row.route,
        entityType: row.entityType,
        entityId: row.entityId,
        question: row.question,
        answer: row.answer,
        model: row.model,
        createdAt: iso(row.createdAt),
      })),
      total,
      page,
      pageSize,
    };
  }
}
