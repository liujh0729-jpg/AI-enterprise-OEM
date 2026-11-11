import { CurrentUser } from '../auth/current-user';
import { UiPreferencesService } from './ui-preferences.service';

/** 账号级界面偏好控制器：与契约 UiPrefs_* 一一对应。 */
export class UiPreferencesController {
  constructor(private readonly service: UiPreferencesService) {}

  get(user: CurrentUser, key: string) {
    return this.service.get(user, key);
  }

  save(user: CurrentUser, key: string, body: { value: unknown }) {
    return this.service.save(user, key, body);
  }
}
