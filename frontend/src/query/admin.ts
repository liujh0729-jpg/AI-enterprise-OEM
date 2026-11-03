"use client";
import { adminApi } from "@/api/admin";
import { useBusinessQuery } from "./business";

export function useAdminGeoCollectionStats() {
  return useBusinessQuery(
    "admin",
    "geo-collection-stats",
    {},
    (signal) => adminApi.geoCollectionStats({}, { signal }),
    "all",
    true,
    {
      refetchInterval: (query) => {
        const pending = query.state.data?.runs.some((row) =>
          ["RUNNING", "PENDING"].includes(row.status),
        );
        return pending
          ? Math.min(120000, 30000 * 2 ** query.state.fetchFailureCount)
          : false;
      },
    },
  );
}
