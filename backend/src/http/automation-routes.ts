import { Context } from 'hono';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { createRoute } from '@hono/zod-openapi';
import { endpoints, z } from '@enterprise/contracts';
import type { CurrentUser } from '../auth/current-user';
import type { Services } from './services';
import type { ApiEnv } from './types';
import { serializeResponse } from './response';
import { ok } from '../common/api';
import { streamSSE } from 'hono/streaming';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { withoutRequestAbort } from '../common/request-context';
import { upstreamToken } from '../common/upstream-token';
import { toCsv } from '../crm/crm.helpers';

/** SSE 保活间隔：必须小于反向代理的空闲超时（Next dev 30 秒 / Nginx 60 秒）。 */
const SSE_HEARTBEAT_MS = 10_000;

const errorResponse = {
  description: 'Request rejected',
  content: {
    'application/json': {
      schema: z.object({
        code: z.number(),
        message: z.string(),
        data: z.unknown(),
      }),
    },
  },
};

type Input = {
  user: CurrentUser;
  param: Record<string, string>;
  query: Record<string, unknown>;
  json: Record<string, unknown>;
  token: string;
};

type Handler = (input: Input) => Promise<unknown>;

/**
 * 需要 AIPDD 上游凭证（用户绑定的 API Key）的端点白名单：只有这些 handler 会读取 input.token。
 * 其余端点（平台管理、本地数据增删改查等）不解析上游 Key——未绑定 Key 的账号不应被 403 拦住，
 * 例如「活码监管」只查本地库，平台管理员本来就不需要绑定 AIPDD Key。
 * 新增读取 i.token 的 handler 时必须登记到这里，否则会拿到空 token。
 */
const UPSTREAM_TOKEN_OPERATIONS = new Set<string>([
  // 营销工具：RPA / Workbuddy / 潜客挖掘 / 大数据
  'Rpa_generateScript',
  'Rpa_llm',
  'Rpa_saveLlm',
  'Rpa_llmModels',
  'Rpa_paramsChat',
  'OpenApi_rpaGenerateScript',
  'Workbuddy_setting',
  'Workbuddy_saveSetting',
  'Workbuddy_models',
  'Workbuddy_clarify',
  'Lead_settings',
  'Lead_saveSettings',
  'Lead_removeSerperKey',
  'Lead_models',
  'Lead_chat',
  'Lead_createTask',
  'Lead_startTask',
  // 跨境电商商品页优化：规划与出图都要经模型网关取用户绑定的上游凭证
  'EcomPdp_plan',
  'EcomPdp_generate',
  // 国内电商商品页优化：同样要经模型网关取用户绑定的上游凭证
  'DomesticPdp_plan',
  'DomesticPdp_generate',
  'Bigdata_settings',
  'Bigdata_saveSettings',
  'Bigdata_models',
  'Bigdata_chat',
  // 内容创作：模型设置、数字资产、任务与专家
  'Content_settings',
  'Content_saveSettings',
  'Content_testChannel',
  'Content_models',
  'Content_digitalAssets',
  'Content_digitalAssetLabels',
  'Content_tagDigitalAsset',
  'Content_registerAsset',
  'Content_createJob',
  'Content_createExpert',
  'Content_librarySearch',
  'Content_libraryPublish',
  'Content_runScheduleNow',
  // 多维表格 AI 与附件、OA 预审
  'LowCode_aiFill',
  'LowCode_aiAsk',
  'LowCode_aiSettings',
  'LowCode_aiChannels',
  'LowCode_aiModels',
  'LowCode_assets',
  'LowCode_uploadAsset',
  'Oa_preReview',
]);

/**
 * 多维表格 / RPA / Workbuddy / AI 调用账号 / Google 潜客线索挖掘 / 大数据查询 / 飞书同步 /
 * 阿里云智能外呼 / 阿里云邮件推送 / 智能体记忆这些模块的路由。
 * 契约在 packages/contracts/src/automation.ts、agent.ts 统一登记，这里按 operationId 挂处理器，
 * 避免几百个端点在 routes.ts 里重复一遍同样的样板。
 */
