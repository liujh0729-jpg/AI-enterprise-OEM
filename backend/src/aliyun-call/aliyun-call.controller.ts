import { CurrentUser } from '../auth/current-user';
import { ok, text } from '../common/api';
import { parseId } from '../common/parse-id';
import { AliyunCallService } from './aliyun-call.service';

/** 阿里云智能外呼（营销工具）界面侧接口；设置与批次都按登录账号隔离。 */
export class AliyunCallController {
  constructor(private readonly service: AliyunCallService) {}

  async settings(user: CurrentUser) {
    return ok(await this.service.getSettings(user));
  }

  async saveSettings(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.service.saveSettings(user, body));
  }

  async test(user: CurrentUser) {
    return ok(await this.service.test(user));
  }

  async instances(user: CurrentUser) {
    return ok(await this.service.instances(user));
  }

  async scripts(user: CurrentUser, query: Record<string, unknown>) {
    return ok(await this.service.scripts(user, text(query.instanceId)));
  }

  async callingNumbers(user: CurrentUser, query: Record<string, unknown>) {
    return ok(await this.service.callingNumbers(user, text(query.instanceId)));
  }

  async jobGroups(user: CurrentUser, query: Record<string, unknown>) {
    return ok(
      await this.service.jobGroups(user, {
        instanceId: text(query.instanceId),
        search: text(query.search),
        page: Number(query.page ?? 1),
        pageSize: Number(query.pageSize ?? 20),
      }),
    );
  }

  async jobGroupStatus(
    user: CurrentUser,
    id: string,
    query: Record<string, unknown>,
  ) {
    return ok(
      await this.service.jobGroupStatus(user, text(id), text(query.instanceId)),
    );
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
      await this.service.importDetail(user, parseId(id, '导入批次 ID'), query),
    );
  }

  async retryImport(user: CurrentUser, id: string) {
    return ok(await this.service.retryImport(user, parseId(id, '导入批次 ID')));
  }

  async refreshImport(user: CurrentUser, id: string) {
    return ok(
      await this.service.refreshImport(user, parseId(id, '导入批次 ID')),
    );
  }
}
