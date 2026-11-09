import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

/** 模型广场：用户侧目录/试用/用量/接入方式 + 平台侧上游与目录维护。 */
export const modelPlazaApi = {
  catalog: endpoint(endpoints.Mp_catalog),
  detail: endpoint(endpoints.Mp_detail),
  trial: endpoint(endpoints.Mp_trial),
  usage: endpoint(endpoints.Mp_usage),
  usageSummary: endpoint(endpoints.Mp_usageSummary),
  connection: endpoint(endpoints.Mp_connection),
};

export const modelPlazaAdminApi = {
  overview: endpoint(endpoints.AdminMp_overview),
  upstreams: endpoint(endpoints.AdminMp_upstreams),
  saveUpstream: endpoint(endpoints.AdminMp_saveUpstream),
  removeUpstream: endpoint(endpoints.AdminMp_removeUpstream),
  catalog: endpoint(endpoints.AdminMp_listCatalog),
  saveCatalog: endpoint(endpoints.AdminMp_saveCatalog),
  toggleCatalog: endpoint(endpoints.AdminMp_toggleCatalog),
  removeCatalog: endpoint(endpoints.AdminMp_removeCatalog),
  pull: endpoint(endpoints.AdminMp_pullModels),
  importModels: endpoint(endpoints.AdminMp_importModels),
  seed: endpoint(endpoints.AdminMp_seed),
  usage: endpoint(endpoints.AdminMp_usageList),
};
