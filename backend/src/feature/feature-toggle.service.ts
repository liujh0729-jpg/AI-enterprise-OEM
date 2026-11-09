import type { Prisma } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import {
  FEATURE_API_PREFIXES,
  FEATURE_SEED,
  type FeatureSeedNode,
} from './feature-catalog.data';

/** 目录节点视图：DB 行 + 合并 PLATFORM/ORG 开关后的有效状态（契约 featureCatalogNodeSchema 同形）。 */
export interface FeatureNodeView {
  code: string;
  kind: 'GROUP' | 'MENU';
  parentCode: string;
  title: string;
  path: string;
  scope: 'PLATFORM' | 'ORG';
  protected: boolean;
  state: 'open' | 'closed';
  sortOrder: number;
}

interface EvalCache {
  at: number;
  /** code → parentCode（含种子全集，祖先链求解用） */
  parents: Map<string, string>;
  /** code → protected */
  protectedCodes: Set<string>;
  platformClosed: Set<string>;
  /** orgUserId → closed 集合（仅存出现过 closed 的企业） */
  orgClosed: Map<string, Set<string>>;
}

const CACHE_TTL_MS = 15_000;

/** 前缀索引按长度降序，保证最长前缀优先命中（assets 的 digital-assets 先于 content-tools 的 content）。 */
const prefixIndex: { prefix: string; code: string }[] = Object.entries(
  FEATURE_API_PREFIXES,
)
  .flatMap(([code, prefixes]) => prefixes.map((prefix) => ({ prefix, code })))
  .sort((a, b) => b.prefix.length - a.prefix.length);

/**
 * /api/v1 开放接口同口径收口：二级段改写到 /enterprise 域后复用同一前缀索引
 * （/api/v1/tax/… → /enterprise/tax）；段名不同源的补别名；未映射段（users 等认证会话）不拦。
 */
const V1_ALIAS: Record<string, string> = {
  '/api/v1/export': '/enterprise/overseas',
};
const toEnterpriseProbe = (path: string) => {
  // '/api/v1/<domain>/…' 切段后 domain 在下标 3（[0]''、[1]api、[2]v1）
  const seg = `/api/v1/${path.split('/')[3] || ''}`;
  const alias = V1_ALIAS[seg];
  if (alias) return alias + path.slice(seg.length);
  return `/enterprise${path.slice('/api/v1'.length)}`;
};

/**
 * 功能开关服务（§5.10）：FeatureCatalog 展示与结构 + FeatureToggle 状态（无行即 open）。
 * 求值口径：任一祖先 GROUP closed 即级联 closed；ORG 行只能在 PLATFORM open 时再收紧，不能反向打开；
 * protected 节点求值强制 open 且拒绝关闭请求；开关改动即时失效缓存（菜单、直链、MCP 同路径同口径）。
 */
export class FeatureToggleService {
  constructor(private readonly prisma: PrismaService) {}

  private cache: EvalCache | null = null;
  private seeded = false;

  /** 懒播种：首次访问补插缺失 code，不覆盖管理员改过的行；进程内只做一次全量对齐。 */
  async ensureSeed() {
    if (this.seeded) return;
    const existing = await this.prisma.featureCatalog.findMany({
      select: { code: true },
    });
    const have = new Set(existing.map((row) => row.code));
    const missing = FEATURE_SEED.filter((node) => !have.has(node.code));
    if (missing.length) {
      await this.prisma.featureCatalog.createMany({
        data: missing.map((node) => this.seedRow(node)),
        skipDuplicates: true,
      });
    }
    this.seeded = true;
    this.cache = null;
  }

  private seedRow(node: FeatureSeedNode): Prisma.FeatureCatalogCreateInput {
    return {
      code: node.code,
      kind: node.kind,
      parentCode: node.parentCode,
      title: node.title,
      path: node.path,
      scope: 'PLATFORM',
      protected: node.protected ? 1 : 0,
      sortOrder: node.sortOrder,
    };
  }

