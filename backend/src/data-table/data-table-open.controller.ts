import { ok } from '../common/api';
import { parseId } from '../common/parse-id';
import { CurrentUser } from '../auth/current-user';
import { DataTableService } from './data-table.service';

/**
 * 多维表格机器通道（x-api-key）。
 *
 * 照搬参考实现 AIRecord 的 openapi rpa_data 能力：读表结构 + 行读写（不做建表/改列）。
 * 行数据以列键为键，脚本读一次 GET /:id 的结构即可拼出写入报文。
 * Key 属于哪个账号，脚本就能看到那个账号的多维表格（本人归属 + 被授权的表），
 * 四种操作各自受权限位约束。
 */
export class DataTableOpenController {
  constructor(private readonly table: DataTableService) {}

  async list(user: CurrentUser) {
    return ok(await this.table.list(user));
  }

  async structure(user: CurrentUser, id: string) {
    return ok(await this.table.get(user, parseId(id, '表格 ID')));
  }

  async rows(user: CurrentUser, id: string, limit?: number, offset?: number) {
    return ok(
      await this.table.listRowsByOffset(
        user,
        parseId(id, '表格 ID'),
        limit ?? 100,
        offset ?? 0,
      ),
    );
  }

  async createRow(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(
      await this.table.createRow(
        user,
        parseId(id, '表格 ID'),
        body.data ?? body,
      ),
    );
  }

  async createRows(user: CurrentUser, id: string, body: { rows?: unknown }) {
    return ok(
      await this.table.createRows(user, parseId(id, '表格 ID'), body.rows),
    );
  }

  async updateRow(
    user: CurrentUser,
    id: string,
    rowId: string,
    body: Record<string, unknown>,
  ) {
    return ok(
      await this.table.updateRow(
        user,
        parseId(id, '表格 ID'),
        parseId(rowId, '行 ID'),
        body.data ?? body,
      ),
    );
  }
}
