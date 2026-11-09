import {
  z,
  serviceViewSchema,
  pageSchema,
  cursorPageSchema,
} from "@enterprise/contracts";
import { parseData, catalogEndpoint } from "./endpoint";
import { servicesApi } from "./services";
import { marketBoardApi } from "./market-board";
const resultSchema = z
  .object({ tip: z.string().optional() })
  .passthrough()
  .nullable();
type Scope = {
  domain: string;
  platform: boolean;
  pool?: boolean;
  /** 二级类目筛选（供需市场跨板块公开池用；其余板块由板块本身收窄，不传）。 */
  categoryId?: string;
  /** 地域筛选（省 / 市）：与需求列表同口径，只有平台/市集这两个读公开池的分支支持。 */
  region?: { province?: string; city?: string };
  /**
   * 取数范围：`all`＝AIworkin 公开池（全部服务），`mine`＝本地台账（我发布的服务）。
   * 只有「市集 / 供需市场」的服务栏目会传；其余栏目（财税 / 供销的服务发布）恒为 `mine`。
   */
  scope?: "all" | "mine";
};
export const serviceBoardApi = {
  page: async (
    { domain, platform, pool, categoryId, region, scope }: Scope,
    cursor: string,
    signal: AbortSignal,
  ) => {
    // 「我发布的服务」＝本地台账。供需市场（平台直连看板）的台账由后端按 scope=mine 读；
    // 市集 / 资产交易读本系统 `provider_service_listings`（分页接口，页码当游标）。
    if (scope === "mine") {
      if (platform)
        return parseData(
          cursorPageSchema(serviceViewSchema),
          await marketBoardApi.services(
            {
              params: { domain },
              query: {
                province: region?.province || undefined,
                city: region?.city || undefined,
                cursor: cursor || undefined,
                pageSize: 20,
                subCategoryId: categoryId || undefined,
                scope: "mine",
              },
            },
            { signal },
          ),
        );
      return localPage(domain, cursor, signal);
    }
    // 「全部服务」＝AIworkin 公开池：
    // 服务市集（营销 / 出海 / 灵工 / 物流 / IT / 知产 / 法律 / 智库 / 资产交易）走市集公开池。
    if (pool)
      return parseData(
        cursorPageSchema(serviceViewSchema),
        await marketBoardApi.marketplace(
          {
            params: { domain },
            query: {
              province: region?.province || undefined,
              city: region?.city || undefined,
              cursor: cursor || undefined,
              pageSize: 20,
            },
          },
          { signal },
        ),
      );
    // 平台直连看板（供需市场）走板块公开池。
    if (platform)
      return parseData(
        cursorPageSchema(serviceViewSchema),
        await marketBoardApi.services(
          {
            params: { domain },
            query: {
              province: region?.province || undefined,
              city: region?.city || undefined,
              cursor: cursor || undefined,
              pageSize: 20,
              subCategoryId: categoryId || undefined,
              scope: "all",
            },
          },
          { signal },
        ),
      );
    return localPage(domain, cursor, signal);
  },
  detail: async (
    { domain, platform }: Scope,
    id: string | number,
    signal?: AbortSignal,
  ) =>
    parseData(
      serviceViewSchema,
      await (platform
        ? marketBoardApi.serviceDetail(
            { params: { domain, id: String(id) } },
            { signal },
          )
        : servicesApi.detail({ params: { id: String(id) } }, { signal })),
    ),
  create: async ({
    domain,
    platform,
    pool,
    body,
  }: Scope & { body: Record<string, unknown> }) =>
    parseData(
      resultSchema,
      await catalogEndpoint(
        platform && !pool ? "MarketBoard_createService" : "Services_create",
        { params: { domain }, body },
      ),
    ),
  update: async ({
    domain,
    platform,
    pool,
    id,
    body,
  }: Scope & { id: string | number; body: Record<string, unknown> }) =>
    parseData(
      resultSchema,
      await catalogEndpoint(
        platform && !pool ? "MarketBoard_updateService" : "Services_update",
        { params: { domain, id: String(id) }, body },
      ),
    ),
  remove: async ({
    domain,
    platform,
    pool,
    id,
  }: Scope & { id: string | number }) =>
    catalogEndpoint(
      platform && !pool ? "MarketBoard_removeService" : "Services_remove",
      { params: { domain, id: String(id) } },
    ),
  publish: async (id: number | string) =>
    parseData(
      resultSchema,
      await servicesApi.publish({ params: { id: String(id) } }),
    ),
};
/** 本地台账（`provider_service_listings`）按页码分页，翻页外壳按游标口径消费。 */
async function localPage(domain: string, cursor: string, signal: AbortSignal) {
  const page = parseData(
    pageSchema(serviceViewSchema),
    await servicesApi.page(
      { query: { domain, page: Number(cursor || 1), pageSize: 20 } },
      { signal },
    ),
  );
  const hasMore = page.page * page.pageSize < page.total;
  return {
    list: page.list,
    hasMore,
    nextCursor: hasMore ? String(page.page + 1) : null,
  };
}
