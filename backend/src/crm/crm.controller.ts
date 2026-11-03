import { CurrentUser } from '../auth/current-user';
import { text } from '../common/api';
import { CrmScopeService } from './crm.scope';
import { CrmSettingsService } from './crm.settings.service';
import { CrmLeadService } from './crm.lead.service';
import { CrmCustomerService } from './crm.customer.service';
import { CrmFollowService } from './crm.follow.service';
import { CrmProductService } from './crm.product.service';
import { CrmOpportunityService } from './crm.opportunity.service';
import { CrmContractService } from './crm.contract.service';
import { CrmOrderService } from './crm.order.service';
import { CrmApprovalService } from './crm.approval.service';
import { CrmReportService } from './crm.report.service';
import { CrmAiService } from './crm.ai.service';

export class CrmController {
  constructor(
    readonly scope: CrmScopeService,
    readonly settingsService: CrmSettingsService,
    readonly leadsService: CrmLeadService,
    readonly customersService: CrmCustomerService,
    readonly followsService: CrmFollowService,
    readonly productsService: CrmProductService,
    readonly opportunitiesService: CrmOpportunityService,
    readonly contractsService: CrmContractService,
    readonly ordersService: CrmOrderService,
    readonly approvalsService: CrmApprovalService,
    readonly reportsService: CrmReportService,
    readonly aiService: CrmAiService,
  ) {}

  workbench(user: CurrentUser, query: Record<string, unknown>) {
    return this.reportsService.workbench(user, query);
  }
  globalSearch(user: CurrentUser, query: Record<string, unknown>) {
    return this.reportsService.search(user, query);
  }
  duplicateCheck(user: CurrentUser, query: Record<string, unknown>) {
    return this.reportsService.duplicates(user, query);
  }
  saveQuickAccess(user: CurrentUser, body: Record<string, unknown>) {
    return this.reportsService.saveQuickAccess(user, body);
  }
  statsOverview(user: CurrentUser, query: Record<string, unknown>) {
    return this.reportsService.statsOverview(user, query);
  }
  statsFunnel(user: CurrentUser) {
    return this.reportsService.statsFunnel(user);
  }
  statsReceivables(user: CurrentUser) {
    return this.reportsService.statsReceivables(user);
  }
  changeLogs(user: CurrentUser, query: Record<string, unknown>) {
    return this.settingsService.changeLogs(user, query);
  }

  settings(user: CurrentUser) {
    return this.settingsService.settings(user);
  }
  saveSettings(user: CurrentUser, body: Record<string, unknown>) {
    return this.settingsService.saveSettings(user, body);
  }
  members(user: CurrentUser) {
    return this.settingsService.members(user);
  }
  saveMember(user: CurrentUser, body: Record<string, unknown>) {
    return this.settingsService.saveMember(user, body);
  }
  removeMember(user: CurrentUser, id: string) {
    return this.settingsService.removeMember(user, id);
  }
  fieldDefs(user: CurrentUser, query: Record<string, unknown>) {
    return this.settingsService.fieldDefs(user, text(query.formKey));
  }
  saveFieldDef(user: CurrentUser, body: Record<string, unknown>) {
    return this.settingsService.saveFieldDef(user, body);
  }
  removeFieldDef(user: CurrentUser, id: string) {
    return this.settingsService.removeFieldDef(user, id);
  }
  customModules(user: CurrentUser) {
    return this.settingsService.customModules(user);
  }
  saveCustomModule(user: CurrentUser, body: Record<string, unknown>) {
    return this.settingsService.saveCustomModule(user, body);
  }
  removeCustomModule(user: CurrentUser, id: string) {
    return this.settingsService.removeCustomModule(user, id);
  }

