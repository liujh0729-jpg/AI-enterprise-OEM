import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { HrmOrg, HrmScopeService } from '../hrm/hrm.scope';
import type { AiEvalService } from '../ai/ai-eval.service';
import type { AccountCrypto } from '../account/account-crypto';
import type { MechanismService } from '../mechanisms/mechanism.service';
import type { DataTableService } from '../data-table/data-table.service';
import type { AliyunMailService } from '../aliyun-mail/aliyun-mail.service';
import type { SeoProject } from '../../generated/prisma';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { kbChatMulti, resolveKbLlm } from '../kb/kb-llm';
import {
  SEO_PROVIDER_CODE,
  SeoDataForSeoClient,
} from './seo-dataforseo.client';
import { clip, json, paramsHash, strArr } from './seo-shared';

/** SEO 各服务共用的依赖集合：一次装配，避免每个服务重复 7 个构造参数。 */
export type SeoContext = {
  prisma: PrismaService;
  scope: HrmScopeService;
  aiEval: AiEvalService;
  crypto: AccountCrypto;
  mechanisms: MechanismService;
  tables: DataTableService;
  mail: AliyunMailService;
  dfs: SeoDataForSeoClient;
};

export type OrgKey = { orgType: string; orgUserId: string };

/** 组织键 + 站点档案：SEO 绝大多数查询的 where 前缀。 */
export type SeoScope = OrgKey & { projectId: number };

/** HrmOrg 还带 actorId/角色判定，落库只取组织键两列。 */
export const orgKeyOf = (org: HrmOrg): OrgKey => ({
  orgType: org.orgType,
  orgUserId: org.orgUserId,
});

export type SeoAiCall = {
  reply: string | null;
  promptTokens: number;
  completionTokens: number;
};

const REUSE_DAYS = 30;

export class SeoBase {
  constructor(protected readonly ctx: SeoContext) {}

  protected get prisma(): PrismaService {
    return this.ctx.prisma;
  }

  protected org(user: CurrentUser): Promise<HrmOrg> {
    return this.ctx.scope.resolve(user);
  }

  /** 站点档案必须属于当前组织，否则连存在性都不透露。 */
  protected async project(
    user: CurrentUser,
    projectId: number,
  ): Promise<{ org: HrmOrg; row: SeoProject }> {
    const org = await this.org(user);
    const row = await this.prisma.seoProject.findFirst({
      where: { id: Number(projectId), ...orgKeyOf(org) },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, 'SEO 站点档案不存在');
    return { org, row };
  }

  protected projectView(row: SeoProject) {
    return {
      id: row.id,
      domain: row.domain,
      brandName: row.brandName,
      locationCode: row.locationCode,
      languageCode: row.languageCode,
      competitors: strArr(row.competitors),
      keyPages: Array.isArray(row.keyPages)
        ? (row.keyPages as Array<{ url: string; role: string }>).map(
            (page) => ({
              url: String(page.url || ''),
              role: String(page.role || 'OTHER'),
            }),
          )
        : [],
      note: row.note,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** 系统 LLM：解析不出通道或调用失败一律返回 null，由调用方走规则式回落并标注「AI 估计」。 */
  protected async ai(
    user: CurrentUser,
    system: string,
    prompt: string,
    maxTokens = 1500,
  ): Promise<SeoAiCall> {
    const channel = await resolveKbLlm(this.prisma, user.userId);
    const result = await kbChatMulti(
      channel,
      [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      user.userId,
      maxTokens,
    );
    if (!result) return { reply: null, promptTokens: 0, completionTokens: 0 };
    return {
      reply: result.reply.trim(),
      promptTokens: result.promptTokens || 0,
      completionTokens: result.completionTokens || 0,
    };
  }

  /** 只有真命中 LLM 才计积分；规则式回落不收费。 */
  protected async charge(
    user: CurrentUser,
    code: string,
    call: SeoAiCall,
    refId: string,
  ): Promise<void> {
    if (!call.reply) return;
    await this.ctx.aiEval
      .chargeByUsage(
        user.userId,
        code,
        {
          tokenIn: call.promptTokens,
          tokenOut: call.completionTokens,
          call: 1,
        },
        refId,
      )
      .catch(() => 0);
  }

  protected async brandContext(org: HrmOrg) {
    const row = await this.prisma.mktContext.findUnique({
      where: {
        orgType_orgUserId: { orgType: org.orgType, orgUserId: org.orgUserId },
      },
    });
    return [
      row?.brandName ? `品牌：${row.brandName}` : '',
      row?.industry ? `行业：${row.industry}` : '',
      row?.positioning ? `定位：${row.positioning}` : '',
      row?.audiences && strArr(row.audiences).length
        ? `受众：${strArr(row.audiences).join('、')}`
        : '',
    ]
      .filter(Boolean)
      .join('；');
  }

  /**
   * 付费研究查询的 30 天同参复用：命中缓存直接返回旧结果并标记 reused，
   * 不再向 DataForSEO 付第二次钱；未命中才执行 loader 并落日志。
   */
  protected async research<T>(input: {
    org: OrgKey;
    projectId: number;
    action: string;
    params: unknown;
    resultRef: string;
    load: () => Promise<T>;
  }): Promise<{ value: T; reused: boolean }> {
    const key = input.org;
    const hash = paramsHash(input.params);
    const cached = await this.prisma.seoResearchLog.findFirst({
      where: {
        ...key,
        projectId: input.projectId,
        action: input.action,
        paramsHash: hash,
        createdAt: { gte: new Date(Date.now() - REUSE_DAYS * 86_400_000) },
      },
      orderBy: { id: 'desc' },
    });
    if (cached) return { value: cached.payload as T, reused: true };
    const value = await input.load();
    await this.prisma.seoResearchLog.create({
      data: {
        ...key,
        projectId: input.projectId,
        action: input.action,
        paramsHash: hash,
        resultRef: clip(input.resultRef, 200),
        payload: json(value),
      },
    });
    return { value, reused: false };
  }

  protected requireDfs(user: CurrentUser) {
    return this.ctx.dfs.requireCredential(user.userId);
  }

  protected async providerConnected(userId: string): Promise<boolean> {
    const row = await this.prisma.seoProviderSetting.findUnique({
      where: { userId_code: { userId, code: SEO_PROVIDER_CODE } },
    });
    return Boolean(row?.credentialCipher);
  }

  protected ok(message = 'ok') {
    return { ok: true, message };
  }
}
