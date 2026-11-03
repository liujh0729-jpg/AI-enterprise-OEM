import { CurrentUser } from '../auth/current-user';
import { ok, text } from '../common/api';
import { parseId } from '../common/parse-id';
import { AliyunMailService } from './aliyun-mail.service';

/** 阿里云邮件推送（营销工具）界面侧接口；设置与同步批次都按登录账号隔离。 */
export class AliyunMailController {
  constructor(private readonly service: AliyunMailService) {}

  async settings(user: CurrentUser) {
    return ok(await this.service.getSettings(user));
  }

  async saveSettings(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.service.saveSettings(user, body));
  }

  async test(user: CurrentUser) {
    return ok(await this.service.test(user));
  }

  async senderAddresses(user: CurrentUser) {
    return ok(await this.service.senderAddresses(user));
  }

  async receiverLists(user: CurrentUser, query: Record<string, unknown>) {
    return ok(await this.service.receiverLists(user, text(query.keyWord)));
  }

  async createReceiverList(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.service.createReceiverList(user, body));
  }

  async preview(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.service.preview(user, body));
  }

  async createImport(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.service.createImport(user, body));
  }

  async listImports(user: CurrentUser, query: Record<string, unknown>) {
    return ok(await this.service.listImports(user, query));
  }

  async importDetail(
    user: CurrentUser,
    id: string,
    query: Record<string, unknown>,
  ) {
    return ok(
      await this.service.importDetail(user, parseId(id, '同步批次 ID'), query),
    );
  }

  async retryImport(user: CurrentUser, id: string) {
    return ok(await this.service.retryImport(user, parseId(id, '同步批次 ID')));
  }

  async refreshImport(user: CurrentUser, id: string) {
    return ok(
      await this.service.refreshImport(user, parseId(id, '同步批次 ID')),
    );
  }
}