  leads(user: CurrentUser, query: Record<string, unknown>) {
    return this.leadsService.list(user, query);
  }
  lead(user: CurrentUser, id: string) {
    return this.leadsService.get(user, id);
  }
  createLead(user: CurrentUser, body: Record<string, unknown>) {
    return this.leadsService.create(user, body);
  }
  updateLead(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.leadsService.update(user, id, body);
  }
  updateLeadStage(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return this.leadsService.updateStage(user, id, body);
  }
  removeLead(user: CurrentUser, id: string) {
    return this.leadsService.remove(user, id);
  }
  transferLead(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.leadsService.transfer(user, id, body);
  }
  batchTransferLead(user: CurrentUser, body: Record<string, unknown>) {
    return this.leadsService.batchTransfer(user, body);
  }
  toPool(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.leadsService.toPool(user, id, body);
  }
  pickLead(user: CurrentUser, id: string) {
    return this.leadsService.pick(user, id);
  }
  assignLead(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.leadsService.assign(user, id, body);
  }
  freezeLead(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.leadsService.freeze(user, id, body);
  }
  unfreezeLead(user: CurrentUser, id: string) {
    return this.leadsService.unfreeze(user, id);
  }
  convertLead(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.leadsService.convert(user, id, body);
  }
  leadOwnerHistory(user: CurrentUser, id: string) {
    return this.leadsService.ownerHistory(user, id);
  }
  leadPools(user: CurrentUser) {
    return this.leadsService.pools(user);
  }
  saveLeadPool(user: CurrentUser, body: Record<string, unknown>) {
    return this.leadsService.savePool(user, body);
  }
  removeLeadPool(user: CurrentUser, id: string) {
    return this.leadsService.removePool(user, id);
  }
  capacities(user: CurrentUser, query: Record<string, unknown>) {
    return this.leadsService.capacities(user, query);
  }
  saveCapacity(user: CurrentUser, body: Record<string, unknown>) {
    return this.leadsService.saveCapacity(user, body);
  }

  customers(user: CurrentUser, query: Record<string, unknown>) {
    return this.customersService.list(user, query);
  }
  customer360(user: CurrentUser, id: string) {
    return this.customersService.get360(user, id);
  }
  createCustomer(user: CurrentUser, body: Record<string, unknown>) {
    return this.customersService.create(user, body);
  }
  updateCustomer(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.customersService.update(user, id, body);
  }
  removeCustomer(user: CurrentUser, id: string) {
    return this.customersService.remove(user, id);
  }
  transferCustomer(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return this.customersService.transfer(user, id, body);
  }
  customerMergePreview(user: CurrentUser, query: Record<string, unknown>) {
    return this.customersService.mergePreview(user, query);
  }
  mergeCustomers(user: CurrentUser, body: Record<string, unknown>) {
    return this.customersService.merge(user, body);
  }
  customerToPool(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.customersService.toPool(user, id, body);
  }
  pickCustomer(user: CurrentUser, id: string) {
    return this.customersService.pick(user, id);
  }
  assignCustomer(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.customersService.assign(user, id, body);
  }
  freezeCustomer(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.customersService.freeze(user, id, body);
  }
  unfreezeCustomer(user: CurrentUser, id: string) {
    return this.customersService.unfreeze(user, id);
  }
  customerPools(user: CurrentUser) {
    return this.customersService.pools(user);
  }
  saveCustomerPool(user: CurrentUser, body: Record<string, unknown>) {
    return this.customersService.savePool(user, body);
  }
  removeCustomerPool(user: CurrentUser, id: string) {
    return this.customersService.removePool(user, id);
  }
  contacts(user: CurrentUser, query: Record<string, unknown>) {
    return this.customersService.contacts(user, query);
  }
  saveContact(user: CurrentUser, body: Record<string, unknown>) {
    return this.customersService.saveContact(user, body);
  }
  toggleContact(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.customersService.toggleContact(user, id, body);
  }
  removeContact(user: CurrentUser, id: string) {
    return this.customersService.removeContact(user, id);
  }
  collaborations(user: CurrentUser, query: Record<string, unknown>) {
    return this.customersService.collaborations(user, query);
  }
  saveCollaboration(user: CurrentUser, body: Record<string, unknown>) {
    return this.customersService.saveCollaboration(user, body);
  }
  removeCollaboration(user: CurrentUser, id: string) {
    return this.customersService.removeCollaboration(user, id);
  }
  customerRelations(user: CurrentUser, query: Record<string, unknown>) {
    return this.customersService.relations(user, query);
  }
  saveCustomerRelation(user: CurrentUser, body: Record<string, unknown>) {
    return this.customersService.saveRelation(user, body);
  }
  removeCustomerRelation(user: CurrentUser, id: string) {
    return this.customersService.removeRelation(user, id);
  }

  followRecords(user: CurrentUser, query: Record<string, unknown>) {
    return this.followsService.records(user, query);
  }
  saveFollowRecord(user: CurrentUser, body: Record<string, unknown>) {
    return this.followsService.saveRecord(user, body);
  }
  followPlans(user: CurrentUser, query: Record<string, unknown>) {
    return this.followsService.plans(user, query);
  }
  saveFollowPlan(user: CurrentUser, body: Record<string, unknown>) {
    return this.followsService.savePlan(user, body);
  }
  updateFollowPlan(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return this.followsService.updatePlan(user, id, body);
  }
  followComments(user: CurrentUser, query: Record<string, unknown>) {
    return this.followsService.comments(user, query);
  }
  saveFollowComment(user: CurrentUser, body: Record<string, unknown>) {
    return this.followsService.saveComment(user, body);
  }

