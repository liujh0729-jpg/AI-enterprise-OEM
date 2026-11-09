import type { CurrentUser } from '../auth/current-user';
import type { GrowthCockpitService } from './growth-cockpit.service';

type Row = Record<string, unknown>;

/** 增长驾驶舱控制器：方法名与契约 `Growth_*` 后缀一一对应。 */
export class GrowthController {
  constructor(private readonly cockpitService: GrowthCockpitService) {}

  cockpit(user: CurrentUser, query: Row) {
    return this.cockpitService.cockpit(user, query);
  }
}
