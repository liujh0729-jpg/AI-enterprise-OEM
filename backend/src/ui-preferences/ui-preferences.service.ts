import { UI_PREFERENCE_KEYS, type UiPreference } from '@enterprise/contracts';
import type { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { fromJson, toJsonInput } from '../common/json-input';
import type { PrismaService } from '../prisma/prisma.service';

/** 已登记的偏好键；未登记键拒绝读写，避免把任意 JSON 当配置塞进来。 */
const ALLOWED_KEYS = new Set<string>(UI_PREFERENCE_KEYS);

/** 账号级界面偏好（跨设备）：本轮只承载驾驶舱「快捷导航」。 */
export class UiPreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  private assertKey(key: string) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '未知的界面偏好键');
    }
  }

  async get(user: CurrentUser, key: string): Promise<UiPreference> {
    this.assertKey(key);
    const row = await this.prisma.userPreference.findUnique({
      where: { userId_key: { userId: user.userId, key } },
    });
    return {
      key,
      value: row ? fromJson<unknown>(row.value) : null,
      updatedAt: row ? row.updatedAt.toISOString() : null,
    };
  }

  async save(
    user: CurrentUser,
    key: string,
    body: { value: unknown },
  ): Promise<UiPreference> {
    this.assertKey(key);
    const value = toJsonInput(body?.value ?? {});
    const row = await this.prisma.userPreference.upsert({
      where: { userId_key: { userId: user.userId, key } },
      create: { userId: user.userId, key, value },
      update: { value },
    });
    return {
      key,
      value: fromJson<unknown>(row.value),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
