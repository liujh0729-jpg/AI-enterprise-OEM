import { PrismaService } from '../prisma/prisma.service';
import { HealthController } from '../health.controller';
import { UserLookupService } from '../directory/user-lookup.service';
import { OssService } from '../oss/oss.service';
import { OssSettingsService } from '../oss/oss-settings.service';
import { OssSettingsController } from '../oss/oss-settings.controller';
import { IdentityService } from '../identity/identity.service';
import { CurrentUser } from '../auth/current-user';
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
import { MarketMcpService } from '../aiworkin/market-mcp.service';
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
import { MarketListingRecordService } from '../market-board/market-listing-record.service';
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
import { SkillGeneratorService } from '../content/skill-generator.service';
import { DataTableService } from '../data-table/data-table.service';
import { DataTableAiService } from '../data-table/data-table-ai.service';
import { DataTableViewService } from '../data-table/data-table-view.service';
import { DataTableController } from '../data-table/data-table.controller';
import { DataTableOpenController } from '../data-table/data-table-open.controller';
import { FeishuBitableClient } from '../feishu/feishu-bitable.client';
import { FeishuSyncCrypto } from '../feishu/feishu-crypto';
import { DataTableFeishuService } from '../feishu/data-table-feishu.service';
import { DataTableFeishuController } from '../feishu/data-table-feishu.controller';
import { AiworkinSocialService } from '../social/aiworkin-social.service';
import { SocialAffinityService } from '../social/social-affinity.service';
import { SocialSyncService } from '../social/social-sync.service';
import { SocialSyncScheduler } from '../social/social-sync.scheduler';
import { RpaCrypto } from '../rpa/rpa-crypto';
import { RpaScriptService } from '../rpa/rpa-script.service';
import { RpaAccountService } from '../rpa/rpa-account.service';
import { RpaSettingService } from '../rpa/rpa-setting.service';
import { RpaTaskService } from '../rpa/rpa-task.service';
import { RpaLlmService } from '../rpa/rpa-llm.service';
import { RpaController } from '../rpa/rpa.controller';
import { RpaChromeController } from '../rpa/rpa-chrome.controller';
import { RpaChromeDeviceService } from '../rpa/chrome-device.service';
import { BrowserAgentToolsService } from '../rpa/browser-agent-tools.service';
import { ChromeAgentService } from '../rpa/chrome-agent.service';
import { RpaChromeLibraryService } from '../rpa/chrome-library.service';
import { RpaChromeScheduleService } from '../rpa/chrome-schedule.service';
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
import { DistributionService } from '../distribution/distribution.service';
import { DistributionController } from '../distribution/distribution.controller';
import { ExtensionCatalogService } from '../platform/extension-catalog.service';
import { BrowserTaskService } from '../platform/browser-task.service';
import { SurveyService } from '../survey/survey.service';
import { SurveyController } from '../survey/survey.controller';
import { PublishReviewService } from '../moderation/publish-review.service';
import { HelpService } from '../help/help.service';
import { HelpController } from '../help/help.controller';
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
import { ContentChannelPolicyService } from '../content/channel-policy.service';
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
import { runAgentTool } from '../content/agent-tools';
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
import { VideoTemplateService } from '../content/video-template.service';
import { VideoTemplateController } from '../content/video-template.controller';
import { VideoTemplateSyncScheduler } from '../content/video-template.sync.scheduler';
import { AgentMemoryController } from '../agent-memory/agent-memory.controller';
import { MailCrypto } from '../mailbox/mail-crypto';
import { MailboxService } from '../mailbox/mailbox.service';
import { MailboxController } from '../mailbox/mailbox.controller';
import { NotificationService } from '../notifications/notification.service';
import { NotificationController } from '../notifications/notification.controller';
import { WechatMpSettingsService } from '../wechat-mp/wechat-mp.settings';
import { WechatMpClient } from '../wechat-mp/wechat-mp.client';
import { WechatMpBindingService } from '../wechat-mp/wechat-mp.binding.service';
import { WechatMpPushService } from '../wechat-mp/wechat-mp.push.service';
import { WechatMpInboundService } from '../wechat-mp/wechat-mp.inbound.service';
import { WechatMpController } from '../wechat-mp/wechat-mp.controller';
import { WechatMpRetryScheduler } from '../wechat-mp/wechat-mp.scheduler';
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
import { OkrBriefService } from '../okr/okr-brief.service';
import { OkrDecompositionService } from '../okr/okr-decomposition.service';
import { OkrTaskLinkageService } from '../okr/okr.task-linkage.service';
import { OkrController } from '../okr/okr.controller';
import { TenantScopeService } from '../tenant/tenant-scope.service';
import { PartyService } from '../party/party.service';
import { PartyController } from '../party/party.controller';
import { OaScopeService } from '../oa/oa.scope';
import { OaTemplateService } from '../oa/oa.templates';
import { OaFlowService } from '../oa/oa.flow';
import { OaLinkageService } from '../oa/oa.linkage';
import { OaInboxService } from '../oa/oa.inbox';
import { OaService } from '../oa/oa.service';
import { OaController } from '../oa/oa.controller';
import { TaskCenterService } from '../task-center/task-center.service';
import {
  TaskAssignmentController,
  TaskCenterController,
} from '../task-center/task-center.controller';
import { TaskAssignmentService } from '../task-center/task-assignment.service';
import { registerTaskDocumentBindings } from '../task-center/task-document.binding';
import { TaskRouterService } from '../task-center/task-router.service';
import { TaskSourceRegistry } from '../task-center/task-source.registry';
import { registerTaskSources } from '../task-center/task-sources';
import { UiPreferencesService } from '../ui-preferences/ui-preferences.service';
import { UiPreferencesController } from '../ui-preferences/ui-preferences.controller';
import { WorkflowEngine } from '../workflow/workflow-engine';
import { WorkflowService } from '../workflow/workflow.service';
import { WorkflowController } from '../workflow/workflow.controller';
import { workflowSource } from '../workflow/workflow.source';
import type { WorkflowRuntime } from '../workflow/workflow.types';
import { AccountCrypto } from '../account/account-crypto';
import { AipddKeyService } from '../account/aipdd-key.service';
import { FeatureToggleService } from '../feature/feature-toggle.service';
import { AccessPolicyService } from '../feature/access-policy.service';
import { SkillReviewService } from '../feature/skill-review.service';
import { SkillReviewRunner } from '../feature/skill-review.runner';
import { PointsSettingsService } from '../points/points-settings.service';
import { PointsService } from '../points/points.service';
import { PricingService } from '../points/pricing.service';
import { BillingRuleService } from '../points/billing-rule.service';
import { ModelUpstreamService } from '../model-plaza/upstream.service';
import { ModelCatalogService } from '../model-plaza/catalog.service';
import { ModelUsageService } from '../model-plaza/usage.service';
import { ModelRelayService } from '../model-plaza/relay.service';
import { ModelPlazaController } from '../model-plaza/model-plaza.controller';
import { PlatformDefaultsService } from '../model-plaza/platform-defaults.service';
import { HardwareService } from '../hardware/hardware.service';
import { HardwareController } from '../hardware/hardware.controller';
import { AiEvalService } from '../ai/ai-eval.service';
import { AiGuardService, registerAiGuard } from '../ai/ai-guard.service';
import { registerAiMetering } from '../ai/ai-gateway';
import { AiAbilitiesService } from '../ai/ai-abilities.service';
import { AiPointsService } from '../ai/ai-points.service';
import { AiController } from '../ai/ai.controller';
import { HrmScopeService } from '../hrm/hrm.scope';
import { HrmProfileService } from '../hrm/hrm-profile.service';
import { HrmAttendanceService } from '../hrm/hrm-attendance.service';
import { HrmRecruitService } from '../hrm/hrm-recruit.service';
import { HrmTalentService } from '../hrm/hrm-talent.service';
import { HrmLifecycleService } from '../hrm/hrm-lifecycle.service';
import { TalentMatchService } from '../talent-match/talent-match.service';
import { HrmController } from '../hrm/hrm.controller';
import { KbSpaceService } from '../kb/kb-space.service';
import { KbSourceService } from '../kb/kb-source.service';
import { KbPageService } from '../kb/kb-page.service';
import { normalizeSlug } from '../kb/kb-util';
import { KbIngestService } from '../kb/kb-ingest.service';
import { KbSearchService } from '../kb/kb-search.service';
import {
  KbRetrieveService,
  type RetrieveInput,
} from '../kb/kb-retrieve.service';
import { KbIntakeService } from '../kb/kb-intake.service';
import { KbAssistService } from '../kb/kb-assist.service';
import { KbGraphService } from '../kb/kb-graph.service';
import { KbConsumerService } from '../kb/kb-consumer.service';
import { KbMemoryService } from '../kb/kb-memory.service';
import { KbAgentStoreService } from '../kb/kb-agent-store.service';
import { KbController } from '../kb/kb.controller';
import {
  PlatformController,
  PointsBillingController,
} from '../feature/governance.controller';
import { WechatPayClient } from '../points/wechat-pay.client';
import { RechargeService } from '../points/recharge.service';
import { CardService } from '../points/card.service';
import { CardTemplateService } from '../points/card-template.service';
import { AdminCardController, CardController } from '../points/card.controller';
import { AwcoinClient } from '../points/awcoin.client';
import { PointsBillingService } from '../points/points-billing.service';
import { ServicePackageService } from '../service-package/service-package.service';
import { ServicePackageFulfillmentService } from '../service-package/service-package-fulfillment.service';
import { StorageService } from '../storage/storage.service';
import { StorageMigrationService } from '../storage/storage-migration.service';
import { MechanismService } from '../mechanisms/mechanism.service';
import { MechanismController } from '../mechanisms/mechanism.controller';
import { GrowthLinkageService } from '../growth/growth-linkage.service';
import { GrowthCockpitService } from '../growth/growth-cockpit.service';
import { GrowthController } from '../growth/growth.controller';
import { OperationRiskService } from '../growth/operation-risk.service';
import { FulfillmentAdvisorService } from '../growth/fulfillment-advisor.service';
import { ProjectService } from '../project/project.service';
import { ProjectCostService } from '../project/project-cost.service';
import { ProjectDemandService } from '../project/project-demand.service';
import { ProjectController } from '../project/project.controller';
import { ErpService } from '../erp/erp.service';
import { ErpController } from '../erp/erp.controller';
import { MktService } from '../marketing/mkt.service';
import { MktController } from '../marketing/mkt.controller';
import { RecruitService } from '../recruit/recruit.service';
import { RecruitController } from '../recruit/recruit.controller';
import { SeoDataForSeoClient } from '../seo/seo-dataforseo.client';
import { SeoProjectService } from '../seo/seo-project.service';
import { SeoAuditService } from '../seo/seo-audit.service';
import { SeoKeywordService } from '../seo/seo-keyword.service';
import { SeoRankService } from '../seo/seo-rank.service';
import { SeoCompetitorService } from '../seo/seo-competitor.service';
import { SeoLocalService } from '../seo/seo-local.service';
import { SeoGoogleService } from '../seo/seo-google.service';
import { SeoOutreachService } from '../seo/seo-outreach.service';
import { SeoSchemaService } from '../seo/seo-schema.service';
import { SeoProgrammaticService } from '../seo/seo-programmatic.service';
import { SeoReportService } from '../seo/seo-report.service';
import { SeoController } from '../seo/seo.controller';
import { AcquisitionSettingsService } from '../acquisition/acquisition-settings.service';
import { AcquisitionRadarService } from '../acquisition/radar.service';
import { AcquisitionPluginBridgeService } from '../acquisition/plugin-bridge.service';
import { AcquisitionOutreachService } from '../acquisition/outreach.service';
import { AcquisitionProfileService } from '../acquisition/profile.service';
import { AcquisitionPlaybookService } from '../acquisition/playbook.service';
import { AcquisitionFollowUpService } from '../acquisition/follow-up.service';
import { AcquisitionReceptionService } from '../acquisition/reception.service';
import { AcquisitionQcService } from '../acquisition/qc.service';
import { AcquisitionDashboardService } from '../acquisition/dashboard.service';
import { AcquisitionScheduler } from '../acquisition/acquisition.scheduler';
import { AcquisitionController } from '../acquisition/acquisition.controller';
import { ScrmSettingsService } from '../wecom-scrm/scrm-settings.service';
import { ScrmScopeService } from '../wecom-scrm/scrm.scope';
import { ScrmCrypto } from '../wecom-scrm/scrm-crypto';
import { ScrmClient } from '../wecom-scrm/scrm.client';
import { ScrmContactService } from '../wecom-scrm/scrm-contact.service';
import { ScrmChatService } from '../wecom-scrm/scrm-chat.service';
import { ScrmCodeService } from '../wecom-scrm/scrm-code.service';
import { ScrmMaterialService } from '../wecom-scrm/scrm-material.service';
import { ScrmMassService } from '../wecom-scrm/scrm-mass.service';
import { ScrmTransferService } from '../wecom-scrm/scrm-transfer.service';
import { ScrmSopService } from '../wecom-scrm/scrm-sop.service';
import { ScrmComplianceService } from '../wecom-scrm/scrm-compliance';
import { ScrmStatsService } from '../wecom-scrm/scrm-stats.service';
import { ScrmSidebarService } from '../wecom-scrm/scrm-sidebar.service';
import { ScrmSyncService } from '../wecom-scrm/scrm-sync.service';
import { ScrmCallbackService } from '../wecom-scrm/scrm-callback';
import { ScrmScheduler } from '../wecom-scrm/scrm.scheduler';
import { ScrmController } from '../wecom-scrm/scrm.controller';
import { CollabService } from '../collab/collab.service';
import { CollabController } from '../collab/collab.controller';
import { GapScopeService } from '../gaps/gaps.scope';
import { EntitlementService } from '../gaps/entitlement.service';
import { AppointmentService } from '../gaps/appointment.service';
import { MailTemplateService } from '../gaps/mail-template.service';
import { PageAssistantService } from '../gaps/assistant.service';
import { TranscriptionService } from '../gaps/transcription.service';
import { QuotationDocumentService } from '../gaps/quotation-doc.service';
import { TimeAuditService } from '../gaps/time-audit.service';
import { PromoService } from '../gaps/promo.service';
import { AfterSalesService } from '../gaps/after-sales.service';
import { ReviewService } from '../gaps/review.service';
import { TaskSyncService } from '../gaps/task-sync.service';
import { TermsService } from '../gaps/terms.service';
import { OnboardingService } from '../gaps/onboarding.service';
import { ChangelogService } from '../gaps/changelog.service';
import { OrgContextService } from '../gaps/org-context.service';
import { UsageService } from '../gaps/usage.service';
import {
  EntitlementController,
  AppointmentController,
  MailTemplateController,
  AssistantController,
  TranscriptionController,
  QuotationDocumentController,
  TimeAuditController,
  PromoController,
  AfterSalesController,
  ReviewController,
  TaskSyncController,
  TermsController,
  OnboardingController,
  ChangelogController,
  OrgContextController,
  UsageController,
} from '../gaps/gaps.controller';
import { UpgradePackageService } from '../upgrade/upgrade-package.service';
import { UpgradeAnalysisService } from '../upgrade/upgrade-analysis.service';
import { UpgradeJobService } from '../upgrade/upgrade-job.service';
import { UpgradeController } from '../upgrade/upgrade.controller';
import { AiCodeService } from '../ai-code/ai-code.service';
import { AiCodeController } from '../ai-code/ai-code.controller';
export function createServices() {
  const prismaService = new PrismaService();
  const healthController = new HealthController(prismaService);
  const userLookupService = new UserLookupService(prismaService);
  const ossSettingsService = new OssSettingsService(prismaService);
  const ossService = new OssService(ossSettingsService);
  const storageService = new StorageService(ossService);
  const identityService = new IdentityService(
    prismaService,
    userLookupService,
    ossService,
  );
  // HRM 组织口径（数据按 (orgType, orgUserId) 隔离）是多个基础服务的公共依赖，
  // 且「离职撤权」复核也复用这里，故尽早构造、全站共用同一实例。
  const hrmScopeService = new HrmScopeService(prismaService, identityService);
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
  const aipddKeyService = new AipddKeyService(prismaService);
  const marketMcpService = new MarketMcpService(aipddKeyService);
  // 商务社交 AIworkin 赋能：个人 Key 的 SNS 身份、outbox 同步与亲密度推荐。
  const socialAiworkinService = new AiworkinSocialService(
    prismaService,
    aipddKeyService,
  );
  const socialSyncService = new SocialSyncService(
    prismaService,
    socialAiworkinService,
    aipddKeyService,
  );
  const socialAffinityService = new SocialAffinityService(prismaService);
  const socialSyncScheduler = new SocialSyncScheduler(
    prismaService,
    socialSyncService,
  );
  const marketListingRecordService = new MarketListingRecordService(
    prismaService,
  );
  const demandService = new DemandService(aiworkinClient, marketMcpService);
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
    marketListingRecordService,
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
  // 多维表格 AI 与视图：AI 三条经 §4.1 网关，视图与列定义同归归属账号。
  const dataTableAiService = new DataTableAiService(
    prismaService,
    dataTableService,
    identityService,
  );
  const dataTableViewService = new DataTableViewService(
    prismaService,
    dataTableService,
    identityService,
  );
  const dataTableController = new DataTableController(
    dataTableService,
    dataTableAiService,
    dataTableViewService,
  );
  // 营销问卷：回收数据写入账号自己的多维表格，公开填写页只走只读视图与提交校验。
  const surveyService = new SurveyService(
    prismaService,
    dataTableService,
    identityService,
  );
  const surveyController = new SurveyController(surveyService);
  // 发布审核：后台配置阿里云内容安全凭据，四类发布动作在鉴权后统一送审。
  const publishReviewService = new PublishReviewService(prismaService);
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
    rpaCrypto,
  );
  // 本地 Chrome 插件 RPA：设备通道（根 app 公开路由，只认设备令牌）+ 会话引擎（LLM 决策/动作回放）。
  const rpaChromeDeviceService = new RpaChromeDeviceService(
    prismaService,
    hrmScopeService,
  );
  const rpaTaskService = new RpaTaskService(
    prismaService,
    identityService,
    rpaScriptService,
    rpaAccountService,
    rpaSettingService,
    rpaChromeDeviceService,
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
  const chromeAgentService = new ChromeAgentService(
    prismaService,
    rpaChromeDeviceService,
    storageService,
    rpaTaskService,
  );
  // 浏览器代理的本账号私有资产台账：插件（设备通道）与界面端点共用。
  const rpaChromeLibraryService = new RpaChromeLibraryService(prismaService);
  // 浏览器代理的 MCP 语义层：外部 MCP 客户端凭设备绿灯（在线）把任务派给本人本机的 Chrome。
  const browserAgentToolsService = new BrowserAgentToolsService(
    rpaChromeDeviceService,
    chromeAgentService,
    rpaChromeLibraryService,
  );
  // 浏览器代理计划任务：到点让本人某台在线设备跑一个目标（离线当轮跳过；停用即自动暂停）。
  const rpaChromeScheduleService = new RpaChromeScheduleService(
    prismaService,
    hrmScopeService,
    chromeAgentService,
  );
  const rpaChromeController = new RpaChromeController(
    rpaChromeDeviceService,
    chromeAgentService,
    rpaChromeLibraryService,
    rpaChromeScheduleService,
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
  // §5.7 安全三件套：平台/组织 AI 主开关 + 用户×组织双维限流，网关与模型设置共用同一闸。
  const aiGuardService = new AiGuardService(prismaService);
  registerAiGuard((userId) => aiGuardService.assertAllowed(userId));
  const contentChannelPolicyService = new ContentChannelPolicyService(
    prismaService,
    identityService,
  );
  const contentModelSettingService = new ContentModelSettingService(
    prismaService,
    identityService,
    modelKeyService,
    contentCrypto,
    new ContentModelCatalogService(),
    contentChannelPolicyService,
  );
  // 平台升级：包台账 / 差异分析 / 任务与备份，执行由独立 runner 进程完成。
  const platformUpgradePackageService = new UpgradePackageService(
    prismaService,
  );
  const platformUpgradeAnalysisService = new UpgradeAnalysisService(
    prismaService,
    platformUpgradePackageService,
    contentModelSettingService,
    identityService,
  );
  const platformUpgradeJobService = new UpgradeJobService(
    prismaService,
    platformUpgradePackageService,
    identityService,
  );
  const upgradeController = new UpgradeController(
    prismaService,
    platformUpgradePackageService,
    platformUpgradeAnalysisService,
    platformUpgradeJobService,
    contentModelSettingService,
    identityService,
    (user) => identityService.requireAdmin(user),
  );
  // AI 编程：模型只写暂存区，落地复用平台升级执行器（CODE_EDIT 任务）。
  const aiCodeService = new AiCodeService(
    prismaService,
    contentModelSettingService,
    identityService,
    userLookupService,
    platformUpgradeJobService,
  );
  const aiCodeController = new AiCodeController(aiCodeService);
  // 平台管理员「生成 Skill」：目录随 MCP_OPERATIONS 增长，模型生成 + 包内安全门禁都在服务内收口。
  const skillGeneratorService = new SkillGeneratorService(
    prismaService,
    identityService,
    contentModelSettingService,
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
  // 平台统一插件能力目录（§10.7）：单一实例，派发门槛与后台维护共用同一份生效口径。
  const extensionCatalogService = new ExtensionCatalogService(prismaService);
  // 平台统一浏览器任务服务（§10.3）：持久队列 + 认领租约 + 结果回执，分发等派发通道复用同一份。
  const browserTaskService = new BrowserTaskService(
    prismaService,
    extensionCatalogService,
  );
  // 多平台内容分发：台账与结果落库在本系统，实际发布由 AIPDD Enterprise 浏览器插件在本地完成。
  const distributionService = new DistributionService(
    prismaService,
    extensionCatalogService,
    browserTaskService,
  );
  const distributionController = new DistributionController(
    distributionService,
  );
  // 帮助中心：章节知识库内置随代码版本化，前端 /help 与 MCP（Help_*）读同一份。
  const helpService = new HelpService();
  const helpController = new HelpController(helpService);
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
    agentMemoryService,
    agentMemoryService,
  );
  const contentDigitalAssetService = new DigitalAssetService(
    prismaService,
    contentModelSettingService,
    aipddAssetClient,
    identityService,
    storageService,
    publishReviewService,
  );
  // 存储底座巡检/迁移：存量 AIPDD 资产按批转存本站 OSS，可中断续跑。
  const storageMigrationService = new StorageMigrationService(
    prismaService,
    storageService,
    identityService,
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
  // 智能硬件：型号/开发包/设备/工具/授权 + 设备通道 + 独立 MCP；控制器由契约 moduleHandlers（Hw_/AdminHw_）注册。
  // 实例化提前到 Agent 工具装配之前：站内 Agent 的 hw__ 工具派发要用它（prisma/oss 均已就绪）。
  const hardwareService = new HardwareService(prismaService, ossService);
  const contentAgentTools = {
    media: contentMediaService,
    memory: contentAgentMemoryService,
    skills: contentAgentSkillService,
    plugins: contentAgentPluginService,
    connectors: contentAgentConnectorService,
    library: contentAgentLibraryService,
    prisma: prismaService,
    identity: identityService,
    hardware: hardwareService,
    // 统一 RAG 出口（kb_retrieve）：kb 装配在下方，闭包延后解析
    retrieve: (user: CurrentUser, input: RetrieveInput) =>
      kbRetrieveService.retrieve(user, input),
    // 会话沉淀到知识库（save_to_kb）：没指定空间就写进账号的智能记忆库
    writeKbPage: async (
      user: CurrentUser,
      input: { title: string; content: string; spaceId?: number },
    ) => {
      const spaceId =
        input.spaceId && input.spaceId > 0
          ? input.spaceId
          : (await kbSpaceService.ensureAgentSpace(user.userId)).id;
      return kbPageService.writePage(
        {
          spaceId,
          slug: normalizeSlug(
            `agent-${input.title}-${Date.now().toString(36)}`,
          ),
          type: 'SYNTHESIS',
          title: input.title,
          body: input.content,
          frontmatter: { tags: ['agent', 'conversation'] },
          status: 'PUBLISHED',
          sourceIds: [],
        },
        user,
      );
    },
    // 首批业务动作工具：各模块服务装配在下方，闭包延后解析（TDZ 只在调用时生效）
    business: {
      crmLeads: {
        create: (user: CurrentUser, body: Record<string, unknown>) =>
          crmLeadService.create(user, body),
      },
      dataTable: {
        list: (user: CurrentUser) => dataTableService.list(user),
        createRow: (user: CurrentUser, tableId: number, data: unknown) =>
          dataTableService.createRow(user, tableId, data),
      },
      erp: {
        listStock: (
          user: CurrentUser,
          query: Parameters<ErpService['listStock']>[1],
        ) => erpService.listStock(user, query),
      },
      oa: {
        saveDraft: (user: CurrentUser, body: Record<string, unknown>) =>
          oaService.saveDraft(user, body),
        submit: (user: CurrentUser, id: string) => oaService.submit(user, id),
      },
      recruit: {
        updateApplicationStatus: (
          user: CurrentUser,
          body: Record<string, unknown>,
        ) => recruitService.updateApplicationStatus(user, body),
      },
      // 本地 Chrome 插件 RPA：设备清单与会话生命周期，均以登录人身份进真实服务。
      rpaChrome: {
        listDevices: (user: CurrentUser) =>
          rpaChromeDeviceService.listDevices(user),
        startSession: (user: CurrentUser, body: Record<string, unknown>) =>
          chromeAgentService.startSession(user, body),
        session: (user: CurrentUser, id: number) =>
          chromeAgentService.sessionView(user, id),
        pauseSession: (user: CurrentUser, id: number) =>
          chromeAgentService.pauseSession(user, id),
        resumeSession: (user: CurrentUser, id: number) =>
          chromeAgentService.resumeSession(user, id),
        stopSession: (user: CurrentUser, id: number) =>
          chromeAgentService.stopSession(user, id),
        retryStep: (user: CurrentUser, stepId: number) =>
          chromeAgentService.retryStep(user, stepId),
      },
    },
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
    hrmScopeService,
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
  // 工作流服务依赖 orgContextService（在文件后半段构造）；Agent 工具目录要读到
  // 已共享工作流，故先占位、构造完成后回填，ContentController 惰性取用。
  const workflowRef: { service?: WorkflowService } = {};
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
    contentAgentConnectorService,
    contentAgentSkillService,
    contentAgentPluginService,
    (user) =>
      workflowRef.service
        ? workflowRef.service.toolSpecs(user)
        : Promise.resolve([]),
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
  // 微信服务号：配置、绑定、推送、回调与重试调度；推送作为站内通知的旁路。
  const wechatMpSettingsService = new WechatMpSettingsService(prismaService);
  const wechatMpClient = new WechatMpClient(wechatMpSettingsService);
  const wechatMpBindingService = new WechatMpBindingService(
    prismaService,
    wechatMpSettingsService,
    wechatMpClient,
    userLookupService,
    identityService,
  );
  const wechatMpPushService = new WechatMpPushService(
    prismaService,
    wechatMpSettingsService,
    wechatMpClient,
    wechatMpBindingService,
    userLookupService,
  );
  const wechatMpInboundService = new WechatMpInboundService(
    prismaService,
    wechatMpSettingsService,
    wechatMpBindingService,
  );
  const wechatMpController = new WechatMpController(
    wechatMpSettingsService,
    wechatMpBindingService,
    wechatMpPushService,
    wechatMpClient,
    identityService,
  );
  const wechatMpScheduler = new WechatMpRetryScheduler(wechatMpPushService);
  const notificationService = new NotificationService(
    prismaService,
    snsService,
    wechatMpPushService,
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
  const imService = new ImService(
    prismaService,
    identityService,
    new ImCrypto(),
    orgStaffService,
    notificationService,
  );
  const imController = new ImController(imService);

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
    hrmScopeService,
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
  const tenantScopeService = new TenantScopeService(prismaService);
  const crmScopeService = new CrmScopeService(
    prismaService,
    userLookupService,
    tenantScopeService,
  );
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
  // HRM 组织口径：企点客户导入要判断 SCRM 同步源，与 SCRM 共用同一套组织归属。
  const tencentQidianService = new TencentQidianService(
    prismaService,
    identityService,
    notificationService,
    new TencentQidianCrypto(),
    dataTableService,
    crmReportService,
    hrmScopeService,
  );
  const tpController = new TencentQidianController(tencentQidianService);
  // 企点分群导出产物也进数字资产（与大数据/潜客同一登记通道）。
  tencentQidianService.deliverableSink = (userId, input) =>
    contentDigitalAssetService.registerDeliverable(userId, input);
  const biScopeService = new BiScopeService(
    prismaService,
    userLookupService,
    tenantScopeService,
  );
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
  const partyService = new PartyService(prismaService, tenantScopeService);
  const partyController = new PartyController(partyService);
  const okrScopeService = new OkrScopeService(
    prismaService,
    userLookupService,
    tenantScopeService,
  );
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
  const okrBriefService = new OkrBriefService(prismaService, okrScopeService);
  const okrTaskLinkageService = new OkrTaskLinkageService(prismaService);
  const okrDecompositionService = new OkrDecompositionService(
    prismaService,
    okrScopeService,
    okrBriefService,
    okrService,
    notificationService,
    okrTaskLinkageService,
  );
  const okrController = new OkrController(
    okrService,
    okrBriefService,
    okrDecompositionService,
  );
  const oaScopeService = new OaScopeService(
    prismaService,
    userLookupService,
    tenantScopeService,
  );
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
  // 统一任务中心：Pull 源聚合各板块待办，Push 通道供各模块派发 @ 到某账号。
  const riskServiceRef: { current?: OperationRiskService } = {};
  const taskSourceRegistry = registerTaskSources(
    new TaskSourceRegistry(),
    prismaService,
    {
      identity: identityService,
      marketing: marketingService,
      logistics: logisticsService,
      tax: taxService,
      risks: () => riskServiceRef.current,
      chrome: () => chromeAgentService,
    },
  );
  const taskCenterService = new TaskCenterService(
    prismaService,
    taskSourceRegistry,
    notificationService,
  );
  // 浏览器代理（docs §8.4）：敏感动作待确认 / 需登录时，向操作人派确认与登录待办。
  chromeAgentService.useTaskCenter(taskCenterService);
  // 派单原语：规则 > 板块默认承办人 > 机构队列；改派时任务与业务单据同事务。
  const taskDocumentRegistry = registerTaskDocumentBindings();
  const taskRouterService = new TaskRouterService(
    prismaService,
    taskCenterService,
    taskDocumentRegistry,
    identityService,
    notificationService,
  );
  const taskCenterController = new TaskCenterController(
    taskCenterService,
    taskRouterService,
  );
  const taskAssignmentService = new TaskAssignmentService(
    prismaService,
    identityService,
  );
  const taskAssignmentController = new TaskAssignmentController(
    taskAssignmentService,
  );
  supplyService.useTaskDispatch(taskRouterService);
  // 账号级界面偏好（跨设备）：本轮承载驾驶舱「快捷导航」。
  const uiPreferencesService = new UiPreferencesService(prismaService);
  const uiPreferencesController = new UiPreferencesController(
    uiPreferencesService,
  );
  // 积分与计费域（设计方案 P2/P3/P5）：账户/流水/设置/定价/充值/AWcoin/日批出账。
  // 构造在此集中一处，供 account 注册赠分、bi/oa/service-desk 扣费、数字资产与营销产物登记取用。
  const accountCrypto = new AccountCrypto();
  const pointsSettingsService = new PointsSettingsService(
    prismaService,
    accountCrypto,
  );
  const pointsService = new PointsService(prismaService, pointsSettingsService);
  // 视频模版社区：发布、付费查看（查看者扣分 / 发布者入账）、评分与复刻生成；
  // AIWORKIN 平台模版的展示开关与定时补充由后台设置驱动，调度器在 main.ts 启动。
  const videoTemplateService = new VideoTemplateService(
    prismaService,
    userLookupService,
    pointsService,
    contentJobService,
    aiworkinClient,
  );
  const videoTemplateController = new VideoTemplateController(
    videoTemplateService,
  );
  const videoTemplateSyncScheduler = new VideoTemplateSyncScheduler(
    videoTemplateService,
  );
  const pricingService = new PricingService(prismaService);
  // 官方服务套餐：目录 + 积分直购 + 平台整合交付（主持企业与多家服务商签约兑现）。
  // 交付服务复用 contracts 主持发起/撤销与 points 退款；目录服务购买后 best-effort 自动发起。
  const servicePackageFulfillment = new ServicePackageFulfillmentService(
    prismaService,
    identityService,
    pointsService,
    contractsService,
    userLookupService,
  );
  const servicePackageService = new ServicePackageService(
    prismaService,
    identityService,
    pointsService,
    pointsSettingsService,
    userLookupService,
    servicePackageFulfillment,
  );
  // L0 平台治理底座（§5.9/§5.10/§5.12）：功能开关、访问策略、审查台账、按用量计费规则。
  const featureToggleService = new FeatureToggleService(prismaService);
  const accessPolicyService = new AccessPolicyService(prismaService);
  const skillReviewService = new SkillReviewService(prismaService);
  const skillReviewRunner = new SkillReviewRunner(
    prismaService,
    skillReviewService,
    accessPolicyService,
    contentModelSettingService,
  );
  // §5.9 先审后用：技能/插件入库（上传/覆盖/安装/回滚）后异步起审，
  // 静态硬红线直接拒收，LLM 绝对安全门通过后才允许启用。
  contentAgentSkillService.reviewHook = (kind, itemId, userId) =>
    skillReviewRunner.enqueue(kind, itemId, userId);
  contentAgentPluginService.reviewHook = (kind, itemId, userId) =>
    skillReviewRunner.enqueue(kind, itemId, userId);
  // 上传入口改为同步审查：用户配置的 LLM 分析结果决定放行/拒绝，不安全不落库；
  // 确定性四组规则作为补充证据与既有红线兜底（不替换原策略）。
  contentAgentSkillService.uploadReview = (userId, pkg) =>
    skillReviewRunner.reviewPackage(userId, pkg);
  contentAgentPluginService.uploadReview = (userId, pkg) =>
    skillReviewRunner.reviewPackage(userId, pkg);
  // 运行期复扫与出站黑名单共用平台访问策略
  contentAgentSkillService.blacklistProvider = async () =>
    (await accessPolicyService.current()).blacklist;
  contentAgentPluginService.blacklistProvider = async () =>
    (await accessPolicyService.current()).blacklist;
  // 2.1 单轮请求上限走平台沙箱硬上限（技能/插件正文无权调大）
  contentAgentEngine.guardOptions = async () => {
    const policy = await accessPolicyService.current();
    return {
      maxToolCalls: policy.limits.maxRequestsPerRun,
      maxOutputChars: 400_000,
    };
  };
  const billingRuleService = new BillingRuleService(prismaService);
  // ai-eval 计费收口（§5.12）：所有 AI 链路出结果后按 BillingRule 用量扣分；审查引擎接技。
  const aiEvalService = new AiEvalService(
    prismaService,
    billingRuleService,
    pointsService,
  );
  skillReviewRunner.chargeUsage = (userId, code, usage, refId) =>
    aiEvalService.chargeByUsage(userId, code, usage, refId);
  // 统一 AI 网关的计量出口（§4.4）：带科目按 BillingRule 扣分，不带科目只落用量事实、一分不扣。
  registerAiMetering({
    charge: (userId, code, usage, refId, meta) =>
      aiEvalService.chargeByUsage(userId, code, usage, refId, meta),
    record: (userId, usage, meta) =>
      aiEvalService.recordUsage(userId, usage, meta),
  });
  // L1 知识库底座（§10）：空间/源/页/摄取/检索/图谱/消费者/记忆提炼；
  // 可见性与写闸都在服务内部收口，路由层只解参与转发；LLM 不可用全部链路规则式回落。
  const kbSpaceService = new KbSpaceService(prismaService, identityService);
  const kbSourceService = new KbSourceService(prismaService, kbSpaceService);
  const kbPageService = new KbPageService(prismaService, kbSpaceService);
  const kbIngestService = new KbIngestService(
    prismaService,
    kbSpaceService,
    kbSourceService,
    kbPageService,
    aiEvalService,
  );
  const kbSearchService = new KbSearchService(
    prismaService,
    kbSpaceService,
    kbPageService,
    aiEvalService,
  );
  const kbGraphService = new KbGraphService(prismaService, kbSpaceService);
  const kbConsumerService = new KbConsumerService(
    prismaService,
    kbSpaceService,
  );
  const kbMemoryService = new KbMemoryService(
    prismaService,
    kbSpaceService,
    kbPageService,
    aiEvalService,
    identityService,
  );
  const kbRetrieveService = new KbRetrieveService(
    prismaService,
    kbSpaceService,
    kbSearchService,
    contentAgentLibraryService,
    helpService,
  );
  // Agent 的记忆与资料在知识库里的唯一落点（§10.4 整合）：长期记忆＝AGENT 空间的记忆页、
  // 资料库＝AGENT 空间的「资料」+ 摄取编译；Agent 侧两个服务只做翻译（设置口注入，避免构造顺序耦合）。
  const kbAgentStoreService = new KbAgentStoreService(
    prismaService,
    kbSpaceService,
    kbPageService,
    kbSourceService,
    kbIngestService,
    kbSearchService,
  );
  contentAgentMemoryService.store = kbAgentStoreService;
  contentAgentLibraryService.store = kbAgentStoreService;
  // 摄取管道（P1-A）：上传走本站 OSS、URL 抓取、飞书文档（凭据取自 IM 连接器）
  const kbIntakeService = new KbIntakeService(
    kbSpaceService,
    kbSourceService,
    storageService,
    () => imService.feishuAppCredentials(),
  );
  // 统一挂载（P1-A）：业务板块（客服/专题厅/法务/出海）按 consumerType 召回并综合作答
  const kbAssistService = new KbAssistService(
    prismaService,
    () => kbRetrieveService,
    () => aiEvalService,
  );
  // 客服 AI 回复前先召回绑定空间（consumerType=SERVICE_DESK，consumerId=客服主账号）
  serviceDeskService.kbRecall = (ownerUserId, query) =>
    kbRetrieveService
      .retrieve(new CurrentUser(ownerUserId, '', ''), {
        query,
        consumerType: 'SERVICE_DESK',
        consumerId: ownerUserId,
        topK: 4,
        maxChars: 1200,
      })
      .then((result) =>
        result.snippets
          .map((snippet) => `- ${snippet.title}：${snippet.text}`)
          .join('\n'),
      );
  // 客服闭环（P4-5）：会话派交付任务进任务中心；解决稿写成待审知识页（绝不直发）。
  serviceDeskService.tasks = taskCenterService;
  serviceDeskService.kbDraft = async (input) => {
    const actor = new CurrentUser(input.actorId, '', '');
    const space = input.spaceId
      ? await kbSpaceService.loadReadable(input.spaceId, actor)
      : await kbSpaceService.resolveActiveSpace(actor);
    const page = await kbPageService.writePage(
      {
        spaceId: space.id,
        slug: input.slug,
        type: 'SUMMARY',
        title: input.title,
        body: input.body,
        frontmatter: { source: 'service-desk', ownerUserId: input.ownerUserId },
        status: 'PENDING_REVIEW',
        sourceIds: [],
      },
      actor,
    );
    return { pageId: page.id, spaceId: space.id };
  };
  // 点状 AI（P2-B）：通用能力（摘要/抽取/分类/评分/RAG 问答）与各模块点共用一套出口。
  const aiAbilitiesService = new AiAbilitiesService(
    prismaService,
    kbRetrieveService,
  );
  const aiPointsService = new AiPointsService(
    prismaService,
    aiAbilitiesService,
    crmScopeService,
    okrScopeService,
    hrmScopeService,
    oaScopeService,
  );
  const aiController = new AiController(aiAbilitiesService, aiPointsService);
  const kbController = new KbController(
    kbSpaceService,
    kbSourceService,
    kbPageService,
    kbIngestService,
    kbSearchService,
    kbGraphService,
    kbConsumerService,
    kbMemoryService,
    kbRetrieveService,
    kbIntakeService,
    kbAssistService,
  );
  const requireAdmin = (user: CurrentUser) =>
    identityService.requireAdmin(user);
  // 模型广场：平台统一上架的模型目录 + 按量计费 + OpenAI 兼容对外网关。
  const modelUpstreamService = new ModelUpstreamService(prismaService);
  const modelUsageService = new ModelUsageService(prismaService, pointsService);
  const modelCatalogService = new ModelCatalogService(
    prismaService,
    pointsService,
    pointsSettingsService,
    modelUpstreamService,
  );
  const modelRelayService = new ModelRelayService();
  const platformDefaultsService = new PlatformDefaultsService(
    prismaService,
    pointsService,
    pointsSettingsService,
  );
  const modelPlazaController = new ModelPlazaController(
    prismaService,
    modelCatalogService,
    modelUpstreamService,
    modelUsageService,
    modelRelayService,
    pointsService,
    pointsSettingsService,
    contentChannelPolicyService,
    platformDefaultsService,
    requireAdmin,
  );
  // 智能硬件控制器（服务实例已在 Agent 工具装配前创建）。
  const hardwareController = new HardwareController(
    hardwareService,
    requireAdmin,
  );
  const platformController = new PlatformController(
    featureToggleService,
    accessPolicyService,
    skillReviewService,
    aiGuardService,
    requireAdmin,
  );
  const pointsBillingController = new PointsBillingController(
    billingRuleService,
    requireAdmin,
  );
  // L2 HRM 底座（§5.1/§12.9）：档案、假勤、招聘、人才评估、Offer/述职/rubric（组织口径已在企点前初始化）。
  // 通用协作底座（§5.2）：评论/@/标签/收藏/资源链接，任何模块传 targetType+targetId 即可挂载。
  const collabService = new CollabService(
    prismaService,
    hrmScopeService,
    notificationService,
  );
  const collabController = new CollabController(collabService);
  // §5.8 横切机制（Outbox/Webhook、导入导出、报表目录、规则、公开分享、OIDC、资产策略、IM 同步）。
  // 先于项目 / ERP / 营销 / 招聘构造，后三者用 dispatch 发业务事件。
  const mechanismService = new MechanismService(
    prismaService,
    hrmScopeService,
    accountCrypto,
    storageService,
    notificationService,
    (user: CurrentUser) => identityService.requireAdmin(user),
  );
  const mechanismController = new MechanismController(mechanismService);
  // 领域联动：任务完成/重开 → 已挂接的 OKR 关键结果自动回写（进程内监听，不产生外部副作用）。
  mechanismService.on('task.completed', (org, _event, payload) =>
    okrTaskLinkageService.onTaskStatus(org, payload),
  );
  mechanismService.on('task.reopened', (org, _event, payload) =>
    okrTaskLinkageService.onTaskStatus(org, payload),
  );
  // 增长联动：CRM 订单审批通过 → 自动立项（幂等），并把项目 id 回写订单。
  const growthLinkageService = new GrowthLinkageService(
    prismaService,
    mechanismService,
  );
  mechanismService.on('crm.order.approved', (org, _event, payload) =>
    growthLinkageService.onOrderApproved(org, payload),
  );
  crmApprovalService.attachMechanisms(mechanismService);
  crmOrderService.attachMechanisms(mechanismService);
  crmContractService.attachMechanisms(mechanismService);
  crmLeadService.attachMechanisms(mechanismService);
  // 增长驾驶舱：OKR / 销售 / 交付 / 获客 / 客服 的当期快照。
  const growthCockpitService = new GrowthCockpitService(
    prismaService,
    hrmScopeService,
  );
  // 经营异常（P4-6）：五类异常扫描 → 责任任务派发；关闭前复核与驾驶舱共用同一扫描口径。
  const operationRiskService = new OperationRiskService(
    prismaService,
    hrmScopeService,
    mechanismService,
    taskCenterService,
  );
  riskServiceRef.current = operationRiskService;
  // 合同履约助手（P4-8）：四态事实 → 卡点与下一步动作；派履约任务走任务中心同一入口。
  const fulfillmentAdvisorService = new FulfillmentAdvisorService(
    prismaService,
    growthCockpitService,
    taskCenterService,
  );
  const growthController = new GrowthController(
    growthCockpitService,
    operationRiskService,
    fulfillmentAdvisorService,
  );
  // AI 获客（营销工具）：雷达/触达/档案/剧本/跟进/质检/看板，插件与调度器同域装配。
  const acquisitionSettingsService = new AcquisitionSettingsService(
    prismaService,
    hrmScopeService,
  );
  const acquisitionRadarService = new AcquisitionRadarService(
    prismaService,
    acquisitionSettingsService,
    mechanismService,
    dataTableService,
    aiEvalService,
  );
  acquisitionRadarService.registerExports();
  const acquisitionPluginService = new AcquisitionPluginBridgeService(
    prismaService,
    acquisitionSettingsService,
    hrmScopeService,
    extensionCatalogService,
    browserTaskService,
  );
  const acquisitionOutreachService = new AcquisitionOutreachService(
    prismaService,
    acquisitionSettingsService,
    acquisitionRadarService,
    publishReviewService,
    mechanismService,
    aiEvalService,
    tencentQidianService,
  );
  const acquisitionProfileService = new AcquisitionProfileService(
    prismaService,
    acquisitionSettingsService,
    acquisitionRadarService,
    crmLeadService,
  );
  // CRM 阶段变化回写获客档案业务状态（档案 → CRM 由 pushCrmStage 走另一条路，两向都不经过对方写方法，不会回环）。
  crmLeadService.onStageChanged(({ ownerUserId, leadId, stage }) =>
    acquisitionProfileService.syncCrmStage(ownerUserId, leadId, stage),
  );
  const acquisitionPlaybookService = new AcquisitionPlaybookService(
    prismaService,
    acquisitionSettingsService,
    acquisitionRadarService,
    acquisitionProfileService,
    kbRetrieveService,
  );
  const acquisitionFollowUpService = new AcquisitionFollowUpService(
    prismaService,
    acquisitionSettingsService,
    publishReviewService,
  );
  const acquisitionReceptionService = new AcquisitionReceptionService(
    prismaService,
    acquisitionSettingsService,
    acquisitionProfileService,
    acquisitionPlaybookService,
    acquisitionFollowUpService,
  );
  const acquisitionQcService = new AcquisitionQcService(
    prismaService,
    acquisitionSettingsService,
    aiEvalService,
  );
  const acquisitionDashboardService = new AcquisitionDashboardService(
    prismaService,
    acquisitionSettingsService,
    hrmScopeService,
    mechanismService,
  );
  // 插件只认令牌：采集与触达各自认领/回执，桥只负责令牌、限流与分发。
  acquisitionPluginService.register({
    type: 'collect',
    claim: (key, limit) => acquisitionRadarService.claimCollectJobs(key, limit),
    report: (key, body, actorUserId) =>
      acquisitionRadarService.reportCollect(key, body, actorUserId),
  });
  acquisitionPluginService.register({
    type: 'outreach',
    claim: (key, limit) =>
      acquisitionOutreachService.claimOutreachJobs(key, limit),
    report: (key, body, actorUserId) =>
      acquisitionOutreachService.reportOutreach(key, body, actorUserId),
  });
  // 跟进复用触达链路回执；企微跟进借服务台既有渠道发送。
  acquisitionOutreachService.followUpReceipt = (input) =>
    acquisitionFollowUpService.receipt(input);
  acquisitionFollowUpService.sendChannel = (input) =>
    serviceDeskService.sendFollowUpText(input);
  // 服务台自动回复处插入销售剧本与档案上下文。
  serviceDeskService.acqReception = (input) =>
    acquisitionReceptionService.context(input);
  const acquisitionController = new AcquisitionController(
    acquisitionSettingsService,
    acquisitionRadarService,
    acquisitionPluginService,
    acquisitionOutreachService,
    acquisitionProfileService,
    acquisitionPlaybookService,
    acquisitionFollowUpService,
    acquisitionQcService,
    acquisitionDashboardService,
  );
  const acquisitionScheduler = new AcquisitionScheduler(
    acquisitionRadarService,
    acquisitionOutreachService,
    acquisitionFollowUpService,
  );
  // 企业微信原生 SCRM（营销工具）：客户/群/活码/群发/继承/SOP/合规/统计/员工侧边栏。
  // 同步源唯一：启用后企点侧客户导入暂停，避免双写。
  const scrmCrypto = new ScrmCrypto();
  const scrmClient = new ScrmClient();
  const scrmScopeService = new ScrmScopeService(
    prismaService,
    hrmScopeService,
    scrmCrypto,
  );
  const scrmSettingsService = new ScrmSettingsService(
    prismaService,
    scrmScopeService,
    scrmCrypto,
    scrmClient,
  );
  const scrmSopService = new ScrmSopService(
    prismaService,
    scrmScopeService,
    scrmClient,
  );
  const scrmContactService = new ScrmContactService(
    prismaService,
    scrmScopeService,
    scrmClient,
    scrmSopService,
  );
  const scrmChatService = new ScrmChatService(
    prismaService,
    scrmScopeService,
    scrmClient,
  );
  const scrmMaterialService = new ScrmMaterialService(
    prismaService,
    scrmScopeService,
  );
  const scrmComplianceService = new ScrmComplianceService(
    prismaService,
    scrmScopeService,
    scrmSopService,
    aiEvalService,
  );
  const scrmCodeService = new ScrmCodeService(
    prismaService,
    scrmScopeService,
    scrmClient,
    scrmMaterialService,
    scrmComplianceService,
  );
  const scrmMassService = new ScrmMassService(
    prismaService,
    scrmScopeService,
    scrmClient,
    scrmComplianceService,
  );
  const scrmTransferService = new ScrmTransferService(
    prismaService,
    scrmScopeService,
    scrmClient,
  );
  const scrmStatsService = new ScrmStatsService(
    prismaService,
    scrmScopeService,
    scrmContactService,
    scrmChatService,
    mechanismService,
  );
  scrmStatsService.registerExports();
  const scrmSidebarService = new ScrmSidebarService(
    scrmScopeService,
    scrmContactService,
    scrmSopService,
    scrmMaterialService,
  );
  const scrmSyncService = new ScrmSyncService(
    prismaService,
    scrmScopeService,
    scrmClient,
    scrmContactService,
    scrmChatService,
    scrmSopService,
  );
  const scrmCallbackService = new ScrmCallbackService(
    scrmScopeService,
    scrmSyncService,
    scrmCodeService,
  );
  const scrmController = new ScrmController(
    scrmSettingsService,
    scrmSyncService,
    scrmContactService,
    scrmChatService,
    scrmCodeService,
    scrmMassService,
    scrmTransferService,
    scrmSopService,
    scrmComplianceService,
    scrmStatsService,
    scrmMaterialService,
    scrmSidebarService,
  );
  const scrmScheduler = new ScrmScheduler(
    scrmMassService,
    scrmTransferService,
    scrmSopService,
    scrmCodeService,
  );
  // L2 项目 / 任务 / 工时（§5.2）：组织口径复用 HRM，业务事件走 mechanisms 分发。
  const projectCostService = new ProjectCostService(
    prismaService,
    hrmScopeService,
    mechanismService,
  );
  const projectService = new ProjectService(
    prismaService,
    hrmScopeService,
    mechanismService,
    aiEvalService,
  );
  const projectDemandService = new ProjectDemandService(
    prismaService,
    hrmScopeService,
    mechanismService,
  );
  const projectController = new ProjectController(
    projectService,
    projectCostService,
    projectDemandService,
  );
  // L2 ERP 进销存 + 应收应付（§5.4）：主数据与单据同组织键，AI 经营评估可回落规则式。
  const erpService = new ErpService(
    prismaService,
    hrmScopeService,
    mechanismService,
    aiEvalService,
  );
  const erpController = new ErpController(erpService);
  // L3 营销技能库（§5.5）：内置技能种子 + LLM 运行 + 内容资产；平台凭据走 AccountCrypto。
  const mktService = new MktService(
    prismaService,
    hrmScopeService,
    mechanismService,
    aiEvalService,
    accountCrypto,
    // 生成完成→内容审核→渠道发布（docs §8.4）：任务走统一任务中心派发与收口。
    taskCenterService,
  );
  const mktController = new MktController(mktService);
  // SEO 工作台（营销工具）：三层数据源（自有抓取 / DataForSEO 用户自带 Key / 系统 LLM）。
  const seoDfs = new SeoDataForSeoClient(prismaService, accountCrypto);
  const seoCtx = {
    prisma: prismaService,
    scope: hrmScopeService,
    aiEval: aiEvalService,
    crypto: accountCrypto,
    mechanisms: mechanismService,
    tables: dataTableService,
    mail: aliyunMailService,
    dfs: seoDfs,
  };
  const seoProjects = new SeoProjectService(seoCtx);
  const seoAudits = new SeoAuditService(seoCtx);
  const seoKeywords = new SeoKeywordService(seoCtx);
  const seoRank = new SeoRankService(seoCtx);
  const seoCompetitors = new SeoCompetitorService(seoCtx);
  const seoLocal = new SeoLocalService(seoCtx);
  const seoGoogle = new SeoGoogleService(seoCtx, seoKeywords);
  const seoOutreach = new SeoOutreachService(seoCtx);
  const seoSchema = new SeoSchemaService(seoCtx);
  const seoProgrammatic = new SeoProgrammaticService(seoCtx);
  const seoReports = new SeoReportService(seoCtx, seoProjects);
  const seoController = new SeoController({
    projects: seoProjects,
    audits: seoAudits,
    keywords: seoKeywords,
    rank: seoRank,
    competitors: seoCompetitors,
    local: seoLocal,
    google: seoGoogle,
    outreach: seoOutreach,
    schema: seoSchema,
    programmatic: seoProgrammatic,
    reports: seoReports,
  });
  // L3 AI 简历代投（§5.6，求职者视角）：资料/岗位/评估/定制/投递确认。
  const recruitService = new RecruitService(
    prismaService,
    hrmScopeService,
    mechanismService,
    aiEvalService,
  );
  const recruitController = new RecruitController(recruitService);
  const hrmProfileService = new HrmProfileService(
    prismaService,
    hrmScopeService,
    taskCenterService,
    notificationService,
  );
  const hrmAttendanceService = new HrmAttendanceService(
    prismaService,
    hrmScopeService,
  );
  const hrmRecruitService = new HrmRecruitService(
    prismaService,
    hrmScopeService,
    aiEvalService,
  );
  const talentMatchService = new TalentMatchService(prismaService);
  const hrmTalentService = new HrmTalentService(
    prismaService,
    hrmScopeService,
    talentMatchService,
    aiEvalService,
  );
  const hrmLifecycleService = new HrmLifecycleService(
    prismaService,
    hrmScopeService,
  );
  const hrmController = new HrmController(
    hrmProfileService,
    hrmAttendanceService,
    hrmRecruitService,
    hrmTalentService,
    hrmLifecycleService,
  );
  // 附录 B 补齐项（一体化升级）：统一组织口径 + 各域服务；公开路由取 gaps 组。
  const gapScopeService = new GapScopeService(hrmScopeService);
  const entitlementService = new EntitlementService(
    prismaService,
    gapScopeService,
  );
  const appointmentService = new AppointmentService(
    prismaService,
    gapScopeService,
  );
  const mailTemplateService = new MailTemplateService(
    prismaService,
    gapScopeService,
    mailboxService,
  );
  const pageAssistantService = new PageAssistantService(
    prismaService,
    gapScopeService,
    // 会议/邮件助手：把提取到的行动项作为「待确认」任务派进任务中心（docs §11.2）。
    taskCenterService,
  );
  const transcriptionService = new TranscriptionService(
    prismaService,
    gapScopeService,
    contentMediaService,
  );
  const quotationDocumentService = new QuotationDocumentService(
    prismaService,
    crmScopeService,
  );
  const timeAuditService = new TimeAuditService(prismaService, gapScopeService);
  // 时长卡（日卡 / 30 天卡）：规格目录只软停用，发卡/扣额/兑换订单集中在 CardService。
  // 支付客户端提前到这里构造——现金购卡与充值共用同一个微信商户客户端。
  const wechatPayClient = new WechatPayClient();
  const cardTemplateService = new CardTemplateService(
    prismaService,
    gapScopeService,
  );
  const cardService = new CardService(
    prismaService,
    pointsService,
    pointsSettingsService,
    wechatPayClient,
    gapScopeService,
  );
  // 扣费顺序「卡 → 积分」的唯一收口点：站内试用、对外 /v1、Agent 内部调用共用这里。
  // modelUsageService 比卡服务先构造（广场域不依赖积分设置之外的东西），故回填字段而非加构造参数。
  modelUsageService.cards = cardService;
  const promoService = new PromoService(
    prismaService,
    gapScopeService,
    pointsService,
    cardService,
  );
  const afterSalesService = new AfterSalesService(prismaService);
  const reviewService = new ReviewService(prismaService, gapScopeService);
  const taskSyncService = new TaskSyncService(prismaService, gapScopeService);
  const termsService = new TermsService(prismaService, gapScopeService);
  const onboardingService = new OnboardingService(
    prismaService,
    gapScopeService,
  );
  const changelogService = new ChangelogService(prismaService, gapScopeService);
  const orgContextService = new OrgContextService(
    prismaService,
    gapScopeService,
  );
  const usageService = new UsageService(prismaService, gapScopeService);
  const entitlementController = new EntitlementController(entitlementService);
  const appointmentController = new AppointmentController(appointmentService);
  const mailTemplateController = new MailTemplateController(
    mailTemplateService,
  );
  const assistantController = new AssistantController(pageAssistantService);
  const transcriptionController = new TranscriptionController(
    transcriptionService,
  );
  const quotationDocumentController = new QuotationDocumentController(
    quotationDocumentService,
  );
  const timeAuditController = new TimeAuditController(timeAuditService);
  const promoController = new PromoController(promoService);
  const cardController = new CardController(cardService, cardTemplateService);
  const adminCardController = new AdminCardController(
    cardService,
    cardTemplateService,
  );
  const afterSalesController = new AfterSalesController(afterSalesService);
  const reviewController = new ReviewController(reviewService);
  const taskSyncController = new TaskSyncController(taskSyncService);
  const termsController = new TermsController(termsService);
  const onboardingController = new OnboardingController(onboardingService);
  const changelogController = new ChangelogController(changelogService);
  const orgContextController = new OrgContextController(orgContextService);
  const usageController = new UsageController(usageService);
  // 工作流：图编排 + 版本冻结 + 运行台账。节点目录从既有注册表派生（契约 + Agent manifest）；
  // 作为 Push-only 任务源接入「我的任务」（挂起/唤醒），并以 wf__ 前缀进 Agent/MCP 工具目录。
  const workflowEngine = new WorkflowEngine(prismaService, taskCenterService);
  taskSourceRegistry.register(workflowSource(workflowEngine));
  const workflowService = new WorkflowService(
    prismaService,
    orgContextService,
    workflowEngine,
    {
      connectorTools: (user) => contentAgentConnectorService.toolSpecs(user),
      hardwareTools: (user) => contentAgentService.hardwareToolSpecs(user),
      skills: (user) => contentAgentSkillService.list(user),
      plugins: (user) => contentAgentPluginService.list(user),
    },
    hrmScopeService,
  );
  workflowRef.service = workflowService;
  // 领域事件桥：本主体的领域事件命中已发布工作流的 trigger.event 节点即起运行。
  // 幂等锚＝事件台账 id，重复投递只起一次；外部 Webhook 触发不开放（决策 D2=C）。
  mechanismService.on('*', async (org, event, payload, meta) => {
    await workflowService.runOnEvent({
      orgType: org.orgType,
      orgUserId: org.orgUserId,
      event,
      payload,
      eventLogId: meta?.eventLogId ?? 0,
    });
  });
  // 任务事件桥：created / closed / overdue 命中已发布工作流的 trigger.task（幂等锚＝任务 + 变化类型）。
  taskCenterService.useTaskEventPort((input) =>
    workflowService.runOnTaskEvent(input),
  );
  // 规则动作（§4.3）：run_workflow 复用统一触发入口、以事件主体负责人身份运行；
  // assign_task 只经 TaskCenterService 写入，source=rule 让「我的任务」能反查规则与事件。
  mechanismService.useWorkflowInvoker((input) =>
    workflowService.invokeByUser(input.ownerUserId, {
      ...(input.workflowId ? { workflowId: input.workflowId } : {}),
      ...(input.businessKey ? { businessKey: input.businessKey } : {}),
      trigger: 'EVENT',
      input: input.input,
      sourceType: 'rule',
      sourceId: input.dedupeKey,
      dedupeKey: input.dedupeKey,
    }),
  );
  mechanismService.useTaskAssigner(async (input) => {
    const orgTarget = input.target.startsWith('ORG:');
    const assignee = (orgTarget ? input.target.slice(4) : input.target).trim();
    if (!assignee) throw new Error('assign_task 未指定承办人');
    const payload = input.payload;
    const str = (value: unknown) => (typeof value === 'string' ? value : '');
    await taskCenterService.assign({
      source: 'rule',
      sourceId: input.sourceId,
      title: str(payload.title) || `规则 ${input.ruleId} 自动任务`,
      description:
        str(payload.description) || JSON.stringify(payload).slice(0, 20000),
      link: str(payload.link) || '/tasks',
      category: str(payload.category) || 'matter',
      priority: str(payload.priority) || 'NORMAL',
      dueAt: str(payload.dueAt) || null,
      assigneeType: orgTarget ? 'ORG' : 'USER',
      assigneeUserId: orgTarget ? '' : assignee,
      orgType: orgTarget ? 'PROVIDER' : '',
      orgUserId: orgTarget ? assignee : '',
      assignedBy: `rule:${input.ruleId}`,
      createdBy: input.org.orgUserId || input.org.actorId,
    });
  });
  const workflowController = new WorkflowController(workflowService);
  // 工作流运行期能力：动作节点走内部自执行器（app.ts 装配 mcpService 后回填），
  // 工具节点走 Agent 统一派发，AI 节点走统一网关 / RAG / 站内 Agent。
  const workflowRunOperation: { current?: WorkflowRuntime['runOperation'] } =
    {};
  workflowEngine.setRuntime({
    runOperation: (user, requestId, operationId, input) =>
      workflowRunOperation.current
        ? workflowRunOperation.current(user, requestId, operationId, input)
        : Promise.resolve({
            status: 503,
            code: undefined,
            message: '执行器尚未就绪',
            data: undefined,
          }),
    callTool: async (user, name, args) => {
      if (name.startsWith('mcp__')) {
        return contentAgentConnectorService.callTool(user, name, args);
      }
      if (name.startsWith('hw__')) {
        const result = await hardwareService.mcpCall(user.userId, name, args);
        const text = result.content.map((item) => item.text).join('\n');
        return {
          text:
            text || (result.isError ? '硬件工具调用失败' : '硬件工具已执行'),
          ok: !result.isError,
        };
      }
      // 内置 / 业务 / 技能 / 插件：走统一派发，工具内部已把失败转成可读文案。
      const result = await runAgentTool(name, args, contentAgentTools, {
        user,
        token: undefined,
      });
      return { text: result.text, ok: true };
    },
    chat: async (user, messages) => {
      const result = await contentMediaService.chat(
        user,
        undefined,
        messages,
        'text',
        undefined,
        { module: 'workflow', operation: 'ai_llm' },
      );
      return { text: result.text, usage: result.usage };
    },
    retrieve: (user, input) =>
      kbRetrieveService.retrieve(user, input as RetrieveInput),
    runAgent: async (user, prompt) => {
      const conversation = await contentAgentService.createConversation(user, {
        title: '工作流 AI 节点',
      });
      const result = await contentAgentService.runSilent(
        user,
        undefined,
        conversation.id,
        prompt,
        {},
      );
      return { text: result.text, usage: result.usage };
    },
  });
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
    cardService,
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
    // 平台统一插件能力目录：派发门槛（分发/获客）与后台维护复用同一实例。
    extensionCatalog: extensionCatalogService,
    // M6 供求广场：社交板复用企业板块同一上游通道（DemandService + AiworkinClient）。
    aiworkinClient,
    demandService,
    users: userLookupService,
    identity: identityService,
    // 商务社交：本地为主，个人 Key 可选同步 AIworkin；调度器由 main.ts 启停。
    socialSync: {
      aiworkin: socialAiworkinService,
      sync: socialSyncService,
      affinity: socialAffinityService,
      scheduler: socialSyncScheduler,
    },
    external: externalService,
    collection: geoCollectionService,
    rpaTaskService,
    workbuddyPlanService,
    contentAgentScheduleService,
    agentMemory: agentMemoryService,
    skillGenerator: skillGeneratorService,
    mailbox: mailboxService,
    notification: notificationService,
    // 微信服务号：公开回调/OAuth 由 app.ts 取用，调度器由 main.ts 启停。
    wechatMp: {
      settings: wechatMpSettingsService,
      client: wechatMpClient,
      binding: wechatMpBindingService,
      push: wechatMpPushService,
      inbound: wechatMpInboundService,
      controller: wechatMpController,
      scheduler: wechatMpScheduler,
    },
    orgStaff: orgStaffService,
    serviceDesk: serviceDeskService,
    // AI 获客域（营销工具）：控制器由契约 moduleHandlers（Acquisition_）注册，
    // 调度器与两段插件路由由 main.ts / automation-routes 取用。
    acquisition: {
      settings: acquisitionSettingsService,
      radar: acquisitionRadarService,
      plugin: acquisitionPluginService,
      outreach: acquisitionOutreachService,
      profiles: acquisitionProfileService,
      playbooks: acquisitionPlaybookService,
      followUps: acquisitionFollowUpService,
      reception: acquisitionReceptionService,
      qc: acquisitionQcService,
      dashboard: acquisitionDashboardService,
      scheduler: acquisitionScheduler,
    },
    // 企业微信原生 SCRM 域（营销工具）：控制器由契约 moduleHandlers（Scrm_）注册，
    // 回调与员工侧边栏是根 app 上的公开路由，调度器由 main.ts 启停。
    scrm: {
      settings: scrmSettingsService,
      sync: scrmSyncService,
      contacts: scrmContactService,
      chats: scrmChatService,
      codes: scrmCodeService,
      mass: scrmMassService,
      transfers: scrmTransferService,
      sops: scrmSopService,
      compliance: scrmComplianceService,
      stats: scrmStatsService,
      materials: scrmMaterialService,
      sidebar: scrmSidebarService,
      callback: scrmCallbackService,
      scheduler: scrmScheduler,
    },
    livecode: livecodeService,
    survey: surveyService,
    publishReview: publishReviewService,
    okrMetrics: okrMetricsService,
    oa: oaService,
    // 统一任务中心（§我的任务）：控制器由契约 moduleHandlers（MyTask_）注册。
    taskCenter: taskCenterService,
    taskSources: taskSourceRegistry,
    taskRouter: taskRouterService,
    taskAssignment: taskAssignmentService,
    uiPreferences: uiPreferencesService,
    workflow: workflowService,
    workflowRunOperation,
    tencentQidian: tencentQidianService,
    crm: crmController,
    bi: biController,
    oss: ossService,
    ossSettings: ossSettingsService,
    storage: {
      service: storageService,
      migration: storageMigrationService,
    },
    // 平台升级：控制器由契约 moduleHandlers（AdminUpgrade_）注册，runner 由任务服务拉起。
    upgrade: {
      packages: platformUpgradePackageService,
      analysis: platformUpgradeAnalysisService,
      jobs: platformUpgradeJobService,
    },
    qxySettings: qxySettingsService,
    capability: capabilityService,
    digitalAsset: contentDigitalAssetService,
    // 创意社区：service 给路由与调度器取 Key，scheduler 由 main.ts 启停。
    community: {
      service: communityService,
      awards: communityAwardService,
      scheduler: communityRunScheduler,
    },
    // 视频模版社区：控制器由 automation-routes 显式注册（复刻要透传 token），
    // 同步调度器由 main.ts 启停。
    videoTemplate: {
      service: videoTemplateService,
      scheduler: videoTemplateSyncScheduler,
    },
    builtinMcp,
    // 平台治理域（§5.9/§5.10）：app.ts 拦截中间件与 governance 路由消费。
    feature: {
      toggle: featureToggleService,
      accessPolicy: accessPolicyService,
      skillReview: skillReviewService,
      skillReviewRunner,
    },
    // §5.8 横切机制：公开分享 / OIDC 回跳在根 app 上直接取用。
    mechanisms: mechanismService,
    // 项目 / 任务 / 工时域（§5.2 L2）：控制器由契约 moduleHandlers（Pj_）注册。
    project: projectService,
    // 附录 B 补齐项：公开预约 / 报价 PDF / 条款正文在根 app 上直接取用。
    gaps: {
      entitlements: entitlementService,
      appointments: appointmentService,
      mailTemplates: mailTemplateService,
      assistant: pageAssistantService,
      transcription: transcriptionService,
      quotationDoc: quotationDocumentService,
      timeAudit: timeAuditService,
      promo: promoService,
      card: cardService,
      cardTemplate: cardTemplateService,
      afterSales: afterSalesService,
      review: reviewService,
      taskSync: taskSyncService,
      terms: termsService,
      onboarding: onboardingService,
      changelog: changelogService,
      orgContext: orgContextService,
      usage: usageService,
    },
    // ERP 进销存域（§5.4 L2）：控制器由契约 moduleHandlers（Erp_）注册。
    erp: erpService,
    // 营销技能库（§5.5 L3）：控制器由契约 moduleHandlers（Mkt_）注册。
    mkt: mktService,
    // AI 简历代投（§5.6 L3）：控制器由契约 moduleHandlers（Recruit_）注册。
    recruit: recruitService,
    // HRM 域（§5.1 L2）：档案/假勤/招聘/评估/Offer，控制器由契约 moduleHandlers 注册。
    hrm: {
      scope: hrmScopeService,
      profile: hrmProfileService,
      attendance: hrmAttendanceService,
      recruit: hrmRecruitService,
      talent: hrmTalentService,
      lifecycle: hrmLifecycleService,
    },
    // 知识库域（§10 L1）：kb 路由与后续 Agent 回流消费。
    kb: {
      space: kbSpaceService,
      source: kbSourceService,
      page: kbPageService,
      ingest: kbIngestService,
      search: kbSearchService,
      graph: kbGraphService,
      consumer: kbConsumerService,
      memory: kbMemoryService,
    },
    // 积分与计费域（供 app.ts 组装 PointsModule、account/billing 钩子、main.ts 调度器使用）。
    points: {
      settings: pointsSettingsService,
      ledger: pointsService,
      pricing: pricingService,
      billingRule: billingRuleService,
      aiEval: aiEvalService,
      pay: wechatPayClient,
      recharge: rechargeService,
      awcoin: awcoinClient,
      billing: pointsBillingService,
      crypto: accountCrypto,
    },
    // 官方服务套餐（供 app.ts 组装 ServicePackageModule）：目录购买 + 平台整合交付。
    servicePackages: {
      catalog: servicePackageService,
      fulfillment: servicePackageFulfillment,
    },
    // 模型广场：平台统一上架的模型目录 + 按量计费 + OpenAI 兼容对外网关。
    modelPlaza: {
      controller: modelPlazaController,
      upstreams: modelUpstreamService,
      catalog: modelCatalogService,
      usage: modelUsageService,
      relay: modelRelayService,
    },
    // 智能硬件：设备通道（根 app 公开路由）与机器通道/MCP（business）都从这里取服务实例。
    hardware: hardwareService,
    // 本地 Chrome 插件 RPA：设备通道在根 app（只认设备令牌），会话引擎给界面与 Agent/MCP 共用。
    rpaChrome: {
      device: rpaChromeDeviceService,
      agent: chromeAgentService,
      // 本账号私有资产台账（会话/消息/技能/录制/抽取）：设备通道与界面端点共用。
      library: rpaChromeLibraryService,
      // 计划任务（浏览器代理定时）：调度器与界面端点共用。
      schedule: rpaChromeScheduleService,
      // MCP 语义层（browser_agent_* / browser_extract / browser_skill_*）：绿灯即派任务的唯一入口。
      tools: browserAgentToolsService,
      // 模型广场目录：插件侧边栏 Agent 的「模型下拉 + 额度条」从这里取已上架模型与余额。
      catalog: modelCatalogService,
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
      seoController,
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
      rpaChromeController,
      workbuddyController,
      aiCallController,
      aiCallOpenController,
      leadProspectingController,
      ecomPdpController,
      domesticPdpController,
      distributionController,
      surveyController,
      helpController,
      bigdataQueryController,
      aliyunCallController,
      aliyunMailController,
      agentMemoryController,
      contentController,
      videoTemplateController,
      appDirectoryController,
      mailboxController,
      notificationController,
      wechatMpController,
      snsController,
      orgStaffController,
      serviceDeskController,
      livecodeController,
      crmController,
      biController,
      growthController,
      lowcodeController,
      okrController,
      partyController,
      oaController,
      taskCenterController,
      taskAssignmentController,
      uiPreferencesController,
      workflowController,
      tpController,
      questionHallController,
      imController,
      skillHubController,
      communityController,
      hrmController,
      mechanismController,
      projectController,
      erpController,
      mktController,
      recruitController,
      kbController,
      aiController,
      platformController,
      pointsBillingController,
      modelPlazaController,
      hardwareController,
      acquisitionController,
      scrmController,
      collabController,
      entitlementController,
      appointmentController,
      mailTemplateController,
      assistantController,
      transcriptionController,
      quotationDocumentController,
      timeAuditController,
      promoController,
      cardController,
      adminCardController,
      afterSalesController,
      reviewController,
      taskSyncController,
      termsController,
      onboardingController,
      changelogController,
      orgContextController,
      usageController,
      upgradeController,
      aiCodeController,
    },
  };
}
export type Services = ReturnType<typeof createServices>;