export function registerAutomationRoutes(
  app: OpenAPIHono<ApiEnv>,
  services: Services,
) {
  const c = services.controllers;
  const handlers: Record<string, Handler> = {
    // ---------- 多维表格（界面侧） ----------
    DataTable_list: async (i) => c.dataTableController.list(i.user),
    DataTable_create: async (i) => c.dataTableController.create(i.user, i.json),
    DataTable_get: async (i) =>
      c.dataTableController.get(i.user, i.param['id']),
    DataTable_update: async (i) =>
      c.dataTableController.update(i.user, i.param['id'], i.json),
    DataTable_remove: async (i) =>
      c.dataTableController.remove(i.user, i.param['id']),
    DataTable_grants: async (i) =>
      c.dataTableController.listGrants(i.user, i.param['id']),
    DataTable_saveGrants: async (i) =>
      c.dataTableController.saveGrants(i.user, i.param['id'], i.json),
    DataTable_addField: async (i) =>
      c.dataTableController.addField(i.user, i.param['id'], i.json),
    DataTable_addFields: async (i) =>
      c.dataTableController.addFields(i.user, i.param['id'], i.json),
    DataTable_reorderFields: async (i) =>
      c.dataTableController.reorderFields(i.user, i.param['id'], i.json),
    DataTable_updateField: async (i) =>
      c.dataTableController.updateField(
        i.user,
        i.param['id'],
        i.param['fieldId'],
        i.json,
      ),
    DataTable_removeField: async (i) =>
      c.dataTableController.deleteField(
        i.user,
        i.param['id'],
        i.param['fieldId'],
      ),
    DataTable_rows: async (i) =>
      c.dataTableController.listRows(
        i.user,
        i.param['id'],
        Number(i.query['page'] ?? 1),
        Number(i.query['pageSize'] ?? 50),
      ),
    DataTable_addRow: async (i) =>
      c.dataTableController.createRow(i.user, i.param['id'], i.json),
    DataTable_updateRow: async (i) =>
      c.dataTableController.updateRow(
        i.user,
        i.param['id'],
        i.param['rowId'],
        i.json,
      ),
    DataTable_removeRow: async (i) =>
      c.dataTableController.deleteRow(i.user, i.param['id'], i.param['rowId']),

    // ---------- 多维表格 ↔ 飞书多维表格同步 ----------
    DataTable_feishuSyncs: async (i) =>
      c.dataTableFeishuController.list(i.user, i.param['id']),
    DataTable_createFeishuSync: async (i) =>
      c.dataTableFeishuController.save(i.user, i.param['id'], i.json),
    DataTable_updateFeishuSync: async (i) =>
      c.dataTableFeishuController.save(i.user, i.param['id'], {
        ...i.json,
        sync_id: i.param['syncId'],
      }),
    DataTable_removeFeishuSync: async (i) =>
      c.dataTableFeishuController.remove(
        i.user,
        i.param['id'],
        i.param['syncId'],
      ),
    DataTable_previewFeishuSync: async (i) =>
      c.dataTableFeishuController.preview(i.user, i.param['id'], i.json),
    DataTable_testFeishuSync: async (i) =>
      c.dataTableFeishuController.test(
        i.user,
        i.param['id'],
        i.param['syncId'],
      ),
    DataTable_runFeishuSync: async (i) =>
      c.dataTableFeishuController.run(i.user, i.param['id'], i.param['syncId']),
    DataTable_feishuSyncLogs: async (i) =>
      c.dataTableFeishuController.logs(
        i.user,
        i.param['id'],
        i.param['syncId'],
      ),

    // ---------- 多维表格（机器通道） ----------
    OpenApi_dataTables: async (i) => c.dataTableOpenController.list(i.user),
    OpenApi_dataTable: async (i) =>
      c.dataTableOpenController.structure(i.user, i.param['id']),
    OpenApi_dataTableRows: async (i) =>
      c.dataTableOpenController.rows(
        i.user,
        i.param['id'],
        i.query['limit'] === undefined ? undefined : Number(i.query['limit']),
        i.query['offset'] === undefined ? undefined : Number(i.query['offset']),
      ),
    OpenApi_dataTableCreateRow: async (i) =>
      c.dataTableOpenController.createRow(i.user, i.param['id'], i.json),
    OpenApi_dataTableCreateRows: async (i) =>
      c.dataTableOpenController.createRows(i.user, i.param['id'], i.json),
    OpenApi_dataTableUpdateRow: async (i) =>
      c.dataTableOpenController.updateRow(
        i.user,
        i.param['id'],
        i.param['rowId'],
        i.json,
      ),

    // ---------- RPA（界面侧） ----------
    Rpa_scripts: async (i) => c.rpaController.listScripts(i.user, i.query),
    Rpa_generateScript: async (i) =>
      c.rpaController.generate(i.user, i.json, i.token),
    Rpa_script: async (i) => c.rpaController.getScript(i.user, i.param['id']),
    Rpa_createScript: async (i) => c.rpaController.createScript(i.user, i.json),
    Rpa_updateScript: async (i) =>
      c.rpaController.updateScript(i.user, i.param['id'], i.json),
    Rpa_removeScript: async (i) =>
      c.rpaController.deleteScript(i.user, i.param['id']),
    Rpa_accounts: async (i) => c.rpaController.listAccounts(i.user, i.query),
    Rpa_createAccount: async (i) =>
      c.rpaController.createAccount(i.user, i.json),
    Rpa_updateAccount: async (i) =>
      c.rpaController.updateAccount(i.user, i.param['id'], i.json),
    Rpa_removeAccount: async (i) =>
      c.rpaController.deleteAccount(i.user, i.param['id']),
    Rpa_tasks: async (i) => c.rpaController.listTasks(i.user, i.query),
    Rpa_createTask: async (i) => c.rpaController.createTask(i.user, i.json),
    Rpa_createTasks: async (i) => c.rpaController.createBatch(i.user, i.json),
    Rpa_executions: async (i) =>
      c.rpaController.listExecutions(i.user, i.query),
    Rpa_task: async (i) => c.rpaController.getTask(i.user, i.param['id']),
    Rpa_updateTask: async (i) =>
      c.rpaController.updateTask(i.user, i.param['id'], i.json),
    Rpa_removeTask: async (i) =>
      c.rpaController.deleteTask(i.user, i.param['id']),
    Rpa_cancelTask: async (i) =>
      c.rpaController.cancelTask(i.user, i.param['id']),
    Rpa_requeueTask: async (i) =>
      c.rpaController.requeueTask(i.user, i.param['id']),
    Rpa_taskExecutions: async (i) =>
      c.rpaController.taskExecutions(i.user, i.param['id']),
    Rpa_llm: async (i) => c.rpaController.llmSetting(i.user, i.token),
    Rpa_saveLlm: async (i) => c.rpaController.saveLlm(i.user, i.json, i.token),
    Rpa_removeLlm: async (i) => c.rpaController.deleteLlm(i.user),
    Rpa_llmModels: async (i) => c.rpaController.llmModels(i.user, i.token),
    Rpa_paramsChat: async (i) =>
      c.rpaController.paramsChat(i.user, i.json, i.token),
    Rpa_settings: async (i) => c.rpaController.getSettings(i.user),
    Rpa_saveSettings: async (i) => c.rpaController.saveSettings(i.user, i.json),

    // ---------- RPA（机器通道） ----------
    OpenApi_rpaScripts: async (i) =>
      c.rpaOpenController.listScripts(i.user, i.query),
    OpenApi_rpaScript: async (i) =>
      c.rpaOpenController.getScript(i.user, i.param['id']),
    OpenApi_rpaGenerateScript: async (i) =>
      c.rpaOpenController.generate(i.user, i.json, i.token),
    OpenApi_rpaCreateScript: async (i) =>
      c.rpaOpenController.createScript(i.user, i.json),
    OpenApi_rpaAccounts: async (i) =>
      c.rpaOpenController.listAccounts(i.user, i.query),
    OpenApi_rpaTasks: async (i) =>
      c.rpaOpenController.listTasks(i.user, i.query),
    OpenApi_rpaTask: async (i) =>
      c.rpaOpenController.getTask(i.user, i.param['id']),
    OpenApi_rpaCreateTask: async (i) =>
      c.rpaOpenController.createTask(i.user, i.json),
    OpenApi_rpaExecutions: async (i) =>
      c.rpaOpenController.listExecutions(i.user, i.query),
    OpenApi_rpaClaimExecution: async (i) =>
      c.rpaOpenController.claim(i.user, i.json),
    OpenApi_rpaFinishExecution: async (i) =>
      c.rpaOpenController.finish(i.user, i.param['id'], i.json),

    // ---------- Workbuddy ----------
    Workbuddy_accounts: async (i) => c.workbuddyController.listAccounts(i.user),
    Workbuddy_addAccount: async (i) =>
      c.workbuddyController.createAccount(i.user, i.json),
    Workbuddy_updateAccount: async (i) =>
      c.workbuddyController.updateAccount(i.user, i.param['id'], i.json),
    Workbuddy_removeAccount: async (i) =>
      c.workbuddyController.removeAccount(i.user, i.param['id']),
    Workbuddy_verifyAccount: async (i) =>
      c.workbuddyController.verifyAccount(i.user, i.param['id']),
    Workbuddy_setting: async (i) =>
      c.workbuddyController.setting(i.user, i.token),
    Workbuddy_saveSetting: async (i) =>
      c.workbuddyController.saveSetting(i.user, i.json, i.token),
    Workbuddy_removeSetting: async (i) =>
      c.workbuddyController.removeSetting(i.user),
    Workbuddy_models: async (i) =>
      c.workbuddyController.models(i.user, i.token),
    Workbuddy_agents: async (i) =>
      c.workbuddyController.listAgents(i.user, i.query),
    Workbuddy_agentDetail: async (i) =>
      c.workbuddyController.agentDetail(i.user, i.query),
    Workbuddy_createAgent: async (i) =>
      c.workbuddyController.createAgent(i.user, i.json),
    Workbuddy_updateAgent: async (i) =>
      c.workbuddyController.updateAgent(i.user, i.json),
    Workbuddy_removeAgent: async (i) =>
      c.workbuddyController.removeAgent(i.user, i.json),
    Workbuddy_agentVersions: async (i) =>
      c.workbuddyController.agentVersions(i.user, i.query),
    Workbuddy_createAgentVersion: async (i) =>
      c.workbuddyController.createAgentVersion(i.user, i.json),
    Workbuddy_catalogModels: async (i) =>
      c.workbuddyController.builtinModels(i.user, i.query),
    Workbuddy_catalogSkills: async (i) =>
      c.workbuddyController.skills(i.user, i.query),
    Workbuddy_catalogExperts: async (i) =>
      c.workbuddyController.experts(i.user, i.query),
    Workbuddy_catalogConnectors: async (i) =>
      c.workbuddyController.connectors(i.user, i.query),
    Workbuddy_plans: async (i) =>
      c.workbuddyController.listPlans(i.user, i.query),
    Workbuddy_createPlan: async (i) =>
      c.workbuddyController.createPlan(i.user, i.json),
    Workbuddy_plan: async (i) =>
      c.workbuddyController.getPlan(i.user, i.param['id']),
    Workbuddy_updatePlan: async (i) =>
      c.workbuddyController.updatePlan(i.user, i.param['id'], i.json),
    Workbuddy_removePlan: async (i) =>
      c.workbuddyController.removePlan(i.user, i.param['id']),
    Workbuddy_clarify: async (i) =>
      c.workbuddyController.clarify(i.user, i.json, i.token),
    Workbuddy_materialize: async (i) =>
      c.workbuddyController.materialize(i.user, i.param['id'], i.json),
    Workbuddy_addPlanTask: async (i) =>
      c.workbuddyController.addTask(i.user, i.param['id'], i.json),
    Workbuddy_dispatchPlan: async (i) =>
      c.workbuddyController.dispatch(i.user, i.param['id']),
    Workbuddy_syncPlan: async (i) =>
      c.workbuddyController.sync(i.user, i.param['id']),
    Workbuddy_updateTask: async (i) =>
      c.workbuddyController.updateTask(i.user, i.param['id'], i.json),
    Workbuddy_removeTask: async (i) =>
      c.workbuddyController.removeTask(i.user, i.param['id']),
    Workbuddy_taskEvents: async (i) =>
      c.workbuddyController.taskEvents(i.user, i.param['id']),
    Workbuddy_followUpTask: async (i) =>
      c.workbuddyController.followUp(i.user, i.param['id'], i.json),
    Workbuddy_cancelTask: async (i) =>
      c.workbuddyController.cancelTask(i.user, i.param['id']),

    // ---------- AI 调用账号 ----------
    AiCall_accounts: async (i) => c.aiCallController.list(i.user, i.query),
    AiCall_account: async (i) => c.aiCallController.get(i.user, i.param['id']),
    AiCall_createAccount: async (i) =>
      c.aiCallController.create(i.user, i.json),
    AiCall_updateAccount: async (i) =>
      c.aiCallController.update(i.user, i.param['id'], i.json),
    AiCall_removeAccount: async (i) =>
      c.aiCallController.remove(i.user, i.param['id']),
    OpenApi_aiCallAccounts: async (i) =>
      c.aiCallOpenController.list(i.user, i.query as never),
    OpenApi_aiCallCredentials: async (i) =>
      c.aiCallOpenController.credentials(
        i.user,
        i.param['id'],
        i.query as never,
      ),

    // ---------- Google 潜客线索挖掘 ----------
    Lead_settings: async (i) =>
      c.leadProspectingController.settings(i.user, i.token),
    Lead_saveSettings: async (i) =>
      c.leadProspectingController.saveSettings(i.user, i.json, i.token),
    Lead_removeSerperKey: async (i) =>
      c.leadProspectingController.removeSerperKey(i.user, i.token),
    Lead_createTable: async (i) =>
      c.leadProspectingController.createTable(i.user, i.json),
    Lead_tables: async (i) => c.leadProspectingController.tables(i.user),
    Lead_models: async (i) =>
      c.leadProspectingController.models(i.user, i.token),
    Lead_chat: async (i) =>
      c.leadProspectingController.chat(i.user, i.json, i.token),
    Lead_messages: async (i) => c.leadProspectingController.messages(i.user),
    Lead_tasks: async (i) =>
      c.leadProspectingController.listTasks(i.user, i.query),
    Lead_createTask: async (i) =>
      c.leadProspectingController.createTask(i.user, i.json, i.token),
    Lead_task: async (i) =>
      c.leadProspectingController.task(i.user, i.param['id']),
    Lead_startTask: async (i) =>
      c.leadProspectingController.startTask(i.user, i.param['id'], i.token),
    Lead_updateTaskTable: async (i) =>
      c.leadProspectingController.updateTaskTable(
        i.user,
        i.param['id'],
        i.json,
      ),
    Lead_removeTask: async (i) =>
      c.leadProspectingController.removeTask(i.user, i.param['id']),

    // ---------- 跨境电商商品页优化（PDP） ----------
    EcomPdp_meta: async (i) => c.ecomPdpController.meta(i.user),
    EcomPdp_page: async (i) => c.ecomPdpController.list(i.user, i.query),
    EcomPdp_detail: async (i) =>
      c.ecomPdpController.detail(i.user, i.param['id']),
    EcomPdp_create: async (i) => c.ecomPdpController.create(i.user, i.json),
    EcomPdp_plan: async (i) =>
      c.ecomPdpController.plan(i.user, i.param['id'], i.token),
    EcomPdp_updateAsset: async (i) =>
      c.ecomPdpController.updateAsset(
        i.user,
        i.param['id'],
        i.param['assetId'],
        i.json,
      ),
    EcomPdp_generate: async (i) =>
      c.ecomPdpController.generate(
        i.user,
        i.param['id'],
        i.param['assetId'],
        i.json,
        i.token,
      ),
    EcomPdp_remove: async (i) =>
      c.ecomPdpController.remove(i.user, i.param['id']),

    // ---------- 国内电商商品页优化（淘宝/天猫、京东、拼多多、抖音） ----------
    DomesticPdp_meta: async (i) => c.domesticPdpController.meta(i.user),
    DomesticPdp_page: async (i) =>
      c.domesticPdpController.list(i.user, i.query),
    DomesticPdp_detail: async (i) =>
      c.domesticPdpController.detail(i.user, i.param['id']),
    DomesticPdp_create: async (i) =>
      c.domesticPdpController.create(i.user, i.json),
    DomesticPdp_plan: async (i) =>
      c.domesticPdpController.plan(i.user, i.param['id'], i.token),
    DomesticPdp_updateAsset: async (i) =>
      c.domesticPdpController.updateAsset(
        i.user,
        i.param['id'],
        i.param['assetId'],
        i.json,
      ),
    DomesticPdp_generate: async (i) =>
      c.domesticPdpController.generate(
        i.user,
        i.param['id'],
        i.param['assetId'],
        i.json,
        i.token,
      ),
    DomesticPdp_remove: async (i) =>
      c.domesticPdpController.remove(i.user, i.param['id']),

    // ---------- 多平台内容分发（营销工具：AIPDD Enterprise 插件本地发布） ----------
    Distribution_meta: async (i) => c.distributionController.meta(i.user),
    Distribution_page: async (i) =>
      c.distributionController.list(i.user, i.query),
    Distribution_detail: async (i) =>
      c.distributionController.detail(i.user, i.param['id']),
    Distribution_create: async (i) =>
      c.distributionController.create(i.user, i.json),
    Distribution_update: async (i) =>
      c.distributionController.update(i.user, i.param['id'], i.json),
    Distribution_remove: async (i) =>
      c.distributionController.remove(i.user, i.param['id']),
    Distribution_mark: async (i) =>
      c.distributionController.mark(i.user, i.param['id']),
    Distribution_reportLogs: async (i) =>
      c.distributionController.reportLogs(i.user, i.param['id'], i.json),

    // ---------- 帮助中心（章节知识库：前端 /help 与 MCP 读同一份） ----------
    Help_chapters: async (i) => c.helpController.chapters(i.user),
    Help_topic: async (i) => c.helpController.topic(i.user, i.param['code']),
    Help_search: async (i) => c.helpController.search(i.user, i.query),

    // ---------- 大数据查询（营销工具：五个独立数据集） ----------
    Bigdata_settings: async (i) =>
      c.bigdataQueryController.settings(i.user, i.param['dataset'], i.token),
    Bigdata_saveSettings: async (i) =>
      c.bigdataQueryController.saveSettings(
        i.user,
        i.param['dataset'],
        i.json,
        i.token,
      ),
    Bigdata_createTable: async (i) =>
      c.bigdataQueryController.createTable(i.user, i.param['dataset'], i.json),
    Bigdata_tables: async (i) =>
      c.bigdataQueryController.tables(i.user, i.param['dataset']),
    Bigdata_models: async (i) =>
      c.bigdataQueryController.models(i.user, i.token),
    Bigdata_chat: async (i) =>
      c.bigdataQueryController.chat(
        i.user,
        i.param['dataset'],
        i.json,
        i.token,
      ),
    Bigdata_messages: async (i) =>
      c.bigdataQueryController.messages(i.user, i.param['dataset']),
    Bigdata_tasks: async (i) =>
      c.bigdataQueryController.listTasks(i.user, i.param['dataset'], i.query),
    Bigdata_createTask: async (i) =>
      c.bigdataQueryController.createTask(i.user, i.param['dataset'], i.json),
    Bigdata_task: async (i) =>
      c.bigdataQueryController.task(i.user, i.param['dataset'], i.param['id']),
    Bigdata_startTask: async (i) =>
      c.bigdataQueryController.startTask(
        i.user,
        i.param['dataset'],
        i.param['id'],
      ),
    Bigdata_updateTaskTable: async (i) =>
      c.bigdataQueryController.updateTaskTable(
        i.user,
        i.param['dataset'],
        i.param['id'],
        i.json,
      ),
    Bigdata_removeTask: async (i) =>
      c.bigdataQueryController.removeTask(
        i.user,
        i.param['dataset'],
        i.param['id'],
      ),

    // ---------- 阿里云智能外呼（营销工具） ----------
    AliyunCall_settings: async (i) => c.aliyunCallController.settings(i.user),
    AliyunCall_saveSettings: async (i) =>
      c.aliyunCallController.saveSettings(i.user, i.json),
    AliyunCall_test: async (i) => c.aliyunCallController.test(i.user),
    AliyunCall_instances: async (i) => c.aliyunCallController.instances(i.user),
    AliyunCall_scripts: async (i) =>
      c.aliyunCallController.scripts(i.user, i.query),
    AliyunCall_callingNumbers: async (i) =>
      c.aliyunCallController.callingNumbers(i.user, i.query),
    AliyunCall_jobGroups: async (i) =>
      c.aliyunCallController.jobGroups(i.user, i.query),
    AliyunCall_jobGroupStatus: async (i) =>
      c.aliyunCallController.jobGroupStatus(i.user, i.param['id'], i.query),
    AliyunCall_preview: async (i) =>
      c.aliyunCallController.preview(i.user, i.json),
    AliyunCall_createImport: async (i) =>
      c.aliyunCallController.createImport(i.user, i.json),
    AliyunCall_imports: async (i) =>
      c.aliyunCallController.listImports(i.user, i.query),
    AliyunCall_import: async (i) =>
      c.aliyunCallController.importDetail(i.user, i.param['id'], i.query),
    AliyunCall_retryImport: async (i) =>
      c.aliyunCallController.retryImport(i.user, i.param['id']),
    AliyunCall_refreshImport: async (i) =>
      c.aliyunCallController.refreshImport(i.user, i.param['id']),

    // ---------- 阿里云邮件推送（营销工具） ----------
    AliyunMail_settings: async (i) => c.aliyunMailController.settings(i.user),
    AliyunMail_saveSettings: async (i) =>
      c.aliyunMailController.saveSettings(i.user, i.json),
    AliyunMail_test: async (i) => c.aliyunMailController.test(i.user),
    AliyunMail_senderAddresses: async (i) =>
      c.aliyunMailController.senderAddresses(i.user),
    AliyunMail_receiverLists: async (i) =>
      c.aliyunMailController.receiverLists(i.user, i.query),
    AliyunMail_createReceiverList: async (i) =>
      c.aliyunMailController.createReceiverList(i.user, i.json),
    AliyunMail_preview: async (i) =>
      c.aliyunMailController.preview(i.user, i.json),
    AliyunMail_createImport: async (i) =>
      c.aliyunMailController.createImport(i.user, i.json),
    AliyunMail_imports: async (i) =>
      c.aliyunMailController.listImports(i.user, i.query),
    AliyunMail_import: async (i) =>
      c.aliyunMailController.importDetail(i.user, i.param['id'], i.query),
    AliyunMail_retryImport: async (i) =>
      c.aliyunMailController.retryImport(i.user, i.param['id']),
    AliyunMail_refreshImport: async (i) =>
      c.aliyunMailController.refreshImport(i.user, i.param['id']),

    // ---------- 智能体记忆（「工作台」栏目） ----------
    Agent_overview: async (i) => c.agentMemoryController.overview(i.user),
    Agent_events: async (i) => c.agentMemoryController.events(i.user, i.query),
    Agent_clear: async (i) => c.agentMemoryController.clear(i.user),
    Agent_grants: async (i) => c.agentMemoryController.grants(i.user),
    Agent_saveGrants: async (i) =>
      c.agentMemoryController.saveGrants(i.user, i.json),

    // ---------- 内容创作：模型设置与数字资产（「开放集成 → 模型设置」） ----------
    Content_settings: async (i) =>
      c.contentController.getSettings(i.user, i.token),
    Content_saveSettings: async (i) =>
      c.contentController.saveSettings(i.user, i.json, i.token),
    Content_saveChannel: async (i) =>
      c.contentController.saveChannel(i.user, i.json),
    Content_removeChannel: async (i) =>
      c.contentController.removeChannel(i.user, i.param['id']),
    Content_testChannel: async (i) =>
      c.contentController.testChannel(i.user, i.json, i.token),
    Content_models: async (i) =>
      c.contentController.models(i.user, i.query, i.token),
    Content_assets: async (i) =>
      c.contentController.listAssets(i.user, i.query),
    Content_digitalAssets: async (i) =>
      c.contentController.digitalAssetList(i.user, i.token, i.query),
    Content_digitalAssetLabels: async (i) =>
      c.contentController.digitalAssetLabels(i.user, i.token),
    Content_tagDigitalAsset: async (i) =>
      c.contentController.tagDigitalAsset(
        i.user,
        i.token,
        i.param['id'],
        i.json,
      ),
    Content_registerAsset: async (i) =>
      c.contentController.registerAsset(i.user, i.param['id'], i.token),
    // ---------- 共享资料（数字资产按账号共享给企业内用户） ----------
    Content_sharedAssets: async (i) => c.contentController.sharedAssets(i.user),
    Content_shareTargets: async (i) => c.contentController.shareTargets(i.user),
    Content_shareAsset: async (i) =>
      c.contentController.shareAsset(i.user, i.json),
    Content_unshareAsset: async (i) =>
      c.contentController.unshareAsset(i.user, i.param['id']),
    Content_jobs: async (i) => c.contentController.listJobs(i.user, i.query),
    Content_createJob: async (i) =>
      c.contentController.createJob(i.user, i.token, i.json),
    Content_job: async (i) => c.contentController.job(i.user, i.param['id']),
    Content_cancelJob: async (i) =>
      c.contentController.cancelJob(i.user, i.param['id']),
    Content_skills: async (i) => c.contentController.listSkills(i.user),
    Content_toggleSkill: async (i) =>
      c.contentController.toggleSkill(i.user, i.param['id'], i.json),
    Content_removeSkill: async (i) =>
      c.contentController.removeSkill(i.user, i.param['id']),
    Content_skillRevisions: async (i) =>
      c.contentController.skillRevisions(i.user, i.param['id']),
    Content_restoreSkill: async (i) =>
      c.contentController.restoreSkill(i.user, i.param['id'], i.json),
    Content_plugins: async (i) => c.contentController.listPlugins(i.user),
    Content_togglePlugin: async (i) =>
      c.contentController.togglePlugin(i.user, i.param['id'], i.json),
    Content_removePlugin: async (i) =>
      c.contentController.removePlugin(i.user, i.param['id']),
    Content_pluginRevisions: async (i) =>
      c.contentController.pluginRevisions(i.user, i.param['id']),
    Content_restorePlugin: async (i) =>
      c.contentController.restorePlugin(i.user, i.param['id'], i.json),
    Content_experts: async (i) => c.contentController.listExperts(i.user),
    Content_createExpert: async (i) =>
      c.contentController.createExpert(i.user, i.token, i.json),
    Content_removeExpert: async (i) =>
      c.contentController.removeExpert(i.user, i.param['id']),
    Content_connectors: async (i) => c.contentController.listConnectors(i.user),
    Content_createConnector: async (i) =>
      c.contentController.createConnector(i.user, i.json),
    Content_updateConnector: async (i) =>
      c.contentController.updateConnector(i.user, i.param['id'], i.json),
    Content_removeConnector: async (i) =>
      c.contentController.removeConnector(i.user, i.param['id']),
    Content_testConnector: async (i) =>
      c.contentController.testConnector(i.user, i.json),
    Content_conversations: async (i) =>
      c.contentController.listConversations(i.user),
    Content_createConversation: async (i) =>
      c.contentController.createConversation(i.user, i.json),
    Content_updateConversation: async (i) =>
      c.contentController.updateConversation(i.user, i.param['id'], i.json),
    Content_removeConversation: async (i) =>
      c.contentController.removeConversation(i.user, i.param['id']),
    Content_messages: async (i) =>
      c.contentController.messages(i.user, i.param['id']),
    Content_memories: async (i) => c.contentController.memories(i.user),
    Content_saveMemories: async (i) =>
      c.contentController.saveMemories(i.user, i.json),

    // ---------- 数字分身（一个账号多个风格 + 人设，记忆共用一套） ----------
    Content_personas: async (i) => c.contentController.personas(i.user),
    Content_createPersona: async (i) =>
      c.contentController.createPersona(i.user, i.json),
    Content_updatePersona: async (i) =>
      c.contentController.updatePersona(i.user, i.param['id'], i.json),
    Content_deletePersona: async (i) =>
      c.contentController.deletePersona(i.user, i.param['id']),

    // ---------- Agent 资料库（记忆页签里的文档检索） ----------
    Content_library: async (i) => c.contentController.listLibrary(i.user),
    Content_libraryAdd: async (i) =>
      c.contentController.libraryAdd(i.user, i.json),
    Content_libraryRemove: async (i) =>
      c.contentController.libraryRemove(i.user, i.param['id']),
    Content_libraryNodes: async (i) =>
      c.contentController.libraryNodes(i.user, i.param['id']),
    Content_librarySearch: async (i) =>
      c.contentController.librarySearch(i.user, i.token, i.json),
    Content_libraryPublish: async (i) =>
      c.contentController.libraryPublish(i.user, i.token, i.json),
    Content_libraryDrafts: async (i) =>
      c.contentController.libraryDrafts(i.user),
    Content_libraryDraftDecide: async (i) =>
      c.contentController.libraryDraftDecide(i.user, i.param['id'], i.json),

    // ---------- Agent 定时任务（到点把指令当一轮对话交给 Agent 执行） ----------
    Content_schedules: async (i) => c.contentController.listSchedules(i.user),
    Content_saveSchedule: async (i) =>
      c.contentController.saveSchedule(i.user, i.json),
    Content_updateSchedule: async (i) =>
      c.contentController.updateSchedule(i.user, i.param['id'], i.json),
    Content_removeSchedule: async (i) =>
      c.contentController.removeSchedule(i.user, i.param['id']),
    Content_scheduleRuns: async (i) =>
      c.contentController.scheduleRuns(i.user, i.param['id']),
    Content_runScheduleNow: async (i) =>
      c.contentController.runScheduleNow(i.user, i.token, i.param['id']),

    // ---------- Agent 助理（第三方消息通道 → 一轮对话 → 原路回消息） ----------
    Content_assistantChannels: async (i) =>
      c.contentController.listAssistantChannels(i.user),
    Content_saveAssistantChannel: async (i) =>
      c.contentController.saveAssistantChannel(i.user, i.json),
    Content_updateAssistantChannel: async (i) =>
      c.contentController.updateAssistantChannel(i.user, i.param['id'], i.json),
    Content_removeAssistantChannel: async (i) =>
      c.contentController.removeAssistantChannel(i.user, i.param['id']),
    Content_testAssistantChannel: async (i) =>
      c.contentController.testAssistantChannel(i.user, i.param['id']),
    Content_assistantMessages: async (i) =>
      c.contentController.assistantMessages(i.user, i.param['id']),

    // ---------- AI邮箱服务（「工作台」栏目） ----------
    Mail_accounts: async (i) => c.mailboxController.accounts(i.user),
    Mail_saveAccount: async (i) =>
      c.mailboxController.saveAccount(i.user, i.json),
    Mail_updateAccount: async (i) =>
      c.mailboxController.updateAccount(i.user, i.param['id'], i.json),
    Mail_removeAccount: async (i) =>
      c.mailboxController.removeAccount(i.user, i.param['id']),
    Mail_testAccount: async (i) =>
      c.mailboxController.testAccount(i.user, i.param['id']),
    Mail_messages: async (i) =>
      c.mailboxController.messages(i.user, i.param['id'], i.query),
    Mail_message: async (i) =>
      c.mailboxController.message(
        i.user,
        i.param['id'],
        i.param['key'],
        i.query,
      ),
    Mail_drafts: async (i) =>
      c.mailboxController.drafts(i.user, i.param['id'], i.query),
    Mail_saveDraft: async (i) =>
      c.mailboxController.saveDraft(i.user, i.param['id'], i.json),
    Mail_sendReply: async (i) =>
      c.mailboxController.sendReply(i.user, i.param['id'], i.json),
    Mail_scripts: async (i) => c.mailboxController.scripts(i.user, i.query),
    Mail_saveScript: async (i) =>
      c.mailboxController.saveScript(i.user, i.json),
    Mail_updateScript: async (i) =>
      c.mailboxController.updateScript(i.user, i.param['scriptId'], i.json),
    Mail_removeScript: async (i) =>
      c.mailboxController.removeScript(i.user, i.param['scriptId']),
    Mail_ledger: async (i) => c.mailboxController.ledger(i.user, i.query),
    // ---------- 系统消息 ----------
    Notifications_list: async (i) =>
      c.notificationController.list(i.user, i.query),
    Notifications_unread: async (i) => c.notificationController.unread(i.user),
    Notifications_read: async (i) =>
      c.notificationController.read(i.user, i.param['id']),
    Notifications_readAll: async (i) =>
      c.notificationController.readAll(i.user, i.json),
    Notifications_readSns: async (i) =>
      c.snsController.readSns(i.user, i.param['id']),
    // ---------- AIworkin 社交（SNS）私信 ----------
    Sns_sendMessage: async (i) => c.snsController.sendMessage(i.user, i.json),
    // ---------- 统一组织成员 ----------
    OrgStaff_workspace: async (i) =>
      c.orgStaffController.workspace(i.user, i.query),
    OrgStaff_search: async (i) => c.orgStaffController.search(i.user, i.query),
    OrgStaff_invite: async (i) => c.orgStaffController.invite(i.user, i.json),
    OrgStaff_update: async (i) =>
      c.orgStaffController.update(i.user, i.param['id'], i.json),
    OrgStaff_remove: async (i) =>
      c.orgStaffController.remove(i.user, i.param['id']),
    OrgStaff_decide: async (i) =>
      c.orgStaffController.decide(i.user, i.param['id'], i.json),
    // ---------- 职能管理（部门 / 岗位目录 + 赋给成员） ----------
    OrgStaff_functions: async (i) =>
      c.orgStaffController.functions(i.user, i.query),
    OrgStaff_saveDepartment: async (i) =>
      c.orgStaffController.saveDepartment(i.user, i.json),
    OrgStaff_removeDepartment: async (i) =>
      c.orgStaffController.removeDepartment(i.user, i.param['id'], i.query),
    OrgStaff_savePosition: async (i) =>
      c.orgStaffController.savePosition(i.user, i.json),
    OrgStaff_removePosition: async (i) =>
      c.orgStaffController.removePosition(i.user, i.param['id'], i.query),
    OrgStaff_assignFunctions: async (i) =>
      c.orgStaffController.assignFunctions(i.user, i.param['id'], i.json),
    // ---------- AI客服 ----------
    ServiceDesk_overview: async (i) => c.serviceDeskController.overview(i.user),
    ServiceDesk_settings: async (i) => c.serviceDeskController.settings(i.user),
    ServiceDesk_saveSettings: async (i) =>
      c.serviceDeskController.saveSettings(i.user, i.json),
    ServiceDesk_sites: async (i) => c.serviceDeskController.sites(i.user),
    ServiceDesk_saveSite: async (i) =>
      c.serviceDeskController.saveSite(i.user, i.json),
    ServiceDesk_removeSite: async (i) =>
      c.serviceDeskController.removeSite(i.user, i.param['id']),
    ServiceDesk_rotateSiteKey: async (i) =>
      c.serviceDeskController.rotateSiteKey(i.user, i.param['id']),
    ServiceDesk_uploadIcon: async (i) =>
      c.serviceDeskController.uploadIcon(i.user, i.json),
    ServiceDesk_channels: async (i) => c.serviceDeskController.channels(i.user),
    ServiceDesk_saveChannel: async (i) =>
      c.serviceDeskController.saveChannel(i.user, i.json),
    ServiceDesk_removeChannel: async (i) =>
      c.serviceDeskController.removeChannel(i.user, i.param['id']),
    ServiceDesk_testChannel: async (i) =>
      c.serviceDeskController.testChannel(i.user, i.param['id']),
    ServiceDesk_groups: async (i) => c.serviceDeskController.groups(i.user),
    ServiceDesk_saveGroup: async (i) =>
      c.serviceDeskController.saveGroup(i.user, i.json),
    ServiceDesk_removeGroup: async (i) =>
      c.serviceDeskController.removeGroup(i.user, i.param['id']),
    ServiceDesk_agents: async (i) => c.serviceDeskController.agents(i.user),
    ServiceDesk_saveAgent: async (i) =>
      c.serviceDeskController.saveAgent(i.user, i.json),
    ServiceDesk_removeAgent: async (i) =>
      c.serviceDeskController.removeAgent(i.user, i.param['id']),
    ServiceDesk_setStatus: async (i) =>
      c.serviceDeskController.setStatus(i.user, i.json),
    ServiceDesk_conversations: async (i) =>
      c.serviceDeskController.conversations(i.user, i.query),
    ServiceDesk_conversation: async (i) =>
      c.serviceDeskController.conversation(i.user, i.param['id']),
    ServiceDesk_send: async (i) =>
      c.serviceDeskController.send(i.user, i.param['id'], i.json),
    ServiceDesk_claim: async (i) =>
      c.serviceDeskController.claim(i.user, i.param['id']),
    ServiceDesk_transfer: async (i) =>
      c.serviceDeskController.transfer(i.user, i.param['id'], i.json),
    ServiceDesk_close: async (i) =>
      c.serviceDeskController.close(i.user, i.param['id'], i.json),
    ServiceDesk_aiSuggest: async (i) =>
      c.serviceDeskController.aiSuggest(i.user, i.param['id'], i.json),
    ServiceDesk_canned: async (i) => c.serviceDeskController.canned(i.user),
    ServiceDesk_saveCanned: async (i) =>
      c.serviceDeskController.saveCanned(i.user, i.json),
    ServiceDesk_removeCanned: async (i) =>
      c.serviceDeskController.removeCanned(i.user, i.param['id']),
    ServiceDesk_faqs: async (i) => c.serviceDeskController.faqs(i.user),
    ServiceDesk_saveFaq: async (i) =>
      c.serviceDeskController.saveFaq(i.user, i.json),
    ServiceDesk_removeFaq: async (i) =>
      c.serviceDeskController.removeFaq(i.user, i.param['id']),
    ServiceDesk_stats: async (i) =>
      c.serviceDeskController.stats(i.user, i.query),
    // ---------- 活码引流 ----------
    MarketingQr_domains: async (i) => c.livecodeController.domains(i.user),
    MarketingQr_domainCreate: async (i) =>
      c.livecodeController.domainCreate(i.user, i.json),
    MarketingQr_domainCheck: async (i) =>
      c.livecodeController.domainCheck(i.user, i.param['id']),
    MarketingQr_domainUpdate: async (i) =>
      c.livecodeController.domainUpdate(i.user, i.param['id'], i.json),
    MarketingQr_domainRemove: async (i) =>
      c.livecodeController.domainRemove(i.user, i.param['id']),
    MarketingQr_list: async (i) => c.livecodeController.list(i.user, i.query),
    MarketingQr_create: async (i) =>
      c.livecodeController.create(i.user, i.json),
    MarketingQr_get: async (i) =>
      c.livecodeController.get(i.user, i.param['id']),
    MarketingQr_update: async (i) =>
      c.livecodeController.update(i.user, i.param['id'], i.json),
    MarketingQr_remove: async (i) =>
      c.livecodeController.remove(i.user, i.param['id']),
    MarketingQr_entry: async (i) =>
      c.livecodeController.entry(i.user, i.param['id'], i.json),
    MarketingQr_switchDomain: async (i) =>
      c.livecodeController.switchDomain(i.user, i.param['id'], i.json),
    MarketingQr_childCreate: async (i) =>
      c.livecodeController.childCreate(i.user, i.param['id'], i.json),
    MarketingQr_childUpdate: async (i) =>
      c.livecodeController.childUpdate(
        i.user,
        i.param['id'],
        i.param['childId'],
        i.json,
      ),
    MarketingQr_childRemove: async (i) =>
      c.livecodeController.childRemove(
        i.user,
        i.param['id'],
        i.param['childId'],
      ),
    MarketingQr_stats: async (i) =>
      c.livecodeController.stats(i.user, i.param['id'], i.query),
    MarketingQr_scans: async (i) =>
      c.livecodeController.scans(i.user, i.param['id'], i.query),
    AdminMarketingQr_list: async (i) =>
      c.livecodeController.adminList(i.user, i.query),
    AdminMarketingQr_disable: async (i) =>
      c.livecodeController.adminDisable(i.user, i.param['id'], i.json),
  };

  /** CRM / BI 的处理器按 operationId 后缀直接对应控制器方法，参数顺序＝用户、路径参数、查询、请求体。 */
  const moduleHandlers = (
    prefix: string,
    controller: Record<string, unknown>,
  ): Record<string, Handler> => {
    const out: Record<string, Handler> = {};
    for (const operationId of Object.keys(endpoints)) {
      if (!operationId.startsWith(prefix)) continue;
      const suffix = operationId.slice(prefix.length);
      const methodName = suffix.charAt(0).toLowerCase() + suffix.slice(1);
      const definition = (
        endpoints as unknown as Record<
          string,
          {
            path: string;
            query: z.ZodObject<z.ZodRawShape>;
            body: z.ZodTypeAny;
          }
        >
      )[operationId];
      const paramNames = definition.path
        .split('/')
        .filter((segment) => segment.startsWith(':'))
        .map((segment) => segment.slice(1));
      out[operationId] = async (i) => {
        const fn = (
          controller as Record<string, (...args: unknown[]) => Promise<unknown>>
        )[methodName];
        if (typeof fn !== 'function') {
          throw new BusinessException(
            ErrorCode.BAD_REQUEST,
            `接口处理器缺失：${operationId}`,
          );
        }
        const args: unknown[] = [i.user];
        for (const name of paramNames) args.push(i.param[name]);
        if (Object.keys(definition.query.shape).length > 0) args.push(i.query);
        if (!definition.body.safeParse(undefined).success) args.push(i.json);
        const value = await fn.apply(controller, args);
        return {
          code: 0,
          message: 'ok',
          data: value === undefined ? null : value,
        };
      };
    }
    return out;
  };
  Object.assign(
    handlers,
    moduleHandlers(
      'Crm_',
      c.crmController as unknown as Record<string, unknown>,
    ),
    moduleHandlers('Bi_', c.biController as unknown as Record<string, unknown>),
    moduleHandlers(
      'LowCode_',
      c.lowcodeController as unknown as Record<string, unknown>,
    ),
    moduleHandlers(
      'Okr_',
      c.okrController as unknown as Record<string, unknown>,
    ),
    moduleHandlers('Oa_', c.oaController as unknown as Record<string, unknown>),
    moduleHandlers('Tp_', c.tpController as unknown as Record<string, unknown>),
    moduleHandlers(
      'QuestionHall_',
      c.questionHallController as unknown as Record<string, unknown>,
    ),
    moduleHandlers('Im_', c.imController as unknown as Record<string, unknown>),
    moduleHandlers(
      'SkillHub_',
      c.skillHubController as unknown as Record<string, unknown>,
    ),
    // 创意社区：面向用户的目录/运行/发布，与平台后台的审核、积分规则两组端点
    moduleHandlers(
      'Community_',
      c.communityController as unknown as Record<string, unknown>,
    ),
    moduleHandlers(
      'CommunityAdmin_',
      c.communityController as unknown as Record<string, unknown>,
    ),
  );

  // 内建应用里需要登录令牌的端点（AI 走模型设置、附件走 AIPDD 数字资产）：
  // moduleHandlers 不传 token，这里覆盖成显式处理器，参数顺序＝用户、路径参数、令牌、查询/请求体。
  // 请求体已由 Zod 契约校验过，这里只做类型收窄。
  Object.assign(handlers, {
    LowCode_aiFill: async (i) =>
      ok(
        await c.lowcodeController.aiFill(
          i.user,
          i.param['id'],
          i.token,
          i.json as unknown as { entityId: number; text: string },
        ),
      ),
    LowCode_aiAsk: async (i) =>
      ok(
        await c.lowcodeController.aiAsk(
          i.user,
          i.param['id'],
          i.token,
          i.json as unknown as { entityId: number; question: string },
        ),
      ),
    LowCode_aiSettings: async (i) =>
      ok(await c.lowcodeController.aiSettings(i.user, i.param['id'], i.token)),
    LowCode_aiChannels: async (i) =>
      ok(await c.lowcodeController.aiChannels(i.user, i.param['id'], i.token)),
    LowCode_aiModels: async (i) =>
      ok(
        await c.lowcodeController.aiModels(
          i.user,
          i.param['id'],
          i.token,
          i.query as unknown as { channelId: number },
        ),
      ),
    LowCode_assets: async (i) =>
      ok(
        await c.lowcodeController.assets(
          i.user,
          i.param['id'],
          i.token,
          i.query,
        ),
      ),
    LowCode_uploadAsset: async (i) =>
      ok(
        await c.lowcodeController.uploadAsset(
          i.user,
          i.param['id'],
          i.token,
          i.json as unknown as {
            name: string;
            contentType: string;
            contentBase64: string;
            fieldKey: string;
          },
        ),
      ),
    // AI 预审要用审批人本人的登录令牌取模型渠道，moduleHandlers 不传 token，这里显式覆盖。
    Oa_preReview: async (i) =>
      ok(await c.oaController.preReview(i.user, i.param['id'], i.token)),
  } satisfies Record<string, Handler>);

  registerCrmExportDownload(app, services);
  registerBiChatStream(app, services);

  for (const [operationId, handler] of Object.entries(handlers)) {
    // endpoints 已有数百条，直接索引联合类型会超过 TS 的比较复杂度上限；
    // 这里按 OpenAPI 路由所需的最小形状取值（契约本身仍由 definition 的类型校验）。
    const definition = (
      endpoints as unknown as Record<
        string,
        {
          method: 'get' | 'post' | 'put' | 'patch' | 'delete';
          path: string;
          params: z.ZodObject<z.ZodRawShape>;
          query: z.ZodObject<z.ZodRawShape>;
          body: z.ZodTypeAny;
          response: z.ZodTypeAny;
        }
      >
    )[operationId];
    const hasBody = !definition.body.safeParse(undefined).success;
    app.openapi(
      createRoute({
        method: definition.method,
        path: definition.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
        operationId,
        tags: [
          operationId.startsWith('OpenApi_')
            ? 'OpenApi'
            : operationId.split('_')[0],
        ],
        request: {
          params: definition.params,
          query: definition.query,
          ...(hasBody
            ? {
                body: {
                  required: true,
                  content: { 'application/json': { schema: definition.body } },
                },
              }
            : {}),
        },
        responses: {
          200: {
            description: 'Success',
            content: { 'application/json': { schema: definition.response } },
          },
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
          500: errorResponse,
          413: errorResponse,
          422: errorResponse,
          503: errorResponse,
        },
      }),
      async (context) => {
        const input: Input = {
          user: context.get('user')!,
          param: context.req.valid('param' as never) as Record<string, string>,
          query: context.req.valid('query' as never) as Record<string, unknown>,
          json: hasBody
            ? (context.req.valid('json' as never) as Record<string, unknown>)
            : {},
          // 只有真正用上游 Key 的端点才解析凭证：未绑定时其余端点照常可用（管理端本地查询不 403）
          token: UPSTREAM_TOKEN_OPERATIONS.has(operationId)
            ? await upstreamToken(context)
            : '',
        };
        const result = await handler(input);
        return context.json(
          serializeResponse(definition.response, result) as never,
          200,
        );
      },
    );
  }

  registerCsvExport(app, services);
  registerSkillHubDownload(app, services);
  registerContentUploads(app, services);
  registerCommunityInputUpload(app, services);
  registerContentDigitalAssetUpload(app, services);
  registerContentAgentStream(app, services);
  registerContentSkillImport(app, services);
  registerContentPluginImport(app, services);
}

