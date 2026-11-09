import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

export const mechanismsApi = {
  overview: endpoint(endpoints.Mechanism_overview),

  webhooks: endpoint(endpoints.Webhook_list),
  saveWebhook: endpoint(endpoints.Webhook_save),
  removeWebhook: endpoint(endpoints.Webhook_remove),
  deliveries: endpoint(endpoints.Webhook_deliveries),
  replayDelivery: endpoint(endpoints.Webhook_replay),
  testWebhook: endpoint(endpoints.Webhook_test),

  importMaps: endpoint(endpoints.Import_listMaps),
  saveImportMap: endpoint(endpoints.Import_saveMap),
  removeImportMap: endpoint(endpoints.Import_removeMap),
  createImportJob: endpoint(endpoints.Import_createJob),
  importJobs: endpoint(endpoints.Import_jobs),
  removeImportJob: endpoint(endpoints.Import_removeJob),

  exportModules: endpoint(endpoints.Export_modules),
  createExportJob: endpoint(endpoints.Export_createJob),
  exportJobs: endpoint(endpoints.Export_jobs),
  removeExportJob: endpoint(endpoints.Export_removeJob),

  reports: endpoint(endpoints.Report_listCatalog),
  saveReport: endpoint(endpoints.Report_saveCatalog),
  removeReport: endpoint(endpoints.Report_removeCatalog),

  rules: endpoint(endpoints.Rule_list),
  saveRule: endpoint(endpoints.Rule_save),
  removeRule: endpoint(endpoints.Rule_remove),
  testRule: endpoint(endpoints.Rule_test),

  shares: endpoint(endpoints.Share_list),
  createShare: endpoint(endpoints.Share_create),
  updateShare: endpoint(endpoints.Share_update),
  removeShare: endpoint(endpoints.Share_remove),

  oidcProviders: endpoint(endpoints.Oidc_listProviders),
  saveOidcProvider: endpoint(endpoints.Oidc_saveProvider),
  removeOidcProvider: endpoint(endpoints.Oidc_removeProvider),
  testOidcProvider: endpoint(endpoints.Oidc_testProvider),

  assetSharePolicy: endpoint(endpoints.AssetPolicy_getSharePolicy),
  saveAssetSharePolicy: endpoint(endpoints.AssetPolicy_saveSharePolicy),

  syncBindings: endpoint(endpoints.Sync_listBindings),
  saveSyncBinding: endpoint(endpoints.Sync_saveBinding),
  removeSyncBinding: endpoint(endpoints.Sync_removeBinding),
  syncOverview: endpoint(endpoints.Sync_overview),
  syncContacts: endpoint(endpoints.Sync_runContacts),
  syncAttendance: endpoint(endpoints.Sync_runAttendance),
  sendSyncMessage: endpoint(endpoints.Sync_sendMessage),
};
