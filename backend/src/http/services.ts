import { PrismaService } from '../prisma/prisma.service';
import { HealthController } from '../health.controller';
import { UserLookupService } from '../directory/user-lookup.service';
import { OssService } from '../oss/oss.service';
import { OssSettingsService } from '../oss/oss-settings.service';
import { OssSettingsController } from '../oss/oss-settings.controller';
import { IdentityService } from '../identity/identity.service';
import { CapabilityService } from '../capability/capability.service';
import { GeoSettingsService } from '../geo/geo-settings.service';
import { GeoCollectionService } from '../geo/geo-collection.service';
import { AdminService } from '../admin/admin.service';
import { AdminController } from '../admin/admin.controller';
import { AiworkinClient } from '../aiworkin/aiworkin.client';
import { DemandService } from '../aiworkin/demand.service';
import { EnterpriseProfileService } from '../aiworkin/enterprise-profile.service';
import { AiworkinController } from '../aiworkin/aiworkin.controller';
import { ConnectionsService } from '../aiworkin/connections.service';
import { ConnectionsController } from '../aiworkin/connections.controller';
import { DemandSyncService } from '../aiworkin/demand-sync.service';
import { ContactResolver } from '../shared/contacts.service';
import { AssetService } from '../asset/asset.service';
import { AssetController } from '../asset/asset.controller';
import { CapabilityController } from '../capability/capability.controller';
import { ContractsService } from '../contracts/contracts.service';
import { ContractsController } from '../contracts/contracts.controller';
import { ExternalService } from '../external/external.service';
import { ExternalCredentialService } from '../external/external-credential.service';
import { ExternalController } from '../external/external.controller';
import { FlexService } from '../flex/flex.service';
import { FlexController } from '../flex/flex.controller';
import { GeoService } from '../geo/geo.service';
import { GeoController } from '../geo/geo.controller';
import { IdentityController } from '../identity/identity.controller';
import { QxySettingsService } from '../qixiangyun/qxy-settings.service';
import { QxyClient } from '../qixiangyun/qxy.client';
import { QxyService } from '../qixiangyun/qxy.service';
import { InvoiceService } from '../invoice/invoice.service';
import { InvoiceController } from '../invoice/invoice.controller';
import { IpService } from '../ip/ip.service';
import { IpController } from '../ip/ip.controller';
import { ThinkTankService } from '../think-tank/think-tank.service';
import { ThinkTankController } from '../think-tank/think-tank.controller';
import { LegalService } from '../legal/legal.service';
import { LegalController } from '../legal/legal.controller';
import { LogisticsService } from '../logistics/logistics.service';
import { LogisticsController } from '../logistics/logistics.controller';
import { MarketBoardService } from '../market-board/market-board.service';
import { MarketBoardController } from '../market-board/market-board.controller';
import { AppDirectoryService } from '../apps/app-directory.service';
import { AppDirectoryController } from '../apps/app-directory.controller';
import { MarketingService } from '../marketing/marketing.service';
import { MarketingController } from '../marketing/marketing.controller';
import { OverseasService } from '../overseas/overseas.service';
import { QxyOpenApiClient } from '../qixiangyun/qxy-openapi.client';
import { InvoiceOcrService } from '../ocr/invoice-ocr.service';
import { TaxService } from '../tax/tax.service';
import { OpenApiController } from '../openapi/openapi.controller';
import { OverseasController } from '../overseas/overseas.controller';
import { QxyController } from '../qixiangyun/qxy.controller';
import { ServicesService } from '../services/services.service';
import { ServicesController } from '../services/services.controller';
import { SmartServiceService } from '../smart-service/smart-service.service';
import { SmartServiceController } from '../smart-service/smart-service.controller';
import { SupplyService } from '../supply/supply.service';
import { SupplyController } from '../supply/supply.controller';
import { TaxController } from '../tax/tax.controller';
import { ModelKeyService } from '../aiworkin/model-key.service';
import { DataTableService } from '../data-table/data-table.service';
import { DataTableController } from '../data-table/data-table.controller';
import { DataTableOpenController } from '../data-table/data-table-open.controller';
import { FeishuBitableClient } from '../feishu/feishu-bitable.client';
import { FeishuSyncCrypto } from '../feishu/feishu-crypto';
import { DataTableFeishuService } from '../feishu/data-table-feishu.service';
import { DataTableFeishuController } from '../feishu/data-table-feishu.controller';
import { RpaCrypto } from '../rpa/rpa-crypto';
import { RpaScriptService } from '../rpa/rpa-script.service';
import { RpaAccountService } from '../rpa/rpa-account.service';
import { RpaSettingService } from '../rpa/rpa-setting.service';
import { RpaTaskService } from '../rpa/rpa-task.service';
import { RpaLlmService } from '../rpa/rpa-llm.service';
import { RpaController } from '../rpa/rpa.controller';
import { RpaOpenController } from '../rpa/rpa-open.controller';
import { WorkbuddyCrypto } from '../workbuddy/workbuddy-crypto';
import { WorkbuddyAccountService } from '../workbuddy/workbuddy-account.service';
import { WorkbuddyAgentService } from '../workbuddy/workbuddy-agent.service';
import { WorkbuddyPlanService } from '../workbuddy/workbuddy-plan.service';
import { WorkbuddyLlmService } from '../workbuddy/workbuddy-llm.service';
import { WorkbuddyController } from '../workbuddy/workbuddy.controller';
import { AiCallCrypto } from '../ai-call/ai-call-crypto';
import { AiCallAccountService } from '../ai-call/ai-call-account.service';
import { AiCallController } from '../ai-call/ai-call.controller';
import { AiCallOpenController } from '../ai-call/ai-call-open.controller';
import { LeadProspectingService } from '../lead-prospecting/lead-prospecting.service';
import { LeadProspectingController } from '../lead-prospecting/lead-prospecting.controller';
import { BigdataQueryService } from '../bigdata/bigdata-query.service';
import { BigdataQueryController } from '../bigdata/bigdata-query.controller';
import { EcomPdpService } from '../ecom-pdp/ecom-pdp.service';
import { EcomPdpController } from '../ecom-pdp/ecom-pdp.controller';
import { DomesticPdpService } from '../domestic-pdp/domestic-pdp.service';
import { DomesticPdpController } from '../domestic-pdp/domestic-pdp.controller';
import { AliyunCallCrypto } from '../aliyun-call/aliyun-call-crypto';
import { AliyunCallService } from '../aliyun-call/aliyun-call.service';
import { AliyunCallController } from '../aliyun-call/aliyun-call.controller';
import { AliyunMailCrypto } from '../aliyun-mail/aliyun-mail-crypto';
import { AliyunMailService } from '../aliyun-mail/aliyun-mail.service';
import { AliyunMailController } from '../aliyun-mail/aliyun-mail.controller';
import { AgentMemoryService } from '../agent-memory/agent-memory.service';
import { ContentCrypto } from '../content/content-crypto';
import { ContentModelCatalogService } from '../content/model-catalog.service';
import { ContentModelSettingService } from '../content/model-setting.service';
import { AipddAssetClient } from '../content/aipdd-asset.client';
import { ContentAssetService } from '../content/asset-registry.service';
import { ContentController } from '../content/content.controller';
import { QuestionHallController } from '../question-hall/question-hall.controller';
import { ImCrypto } from '../im/im.crypto';
import { ImController } from '../im/im.controller';
import { ImService } from '../im/im.service';
import { QuestionHallService } from '../question-hall/question-hall.service';
import { ComfyClient } from '../community/comfy.client';
import { ComfyCrypto } from '../community/comfy-crypto';
import { CommunityAwardService } from '../community/community-award.service';
import { CommunityService } from '../community/community.service';
import { CommunityController } from '../community/community.controller';
import { CommunityImportService } from '../community/community-import.service';
import { CommunityRunScheduler } from '../community/community-run.scheduler';
import { ContentAgentExpertService } from '../content/agent-experts.service';
import {
  ContentAgentConnectorService,
  type BuiltinMcpRunner,
} from '../content/agent-connectors.service';
import { AgentMcpCrypto } from '../content/agent-mcp-crypto';
import { ContentAgentMemoryService } from '../content/agent-memory.service';
import { ContentAgentLibraryService } from '../content/agent-library.service';
import { ContentAgentSkillService } from '../content/agent-skills.service';
import { ContentAgentPluginService } from '../content/agent-plugins.service';
import { SkillHubClient } from '../skillhub/skillhub.client';
import { SkillHubService } from '../skillhub/skillhub.service';
import { SkillHubController } from '../skillhub/skillhub.controller';
import { ContentMediaService } from '../content/content-media.service';
import { ContentAgentEngine } from '../content/agent-engine';
import { ContentAgentService } from '../content/agent.service';
import { ContentAgentScheduleService } from '../content/agent-schedule.service';
import { ContentAgentAssistantService } from '../content/agent-assistant.service';
import { ContentJobService } from '../content/content-job.service';
import { DigitalAssetService } from '../content/digital-asset.service';
import { AssetShareService } from '../content/asset-share.service';
import { AgentMemoryController } from '../agent-memory/agent-memory.controller';
import { MailCrypto } from '../mailbox/mail-crypto';
import { MailboxService } from '../mailbox/mailbox.service';
import { MailboxController } from '../mailbox/mailbox.controller';
import { NotificationService } from '../notifications/notification.service';
import { NotificationController } from '../notifications/notification.controller';
import { SnsService } from '../sns/sns.service';
import { SnsController } from '../sns/sns.controller';
import { OrgStaffService } from '../org-staff/org-staff.service';
import { OrgStaffController } from '../org-staff/org-staff.controller';
import { ServiceDeskService } from '../service-desk/service-desk.service';
import { ServiceDeskController } from '../service-desk/service-desk.controller';
import { LivecodeService } from '../livecode/livecode.service';
import { LivecodeController } from '../livecode/livecode.controller';
import { CrmScopeService } from '../crm/crm.scope';
import { CrmSettingsService } from '../crm/crm.settings.service';
import { CrmLeadService } from '../crm/crm.lead.service';
import { CrmCustomerService } from '../crm/crm.customer.service';
import { CrmFollowService } from '../crm/crm.follow.service';
import { CrmProductService } from '../crm/crm.product.service';
import { CrmOpportunityService } from '../crm/crm.opportunity.service';
import { CrmContractService } from '../crm/crm.contract.service';
import { CrmOrderService } from '../crm/crm.order.service';
import { CrmApprovalService } from '../crm/crm.approval.service';
import { CrmReportService } from '../crm/crm.report.service';
import { CrmAiService } from '../crm/crm.ai.service';
import { CrmController } from '../crm/crm.controller';
import { TencentQidianCrypto } from '../tencent-qidian/tp-crypto';
import { TencentQidianService } from '../tencent-qidian/tp.service';
import { TencentQidianController } from '../tencent-qidian/tp.controller';
import { BiScopeService } from '../bi/bi.scope';
import { BiCrypto } from '../bi/bi-crypto';
import { BiDatasourceService } from '../bi/bi.datasource.service';
import { BiQueryService } from '../bi/bi.query.service';
import { BiDatasetService } from '../bi/bi.dataset.service';
import { BiChatService } from '../bi/bi.chat.service';
import { BiChartService } from '../bi/bi.chart.service';
import { BiDashboardService } from '../bi/bi.dashboard.service';
import { BiSettingsService } from '../bi/bi.settings.service';
import { BiController } from '../bi/bi.controller';
import { LowCodeAccessService } from '../lowcode/lowcode.access.service';
import { LowCodeService } from '../lowcode/lowcode.service';
import { LowCodeContentService } from '../lowcode/lowcode.content.service';
import { LowCodeRowService } from '../lowcode/lowcode.row.service';
import { LowCodeApprovalService } from '../lowcode/lowcode.approval.service';
import { LowCodeAiService } from '../lowcode/lowcode.ai.service';
import { LowCodeAssetsService } from '../lowcode/lowcode.assets.service';
import { LowCodeController } from '../lowcode/lowcode.controller';
import { OkrScopeService } from '../okr/okr.scope';
import { OkrMetricsService } from '../okr/okr.metrics.service';
import { OkrService } from '../okr/okr.service';
import { OkrController } from '../okr/okr.controller';
import { OaScopeService } from '../oa/oa.scope';
import { OaTemplateService } from '../oa/oa.templates';
import { OaFlowService } from '../oa/oa.flow';
import { OaLinkageService } from '../oa/oa.linkage';
import { OaInboxService } from '../oa/oa.inbox';
import { OaService } from '../oa/oa.service';
import { OaController } from '../oa/oa.controller';
import { AccountCrypto } from '../account/account-crypto';
import { PointsSettingsService } from '../points/points-settings.service';
import { PointsService } from '../points/points.service';
import { PricingService } from '../points/pricing.service';
import { WechatPayClient } from '../points/wechat-pay.client';
import { RechargeService } from '../points/recharge.service';
import { AwcoinClient } from '../points/awcoin.client';
import { PointsBillingService } from '../points/points-billing.service';
export function createServices() {
  const prismaService = new PrismaService();
  const healthController = new HealthController(prismaService);
  const userLookupService = new UserLookupService(prismaService);
  const ossSettingsService = new OssSettingsService(prismaService);
  const ossService = new OssService(ossSettingsService);
  const identityService = new IdentityService(
    prismaService,
    userLookupService,
    ossService,
  );
  // 企享云账号池需先于能力服务创建：审核通过时按税号写入「企业税号 ↔ 账号」绑定。
  const qxySettingsService = new QxySettingsService(
    prismaService,
    identityService,
  );
  const capabilityService = new CapabilityService(
    prismaService,
    identityService,
    userLookupService,
    qxySettingsService,
  );
  const geoSettingsService = new GeoSettingsService(prismaService);
  const geoCollectionService = new GeoCollectionService(
    prismaService,
    geoSettingsService,
  );
  const adminService = new AdminService(
    prismaService,
    identityService,
    userLookupService,
    capabilityService,
    geoCollectionService,
  );
  const adminController = new AdminController(adminService);
  const aiworkinClient = new AiworkinClient();
  const demandService = new DemandService(aiworkinClient);
  const enterpriseProfileService = new EnterpriseProfileService(aiworkinClient);
  const aiworkinController = new AiworkinController(
    aiworkinClient,
    demandService,
    enterpriseProfileService,
  );
  const connectionsService = new ConnectionsService(aiworkinClient);
  const connectionsController = new ConnectionsController(connectionsService);
  const demandSyncService = new DemandSyncService(
    aiworkinClient,
    demandService,
  );
  const contactResolver = new ContactResolver(prismaService);
  const assetService = new AssetService(
    prismaService,
    identityService,
    userLookupService,
    demandSyncService,
    contactResolver,
  );
  const assetController = new AssetController(assetService);
  const capabilityController = new CapabilityController(capabilityService);
  const contractsService = new ContractsService(
    prismaService,
    identityService,
    userLookupService,
    contactResolver,
  );
  const contractsController = new ContractsController(contractsService);
  const externalService = new ExternalService(prismaService, identityService);
  const externalCredentialService = new ExternalCredentialService(
    prismaService,
  );
  const externalController = new ExternalController(
    externalService,
    externalCredentialService,
  );
  const flexService = new FlexService(
    prismaService,
    identityService,
    contractsService,
    demandSyncService,
    userLookupService,
    contactResolver,
    ossService,
  );
  const flexController = new FlexController(flexService);
  const geoService = new GeoService(
    prismaService,
    identityService,
    geoCollectionService,
    geoSettingsService,
  );
  const geoController = new GeoController(geoService, geoSettingsService);
  const identityController = new IdentityController(identityService);
  const qxyClient = new QxyClient(qxySettingsService);
  const qxyService = new QxyService(
    prismaService,
    identityService,
    capabilityService,
    qxyClient,
    qxySettingsService,
  );
  const invoiceService = new InvoiceService(
    prismaService,
    identityService,
    qxyService,
    contactResolver,
  );
  const invoiceController = new InvoiceController(invoiceService);
  const ipService = new IpService(
    prismaService,
    identityService,
    contractsService,
    demandSyncService,
    contactResolver,
  );
  const ipController = new IpController(ipService);
  const thinkTankService = new ThinkTankService(
    prismaService,
    identityService,
    contractsService,
    demandSyncService,
    contactResolver,
    userLookupService,
  );
  const thinkTankController = new ThinkTankController(thinkTankService);
  const legalService = new LegalService(
    prismaService,
    identityService,
    contractsService,
    userLookupService,
    demandSyncService,
    contactResolver,
  );
  const legalController = new LegalController(legalService);
  const logisticsService = new LogisticsService(
    prismaService,
    identityService,
    userLookupService,
    demandSyncService,
    contactResolver,
  );
  const logisticsController = new LogisticsController(logisticsService);
  const marketBoardService = new MarketBoardService(
    aiworkinClient,
    demandService,
    identityService,
    contactResolver,
  );
  const marketBoardController = new MarketBoardController(marketBoardService);
  const marketingService = new MarketingService(
    prismaService,
    identityService,
    userLookupService,
    demandSyncService,
    contactResolver,
  );
  const marketingController = new MarketingController(marketingService);
  const overseasService = new OverseasService(
    prismaService,
    identityService,
    contractsService,
    userLookupService,
    contactResolver,
  );
  const qxyOpenApiClient = new QxyOpenApiClient(qxySettingsService);
  const invoiceOcrService = new InvoiceOcrService(
    qxyOpenApiClient,
    qxySettingsService,
  );
  const taxService = new TaxService(
    prismaService,
    identityService,
    contractsService,
    externalService,
    invoiceOcrService,
    contactResolver,
  );
  const openApiController = new OpenApiController(
    identityService,
    contractsService,
    logisticsService,
    overseasService,
    legalService,
    ipService,
    flexService,
    taxService,
    thinkTankService,
  );
  const overseasController = new OverseasController(overseasService);
  const ossSettingsController = new OssSettingsController(
    ossSettingsService,
    identityService,
    ossService,
  );
  const qxyController = new QxyController(qxyService);
  const servicesService = new ServicesService(
    prismaService,
    identityService,
    demandSyncService,
    contactResolver,
  );
  const servicesController = new ServicesController(servicesService);
  const smartServiceService = new SmartServiceService(
    prismaService,
    identityService,
    userLookupService,
    demandSyncService,
    contactResolver,
  );
  const smartServiceController = new SmartServiceController(
    smartServiceService,
  );
  const supplyService = new SupplyService(
    prismaService,
    identityService,
    contractsService,
    aiworkinClient,
  );
  const supplyController = new SupplyController(supplyService);
  const taxController = new TaxController(taxService);
  const modelKeyService = new ModelKeyService();
  const dataTableService = new DataTableService(
    prismaService,
    identityService,
    userLookupService,
  );
  const dataTableController = new DataTableController(dataTableService);
  const dataTableOpenController = new DataTableOpenController(dataTableService);
  const feishuBitableClient = new FeishuBitableClient();
  const dataTableFeishuService = new DataTableFeishuService(
    prismaService,
    identityService,
    feishuBitableClient,
    new FeishuSyncCrypto(),
  );
  const dataTableFeishuController = new DataTableFeishuController(
    dataTableFeishuService,
  );
  dataTableService.setRowListener((tableId, action, rowId) =>
    dataTableFeishuService.onRowChange(tableId, action, rowId),
  );
  const rpaCrypto = new RpaCrypto();
  const rpaScriptService = new RpaScriptService(prismaService, identityService);
  const rpaAccountService = new RpaAccountService(
    prismaService,
    identityService,
    rpaCrypto,
  );
  const rpaSettingService = new RpaSettingService(
    prismaService,
    identityService,
  );
  const rpaTaskService = new RpaTaskService(
    prismaService,
    identityService,
    rpaScriptService,
    rpaAccountService,
    rpaSettingService,
  );
  const rpaLlmService = new RpaLlmService(
    prismaService,
    identityService,
    modelKeyService,
  );
  const rpaController = new RpaController(
    rpaScriptService,
    rpaAccountService,
    rpaTaskService,
    rpaLlmService,
    rpaSettingService,
  );
  const rpaOpenController = new RpaOpenController(
    rpaScriptService,
    rpaAccountService,
    rpaTaskService,
    rpaLlmService,
  );
  const workbuddyCrypto = new WorkbuddyCrypto();
  const workbuddyAccountService = new WorkbuddyAccountService(
    prismaService,
    identityService,
    workbuddyCrypto,
  );
  const workbuddyAgentService = new WorkbuddyAgentService(
    workbuddyAccountService,
    identityService,
  );
  const workbuddyPlanService = new WorkbuddyPlanService(
    prismaService,
    identityService,
    workbuddyAccountService,
  );
  const workbuddyLlmService = new WorkbuddyLlmService(
    prismaService,
    identityService,
    modelKeyService,
  );
  const workbuddyController = new WorkbuddyController(
    workbuddyAccountService,
    workbuddyAgentService,
    workbuddyLlmService,
    workbuddyPlanService,
  );
  const aiCallCrypto = new AiCallCrypto();
  const aiCallAccountService = new AiCallAccountService(
    prismaService,
    identityService,
    aiCallCrypto,
  );
  const aiCallController = new AiCallController(aiCallAccountService);
  const aiCallOpenController = new AiCallOpenController(aiCallAccountService);
  const leadProspectingService = new LeadProspectingService(
    prismaService,
    identityService,
    rpaCrypto,
    modelKeyService,
    dataTableService,
    rpaLlmService,
  );
  const leadProspectingController = new LeadProspectingController(
    leadProspectingService,
  );
  const bigdataQueryService = new BigdataQueryService(
    prismaService,
    identityService,
    modelKeyService,
    dataTableService,
    rpaLlmService,
  );
  const bigdataQueryController = new BigdataQueryController(
    bigdataQueryService,
  );
  const aliyunCallService = new AliyunCallService(
    prismaService,
    identityService,
    new AliyunCallCrypto(),
    dataTableService,
  );
  const aliyunCallController = new AliyunCallController(aliyunCallService);
  const aliyunMailService = new AliyunMailService(
    prismaService,
    identityService,
    new AliyunMailCrypto(),
    dataTableService,
  );
  const aliyunMailController = new AliyunMailController(aliyunMailService);
  const agentMemoryService = new AgentMemoryService(prismaService);
  const agentMemoryController = new AgentMemoryController(agentMemoryService);
  const contentCrypto = new ContentCrypto();
  const aipddAssetClient = new AipddAssetClient();
  const contentModelSettingService = new ContentModelSettingService(
    prismaService,
    identityService,
    modelKeyService,
    contentCrypto,
    new ContentModelCatalogService(),
  );
  const contentAssetService = new ContentAssetService(
    prismaService,
    modelKeyService,
    contentCrypto,
    aipddAssetClient,
  );
  const contentAgentMemoryService = new ContentAgentMemoryService(
    prismaService,
  );
  const contentAgentSkillService = new ContentAgentSkillService(
    prismaService,
    identityService,
  );
  const contentAgentPluginService = new ContentAgentPluginService(
    prismaService,
    identityService,
  );
  const skillHubService = new SkillHubService(
    new SkillHubClient(),
    contentAgentSkillService,
    contentAgentPluginService,
  );
  const skillHubController = new SkillHubController(skillHubService);
  const contentMediaService = new ContentMediaService(
    contentModelSettingService,
    contentAssetService,
    aipddAssetClient,
  );
  // 跨境电商商品页优化：规划走文本槽位、出图走图片槽位，全部经本系统模型网关。
  const ecomPdpService = new EcomPdpService(
    prismaService,
    contentModelSettingService,
    contentMediaService,
  );
  const ecomPdpController = new EcomPdpController(ecomPdpService);
  // 国内电商商品页优化：同一套模型网关装配，文案与合规规则走 domestic-pdp 知识层。
  const domesticPdpService = new DomesticPdpService(
    prismaService,
    contentModelSettingService,
    contentMediaService,
  );
  const domesticPdpController = new DomesticPdpController(domesticPdpService);
  const contentAgentExpertService = new ContentAgentExpertService(
    prismaService,
    contentMediaService,
  );
  // 本站 MCP Server 需要完整的 Services 对象，由 app 组装后回填给内置连接器。
  const builtinMcp: { current?: BuiltinMcpRunner } = {};
  const contentAgentConnectorService = new ContentAgentConnectorService(
    prismaService,
    new AgentMcpCrypto(),
    identityService,
    builtinMcp,
  );
  const contentDigitalAssetService = new DigitalAssetService(
    prismaService,
    contentModelSettingService,
    aipddAssetClient,
    identityService,
    ossService,
  );
  // 营销工具产物登记通道（设计 §10）：任务成功的 CSV/报告经此存自有 OSS 并入数字资产台账。
  bigdataQueryService.deliverableSink = (userId, input) =>
    contentDigitalAssetService.registerDeliverable(userId, input);
  leadProspectingService.deliverableSink = (userId, input) =>
    contentDigitalAssetService.registerDeliverable(userId, input);
  const contentAgentLibraryService = new ContentAgentLibraryService(
    prismaService,
    contentModelSettingService,
    aipddAssetClient,
    contentDigitalAssetService,
    identityService,
  );
  const contentAgentTools = {
    media: contentMediaService,
    memory: contentAgentMemoryService,
    skills: contentAgentSkillService,
    plugins: contentAgentPluginService,
    connectors: contentAgentConnectorService,
    library: contentAgentLibraryService,
    prisma: prismaService,
  };
  const contentAgentEngine = new ContentAgentEngine(
    contentModelSettingService,
    contentAgentTools,
  );
  const contentAgentService = new ContentAgentService(
    prismaService,
    contentAgentMemoryService,
    contentAgentSkillService,
    contentAgentPluginService,
    contentAgentExpertService,
    contentAgentConnectorService,
    contentAgentEngine,
    contentAgentTools,
  );
  const contentJobService = new ContentJobService(
    prismaService,
    contentModelSettingService,
    contentMediaService,
    contentAssetService,
  );
  const contentAgentScheduleService = new ContentAgentScheduleService(
    prismaService,
    identityService,
    userLookupService,
    contentAgentService,
    contentAgentExpertService,
  );
  const contentAgentAssistantService = new ContentAgentAssistantService(
    prismaService,
    identityService,
    contentAgentService,
  );
  const contentAssetShareService = new AssetShareService(
    prismaService,
    userLookupService,
  );
  const contentController = new ContentController(
    contentModelSettingService,
    contentAssetService,
    aipddAssetClient,
    contentAgentService,
    contentJobService,
    contentDigitalAssetService,
    contentAgentLibraryService,
    contentAgentScheduleService,
    contentAgentAssistantService,
    contentAssetShareService,
  );
  const appDirectoryService = new AppDirectoryService();
  const appDirectoryController = new AppDirectoryController(
    appDirectoryService,
  );
  const mailboxService = new MailboxService(
    prismaService,
    identityService,
    new MailCrypto(),
  );
  const mailboxController = new MailboxController(mailboxService);
  const snsService = new SnsService(prismaService, identityService);
  const snsController = new SnsController(snsService);
  const notificationService = new NotificationService(
    prismaService,
    snsService,
  );
  const notificationController = new NotificationController(
    notificationService,
  );
  const questionHallController = new QuestionHallController(
    new QuestionHallService(
      prismaService,
      identityService,
      notificationService,
      contentModelSettingService,
    ),
  );
  const orgStaffService = new OrgStaffService(
    prismaService,
    userLookupService,
    identityService,
    notificationService,
  );
  const orgStaffController = new OrgStaffController(orgStaffService);
  const imController = new ImController(
    new ImService(
      prismaService,
      identityService,
      new ImCrypto(),
      orgStaffService,
      notificationService,
    ),
  );

  const serviceDeskService = new ServiceDeskService(
    prismaService,
    identityService,
    userLookupService,
    notificationService,
    ossService,
    contentModelSettingService,
  );
  const serviceDeskController = new ServiceDeskController(serviceDeskService);
  const livecodeService = new LivecodeService(prismaService, ossService);
  const livecodeController = new LivecodeController(livecodeService);
  const lowcodeAccessService = new LowCodeAccessService(
    prismaService,
    identityService,
  );
  const lowcodeService = new LowCodeService(
    prismaService,
    identityService,
    userLookupService,
    notificationService,
    lowcodeAccessService,
  );
  const lowcodeContentService = new LowCodeContentService(
    prismaService,
    identityService,
    dataTableService,
    lowcodeAccessService,
  );
  const lowcodeRowService = new LowCodeRowService(
    prismaService,
    dataTableService,
    lowcodeAccessService,
  );
  const lowcodeApprovalService = new LowCodeApprovalService(
    prismaService,
    lowcodeAccessService,
    dataTableService,
    notificationService,
    userLookupService,
    identityService,
  );
  const lowcodeAiService = new LowCodeAiService(
    prismaService,
    lowcodeAccessService,
    contentModelSettingService,
  );
  const lowcodeAssetsService = new LowCodeAssetsService(
    contentDigitalAssetService,
    lowcodeAccessService,
  );
  const lowcodeController = new LowCodeController(
    lowcodeService,
    lowcodeContentService,
    lowcodeRowService,
    lowcodeApprovalService,
    lowcodeAiService,
    lowcodeAssetsService,
  );
  const crmScopeService = new CrmScopeService(prismaService, userLookupService);
  const crmSettingsService = new CrmSettingsService(
    prismaService,
    crmScopeService,
  );
  const crmLeadService = new CrmLeadService(
    prismaService,
    crmScopeService,
    crmSettingsService,
  );
  const crmCustomerService = new CrmCustomerService(
    prismaService,
    crmScopeService,
    crmSettingsService,
  );
  const crmFollowService = new CrmFollowService(
    prismaService,
    crmScopeService,
    crmSettingsService,
  );
  const crmProductService = new CrmProductService(
    prismaService,
    crmScopeService,
  );
  const crmOpportunityService = new CrmOpportunityService(
    prismaService,
    crmScopeService,
    crmSettingsService,
  );
  const crmContractService = new CrmContractService(
    prismaService,
    crmScopeService,
    crmSettingsService,
  );
  const crmOrderService = new CrmOrderService(
    prismaService,
    crmScopeService,
    crmSettingsService,
  );
  const crmApprovalService = new CrmApprovalService(
    prismaService,
    crmScopeService,
    crmSettingsService,
  );
  const crmReportService = new CrmReportService(
    prismaService,
    crmScopeService,
    crmSettingsService,
    dataTableService,
  );
  const crmAiService = new CrmAiService(
    prismaService,
    crmScopeService,
    contentModelSettingService,
  );
  const crmController = new CrmController(
    crmScopeService,
    crmSettingsService,
    crmLeadService,
    crmCustomerService,
    crmFollowService,
    crmProductService,
    crmOpportunityService,
    crmContractService,
    crmOrderService,
    crmApprovalService,
    crmReportService,
    crmAiService,
  );
  const tencentQidianService = new TencentQidianService(
    prismaService,
    identityService,
    notificationService,
    new TencentQidianCrypto(),
    dataTableService,
    crmReportService,
  );
  const tpController = new TencentQidianController(tencentQidianService);
  // 企点分群导出产物也进数字资产（与大数据/潜客同一登记通道）。
  tencentQidianService.deliverableSink = (userId, input) =>
    contentDigitalAssetService.registerDeliverable(userId, input);
  const biScopeService = new BiScopeService(prismaService, userLookupService);
  const biDatasourceService = new BiDatasourceService(
    prismaService,
    biScopeService,
    new BiCrypto(),
  );
  const biQueryService = new BiQueryService(
    prismaService,
    biScopeService,
    crmScopeService,
    biDatasourceService,
  );
  const biDatasetService = new BiDatasetService(
    prismaService,
    biScopeService,
    biQueryService,
  );
  const biChatService = new BiChatService(
    prismaService,
    biScopeService,
    biQueryService,
    contentModelSettingService,
  );
  const biChartService = new BiChartService(
    prismaService,
    biScopeService,
    biQueryService,
  );
  const biDashboardService = new BiDashboardService(
    prismaService,
    biScopeService,
    biQueryService,
  );
  const biSettingsService = new BiSettingsService(
    prismaService,
    biScopeService,
    biQueryService,
    biChartService,
    dataTableService,
  );
  const biController = new BiController(
    biScopeService,
    biDatasourceService,
    biDatasetService,
    biChatService,
    biChartService,
    biDashboardService,
    biSettingsService,
  );
  const okrScopeService = new OkrScopeService(prismaService, userLookupService);
  const okrMetricsService = new OkrMetricsService(
    prismaService,
    crmScopeService,
    dataTableService,
    lowcodeAccessService,
    notificationService,
  );
  const okrService = new OkrService(
    prismaService,
    okrScopeService,
    okrMetricsService,
    notificationService,
  );
  const okrController = new OkrController(okrService);
  const oaScopeService = new OaScopeService(prismaService, userLookupService);
  const oaTemplateService = new OaTemplateService(prismaService);
  const oaFlowService = new OaFlowService((ctx) => oaScopeService.members(ctx));
  const oaLinkageService = new OaLinkageService(
    prismaService,
    crmScopeService,
    crmSettingsService,
    contractsService,
    identityService,
    dataTableService,
    lowcodeAccessService,
  );
  const oaInboxService = new OaInboxService(
    prismaService,
    crmApprovalService,
    invoiceService,
    flexService,
    contractsService,
  );
  const oaService = new OaService(
    prismaService,
    oaScopeService,
    oaTemplateService,
    oaFlowService,
    oaLinkageService,
    oaInboxService,
    notificationService,
    contentMediaService,
  );
  const oaController = new OaController(oaService);
  // 积分与计费域（设计方案 P2/P3/P5）：账户/流水/设置/定价/充值/AWcoin/日批出账。
  // 构造在此集中一处，供 account 注册赠分、bi/oa/service-desk 扣费、数字资产与营销产物登记取用。
  const accountCrypto = new AccountCrypto();
  const pointsSettingsService = new PointsSettingsService(
    prismaService,
    accountCrypto,
  );
  const pointsService = new PointsService(prismaService, pointsSettingsService);
  const pricingService = new PricingService(prismaService);
  const wechatPayClient = new WechatPayClient();
  const rechargeService = new RechargeService(
    prismaService,
    pointsSettingsService,
    pointsService,
    wechatPayClient,
  );
  const awcoinClient = new AwcoinClient(prismaService, accountCrypto);
  const pointsBillingService = new PointsBillingService(
    prismaService,
    pointsSettingsService,
    pointsService,
    rechargeService,
  );
  // 实时扣费：BI 每查一次、OA 每提交一单、AI 客服每开一个新会话，均按价目计费；
  // chargeSafely 余额不足只转欠费状态，不回滚已完成的业务。
  const chargeSafely = (
    userId: string,
    code: string,
    quantity: number,
    refId?: string,
  ) => pointsService.chargeSafely(userId, code, quantity, refId || '');
  biQueryService.pointsChargeSafely = chargeSafely;
  oaService.pointsChargeSafely = chargeSafely;
  serviceDeskService.pointsChargeSafely = chargeSafely;
  // 创意社区（Comfy Cloud 工作流市场·纯 BYOK）：Key 独立加密域、上游唯一出口、
  // 发布校验与审核发奖都在 community 域内；运行产物由调度器转存进本站 OSS 并入数字资产。
  const comfyCrypto = new ComfyCrypto();
  const comfyClient = new ComfyClient();
  const communityAwardService = new CommunityAwardService(
    prismaService,
    pointsService,
    pointsSettingsService,
    identityService,
  );
  const communityService = new CommunityService(
    prismaService,
    identityService,
    userLookupService,
    ossService,
    comfyClient,
    comfyCrypto,
    communityAwardService,
  );
  const communityController = new CommunityController(
    communityService,
    communityAwardService,
    new CommunityImportService(
      prismaService,
      identityService,
      userLookupService,
      ossService,
      comfyClient,
    ),
  );
  const communityRunScheduler = new CommunityRunScheduler(
    prismaService,
    comfyClient,
    communityService,
    contentDigitalAssetService,
  );
  return {
    prisma: prismaService,
    // M6 供求广场：社交板复用企业板块同一上游通道（DemandService + AiworkinClient）。
    aiworkinClient,
    demandService,
    users: userLookupService,
    identity: identityService,
    external: externalService,
    collection: geoCollectionService,
    rpaTaskService,
    workbuddyPlanService,
    contentAgentScheduleService,
    agentMemory: agentMemoryService,
    mailbox: mailboxService,
    notification: notificationService,
    orgStaff: orgStaffService,
    serviceDesk: serviceDeskService,
    livecode: livecodeService,
    okrMetrics: okrMetricsService,
    oa: oaService,
    tencentQidian: tencentQidianService,
    crm: crmController,
    bi: biController,
    oss: ossService,
    ossSettings: ossSettingsService,
    qxySettings: qxySettingsService,
    capability: capabilityService,
    digitalAsset: contentDigitalAssetService,
    // 创意社区：service 给路由与调度器取 Key，scheduler 由 main.ts 启停。
    community: {
      service: communityService,
      awards: communityAwardService,
      scheduler: communityRunScheduler,
    },
    builtinMcp,
    // 积分与计费域（供 app.ts 组装 PointsModule、account/billing 钩子、main.ts 调度器使用）。
    points: {
      settings: pointsSettingsService,
      ledger: pointsService,
      pricing: pricingService,
      pay: wechatPayClient,
      recharge: rechargeService,
      awcoin: awcoinClient,
      billing: pointsBillingService,
      crypto: accountCrypto,
    },
    controllers: {
      healthController,
      adminController,
      aiworkinController,
      connectionsController,
      assetController,
      capabilityController,
      contractsController,
      externalController,
      flexController,
      geoController,
      identityController,
      invoiceController,
      ipController,
      thinkTankController,
      legalController,
      logisticsController,
      marketBoardController,
      marketingController,
      openApiController,
      overseasController,
      ossSettingsController,
      qxyController,
      servicesController,
      smartServiceController,
      supplyController,
      taxController,
      dataTableController,
      dataTableOpenController,
      dataTableFeishuController,
      rpaController,
      rpaOpenController,
      workbuddyController,
      aiCallController,
      aiCallOpenController,
      leadProspectingController,
      ecomPdpController,
      domesticPdpController,
      bigdataQueryController,
      aliyunCallController,
      aliyunMailController,
      agentMemoryController,
      contentController,
      appDirectoryController,
      mailboxController,
      notificationController,
      snsController,
      orgStaffController,
      serviceDeskController,
      livecodeController,
      crmController,
      biController,
      lowcodeController,
      okrController,
      oaController,
      tpController,
      questionHallController,
      imController,
      skillHubController,
      communityController,
    },
  };
}
export type Services = ReturnType<typeof createServices>;