  /** 目录 + 开关合并求值缓存：TTL 内复用，setToggle 后立即作废。 */
  private async evalCache(): Promise<EvalCache> {
    await this.ensureSeed();
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS)
      return this.cache;
    const [catalog, toggles] = await Promise.all([
      this.prisma.featureCatalog.findMany({ orderBy: { sortOrder: 'asc' } }),
      this.prisma.featureToggle.findMany({ where: { state: 'closed' } }),
    ]);
    const parents = new Map<string, string>();
    const protectedCodes = new Set<string>();
    for (const row of catalog) {
      parents.set(row.code, row.parentCode);
      if (row.protected === 1) protectedCodes.add(row.code);
    }
    const platformClosed = new Set<string>();
    const orgClosed = new Map<string, Set<string>>();
    for (const toggle of toggles) {
      if (toggle.scope === 'PLATFORM') platformClosed.add(toggle.code);
      else {
        const set = orgClosed.get(toggle.orgUserId) || new Set<string>();
        set.add(toggle.code);
        orgClosed.set(toggle.orgUserId, set);
      }
    }
    this.cache = {
      at: Date.now(),
      parents,
      protectedCodes,
      platformClosed,
      orgClosed,
    };
    return this.cache;
  }

  /** 祖先链（含自身）；未在目录中的 code 只返回自身，防御脏前缀映射。 */
  private chain(cache: EvalCache, code: string): string[] {
    const chain: string[] = [];
    let cursor: string | undefined = code;
    const guard = new Set<string>();
    while (cursor !== undefined && !guard.has(cursor)) {
      guard.add(cursor);
      chain.push(cursor);
      cursor = cache.parents.get(cursor);
      if (cursor === '') cursor = undefined;
    }
    return chain;
  }

  /** 单 code 对某身份是否 open（protected 强制 open；ORG 只能在 PLATFORM open 时收紧）。 */
  async isOpen(code: string, orgUserId = ''): Promise<boolean> {
    const cache = await this.evalCache();
    if (cache.protectedCodes.has(code)) return true;
    for (const link of this.chain(cache, code)) {
      if (cache.platformClosed.has(link)) return false;
      // orgUserId 为空＝平台视角（管理端目录），只看 PLATFORM 行
      if (orgUserId && cache.orgClosed.get(orgUserId)?.has(link)) return false;
    }
    return true;
  }

  /** 拦截入口：path 命中功能前缀且该功能 closed 时抛 FEATURE_CLOSED（直链 / MCP 转发同口径）。 */
  async assertFeatureOpen(path: string, orgUserId = '') {
    const code = this.featureCodeForPath(path);
    if (!code) return;
    if (!(await this.isOpen(code, orgUserId))) {
      throw new BusinessException(ErrorCode.FEATURE_CLOSED);
    }
  }

  featureCodeForPath(path: string): string | undefined {
    const hit = prefixIndex.find(
      (item) => path === item.prefix || path.startsWith(`${item.prefix}/`),
    );
    if (hit) return hit.code;
    // /api/v1 开放接口（API Key 通道）：改写到 /enterprise 域后二次匹配，MCP 端点已在索引里直接命中
    if (!path.startsWith('/api/v1/')) return undefined;
    const probe = toEnterpriseProbe(path);
    const again = prefixIndex.find(
      (item) => probe === item.prefix || probe.startsWith(`${item.prefix}/`),
    );
    return again?.code;
  }

  /** 管理端目录（Platform_featureCatalog）：只按 PLATFORM 行求值，供开关页组树。 */
  async adminCatalog(): Promise<FeatureNodeView[]> {
    return this.renderCatalog('');
  }

  /** 有效菜单（Platform_menu）：合并当前身份的 ORG 覆盖行，前端导航唯一数据源。 */
  async menuFor(orgUserId: string): Promise<FeatureNodeView[]> {
    return this.renderCatalog(orgUserId);
  }

  private async renderCatalog(orgUserId: string): Promise<FeatureNodeView[]> {
    await this.ensureSeed();
    const cache = await this.evalCache();
    const rows = await this.prisma.featureCatalog.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      code: row.code,
      kind: row.kind === 'GROUP' ? 'GROUP' : 'MENU',
      parentCode: row.parentCode,
      title: row.title,
      path: row.path,
      scope: row.scope === 'ORG' ? 'ORG' : 'PLATFORM',
      protected: row.protected === 1,
      state:
        row.protected === 1 ||
        !this.chain(cache, row.code).some(
          (link) =>
            cache.platformClosed.has(link) ||
            (orgUserId && cache.orgClosed.get(orgUserId)?.has(link)),
        )
          ? 'open'
          : 'closed',
      sortOrder: row.sortOrder,
    }));
  }

  /** 设置开关（Platform_setFeatureToggle）：protected 拒绝 closed；ORG open 不得越过 PLATFORM closed。 */
  async setToggle(
    input: {
      code: string;
      state: 'open' | 'closed';
      scope: 'PLATFORM' | 'ORG';
      orgUserId: string;
    },
    adminUserId: string,
  ) {
    await this.ensureSeed();
    const row = await this.prisma.featureCatalog.findUnique({
      where: { code: input.code },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '功能编码不存在');
    if (row.protected === 1 && input.state === 'closed') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该功能属受保护底座（认证/平台管理/账户计费/合规退出），不允许关闭',
      );
    }
    if (input.scope === 'ORG' && input.state === 'open') {
      // 平台级仍关闭时，企业级“打开”是无效操作，直接拒绝避免产生误导性的覆盖行
      const cache = await this.evalCache();
      if (
        this.chain(cache, input.code).some((link) =>
          cache.platformClosed.has(link),
        )
      ) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '平台级处于关闭状态，请先打开平台级开关',
        );
      }
    }
    if (input.scope === 'ORG' && !input.orgUserId) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        'ORG 开关必须指定企业',
      );
    }
    await this.prisma.featureToggle.upsert({
      where: {
        code_scope_orgUserId: {
          code: input.code,
          scope: input.scope,
          orgUserId: input.orgUserId || '',
        },
      },
      create: {
        code: input.code,
        scope: input.scope,
        orgUserId: input.orgUserId || '',
        state: input.state,
        updatedBy: adminUserId,
      },
      update: { state: input.state, updatedBy: adminUserId },
    });
    this.cache = null; // 写后立即失效，菜单与拦截同口径生效
    return (await this.adminCatalog()).find(
      (node) => node.code === input.code,
    )!;
  }
}