/** 数字资产上传：multipart（文件 + type/name/labels 字段），上传后立即登记到平台。 */
function registerContentDigitalAssetUpload(
  app: OpenAPIHono<ApiEnv>,
  services: Services,
) {
  app.post(
    '/enterprise/content/digital-assets/upload',
    async (context: Context<ApiEnv>) => {
      const form = await context.req.formData();
      const file = form.get('file');
      if (!(file instanceof File)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '请选择要上传的资产文件',
        );
      }
      let labels: unknown = [];
      const rawLabels = form.get('labels');
      if (typeof rawLabels === 'string' && rawLabels.trim()) {
        try {
          labels = JSON.parse(rawLabels);
        } catch {
          labels = rawLabels.split(',');
        }
      }
      const result =
        await services.controllers.contentController.uploadDigitalAsset(
          context.get('user')!,
          await upstreamToken(context),
          file,
          {
            type: form.get('type'),
            name: form.get('name'),
            labels,
          },
        );
      return context.json(result);
    },
  );
}

/** 技能包上传走 multipart（zip 二进制），不进 JSON 契约。 */
function registerContentSkillImport(
  app: OpenAPIHono<ApiEnv>,
  services: Services,
) {
  app.post(
    '/enterprise/content/agent/skills/import',
    async (context: Context<ApiEnv>) => {
      const form = await context.req.formData();
      const file = form.get('file');
      if (!(file instanceof File)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '请选择要上传的 zip 技能包',
        );
      }
      const result = await services.controllers.contentController.importSkill(
        context.get('user')!,
        file,
      );
      return context.json(result);
    },
  );
}

