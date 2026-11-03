"use client";
import { connectionsApi } from "@/api/connections";
import { useBusinessQuery } from "./business";
export const EMPTY_REGIONS: Region[] = [];
export function useLocationDictionary() {
  return useBusinessQuery(
    "connections",
    "locations",
    {},
    async (signal) => {
      const data = await connectionsApi.locations({}, { signal });
      return data?.list ?? [];
    },
    "all",
    true,
    { staleTime: 60 * 60 * 1000 },
  );
}
export type Region = NonNullable<
  Awaited<ReturnType<typeof connectionsApi.locations>>
>["list"][number];
