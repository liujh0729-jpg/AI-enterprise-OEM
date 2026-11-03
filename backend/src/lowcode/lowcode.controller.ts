import { CurrentUser } from '../auth/current-user';
import { LowCodeAiService } from './lowcode.ai.service';
import { LowCodeApprovalService } from './lowcode.approval.service';
import { LowCodeAssetsService } from './lowcode.assets.service';
import { LowCodeContentService } from './lowcode.content.service';
import { LowCodeRowService } from './lowcode.row.service';
import { LowCodeService } from './lowcode.service';

type PermissionInput = {
  resourceType: string;
  resourceId: string;
  actions: string[];
};

/**
 * 内建应用控制器：方法名必须与契约 operationId 去掉 `LowCode_` 后的后缀一致
 * （首字母小写），由 automation-routes 的 moduleHandlers 自动映射。
 * 需要登录令牌的端点（AI 与数字资产）另在路由里显式注册，见 lowcode 段。
 */
export class LowCodeController {
  constructor(
    readonly projectsService: LowCodeService,
    readonly contentService: LowCodeContentService,
    readonly rowsService: LowCodeRowService,
    readonly approvalsService: LowCodeApprovalService,
    readonly aiService: LowCodeAiService,
    readonly assetsService: LowCodeAssetsService,
  ) {}

  // ---------- 项目 ----------
  projects(
    user: CurrentUser,
    query: { scope?: string; type?: string; keyword?: string },
  ) {
    return this.projectsService.list(user, query);
  }
  projectTemplates(user: CurrentUser) {
    return this.projectsService.templates(user);
  }
  projectCreate(
    user: CurrentUser,
    body: {
      name: string;
      templateKey: string;
      description: string;
      orgType: string;
      orgUserId: string;
      icon: string;
    },
  ) {
    return this.projectsService.create(user, body);
  }
  projectDetail(user: CurrentUser, id: unknown) {
    return this.projectsService.detail(user, id);
  }
  projectUpdate(
    user: CurrentUser,
    id: unknown,
    body: {
      name?: string;
      description?: string;
      icon?: string;
      status?: string;
      settings?: Record<string, unknown>;
    },
  ) {
    return this.projectsService.update(user, id, body);
  }
  projectDelete(user: CurrentUser, id: unknown) {
    return this.projectsService.remove(user, id);
  }
  availableTables(user: CurrentUser, id: unknown) {
    return this.projectsService.availableTables(user, id);
  }

  // ---------- 成员与角色 ----------
  members(user: CurrentUser, id: unknown) {
    return this.projectsService.members(user, id);
  }
  memberCandidates(
    user: CurrentUser,
    id: unknown,
    query: { keyword?: string },
  ) {
    return this.projectsService.memberCandidates(user, id, query);
  }
  memberAdd(
    user: CurrentUser,
    id: unknown,
    body: { userIds: string[]; roleId: number },
  ) {
    return this.projectsService.memberAdd(user, id, body);
  }
  memberUpdate(
    user: CurrentUser,
    id: unknown,
    memberId: string,
    body: { roleId: number },
  ) {
    return this.projectsService.memberUpdate(user, id, memberId, body);
  }
  memberRemove(user: CurrentUser, id: unknown, memberId: string) {
    return this.projectsService.memberRemove(user, id, memberId);
  }
  roles(user: CurrentUser, id: unknown) {
    return this.projectsService.roles(user, id);
  }
  roleSave(
    user: CurrentUser,
    id: unknown,
    body: { id: number; key: string; name: string; description: string },
  ) {
    return this.projectsService.roleSave(user, id, body);
  }
  roleDelete(user: CurrentUser, id: unknown, roleId: string) {
    return this.projectsService.roleDelete(user, id, roleId);
  }
  rolePermissions(user: CurrentUser, id: unknown, roleId: string) {
    return this.projectsService.rolePermissions(user, id, roleId);
  }
  rolePermissionSave(
    user: CurrentUser,
    id: unknown,
    roleId: string,
    body: { permissions: PermissionInput[] },
  ) {
    return this.projectsService.rolePermissionSave(user, id, roleId, body);
  }
  dataRules(user: CurrentUser, id: unknown, query: { entityId?: number }) {
    return this.projectsService.dataRules(user, id, query);
  }
  dataRuleSave(
    user: CurrentUser,
    id: unknown,
    body: {
      id: number;
      entityId: number;
      roleId: number;
      field: string;
      op: string;
      value: string;
    },
  ) {
    return this.projectsService.dataRuleSave(user, id, body);
  }
  dataRuleDelete(user: CurrentUser, id: unknown, ruleId: string) {
    return this.projectsService.dataRuleDelete(user, id, ruleId);
  }