/** 插件包上传走 multipart（zip 二进制），不进 JSON 契约。 */
function registerContentPluginImport(
  app: OpenAPIHono<ApiEnv>,
  services: Services,
) {
  app.post(
    '/enterprise/content/agent/plugins/import',
    async (context: Context<ApiEnv>) => {
      const form = await context.req.formData();
      const file = form.get('file');
      if (!(file instanceof File)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '请选择要上传的 zip 插件包',
        );
      }
      const result = await services.controllers.contentController.importPlugin(
        context.get('user')!,
        file,
      );
      return context.json(result);
    },
  );
}

/**
 * Agent 对话流：SSE 不是 JSON 契约（响应是 text/event-stream），单独登记。
 * 事件：delta / tool_start / tool_progress / tool_end / media / notice / done / error。
 *
 * 保活：图片、视频生成期间轮询要跑几分钟，中间一个字节都不写。
 * 反向代理会掐掉空闲连接（Next dev 的 proxyTimeout 默认 30 秒，Nginx 的
 * proxy_read_timeout 默认 60 秒），所以这里每 10 秒写一条 SSE 注释，工具运行中
 * 另外每 10 秒发一条 tool_progress。保活只影响「看得到进度」，
 * 这一轮的结论以落库为准，前端另有轮询兜底。
 */
