import { endpoints } from "@enterprise/contracts";
import { endpoint } from "./endpoint";

export const flexApi = {
  payrollPage: endpoint(endpoints.Flex_payrollPage),
  payrollStats: endpoint(endpoints.Flex_payrollStats),
  payrollDetail: endpoint(endpoints.Flex_payrollDetail),

  onboardingPage: endpoint(endpoints.Flex_onboardingPage),
  onboardingStats: endpoint(endpoints.Flex_onboardingStats),
  onboardingDetail: endpoint(endpoints.Flex_onboardingDetail),

  page: endpoint(endpoints.Flex_page),
  stats: endpoint(endpoints.Flex_stats),
  detail: endpoint(endpoints.Flex_detail),
  providers: endpoint(endpoints.Flex_providers),
  createProvider: endpoint(endpoints.Flex_createProvider),
  updateProvider: endpoint(endpoints.Flex_updateProvider),
  removeProvider: endpoint(endpoints.Flex_removeProvider),
  onboardings: endpoint(endpoints.Flex_onboardings),
  createOnboarding: endpoint(endpoints.Flex_createOnboarding),
  uploadOnboardingAttachments: endpoint(
    endpoints.Flex_uploadOnboardingAttachments,
  ),
  auditOnboarding: endpoint(endpoints.Flex_auditOnboarding),
  workOrders: endpoint(endpoints.Flex_workOrders),
  createWorkOrder: endpoint(endpoints.Flex_createWorkOrder),
  match: endpoint(endpoints.Flex_match),
  messages: endpoint(endpoints.Flex_messages),
  postMessage: endpoint(endpoints.Flex_postMessage),
  candidates: endpoint(endpoints.Flex_candidates),
  settlements: endpoint(endpoints.Flex_settlements),
  publish: endpoint(endpoints.Flex_publish),
  updateWorkOrder: endpoint(endpoints.Flex_updateWorkOrder),
  removeWorkOrder: endpoint(endpoints.Flex_removeWorkOrder),
  updateWorkOrderContacts: endpoint(endpoints.Flex_updateWorkOrderContacts),
  updateOnboardingContacts: endpoint(endpoints.Flex_updateOnboardingContacts),
  updatePayrollContacts: endpoint(endpoints.Flex_updatePayrollContacts),
  payrolls: endpoint(endpoints.Flex_payrolls),
  createPayroll: endpoint(endpoints.Flex_createPayroll),
  auditPayroll: endpoint(endpoints.Flex_auditPayroll),
};
