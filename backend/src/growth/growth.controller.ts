import type { CurrentUser } from '../auth/current-user';
import type { FulfillmentAdvisorService } from './fulfillment-advisor.service';
import type { GrowthCockpitService } from './growth-cockpit.service';
import type { OperationRiskService } from './operation-risk.service';

type Row = Record<string, unknown>;

/** 增长驾驶舱控制器：方法名与契约 `Growth_*` 后缀一一对应。 */
export class GrowthController {
  constructor(
    private readonly cockpitService: GrowthCockpitService,
    private readonly risksService: OperationRiskService,
    private readonly advisorService: FulfillmentAdvisorService,
  ) {}

  cockpit(user: CurrentUser, query: Row) {
    return this.cockpitService.cockpit(user, query);
  }

  fulfillment(user: CurrentUser, query: Row) {
    return this.cockpitService.fulfillment(user, query);
  }

  risks(user: CurrentUser, query: Row) {
    return this.risksService.list(user, query);
  }

  scanRisks(user: CurrentUser) {
    return this.risksService.runScan(user);
  }

  fulfillmentAdvice(user: CurrentUser, query: Row) {
    return this.advisorService.advise(user, query);
  }

  dispatchFulfillment(user: CurrentUser, _query: Row, body: Row) {
    return this.advisorService.dispatch(user, body);
  }
}
