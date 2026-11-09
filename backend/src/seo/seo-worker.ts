import type { PrismaService } from '../prisma/prisma.service';
import { UserLookupService } from '../directory/user-lookup.service';
import { OssSettingsService } from '../oss/oss-settings.service';
import { OssService } from '../oss/oss.service';
import { IdentityService } from '../identity/identity.service';
import { HrmScopeService } from '../hrm/hrm.scope';
import { AccountCrypto } from '../account/account-crypto';
import { StorageService } from '../storage/storage.service';
import { NotificationService } from '../notifications/notification.service';
import { MechanismService } from '../mechanisms/mechanism.service';
import { PointsSettingsService } from '../points/points-settings.service';
import { PointsService } from '../points/points.service';
import { BillingRuleService } from '../points/billing-rule.service';
import { AiEvalService } from '../ai/ai-eval.service';
import { DataTableService } from '../data-table/data-table.service';
import { AliyunMailCrypto } from '../aliyun-mail/aliyun-mail-crypto';
import { AliyunMailService } from '../aliyun-mail/aliyun-mail.service';
import { SeoDataForSeoClient } from './seo-dataforseo.client';
import { SeoKeywordService } from './seo-keyword.service';
import { SeoRankService } from './seo-rank.service';
import { SeoGoogleService } from './seo-google.service';
import { SeoRankScheduler } from './seo-rank.scheduler';
import type { SeoContext } from './seo-base.service';

/**
 * GEO worker 进程内的 SEO 装配：调度器只用到排名检查与 Google 同步，
 * 但 SeoContext 要求完整依赖，这里按 services.ts 同一口径构造真实实例（构造期无 I/O）。
 */
export function createSeoScheduler(prisma: PrismaService): SeoRankScheduler {
  const users = new UserLookupService(prisma);
  const oss = new OssService(new OssSettingsService(prisma));
  const identity = new IdentityService(prisma, users, oss);
  const scope = new HrmScopeService(prisma, identity);
  const crypto = new AccountCrypto();
  const storage = new StorageService(oss);
  const notifications = new NotificationService(prisma);
  const mechanisms = new MechanismService(
    prisma,
    scope,
    crypto,
    storage,
    notifications,
    (user) => identity.requireAdmin(user),
  );
  const pointsSettings = new PointsSettingsService(prisma, crypto);
  const points = new PointsService(prisma, pointsSettings);
  const billingRules = new BillingRuleService(prisma);
  const aiEval = new AiEvalService(prisma, billingRules, points);
  const tables = new DataTableService(prisma, identity, users);
  const mail = new AliyunMailService(
    prisma,
    identity,
    new AliyunMailCrypto(),
    tables,
  );
  const dfs = new SeoDataForSeoClient(prisma, crypto);
  const ctx: SeoContext = {
    prisma,
    scope,
    aiEval,
    crypto,
    mechanisms,
    tables,
    mail,
    dfs,
  };
  const keywords = new SeoKeywordService(ctx);
  const rank = new SeoRankService(ctx);
  const google = new SeoGoogleService(ctx, keywords);
  return new SeoRankScheduler(prisma, rank, google);
}