function registerContentAgentStream(
  app: OpenAPIHono<ApiEnv>,
  services: Services,
) {
  app.post(
    '/enterprise/content/agent/conversations/:id/messages',
    async (context: Context<ApiEnv>) => {
      const user = context.get('user')!;
      const token = await upstreamToken(context);
      const id = context.req.param('id')!;
      const body = await context.req
        .json<Record<string, unknown>>()
        .catch(() => ({}));
      // 不把浏览器连接挂到这一轮上：生成动辄几分钟，断线不该把跑了一半的生成作废，
      // 只有「停止」（cancel 端点）能中断；跑完照常落库。请求级信号一并抹掉，
      // 否则出站调用仍会因为浏览器断开而集体中断。
      return streamSSE(context, async (stream) => {
        const emit = async (event: string, data: Record<string, unknown>) => {
          await stream.writeSSE({ event, data: JSON.stringify(data) });
        };
        const heartbeat = setInterval(() => {
          void stream.write(': ping\n\n').catch(() => undefined);
        }, SSE_HEARTBEAT_MS);
        try {
          await withoutRequestAbort(() =>
            services.controllers.contentController.streamAgent(
              user,
              token,
              id,
              body,
              emit,
            ),
          );
        } catch (error) {
          const message =
            error instanceof BusinessException
              ? error.message
              : '对话失败，请稍后重试';
          await emit('error', { message });
        } finally {
          clearInterval(heartbeat);
        }
      });
    },
  );
  app.post(
    '/enterprise/content/agent/conversations/:id/cancel',
    async (context: Context<ApiEnv>) => {
      const body: Record<string, unknown> = await context.req
        .json<Record<string, unknown>>()
        .catch(() => ({}));
      const runId = typeof body.runId === 'string' ? body.runId : undefined;
      const result = services.controllers.contentController.cancelAgent(
        context.get('user')!,
        context.req.param('id')!,
        runId,
      );
      return context.json(result);
    },
  );
}

