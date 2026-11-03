"use client";
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/lib/session";
import { usePageVisible } from "./visibility";
import { geoApi } from "@/api/geo";
import { useBusinessQuery } from "./business";

export const useGeoProjects = () =>
  useBusinessQuery("geo", "projects", {}, (signal) =>
    geoApi.projects({}, { signal }),
  );
export const useGeoMeta = () =>
  useBusinessQuery("geo", "meta", {}, (signal) => geoApi.meta({}, { signal }));
export const useGeoQuestions = (projectId: number) =>
  useBusinessQuery(
    "geo",
    "questions",
    { projectId },
    (signal) =>
      geoApi.questions({ params: { id: String(projectId) } }, { signal }),
    "all",
    projectId > 0,
  );
export const useGeoBatches = (projectId: number) =>
  useBusinessQuery("geo", "batches", { projectId }, (signal) =>
    geoApi.batches({ params: { id: String(projectId) } }, { signal }),
  );
export const useGeoObservations = (batchId: number) =>
  useBusinessQuery("geo", "observations", { batchId }, (signal) =>
    geoApi.observations({ params: { id: String(batchId) } }, { signal }),
  );
export const useGeoTopics = (projectId: number) =>
  useBusinessQuery("geo", "topics", { projectId }, (signal) =>
    geoApi.topics({ params: { id: String(projectId) } }, { signal }),
  );
export const useGeoReport = (projectId: number, batchId: number) =>
  useBusinessQuery("geo", "report", { projectId, batchId }, (signal) =>
    geoApi.report(
      {
        params: { id: String(projectId) },
        query: { batchId: batchId ? String(batchId) : undefined },
      },
      { signal },
    ),
  );
export function useGeoAutoCollect(projectId: number) {
  const visible = usePageVisible();
  const client = useQueryClient();
  const { me } = useSession();
  const attempts = useRef({ projectId, errorAt: 0, successAt: 0, failures: 0 });
  const query = useBusinessQuery(
    "geo",
    "auto-collect",
    { projectId },
    (signal) =>
      geoApi.autoCollect({ params: { id: String(projectId) } }, { signal }),
    "all",
    projectId > 0,
    {
      refetchInterval: (query) => {
        const state = query.state;
        if (attempts.current.projectId !== projectId)
          attempts.current = {
            projectId,
            errorAt: 0,
            successAt: 0,
            failures: 0,
          };
        const tracker = attempts.current;
        if (state.dataUpdatedAt > tracker.successAt) {
          tracker.successAt = state.dataUpdatedAt;
          tracker.failures = 0;
        }
        if (state.errorUpdatedAt > tracker.errorAt) {
          tracker.errorAt = state.errorUpdatedAt;
          tracker.failures++;
        }
        const run = state.data?.currentRun;
        return visible &&
          state.data?.enabled &&
          run &&
          ["PENDING", "RUNNING"].includes(run.status)
          ? Math.min(120000, 30000 * 2 ** Math.min(2, tracker.failures))
          : false;
      },
    },
  );
  const run = query.data?.currentRun;
  const version = run
    ? JSON.stringify([
        run.id,
        run.status,
        run.done,
        run.failed,
        run.batchId,
        run.finishedAt,
      ])
    : "";
  const scope = JSON.stringify([me?.userId, me?.currentIdentity, projectId]);
  const previous = useRef({ scope, version });
  useEffect(() => {
    const last = previous.current;
    previous.current = { scope, version };
    if (last.scope !== scope || !last.version || last.version === version)
      return;
    // Worker 提交的新结果由状态轮询触发刷新，完成后无需继续轮询结果列表。
    void client.invalidateQueries({
      predicate: (item) =>
        item.queryKey[0] === "private" &&
        item.queryKey[1] === me?.userId &&
        item.queryKey[2] === me?.currentIdentity &&
        item.queryKey[4] === "geo" &&
        !["auto-collect", "meta"].includes(String(item.queryKey[5])),
    });
  }, [client, me?.userId, me?.currentIdentity, scope, version]);
  return query;
}