  opportunities(user: CurrentUser, query: Record<string, unknown>) {
    return this.opportunitiesService.list(user, query);
  }
  opportunity(user: CurrentUser, id: string) {
    return this.opportunitiesService.get(user, id);
  }
  createOpportunity(user: CurrentUser, body: Record<string, unknown>) {
    return this.opportunitiesService.create(user, body);
  }
  updateOpportunity(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return this.opportunitiesService.update(user, id, body);
  }
  updateOpportunityStage(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return this.opportunitiesService.updateStage(user, id, body);
  }
  removeOpportunity(user: CurrentUser, id: string) {
    return this.opportunitiesService.remove(user, id);
  }
  opportunityStages(user: CurrentUser) {
    return this.opportunitiesService.stages(user);
  }
  saveOpportunityStage(user: CurrentUser, body: Record<string, unknown>) {
    return this.opportunitiesService.saveStage(user, body);
  }
  removeOpportunityStage(user: CurrentUser, id: string) {
    return this.opportunitiesService.removeStage(user, id);
  }
  opportunityRules(user: CurrentUser) {
    return this.opportunitiesService.rules(user);
  }
  saveOpportunityRule(user: CurrentUser, body: Record<string, unknown>) {
    return this.opportunitiesService.saveRule(user, body);
  }
  quotations(user: CurrentUser, query: Record<string, unknown>) {
    return this.opportunitiesService.quotations(user, query);
  }
  saveQuotation(user: CurrentUser, body: Record<string, unknown>) {
    return this.opportunitiesService.saveQuotation(user, body);
  }
  voidQuotation(user: CurrentUser, id: string) {
    return this.opportunitiesService.voidQuotation(user, id);
  }
  removeQuotation(user: CurrentUser, id: string) {
    return this.opportunitiesService.removeQuotation(user, id);
  }

  contracts(user: CurrentUser, query: Record<string, unknown>) {
    return this.contractsService.list(user, query);
  }
  contract(user: CurrentUser, id: string) {
    return this.contractsService.get(user, id);
  }
  createContract(user: CurrentUser, body: Record<string, unknown>) {
    return this.contractsService.create(user, body);
  }
  updateContract(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.contractsService.update(user, id, body);
  }
  updateContractStage(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return this.contractsService.updateStage(user, id, body);
  }
  voidContract(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.contractsService.voidContract(user, id, body);
  }
  removeContract(user: CurrentUser, id: string) {
    return this.contractsService.remove(user, id);
  }
  contractStages(user: CurrentUser) {
    return this.contractsService.stages(user);
  }
  saveContractStage(user: CurrentUser, body: Record<string, unknown>) {
    return this.contractsService.saveStage(user, body);
  }
  removeContractStage(user: CurrentUser, id: string) {
    return this.contractsService.removeStage(user, id);
  }
  paymentPlans(user: CurrentUser, query: Record<string, unknown>) {
    return this.contractsService.plans(user, query);
  }
  savePaymentPlan(user: CurrentUser, body: Record<string, unknown>) {
    return this.contractsService.savePlan(user, body);
  }
  removePaymentPlan(user: CurrentUser, id: string) {
    return this.contractsService.removePlan(user, id);
  }
  paymentRecords(user: CurrentUser, query: Record<string, unknown>) {
    return this.contractsService.records(user, query);
  }
  savePaymentRecord(user: CurrentUser, body: Record<string, unknown>) {
    return this.contractsService.saveRecord(user, body);
  }
  removePaymentRecord(user: CurrentUser, id: string) {
    return this.contractsService.removeRecord(user, id);
  }
  invoices(user: CurrentUser, query: Record<string, unknown>) {
    return this.contractsService.invoices(user, query);
  }
  saveInvoice(user: CurrentUser, body: Record<string, unknown>) {
    return this.contractsService.saveInvoice(user, body);
  }
  removeInvoice(user: CurrentUser, id: string) {
    return this.contractsService.removeInvoice(user, id);
  }
  businessTitles(user: CurrentUser, query: Record<string, unknown>) {
    return this.contractsService.titles(user, query);
  }
  saveBusinessTitle(user: CurrentUser, body: Record<string, unknown>) {
    return this.contractsService.saveTitle(user, body);
  }
  removeBusinessTitle(user: CurrentUser, id: string) {
    return this.contractsService.removeTitle(user, id);
  }