/** 素材上传走 multipart，不进 JSON 契约：直接交给 AIPDD 数字资产云中转，返回公网直链。 */
function registerContentUploads(app: OpenAPIHono<ApiEnv>, services: Services) {
  app.post('/enterprise/content/uploads', async (context: Context<ApiEnv>) => {
    const form = await context.req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择要上传的文件');
    }
    const result = await services.controllers.contentController.upload(
      context.get('user')!,
      await upstreamToken(context),
      file,
    );
    return context.json({ code: 0, message: 'ok', data: result });
  });
}

/**
 * 创意社区运行表单的图片输入：multipart 不进 JSON 契约，单独登记。
 * 与内容创作的素材上传不同——这里必须落**本站自己的桶**：
 * 后端取字节时要按本站 OSS 域校验主机（不能把运行入口开成任意外链代理），
 * 所以不能走 AIPDD 数字资产云中转的那条通道。
 */
function registerCommunityInputUpload(
  app: OpenAPIHono<ApiEnv>,
  services: Services,
) {
  app.post(
    '/enterprise/community/uploads',
    async (context: Context<ApiEnv>) => {
      const form = await context.req.formData();
      const file = form.get('file');
      if (!(file instanceof File)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '请选择要上传的图片',
        );
      }
      const result = await services.controllers.communityController.uploadInput(
        context.get('user')!,
        {
          name: file.name,
          type: file.type,
          bytes: Buffer.from(await file.arrayBuffer()),
        },
      );
      return context.json({ code: 0, message: 'ok', data: result });
    },
  );
}

