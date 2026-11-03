import { ok } from '../common/api';
import { parseId } from '../common/parse-id';
import { CurrentUser } from '../auth/current-user';
import { assertDataset, BigdataQueryService } from './bigdata-query.service';

/**
 * 大数据查询（营销工具）界面侧接口（登录态）。
 * 路径里的 :dataset 决定用哪个数据集的设置 / 对话 / 任务 / 结果表，五个数据集互不相通。
 */
export class BigdataQueryController {
  constructor(private readonly bigdata: BigdataQueryService) {}

  async settings(user: CurrentUser, dataset: string, token?: string) {
    return ok(
      await this.bigdata.getSettings(user, assertDataset(dataset), token),
    );
  }

  async saveSettings(
    user: CurrentUser,
    dataset: string,
    body: Record<string, unknown>,
    token?: string,
  ) {
    return ok(
      await this.bigdata.save(user, assertDataset(dataset), body, token),
    );
  }

  async createTable(
    user: CurrentUser,
    dataset: string,
    body: Record<string, unknown>,
  ) {
    return ok(
      await this.bigdata.createDataTable(user, assertDataset(dataset), body),
    );
  }

  async tables(user: CurrentUser, dataset: string) {
    return ok(
      await this.bigdata.resultTableOptions(user, assertDataset(dataset)),
    );
  }

  async models(user: CurrentUser, token?: string) {
    return ok(await this.bigdata.models(user, token));
  }

  async chat(
    user: CurrentUser,
    dataset: string,
    body: Record<string, unknown>,
    token?: string,
  ) {
    return ok(
      await this.bigdata.chat(user, assertDataset(dataset), body, token),
    );
  }

  async messages(user: CurrentUser, dataset: string) {
    return ok(await this.bigdata.listMessages(user, assertDataset(dataset)));
  }

  async createTask(
    user: CurrentUser,
    dataset: string,
    body: Record<string, unknown>,
  ) {
    return ok(
      await this.bigdata.createTask(user, assertDataset(dataset), body),
    );
  }

  async listTasks(
    user: CurrentUser,
    dataset: string,
    query: { page?: number; pageSize?: number },
  ) {
    return ok(
      await this.bigdata.listTasks(user, assertDataset(dataset), query),
    );
  }

  async task(user: CurrentUser, dataset: string, id: string) {
    return ok(
      await this.bigdata.getTask(
        user,
        assertDataset(dataset),
        parseId(id, '任务 ID'),
      ),
    );
  }

  async startTask(user: CurrentUser, dataset: string, id: string) {
    return ok(
      await this.bigdata.start(
        user,
        assertDataset(dataset),
        parseId(id, '任务 ID'),
      ),
    );
  }

  async updateTaskTable(
    user: CurrentUser,
    dataset: string,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(
      await this.bigdata.updateTaskTable(
        user,
        assertDataset(dataset),
        parseId(id, '任务 ID'),
        body.dataTableId,
      ),
    );
  }

  async removeTask(user: CurrentUser, dataset: string, id: string) {
    return ok(
      await this.bigdata.removeTask(
        user,
        assertDataset(dataset),
        parseId(id, '任务 ID'),
      ),
    );
  }
}
