import { ok } from '../common/api';
import { parseId } from '../common/parse-id';
import { CurrentUser } from '../auth/current-user';
import { SupplyService } from './supply.service';
/** 供销网络：服务站 / 商品(SPU·SKU) / 服务项目 / 订货单 / 预约单（其他费用由服务商按单据自由填写）。 */
export class SupplyController {
  constructor(private readonly supply: SupplyService) {}
  /* -------------------------------------------------------------- 服务站 */
  async bookingPage(user: CurrentUser, query: Record<string, unknown>) {
    return ok(await this.supply.bookingPage(user, query));
  }
  async bookingStats(user: CurrentUser) {
    return ok(await this.supply.bookingStats(user));
  }
  async bookingDetail(user: CurrentUser, id: string) {
    return ok(await this.supply.bookingDetail(user, parseId(id)));
  }
  async orderPage(user: CurrentUser, query: Record<string, unknown>) {
    return ok(await this.supply.orderPage(user, query));
  }
  async orderStats(user: CurrentUser) {
    return ok(await this.supply.orderStats(user));
  }
  async orderDetail(user: CurrentUser, id: string) {
    return ok(await this.supply.orderDetail(user, parseId(id)));
  }
  async stations(user: CurrentUser, provider?: string) {
    return ok(await this.supply.listStations(user, { provider }));
  }
  async createStation(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.supply.createStation(user, body));
  }
  async updateStation(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.supply.updateStation(user, parseId(id), body));
  }
  async removeStation(user: CurrentUser, id: string) {
    return ok(await this.supply.removeStation(user, parseId(id)));
  }
  /* ------------------------------------------------------- 商品 SPU / SKU */
  async products(user: CurrentUser, query: Record<string, string>) {
    return ok(await this.supply.listProducts(user, query));
  }
  async createProduct(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.supply.createProduct(user, body));
  }
  async updateProduct(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.supply.updateProduct(user, parseId(id), body));
  }
  async removeProduct(user: CurrentUser, id: string) {
    return ok(await this.supply.removeProduct(user, parseId(id)));
  }
  /** 设置商品可售站点（多站点归属）。 */
  async setProductStations(
    user: CurrentUser,
    id: string,
    body: {
      station_ids?: (number | string)[];
      stationIds?: (number | string)[];
    },
  ) {
    const raw = body.station_ids ?? body.stationIds ?? [];
    return ok(
      await this.supply.setProductStations(
        user,
        parseId(id),
        (Array.isArray(raw) ? raw : []).map((value) =>
          parseId(value, '服务站 ID'),
        ),
      ),
    );
  }
  /** 单站点独立上下架。 */
  async setProductStationStatus(
    user: CurrentUser,
    id: string,
    stationId: string,
    body: {
      status?: string;
    },
  ) {
    return ok(
      await this.supply.setProductStationStatus(
        user,
        parseId(id),
        parseId(stationId, '服务站 ID'),
        String(body.status || ''),
      ),
    );
  }
  async addSku(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return ok(await this.supply.addSku(user, parseId(id), body));
  }
  async updateSku(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.supply.updateSku(user, parseId(id), body));
  }
  async removeSku(user: CurrentUser, id: string) {
    return ok(await this.supply.removeSku(user, parseId(id)));
  }
  /* ----------------------------------------------------------- 服务项目 */
  async services(user: CurrentUser, query: Record<string, string>) {
    return ok(await this.supply.listServices(user, query));
  }
  async createService(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.supply.createService(user, body));
  }
  async updateService(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.supply.updateService(user, parseId(id), body));
  }
  async removeService(user: CurrentUser, id: string) {
    return ok(await this.supply.removeService(user, parseId(id)));
  }
  /* ------------------------------------------------------------- 订货单 */
  async orders(user: CurrentUser, query: Record<string, string>) {
    return ok(await this.supply.listOrders(user, query));
  }
  async createOrder(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.supply.createOrder(user, body));
  }
  async updateOrder(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.supply.updateOrder(user, parseId(id), body));
  }
  async removeOrder(user: CurrentUser, id: string) {
    return ok(await this.supply.removeOrder(user, parseId(id)));
  }
  async submitOrder(user: CurrentUser, id: string) {
    return ok(await this.supply.submitOrder(user, parseId(id)));
  }
  /** 服务商/承办职员报价：逐条缺货说明 + 承诺发货日期 + 其他费用（自行填写名称与金额）。 */
  async quoteOrder(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.supply.quoteOrder(user, parseId(id), body));
  }
  async confirmOrder(
    user: CurrentUser,
    id: string,
    body: {
      note?: string;
    },
  ) {
    return ok(
      await this.supply.confirmOrder(
        user,
        parseId(id),
        String(body.note || ''),
      ),
    );
  }
  /** 企业驳回（要求重新报价）。 */
  async returnOrder(
    user: CurrentUser,
    id: string,
    body: {
      note?: string;
    },
  ) {
    return ok(
      await this.supply.returnOrder(user, parseId(id), String(body.note || '')),
    );
  }
  async vetoOrder(
    user: CurrentUser,
    id: string,
    body: {
      note?: string;
    },
  ) {
    return ok(
      await this.supply.vetoOrder(user, parseId(id), String(body.note || '')),
    );
  }
  async cancelOrder(
    user: CurrentUser,
    id: string,
    body: {
      note?: string;
    },
  ) {
    return ok(
      await this.supply.cancelOrder(user, parseId(id), String(body.note || '')),
    );
  }
  /** 指派/取消指派承办职员（仅服务商账号）。 */
  async assignOrder(
    user: CurrentUser,
    id: string,
    body: {
      staff_user_id?: string;
      staffUserId?: string;
    },
  ) {
    return ok(
      await this.supply.assignOrder(
        user,
        parseId(id),
        String(body.staff_user_id ?? body.staffUserId ?? ''),
      ),
    );
  }
  async orderLogs(user: CurrentUser, id: string) {
    return ok(await this.supply.orderLogs(user, parseId(id)));
  }
  /* ------------------------------------------------------------- 预约单 */
  async bookings(user: CurrentUser, query: Record<string, string>) {
    return ok(await this.supply.listBookings(user, query));
  }
  async createBooking(user: CurrentUser, body: Record<string, unknown>) {
    return ok(await this.supply.createBooking(user, body));
  }
  async updateBooking(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.supply.updateBooking(user, parseId(id), body));
  }
  async removeBooking(user: CurrentUser, id: string) {
    return ok(await this.supply.removeBooking(user, parseId(id)));
  }
  async submitBooking(user: CurrentUser, id: string) {
    return ok(await this.supply.submitBooking(user, parseId(id)));
  }
  async quoteBooking(
    user: CurrentUser,
    id: string,
    body: Record<string, unknown>,
  ) {
    return ok(await this.supply.quoteBooking(user, parseId(id), body));
  }
  async confirmBooking(
    user: CurrentUser,
    id: string,
    body: {
      note?: string;
    },
  ) {
    return ok(
      await this.supply.confirmBooking(
        user,
        parseId(id),
        String(body.note || ''),
      ),
    );
  }
  async returnBooking(
    user: CurrentUser,
    id: string,
    body: {
      note?: string;
    },
  ) {
    return ok(
      await this.supply.returnBooking(
        user,
        parseId(id),
        String(body.note || ''),
      ),
    );
  }
  async vetoBooking(
    user: CurrentUser,
    id: string,
    body: {
      note?: string;
    },
  ) {
    return ok(
      await this.supply.vetoBooking(user, parseId(id), String(body.note || '')),
    );
  }
  async cancelBooking(
    user: CurrentUser,
    id: string,
    body: {
      note?: string;
    },
  ) {
    return ok(
      await this.supply.cancelBooking(
        user,
        parseId(id),
        String(body.note || ''),
      ),
    );
  }
  async assignBooking(
    user: CurrentUser,
    id: string,
    body: {
      staff_user_id?: string;
      staffUserId?: string;
    },
  ) {
    return ok(
      await this.supply.assignBooking(
        user,
        parseId(id),
        String(body.staff_user_id ?? body.staffUserId ?? ''),
      ),
    );
  }
  async bookingLogs(user: CurrentUser, id: string) {
    return ok(await this.supply.bookingLogs(user, parseId(id)));
  }
  /* --------------------------------------------------------- 平台监管 */
  /** 平台管理后台：单据总览 / 站点统计（需平台管理员）。 */
  async adminOverview(user: CurrentUser, query: Record<string, string>) {
    return ok(await this.supply.adminOverview(user, query));
  }
}
