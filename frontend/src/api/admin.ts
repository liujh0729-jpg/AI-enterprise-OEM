import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

export const adminApi = {
  contractPage: endpoint(endpoints.Admin_contractPage),
  users: endpoint(endpoints.Admin_users),
  appPage: endpoint(endpoints.Admin_appPage),
  providerPage: endpoint(endpoints.Admin_providerPage),
  requestPage: endpoint(endpoints.Admin_requestPage),
  providerStats: endpoint(endpoints.Admin_providerStats),
  stats: endpoint(endpoints.Admin_stats),
  enterprises: endpoint(endpoints.Admin_enterprises),
  apps: endpoint(endpoints.Admin_apps),
  auditApp: endpoint(endpoints.Admin_auditApp),
  providers: endpoint(endpoints.Admin_providers),
  revoke: endpoint(endpoints.Admin_revoke),
  restore: endpoint(endpoints.Admin_restore),
  capabilityRequests: endpoint(endpoints.Admin_capabilityRequests),
  capabilityMatrix: endpoint(endpoints.Admin_capabilityMatrix),
  capabilities: endpoint(endpoints.Admin_capabilities),
  setCapability: endpoint(endpoints.Admin_setCapability),
  settings: endpoint(endpoints.Admin_settings),
  saveSettings: endpoint(endpoints.Admin_saveSettings),
  geoCollectionStats: endpoint(endpoints.Admin_geoCollectionStats),
  flexPayroll: endpoint(endpoints.Admin_flexPayroll),
  saveFlexPayroll: endpoint(endpoints.Admin_saveFlexPayroll),
  contracts: endpoint(endpoints.Admin_contracts),
};