/** SkillHub 技能包下载返回 zip，不进 JSON 契约，单独登记。 */
function registerSkillHubDownload(
  app: OpenAPIHono<ApiEnv>,
  services: Services,
) {
  app.get(
    '/enterprise/skillhub/skills/:slug/download',
    async (context: Context<ApiEnv>) => {
      const result = await services.controllers.skillHubController.download(
        context.get('user')!,
        context.req.param('slug')!,
      );
      const filename = encodeURIComponent(result.filename);
      const body = result.bytes.buffer.slice(
        result.bytes.byteOffset,
        result.bytes.byteOffset + result.bytes.byteLength,
      ) as ArrayBuffer;
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${filename}`,
        },
      });
    },
  );
}

/** CSV 导出返回 text/csv，不进 JSON 契约，单独登记。 */
function registerCsvExport(app: OpenAPIHono<ApiEnv>, services: Services) {
  app.get(
    '/enterprise/data-tables/:id/export',
    async (context: Context<ApiEnv>) => {
      const result = await services.controllers.dataTableController.exportCsv(
        context.get('user')!,
        context.req.param('id')!,
      );
      const encodedFilename = encodeURIComponent(result.filename);
      return new Response(result.content, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`,
        },
      });
    },
  );
}

/** CRM 导出文件下载：CSV 不是 JSON 契约，单独登记。 */
function registerCrmExportDownload(
  app: OpenAPIHono<ApiEnv>,
  services: Services,
) {
  app.get(
    '/enterprise/crm/export-tasks/:id/download',
    async (context: Context<ApiEnv>) => {
      const result =
        await services.controllers.crmController.reportsService.download(
          context.get('user')!,
          context.req.param('id')!,
        );
      const content = toCsv(
        result.columns.map((item) => ({ key: item.key, label: item.label })),
        result.rows,
      );
      const filename = encodeURIComponent(result.fileName || 'crm-export.csv');
      return new Response(content, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${filename}`,
        },
      });
    },
  );
}

/** BI 智能问数流式输出：事件 status / result / error / done。 */
function registerBiChatStream(app: OpenAPIHono<ApiEnv>, services: Services) {
  app.post('/enterprise/bi/chat/stream', async (context: Context<ApiEnv>) => {
    const user = context.get('user')!;
    const body = await context.req
      .json<Record<string, unknown>>()
      .catch(() => ({}));
    return streamSSE(context, async (stream) => {
      const emit = async (event: string, data: Record<string, unknown>) => {
        await stream.writeSSE({ event, data: JSON.stringify(data) });
      };
      const heartbeat = setInterval(() => {
        void stream.write(': ping\n\n').catch(() => undefined);
      }, SSE_HEARTBEAT_MS);
      try {
        await withoutRequestAbort(() =>
          services.controllers.biController.chatService.stream(
            user,
            body,
            emit,
          ),
        );
      } finally {
        clearInterval(heartbeat);
      }
    });
  });
}
