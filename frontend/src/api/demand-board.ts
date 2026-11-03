import {
  z,
  pageSchema,
  cursorPageSchema,
  channelConversationSchema,
  type CursorPage,
  type EndpointId,
  ApiError,
} from "@enterprise/contracts";
import { catalogEndpoint, parseData } from "./endpoint";
const localModules = {
  "/enterprise/marketing": [
    "Marketing_page",
    "Marketing_detail",
    "Marketing_create",
    "Marketing_update",
    "Marketing_remove",
    "Marketing_messages",
    "Marketing_postMessage",
  ],
  "/enterprise/logistics": [
    "Logistics_page",
    "Logistics_detail",
    "Logistics_create",
    "Logistics_update",
    "Logistics_remove",
    "Logistics_messages",
    "Logistics_postMessage",
  ],
  "/enterprise/smart": [
    "SmartService_page",
    "SmartService_detail",
    "SmartService_create",
    "SmartService_update",
    "SmartService_remove",
    "SmartService_messages",
    "SmartService_postMessage",
  ],
  "/enterprise/asset": [
    "Asset_page",
    "Asset_detail",
    "Asset_create",
    "Asset_update",
    "Asset_remove",
    "Asset_messages",
    "Asset_postMessage",
  ],
  "/enterprise/legal/requests": [
    "Legal_page",
    "Legal_detail",
    "Legal_create",
    "Legal_updateRequest",
    "Legal_removeRequest",
    "Legal_messages",
    "Legal_postMessage",
  ],
  "/enterprise/ip/requests": [
    "Ip_page",
    "Ip_detail",
    "Ip_create",
    "Ip_updateRequest",
    "Ip_removeRequest",
    "Ip_messages",
    "Ip_postMessage",
  ],
  "/enterprise/flex/work-orders": [
    "Flex_page",
    "Flex_detail",
    "Flex_createWorkOrder",
    "Flex_updateWorkOrder",
    "Flex_removeWorkOrder",
    "Flex_messages",
    "Flex_postMessage",
  ],
  "/enterprise/think-tank/requests": [
    "ThinkTank_page",
    "ThinkTank_detail",
    "ThinkTank_create",
    "ThinkTank_update",
    "ThinkTank_remove",
    "ThinkTank_messages",
    "ThinkTank_postMessage",
  ],
} as const satisfies Record<string, readonly EndpointId[]>;
function board(path: string) {
  const local = Object.entries(localModules).find(([key]) => key === path)?.[1];
  if (local) return { local, domain: undefined };
  const domain = /^\/enterprise\/market\/([^/]+)\/demands$/.exec(path)?.[1];
  if (domain) return { local: null, domain };
  throw new ApiError("未登记的需求看板", "protocol");
}
export async function loadDemandPage<Row>(
  path: string,
  filters: Record<string, string>,
  cursor: string,
  signal: AbortSignal,
  schema: z.ZodType<Row>,
): Promise<CursorPage<Row>> {
  const { local, domain } = board(path);
  if (local) {
    const result = parseData(
      pageSchema(schema),
      await catalogEndpoint(
        local[0],
        { query: { ...filters, page: Number(cursor || 1), pageSize: 20 } },
        { signal },
      ),
    );
    const hasMore = result.page * result.pageSize < result.total;
    return {
      list: result.list,
      hasMore,
      nextCursor: hasMore ? String(result.page + 1) : null,
    };
  }
  return parseData(
    cursorPageSchema(schema),
    await catalogEndpoint(
      "MarketBoard_demands",
      {
        params: { domain },
        query: { ...filters, cursor: cursor || undefined },
      },
      { signal },
    ),
  );
}
const mutationSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    tip: z.string().optional(),
  })
  .passthrough()
  .nullable();
export const demandBoardApi = {
  detail: async <Row>(
    path: string,
    id: string | number,
    schema: z.ZodType<Row>,
    signal?: AbortSignal,
  ) => {
    const { local, domain } = board(path);
    return parseData(
      schema,
      await catalogEndpoint(
        local ? local[1] : "MarketBoard_demandDetail",
        { params: { domain, id: String(id) } },
        { signal },
      ),
    );
  },
  messages: async (path: string, id: string | number, signal?: AbortSignal) => {
    const { local, domain } = board(path);
    const result = parseData(
      z.object({ conversations: z.array(channelConversationSchema) }),
      await catalogEndpoint(
        local ? local[5] : "MarketBoard_demandMessages",
        { params: { domain, id: String(id) } },
        { signal },
      ),
    );
    return result.conversations;
  },
  create: async ({
    path,
    body,
  }: {
    path: string;
    body: Record<string, unknown>;
  }) => {
    const { local, domain } = board(path);
    const input =
      local &&
      ["Marketing_create", "Logistics_create", "SmartService_create"].includes(
        local[2],
      )
        ? Object.fromEntries(
            Object.entries(body)
              .filter(([, value]) => value !== undefined)
              .map(([key, value]) => [
                key,
                value === null ? "" : String(value),
              ]),
          )
        : body;
    return parseData(
      mutationSchema,
      await catalogEndpoint(local ? local[2] : "MarketBoard_createDemand", {
        params: { domain },
        body: input,
      }),
    );
  },
  update: async ({
    path,
    id,
    body,
  }: {
    path: string;
    id: string | number;
    body: Record<string, unknown>;
  }) => {
    const { local, domain } = board(path);
    return parseData(
      mutationSchema,
      await catalogEndpoint(local ? local[3] : "MarketBoard_updateDemand", {
        params: { domain, id: String(id) },
        body,
      }),
    );
  },
  remove: async ({ path, id }: { path: string; id: string | number }) => {
    const { local, domain } = board(path);
    return catalogEndpoint(local ? local[4] : "MarketBoard_removeDemand", {
      params: { domain, id: String(id) },
    });
  },
  reply: async ({
    path,
    id,
    text,
    conversationId,
  }: {
    path: string;
    id: string | number;
    text: string;
    conversationId: string;
  }) => {
    const { local } = board(path);
    if (!local) throw new ApiError("该看板不支持回复", "business");
    return catalogEndpoint(local[6], {
      params: { id: String(id) },
      body: { text, conversation_id: conversationId },
    });
  },
};