  // ---------- 实体与页面 ----------
  entities(user: CurrentUser, id: unknown) {
    return this.contentService.entities(user, id);
  }
  entitySave(
    user: CurrentUser,
    id: unknown,
    body: Parameters<LowCodeContentService['entitySave']>[2],
  ) {
    return this.contentService.entitySave(user, id, body);
  }
  entityDelete(user: CurrentUser, id: unknown, entityId: unknown) {
    return this.contentService.entityDelete(user, id, entityId);
  }
  entityFields(user: CurrentUser, id: unknown, entityId: unknown) {
    return this.contentService.entityFields(user, id, entityId);
  }
  entityFieldSave(
    user: CurrentUser,
    id: unknown,
    entityId: unknown,
    body: Parameters<LowCodeContentService['entityFieldSave']>[3],
  ) {
    return this.contentService.entityFieldSave(user, id, entityId, body);
  }
  entityFieldDelete(
    user: CurrentUser,
    id: unknown,
    entityId: unknown,
    fieldKey: unknown,
  ) {
    return this.contentService.entityFieldDelete(user, id, entityId, fieldKey);
  }
  pages(user: CurrentUser, id: unknown) {
    return this.contentService.pages(user, id);
  }
  pageSave(
    user: CurrentUser,
    id: unknown,
    body: Parameters<LowCodeContentService['pageSave']>[2],
  ) {
    return this.contentService.pageSave(user, id, body);
  }
  pageDelete(user: CurrentUser, id: unknown, pageId: unknown) {
    return this.contentService.pageDelete(user, id, pageId);
  }
  pageReorder(user: CurrentUser, id: unknown, body: { ids: number[] }) {
    return this.contentService.pageReorder(user, id, body);
  }

  // ---------- 行数据 ----------
  entityRows(
    user: CurrentUser,
    id: unknown,
    entityId: unknown,
    query: Parameters<LowCodeRowService['entityRows']>[3],
  ) {
    return this.rowsService.entityRows(user, id, entityId, query);
  }
  entityRow(user: CurrentUser, id: unknown, entityId: unknown, rowId: unknown) {
    return this.rowsService.entityRow(user, id, entityId, rowId);
  }
  entityRowCreate(
    user: CurrentUser,
    id: unknown,
    entityId: unknown,
    body: { data: Record<string, unknown> },
  ) {
    return this.rowsService.entityRowCreate(user, id, entityId, body);
  }
  entityRowUpdate(
    user: CurrentUser,
    id: unknown,
    entityId: unknown,
    rowId: unknown,
    body: { data: Record<string, unknown> },
  ) {
    return this.rowsService.entityRowUpdate(user, id, entityId, rowId, body);
  }
  entityRowDelete(
    user: CurrentUser,
    id: unknown,
    entityId: unknown,
    rowId: unknown,
  ) {
    return this.rowsService.entityRowDelete(user, id, entityId, rowId);
  }
  entityRowExport(
    user: CurrentUser,
    id: unknown,
    entityId: unknown,
    body: Parameters<LowCodeRowService['entityRowExport']>[3],
  ) {
    return this.rowsService.entityRowExport(user, id, entityId, body);
  }

  // ---------- 审批 ----------
  approvalFlows(user: CurrentUser, id: unknown, query: { entityId?: number }) {
    return this.approvalsService.flows(user, id, query);
  }
  approvalFlowSave(
    user: CurrentUser,
    id: unknown,
    body: Parameters<LowCodeApprovalService['flowSave']>[2],
  ) {
    return this.approvalsService.flowSave(user, id, body);
  }
  approvalFlowDelete(user: CurrentUser, id: unknown, flowId: unknown) {
    return this.approvalsService.flowDelete(user, id, flowId);
  }
  approvalSubmit(
    user: CurrentUser,
    id: unknown,
    body: {
      entityId: number;
      rowId: number;
      flowId: number;
      comment: string;
    },
  ) {
    return this.approvalsService.submit(user, id, body);
  }
  approvalTasks(
    user: CurrentUser,
    id: unknown,
    query: { page?: number; pageSize?: number; status?: 'PENDING' | 'DONE' },
  ) {
    return this.approvalsService.tasks(user, id, query);
  }
  approvalAct(
    user: CurrentUser,
    id: unknown,
    body: { taskId: number; action: 'APPROVE' | 'REJECT'; comment: string },
  ) {
    return this.approvalsService.act(user, id, body);
  }
  recordApproval(
    user: CurrentUser,
    id: unknown,
    entityId: unknown,
    rowId: unknown,
  ) {
    return this.approvalsService.recordApproval(user, id, entityId, rowId);
  }

  // ---------- AI（需要登录令牌，路由里显式注册） ----------
  aiFill(
    user: CurrentUser,
    id: unknown,
    token: string,
    body: { entityId: number; text: string },
  ) {
    return this.aiService.aiFill(user, id, token, body);
  }
  aiAsk(
    user: CurrentUser,
    id: unknown,
    token: string,
    body: { entityId: number; question: string },
  ) {
    return this.aiService.aiAsk(user, id, token, body);
  }
  aiSettings(user: CurrentUser, id: unknown, token: string) {
    return this.aiService.aiSettings(user, id, token);
  }
  aiSaveSettings(
    user: CurrentUser,
    id: unknown,
    body: { channelId: number; model: string },
  ) {
    return this.aiService.aiSaveSettings(user, id, body);
  }
  aiChannels(user: CurrentUser, id: unknown, token: string) {
    return this.aiService.aiChannels(user, id, token);
  }
  aiModels(
    user: CurrentUser,
    id: unknown,
    token: string,
    query: { channelId: number },
  ) {
    return this.aiService.aiModels(user, id, token, query);
  }

  // ---------- 数字资产（需要登录令牌，路由里显式注册） ----------
  assets(
    user: CurrentUser,
    id: unknown,
    token: string,
    query: Record<string, unknown>,
  ) {
    return this.assetsService.assets(user, id, token, query);
  }
  uploadAsset(
    user: CurrentUser,
    id: unknown,
    token: string,
    body: Parameters<LowCodeAssetsService['uploadAsset']>[3],
  ) {
    return this.assetsService.uploadAsset(user, id, token, body);
  }
}
