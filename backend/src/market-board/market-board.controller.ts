import { CurrentUser } from '../auth/current-user';
import { ok } from '../common/api';
import { MarketBoardService } from './market-board.service';
/**
 * 平台直连看板（财税 / 供销 / 出海）的「需求信息」与「服务发布」接口。
 * 发布走 AIworkin MCP 并把平台挂单号落本地台账（`market_listing_records`）；
 * 列表 / 明细按挂单号读回平台公开池，读不回（草稿 / 已下架）时用台账快照回显。
 */
export class MarketBoardController {
  constructor(private readonly board: MarketBoardService) {}
  async demands(
    user: CurrentUser,
    poolToken: string,
    domain: string,
    province?: string,
    city?: string,
    cursor?: string,
    pageSize = 20,
    subCategoryId?: string,
    scope?: 'all' | 'mine',
  ) {
    return ok(
      await this.board.listDemands(
        user,
        domain,
        poolToken,
        { province, city, categoryId: subCategoryId, scope },
        cursor,
        pageSize,
      ),
    );
  }
  async demandDetail(
    user: CurrentUser,
    poolToken: string,
    domain: string,
    id: string,
  ) {
    return ok(await this.board.detail(user, domain, id, poolToken, 'DEMAND'));
  }
  async serviceDetail(
    user: CurrentUser,
    poolToken: string,
    domain: string,
    id: string,
  ) {
    return ok(await this.board.detail(user, domain, id, poolToken, 'SUPPLY'));
  }
  async createDemand(
    user: CurrentUser,
    token: string,
    domain: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.board.createDemand(user, domain, body, token));
  }
  /** 一条自有需求的会话清单（一位回复方一条）；需求方在平台上只读，不提供回复入口。 */
  async demandMessages(
    user: CurrentUser,
    token: string,
    domain: string,
    id: string,
  ) {
    return ok(await this.board.demandMessages(user, domain, id, token));
  }
  async updateDemand(
    user: CurrentUser,
    token: string,
    domain: string,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.board.updateDemand(user, domain, id, body, token));
  }
  async removeDemand(
    user: CurrentUser,
    token: string,
    domain: string,
    id: string,
  ) {
    return ok(await this.board.removeDemand(user, domain, id, token));
  }
  async services(
    user: CurrentUser,
    poolToken: string,
    domain: string,
    province?: string,
    city?: string,
    cursor?: string,
    pageSize = 20,
    subCategoryId?: string,
    scope?: 'all' | 'mine',
  ) {
    return ok(
      await this.board.listServices(
        user,
        domain,
        poolToken,
        { province, city, categoryId: subCategoryId, scope },
        cursor,
        pageSize,
      ),
    );
  }
  /** 服务市集（七板块只读公开池）：列出全平台服务商在该板块已发布的服务；凭证由路由层传平台 Key。 */
  async marketplace(
    user: CurrentUser,
    poolToken: string,
    domain: string,
    province?: string,
    city?: string,
    cursor?: string,
    pageSize = 20,
  ) {
    return ok(
      await this.board.listMarketplace(
        user,
        domain,
        poolToken,
        { province, city },
        cursor,
        pageSize,
      ),
    );
  }
  /** 服务市集明细：只读公开池挂单，非属主。 */
  async marketplaceDetail(
    user: CurrentUser,
    poolToken: string,
    domain: string,
    id: string,
  ) {
    return ok(await this.board.marketplaceDetail(user, domain, id, poolToken));
  }
  async createService(
    user: CurrentUser,
    token: string,
    domain: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.board.createService(user, domain, body, token));
  }
  async updateService(
    user: CurrentUser,
    token: string,
    domain: string,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.board.updateService(user, domain, id, body, token));
  }
  async removeService(
    user: CurrentUser,
    token: string,
    domain: string,
    id: string,
  ) {
    return ok(await this.board.removeService(user, domain, id, token));
  }
}
