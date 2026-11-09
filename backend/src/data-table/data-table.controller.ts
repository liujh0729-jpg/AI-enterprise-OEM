import { ok, text } from '../common/api';
import { parseId } from '../common/parse-id';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { DataTableAiService } from './data-table-ai.service';
import { DataTableViewService } from './data-table-view.service';
import { DataTableService } from './data-table.service';

/** 多维表格（按账号归属，切身份看到同一份）：界面侧走这里，机器通道走 data-table-open.controller。 */
export class DataTableController {
  constructor(
    private readonly table: DataTableService,
    private readonly ai: DataTableAiService,
    private readonly views: DataTableViewService,
  ) {}

  async list(user: CurrentUser) {
    return ok(await this.table.list(user));
  }

  async create(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.table.create(user, body));
  }

  async get(user: CurrentUser, id: string) {
    return ok(await this.table.get(user, parseId(id, '表格 ID')));
  }

  async update(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return ok(await this.table.update(user, parseId(id, '表格 ID'), body));
  }

  async remove(user: CurrentUser, id: string) {
    return ok(await this.table.remove(user, parseId(id, '表格 ID')));
  }

  /** 授权名单与现状（访问 / 新增 / 修改 / 删除四个独立权限位）。 */
  async listGrants(user: CurrentUser, id: string) {
    return ok(await this.table.listGrants(user, parseId(id, '表格 ID')));
  }

  /** 保存授权：整张表的授权一次全量覆盖，四项都不勾＝收回该成员全部权限。 */
  async saveGrants(
    user: CurrentUser,
    id: string,
    body: { grants?: unknown } & Record<string, unknown>,
  ) {
    return ok(
      await this.table.saveGrants(
        user,
        parseId(id, '表格 ID'),
        body.grants ?? body,
      ),
    );
  }

  async addField(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return ok(await this.table.addField(user, parseId(id, '表格 ID'), body));
  }

  /** 批量建列：建表模板一次给全部列，服务端一趟校验、一趟写入。 */
  async addFields(
    user: CurrentUser,
    id: string,
    body: { fields?: unknown } & Record<string, unknown>,
  ) {
    if (!Array.isArray(body.fields)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请提交要新建的列清单',
      );
    }
    return ok(
      await this.table.addFields(
        user,
        parseId(id, '表格 ID'),
        body.fields as Record<string, unknown>[],
      ),
    );
  }

  async reorderFields(
    user: CurrentUser,
    id: string,
    body: { field_keys?: unknown; fieldKeys?: unknown },
  ) {
    const keys = body.field_keys ?? body.fieldKeys;
    return ok(
      await this.table.reorderFields(
        user,
        parseId(id, '表格 ID'),
        Array.isArray(keys) ? keys.map((item) => text(item)) : [],
      ),
    );
  }

  async updateField(
    user: CurrentUser,
    id: string,
    fieldId: string,
    body: Record<string, unknown>,
  ) {
    return ok(
      await this.table.updateField(
        user,
        parseId(id, '表格 ID'),
        parseId(fieldId, '列 ID'),
        body,
      ),
    );
  }

  async deleteField(user: CurrentUser, id: string, fieldId: string) {
    return ok(
      await this.table.deleteField(
        user,
        parseId(id, '表格 ID'),
        parseId(fieldId, '列 ID'),
      ),
    );
  }

  async listRows(
    user: CurrentUser,
    id: string,
    page?: number,
    pageSize?: number,
  ) {
    return ok(
      await this.table.listRows(
        user,
        parseId(id, '表格 ID'),
        page ?? 1,
        pageSize ?? 50,
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

  async deleteRow(user: CurrentUser, id: string, rowId: string) {
    return ok(
      await this.table.deleteRow(
        user,
        parseId(id, '表格 ID'),
        parseId(rowId, '行 ID'),
      ),
    );
  }

  /** 导出整张表为 CSV（UTF-8 + BOM，Excel 直接打开不乱码）。 */
  async exportCsv(user: CurrentUser, id: string) {
    return this.table.exportCsv(user, parseId(id, '表格 ID'));
  }

  /** AI 列：按提示词 + 取材列批量生成某列的值并写回（缺 Key 回落规则拼接）。 */
  async aiFillColumn(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.ai.fillColumn(user, parseId(id, '表格 ID'), body));
  }

  /** AI 问数：服务端先聚合全表再喂模型，返回结论与聚合口径。 */
  async aiAsk(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return ok(await this.ai.ask(user, parseId(id, '表格 ID'), body));
  }

  /** 一句话建表：返回列结构草稿（不落库），确认后另走新建表与批量建列。 */
  async aiPlanTable(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.ai.planTable(user, body));
  }

  /** AI 生成视图：按一句话给出网格 / 看板 / 汇总视图草稿。 */
  async aiPlanView(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.ai.planView(user, parseId(id, '表格 ID'), body));
  }

  async listViews(user: CurrentUser, id: string) {
    return ok(await this.views.list(user, parseId(id, '表格 ID')));
  }

  async saveView(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return ok(await this.views.save(user, parseId(id, '表格 ID'), body));
  }

  async removeView(user: CurrentUser, id: string, viewId: string) {
    return ok(
      await this.views.remove(
        user,
        parseId(id, '表格 ID'),
        parseId(viewId, '视图 ID'),
      ),
    );
  }
}
