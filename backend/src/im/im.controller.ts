import { CurrentUser } from '../auth/current-user';
import { text } from '../common/api';
import { ImService } from './im.service';

type Row = Record<string, unknown>;

/**
 * IM 连接控制器：方法名与契约 Im_* 去掉前缀后一致（首字母小写），
 * 由 automation-routes 的 moduleHandlers 自动映射并统一包 envelope。
 */
export class ImController {
  constructor(private readonly service: ImService) {}

  connectors(user: CurrentUser) {
    return this.service.connectors(user);
  }

  saveConnector(user: CurrentUser, body: Row) {
    return this.service.saveConnector(user, body);
  }

  deleteConnector(user: CurrentUser, id: string) {
    return this.service.deleteConnector(user, id);
  }

  testConnector(user: CurrentUser, id: string) {
    return this.service.testConnector(user, id);
  }

  staffDirectory(user: CurrentUser, query: Record<string, unknown>) {
    return this.service.staffDirectory(user, text(query.connectorId));
  }

  members(user: CurrentUser, id: string) {
    return this.service.members(user, id);
  }

  importMembers(user: CurrentUser, id: string) {
    return this.service.importMembers(user, id);
  }

  linkMember(user: CurrentUser, id: string, body: Row) {
    return this.service.linkMember(user, id, body);
  }

  unlinkMember(user: CurrentUser, id: string, body: Row) {
    return this.service.unlinkMember(user, id, body);
  }

  inviteUnlinked(user: CurrentUser, id: string, body: Row) {
    return this.service.inviteUnlinked(user, id, body);
  }

  departments(user: CurrentUser, id: string) {
    return this.service.departments(user, id);
  }

  saveDeptLink(user: CurrentUser, id: string, body: Row) {
    return this.service.saveDeptLink(user, id, body);
  }

  bindings(user: CurrentUser, id: string) {
    return this.service.bindings(user, id);
  }

  saveBinding(user: CurrentUser, id: string, body: Row) {
    return this.service.saveBinding(user, id, body);
  }

  deleteBinding(user: CurrentUser, id: string, bindingId: string) {
    return this.service.deleteBinding(user, id, bindingId);
  }

  bindingTest(user: CurrentUser, id: string, body: Row) {
    return this.service.bindingTest(user, id, body);
  }

  syncNow(user: CurrentUser, id: string, body: Row) {
    return this.service.syncNow(user, id, body);
  }

  syncLogs(user: CurrentUser, id: string, query: Row) {
    return this.service.syncLogs(user, id, query);
  }

  retryEvent(user: CurrentUser, id: string, eventId: string) {
    return this.service.retryEvent(user, id, eventId);
  }

  notifyRules(user: CurrentUser, id: string) {
    return this.service.notifyRules(user, id);
  }

  saveNotifyRules(user: CurrentUser, id: string, body: Row) {
    return this.service.saveNotifyRules(user, id, body);
  }

  testNotify(user: CurrentUser, id: string, body: Row) {
    return this.service.testNotify(user, id, body);
  }

  approvalTemplates(user: CurrentUser, id: string) {
    return this.service.approvalTemplates(user, id);
  }

  publishApproval(user: CurrentUser, id: string, body: Row) {
    return this.service.publishApproval(user, id, body);
  }

  taskPublish(user: CurrentUser, id: string, body: Row) {
    return this.service.taskPublish(user, id, body);
  }

  overview(user: CurrentUser) {
    return this.service.overview(user);
  }

  /** 公开回调入口：飞书 url_verification 要原样回 challenge。 */
  handleEvent(provider: string, token: string, body: Row) {
    return this.service.handleEvent(provider, token, body);
  }
}
