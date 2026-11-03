"use client";
import { connectionsApi } from "@/api/connections";
import { useSession } from "@/lib/session";
import { queryKeys, useBusinessMutation, useBusinessQuery } from "./business";
export function useConnectionDictionaries(codes: Record<string, string>) {
  return useBusinessQuery(
    "connections",
    "dictionaries",
    { codes },
    async (signal) => {
      const entries = Object.entries(codes);
      const results = await Promise.allSettled(
        entries.map(
          async ([key, code]) =>
            [
              key,
              (
                await connectionsApi.dictionary(
                  { params: { code } },
                  { signal },
                )
              )?.list ?? [],
            ] as const,
        ),
      );
      const options: Record<string, { key: string; label: string }[]> = {};
      const issues: { key: string; message: string }[] = [];
      results.forEach((result, index) => {
        if (result.status === "fulfilled")
          options[result.value[0]] = result.value[1];
        else
          issues.push({
            key: entries[index][0],
            message:
              result.reason instanceof Error
                ? result.reason.message
                : "加载失败",
          });
      });
      if (signal.aborted) throw signal.reason;
      return { options, issues };
    },
    "all",
    true,
    { staleTime: 60 * 60 * 1000 },
  );
}
export function useConnectionResources(
  query: Record<string, string | string[]>,
) {
  return useBusinessQuery("connections", "resources", query, (signal) =>
    connectionsApi.resources({ query }, { signal }),
  );
}
export function useConnectionContact(
  resource: { id: string; sourceType: string } | null,
) {
  return useBusinessQuery(
    "connections",
    "contact",
    { id: resource?.id, sourceType: resource?.sourceType },
    (signal) =>
      connectionsApi.contact(
        {
          params: {
            resourceId: resource?.id ?? "",
            sourceType: resource?.sourceType ?? "",
          },
        },
        { signal },
      ),
    "all",
    !!resource,
  );
}
export function useConnectionFavorite() {
  const { me } = useSession();
  const scope = queryKeys.scope(me?.userId ?? "", me?.currentIdentity ?? "");
  return useBusinessMutation(
    ({
      id,
      sourceType,
      favorite,
    }: {
      id: string;
      sourceType: string;
      favorite: boolean;
    }) => {
      const method =
        sourceType === "profile"
          ? favorite
            ? connectionsApi.addProfileFavorite
            : connectionsApi.removeProfileFavorite
          : favorite
            ? connectionsApi.addFavorite
            : connectionsApi.removeFavorite;
      return method({ params: { resourceId: id } });
    },
    [
      [...scope, "connections", "resources"],
      [...scope, "connections", "favorites"],
    ],
  );
}
