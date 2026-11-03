"use client";
import { useCallback } from "react";
import { ApiError } from "@enterprise/contracts";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueries,
  useQueryClient,
  type QueryKey,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { App } from "antd";
import { presentMutationError } from "./errors";
import { useSession } from "@/lib/session";
import { queryKeys } from "./keys";
import { matchesInvalidationModule } from "./invalidation";
export { queryKeys } from "./keys";
export function useBusinessQuery<T>(
  module: string,
  resource: string,
  params: unknown,
  load: (signal: AbortSignal) => Promise<T>,
  enterprise: string | number = "all",
  enabled = true,
  policy: Pick<
    UseQueryOptions<T, Error, T>,
    "staleTime" | "refetchInterval"
  > = {},
) {
  const { me, loading, switchingIdentity } = useSession();
  const scope = queryKeys.scope(
    me?.userId || "",
    me?.currentIdentity || "",
    enterprise,
  );
  return useQuery({
    ...policy,
    queryKey: queryKeys.resource(scope, module, resource, params),
    queryFn: ({ signal }) => load(signal),
    enabled: enabled && !!me && !loading && !switchingIdentity,
  });
}
/** 可见模块分别订阅，各自完成与报错，不让慢模块阻塞其他模块。 */
export function useBusinessQueries<T>(
  module: string,
  resources: { resource: string; params: unknown; load: (signal: AbortSignal) => Promise<T> }[],
) {
  const { me, loading, switchingIdentity } = useSession();
  const scope = queryKeys.scope(me?.userId || "", me?.currentIdentity || "", "all");
  return useQueries({
    queries: resources.map(({ resource, params, load }) => ({
      queryKey: queryKeys.resource(scope, module, resource, params),
      queryFn: ({ signal }: { signal: AbortSignal }) => load(signal),
      enabled: !!me && !loading && !switchingIdentity,
    })),
  });
}
export function useBusinessMutation<TInput, TResult>(
  action: (input: TInput) => Promise<TResult>,
  invalidate: (QueryKey | string)[],
) {
  const client = useQueryClient();
  const { message } = App.useApp();
  const { me } = useSession();
  return useMutation({
    mutationFn: action,
    onSuccess: async () => {
      await Promise.all(
        invalidate.map((key) =>
          typeof key === "string"
            ? client.invalidateQueries({
                predicate: (query) =>
                  query.queryKey[0] === "private" &&
                  query.queryKey[1] === me?.userId &&
                  query.queryKey[2] === me?.currentIdentity &&
                  matchesInvalidationModule(query.queryKey[4],key),
              })
            : client.invalidateQueries({ queryKey: key }),
        ),
      );
    },
    onError: (error) => {
      presentMutationError(error, (text) => message.error(text));
    },
  });
}

/** 按模块刷新所有企业上下文，避免只刷新默认企业的缓存。 */
export const useOperationMutation = useBusinessMutation;

/** 弹窗详情和消息按需取数，仍使用会话隔离的缓存和取消信号。 */
export function useBusinessFetchQuery(
  module: string,
  enterprise: string | number = "all",
) {
  const client = useQueryClient();
  const { me, loading, switchingIdentity } = useSession();
  const account = me?.userId;
  const identity = me?.currentIdentity;
  return useCallback(
    <T>(
      resource: string,
      params: unknown,
      load: (signal: AbortSignal) => Promise<T>,
    ) => {
      if (!account || loading || switchingIdentity)
        return Promise.reject(new ApiError("会话正在更新", "cancelled"));
      return client.fetchQuery({
        queryKey: queryKeys.resource(
          queryKeys.scope(account, identity || "", enterprise),
          module,
          resource,
          params,
        ),
        queryFn: ({ signal }) => load(signal),
      });
    },
    [client, account, identity, loading, switchingIdentity, enterprise, module],
  );
}

export function useBusinessInfiniteQuery<T>(
  module: string,
  resource: string,
  params: unknown,
  load: (
    signal: AbortSignal,
    cursor: string,
  ) => Promise<import("@enterprise/contracts").CursorPage<T>>,
  enabled = true,
) {
  const { me, loading, switchingIdentity } = useSession();
  return useInfiniteQuery({
    queryKey: queryKeys.resource(
      queryKeys.scope(me?.userId || "", me?.currentIdentity || ""),
      module,
      resource,
      params,
    ),
    initialPageParam: "",
    queryFn: ({ signal, pageParam }) => load(signal, pageParam),
    getNextPageParam: (page) =>
      page.hasMore ? (page.nextCursor ?? undefined) : undefined,
    enabled: enabled && !!me && !loading && !switchingIdentity,
  });
}
