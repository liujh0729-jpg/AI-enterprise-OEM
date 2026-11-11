import type { PrismaService } from '../prisma/prisma.service';
import type { IdentityService } from '../identity/identity.service';
import type { MarketingService } from '../marketing/marketing.service';
import type { LogisticsService } from '../logistics/logistics.service';
import type { TaxService } from '../tax/tax.service';
import type { OperationRiskService } from '../growth/operation-risk.service';
import type { ChromeAgentService } from '../rpa/chrome-agent.service';
import type { TaskSourceRegistry } from './task-source.registry';
import { contractSource } from './sources/contract.source';
import { crmSource } from './sources/crm.source';
import { deskSource } from './sources/desk.source';
import { logisticsSource } from './sources/logistics.source';
import { marketingSource } from './sources/marketing.source';
import { oaSource } from './sources/oa.source';
import { okrSource } from './sources/okr.source';
import { platformSource } from './sources/platform.source';
import { projectSource } from './sources/project.source';
import { taxSource } from './sources/tax.source';
import { riskSource } from './sources/risk.source';
import { rpaBrowserSource } from './sources/rpa.source';

/** 板块源复用各板块自己的身份域列表，需要板块服务与身份服务（其余 7 个存量源只读 prisma）。 */
export interface BoardSourceDeps {
  identity: IdentityService;
  marketing: MarketingService;
  logistics: LogisticsService;
  tax: TaxService;
  /** 经营异常扫描器（关闭前复核用）；装配前为 undefined，复核放行。 */
  risks?: () => OperationRiskService | undefined;
  /** 浏览器代理（待确认/需登录任务的关闭前复核）；装配前为 undefined，复核放行。 */
  chrome?: () => ChromeAgentService | undefined;
}

/** 接入的 10 个存量源：账号级聚合，各源只读，不改各模块授权语义。 */
export function registerTaskSources(
  registry: TaskSourceRegistry,
  prisma: PrismaService,
  boards: BoardSourceDeps,
): TaskSourceRegistry {
  return registry
    .register(oaSource(prisma))
    .register(okrSource(prisma))
    .register(projectSource(prisma))
    .register(crmSource(prisma))
    .register(deskSource(prisma))
    .register(contractSource(prisma))
    .register(platformSource(prisma))
    .register(marketingSource(boards.marketing, boards.identity))
    .register(logisticsSource(boards.logistics, boards.identity))
    .register(taxSource(boards.tax, boards.identity))
    .register(riskSource(boards.risks || (() => undefined)))
    .register(rpaBrowserSource(boards.chrome || (() => undefined)));
}
