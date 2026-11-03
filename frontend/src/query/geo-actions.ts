"use client";
import { geoApi } from "@/api/geo";
import { useSession } from "@/lib/session";
import { queryKeys, useBusinessMutation } from "./business";

/** GEO 写操作统一刷新项目、问题、批次、报告和任务进度。 */
export function useGeoActions() {
  const { me } = useSession();
  const scope = queryKeys.scope(me?.userId ?? "", me?.currentIdentity ?? "");
  const invalidations = [
    [...scope, "geo"],
    [...scope, "dashboard"],
  ];
  return {
    createProject: useBusinessMutation(geoApi.createProject, invalidations),
    updateProject: useBusinessMutation(geoApi.updateProject, invalidations),
    removeProject: useBusinessMutation(geoApi.removeProject, invalidations),
    setAutoCollect: useBusinessMutation(geoApi.setAutoCollect, invalidations),
    createQuestion: useBusinessMutation(geoApi.createQuestion, invalidations),
    updateQuestion: useBusinessMutation(geoApi.updateQuestion, invalidations),
    removeQuestion: useBusinessMutation(geoApi.removeQuestion, invalidations),
    createBatch: useBusinessMutation(geoApi.createBatch, invalidations),
    updateBatch: useBusinessMutation(geoApi.updateBatch, invalidations),
    removeBatch: useBusinessMutation(geoApi.removeBatch, invalidations),
    createObservation: useBusinessMutation(
      geoApi.createObservation,
      invalidations,
    ),
    updateObservation: useBusinessMutation(
      geoApi.updateObservation,
      invalidations,
    ),
    removeObservation: useBusinessMutation(
      geoApi.removeObservation,
      invalidations,
    ),
    createTopic: useBusinessMutation(geoApi.createTopic, invalidations),
    updateTopic: useBusinessMutation(geoApi.updateTopic, invalidations),
    removeTopic: useBusinessMutation(geoApi.removeTopic, invalidations),
  };
}
