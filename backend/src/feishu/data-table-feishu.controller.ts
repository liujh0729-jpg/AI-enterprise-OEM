import { ok } from '../common/api';
import { parseId } from '../common/parse-id';
import { CurrentUser } from '../auth/current-user';
import { DataTableFeishuService } from './data-table-feishu.service';

/**
 * 多维表格 ↔ 飞书多维表格同步的界面侧入口。
 * 飞书事件回调（handleEvent）走公开路径，不需要登录态。
 */
export class DataTableFeishuController {
  constructor(private readonly sync: DataTableFeishuService) {}

  async list(user: CurrentUser, id: string) {
    return ok(await this.sync.list(user, parseId(id, '表格 ID')));
  }

  async save(user: CurrentUser, id: string, body: Record<string, unknown>) {
    const tableId = parseId(id, '表格 ID');
    const raw = body.sync_id ?? body.syncId;
    const syncId =
      raw === undefined || raw === null || raw === ''
        ? undefined
        : parseId(raw, '同步绑定 ID');
    return ok(await this.sync.save(user, tableId, body, syncId));
  }

  async remove(user: CurrentUser, id: string, syncId: string) {
    return ok(
      await this.sync.remove(
        user,
        parseId(id, '表格 ID'),
        parseId(syncId, '同步绑定 ID'),
      ),
    );
  }

  /** 连一次飞书，读回可选的数据表与列（配映射用）。 */
  async preview(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return ok(await this.sync.preview(user, parseId(id, '表格 ID'), body));
  }

  async test(user: CurrentUser, id: string, syncId: string) {
    return ok(
      await this.sync.test(
        user,
        parseId(id, '表格 ID'),
        parseId(syncId, '同步绑定 ID'),
      ),
    );
  }

  async run(user: CurrentUser, id: string, syncId: string) {
    return ok(
      await this.sync.run(
        user,
        parseId(id, '表格 ID'),
        parseId(syncId, '同步绑定 ID'),
      ),
    );
  }

  async logs(user: CurrentUser, id: string, syncId: string) {
    return ok(
      await this.sync.logs(
        user,
        parseId(id, '表格 ID'),
        parseId(syncId, '同步绑定 ID'),
      ),
    );
  }

  /** 飞书事件订阅回调：域名校验与记录变更都走这里，返回体直接给飞书。 */
  async handleEvent(token: string, body: Record<string, unknown>) {
    return this.sync.handleEvent(token, body);
  }
}
