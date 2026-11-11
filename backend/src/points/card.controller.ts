import type { CurrentUser } from '../auth/current-user';
import type { Row } from '../gaps/gaps.helpers';
import type { CardTemplateService } from './card-template.service';
import type { CardService } from './card.service';

/**
 * 用户侧时长卡端点（契约 `Card_*`）：规格目录、我的卡、可用卡、兑换订单与扣量明细。
 * 登录态由 business 路由组统一校验，这里只转发；能否看到「已停用规格」由服务层按角色决定。
 */
export class CardController {
  constructor(
    private readonly cards: CardService,
    private readonly templateSvc: CardTemplateService,
  ) {}

  templates(user: CurrentUser) {
    return this.templateSvc.list(user, { admin: false });
  }

  /** 我持有的卡（含已用尽/已过期），兑换订单页与「我的时长卡」都读它。 */
  myCards(user: CurrentUser) {
    return this.cards.myCards(user.userId);
  }

  /** 仍可扣的卡（临期优先）：模型广场据此在零余额时放行试用按钮。 */
  usableCards(user: CurrentUser) {
    return this.cards.usableCards(user.userId);
  }

  orders(user: CurrentUser, query: Row) {
    return this.cards.orders(user.userId, query);
  }

  orderUsage(user: CurrentUser, orderNo: string, query: Row) {
    return this.cards.orderUsage(user.userId, orderNo, query);
  }

  exchangeByPoints(user: CurrentUser, body: Row) {
    return this.cards.exchangeByPoints(user, body);
  }

  createCashOrder(user: CurrentUser, body: Row, clientIp = '') {
    return this.cards.createCashOrder(user, body, clientIp);
  }

  queryOrder(user: CurrentUser, orderNo: string) {
    return this.cards.queryOrder(user, orderNo);
  }
}

/** 平台管理侧时长卡端点（契约 `AdminCard_*`）：规格目录维护与卡的撤销。 */
export class AdminCardController {
  constructor(
    private readonly cards: CardService,
    private readonly templateSvc: CardTemplateService,
  ) {}

  templates(user: CurrentUser) {
    return this.templateSvc.list(user, { admin: true });
  }

  saveTemplate(user: CurrentUser, body: Row) {
    return this.templateSvc.save(user, body);
  }

  removeTemplate(user: CurrentUser, code: string) {
    return this.templateSvc.disable(user, code);
  }

  revokeCard(user: CurrentUser, cardId: string, body: Row) {
    return this.cards.revoke(user, cardId, body);
  }
}
