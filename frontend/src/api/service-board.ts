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
type Scope = { domain: string; platform: boolean; pool?: boolean };
export const serviceBoardApi = {
  page: async (
    { domain, platform, pool }: Scope,
    cursor: string,
    signal: AbortSignal,
  ) => {
    // 服务市集：读 AIworkin SUPPLY 公开池（全平台服务商已发布的服务），写仍走本地台账。
    if (pool)
      return parseData(
        cursorPageSchema(serviceViewSchema),
        await marketBoardApi.marketplace(
          {
            params: { domain },
            query: { cursor: cursor || undefined, pageSize: 20 },
          },
          { signal },
        ),
      );
    if (platform)
      return parseData(
        cursorPageSchema(serviceViewSchema),
        await marketBoardApi.services(
          {
            params: { domain },
            query: { cursor: cursor || undefined, pageSize: 20 },
          },
          { signal },
        ),
      );
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
  },
  /**
   * 市集列表要把「我发布的服务」（本地台账，含未发布草稿）排在公开池前面，
   * 并按平台挂单号 `platformListingId` 与公开池行去重。
   */
  ownList: async (domain: string, signal?: AbortSignal) =>
    parseData(
      z.array(serviceViewSchema),
      await servicesApi.list({ query: { domain } }, { signal }),
    ),
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
