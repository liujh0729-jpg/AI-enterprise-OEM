"use client";
import {
  fetchAllModuleCategories,
  fetchModuleCategory,
} from "@/lib/aiworkin-categories";
import { useBusinessQuery } from "./business";

export const useModuleCategory = (domain: string, enabled = true) =>
  useBusinessQuery(
    "dictionary",
    "platform-category",
    { domain: domain.toUpperCase() },
    (signal) => fetchModuleCategory(domain, signal),
    "all",
    enabled,
    { staleTime: 60 * 60 * 1000 },
  );

/** 供需市场：全部业务板块的类目树（跨板块发布用）。 */
export const useAllModuleCategories = (enabled = true) =>
  useBusinessQuery(
    "dictionary",
    "platform-category-all",
    {},
    (signal) => fetchAllModuleCategories(signal),
    "all",
    enabled,
    { staleTime: 60 * 60 * 1000 },
  );
