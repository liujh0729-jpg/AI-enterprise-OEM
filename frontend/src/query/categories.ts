"use client";
import { fetchModuleCategory } from "@/lib/aiworkin-categories";
import { useBusinessQuery } from "./business";

export const useModuleCategory = (domain: string) =>
  useBusinessQuery(
    "dictionary",
    "platform-category",
    { domain: domain.toUpperCase() },
    (signal) => fetchModuleCategory(domain, signal),
    "all",
    true,
    { staleTime: 60 * 60 * 1000 },
  );