  orders(user: CurrentUser, query: Record<string, unknown>) {
    return this.ordersService.list(user, query);
  }
  order(user: CurrentUser, id: string) {
    return this.ordersService.get(user, id);
  }
  createOrder(user: CurrentUser, body: Record<string, unknown>) {
    return this.ordersService.create(user, body);
  }
  updateOrder(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.ordersService.update(user, id, body);
  }
  updateOrderStage(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return this.ordersService.updateStage(user, id, body);
  }
  removeOrder(user: CurrentUser, id: string) {
    return this.ordersService.remove(user, id);
  }
  orderStages(user: CurrentUser) {
    return this.ordersService.stages(user);
  }
  saveOrderStage(user: CurrentUser, body: Record<string, unknown>) {
    return this.ordersService.saveStage(user, body);
  }
  removeOrderStage(user: CurrentUser, id: string) {
    return this.ordersService.removeStage(user, id);
  }

  products(user: CurrentUser, query: Record<string, unknown>) {
    return this.productsService.list(user, query);
  }
  saveProduct(user: CurrentUser, body: Record<string, unknown>) {
    return this.productsService.save(user, body);
  }
  removeProduct(user: CurrentUser, id: string) {
    return this.productsService.remove(user, id);
  }
  productPrices(user: CurrentUser) {
    return this.productsService.prices(user);
  }
  saveProductPrice(user: CurrentUser, body: Record<string, unknown>) {
    return this.productsService.savePrice(user, body);
  }
  removeProductPrice(user: CurrentUser, id: string) {
    return this.productsService.removePrice(user, id);
  }

  approvalFlows(user: CurrentUser) {
    return this.approvalsService.flows(user);
  }
  approvalFlow(user: CurrentUser, id: string) {
    return this.approvalsService.flow(user, id);
  }
  saveApprovalFlow(user: CurrentUser, body: Record<string, unknown>) {
    return this.approvalsService.saveFlow(user, body);
  }
  removeApprovalFlow(user: CurrentUser, id: string) {
    return this.approvalsService.removeFlow(user, id);
  }
  submitApproval(user: CurrentUser, body: Record<string, unknown>) {
    return this.approvalsService.submit(user, body);
  }
  approvalInstances(user: CurrentUser, query: Record<string, unknown>) {
    return this.approvalsService.instances(user, query);
  }
  approvalInstance(user: CurrentUser, id: string) {
    return this.approvalsService.instance(user, id);
  }
  approvalTodo(user: CurrentUser, query: Record<string, unknown>) {
    return this.approvalsService.todo(user, query);
  }
  approvalDone(user: CurrentUser, query: Record<string, unknown>) {
    return this.approvalsService.done(user, query);
  }
  approve(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.approvalsService.approve(user, id, body);
  }
  reject(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.approvalsService.reject(user, id, body);
  }
  addSign(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.approvalsService.addSign(user, id, body);
  }
  returnBack(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.approvalsService.returnBack(user, id, body);
  }
  revokeApproval(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.approvalsService.revoke(user, id, body);
  }
  approvalComments(user: CurrentUser, id: string) {
    return this.approvalsService.comments(user, id);
  }
  saveApprovalComment(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return this.approvalsService.saveComment(user, id, body);
  }

  exportTasks(user: CurrentUser) {
    return this.reportsService.exportTasks(user);
  }
  createExport(user: CurrentUser, body: Record<string, unknown>) {
    return this.reportsService.createExport(user, body);
  }
  importPrecheck(user: CurrentUser, body: Record<string, unknown>) {
    return this.reportsService.precheck(user, body);
  }
  importCommit(user: CurrentUser, body: Record<string, unknown>) {
    return this.reportsService.importCommit(user, body);
  }
  exportToDataTable(user: CurrentUser, body: Record<string, unknown>) {
    return this.reportsService.exportToDataTable(user, body);
  }

  aiDraftLead(user: CurrentUser, body: Record<string, unknown>) {
    return this.aiService.draftLead(user, body);
  }
  aiSummarize(user: CurrentUser, body: Record<string, unknown>) {
    return this.aiService.summarize(user, body);
  }
  aiRisk(user: CurrentUser, body: Record<string, unknown>) {
    return this.aiService.risk(user, body);
  }
  analyzeOpportunity(user: CurrentUser, body: Record<string, unknown>) {
    return this.aiService.analyzeOpportunity(user, body);
  }
  aiCollectionDraft(user: CurrentUser, body: Record<string, unknown>) {
    return this.aiService.collectionDraft(user, body);
  }
  aiReport(user: CurrentUser, body: Record<string, unknown>) {
    return this.aiService.report(user, body);
  }
  aiDuplicateExplain(user: CurrentUser, body: Record<string, unknown>) {
    return this.aiService.duplicateExplain(user, body);
  }
}
