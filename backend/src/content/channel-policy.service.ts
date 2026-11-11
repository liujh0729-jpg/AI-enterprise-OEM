import {
  CONTENT_CHANNEL_PRESETS,
  CONTENT_CHANNEL_PROVIDERS,
  CONTENT_MEDIA_TYPES,
  CONTENT_PRESET_DEFAULT_MEDIA_TYPES,
  isProviderSupported,
  type ContentChannelPolicy,
  type ContentChannelProvider,
  type ContentMediaType,
} from '@enterprise/contracts';
import { CurrentUser } from '../auth/current-user';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';

function isMediaType(value: unknown): value is ContentMediaType {
  return (
    typeof value === 'string' &&
    (CONTENT_MEDIA_TYPES as readonly string[]).includes(value)
  );
}

function isProvider(value: unknown): value is ContentChannelProvider {
  return (
    typeof value === 'string' &&
    (CONTENT_CHANNEL_PROVIDERS as readonly string[]).includes(value)
  );
}

function normalize(body: unknown): ContentChannelPolicy {
  const source =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const rawTypes =
    source.presetTypes &&
    typeof source.presetTypes === 'object' &&
    !Array.isArray(source.presetTypes)
      ? (source.presetTypes as Record<string, unknown>)
      : {};
  const presetTypes: Record<string, ContentMediaType> = {};
  for (const preset of CONTENT_CHANNEL_PRESETS) {
    const value = rawTypes[preset];
    presetTypes[preset] = isMediaType(value)
      ? value
      : CONTENT_PRESET_DEFAULT_MEDIA_TYPES[preset];
  }
  const disabledProviders = Array.isArray(source.disabledProviders)
    ? Array.from(new Set(source.disabledProviders.filter(isProvider)))
    : [];
  return {
    allowCustom:
      typeof source.allowCustom === 'boolean' ? source.allowCustom : true,
    presetTypes,
    disabledProviders,
  };
}

/** 读取渠道策略（无副作用，供内容/AI 网关等只读链路复用，不依赖 IdentityService）。 */
export async function readChannelPolicy(
  prisma: PrismaService,
): Promise<ContentChannelPolicy> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: ContentChannelPolicyService.KEY },
  });
  if (!row?.value) return normalize({});
  try {
    return normalize(JSON.parse(row.value));
  } catch {
    return normalize({});
  }
}

/**
 * 平台对用户算力渠道的统一策略（system_settings 单键 JSON）：
 * - allowCustom：用户还能不能新增自定义 OpenAI 兼容渠道，关闭后已有渠道仍可用；
 * - presetTypes：上游没有声明模型类型时，按渠道预设兜底归类，供默认模型槽位筛选；
 * - disabledProviders：平台管理员关闭的算力渠道（默认空＝全部支持），被关闭的渠道用户
 *   不能新增、也选不到；关闭 AIPDD 只影响算力，不影响业务服务的 API Key 链路。
 */
export class ContentChannelPolicyService {
  static readonly KEY = 'content_channel_policy';

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
  ) {}

  async view(): Promise<ContentChannelPolicy> {
    return readChannelPolicy(this.prisma);
  }

  async save(user: CurrentUser, body: unknown): Promise<ContentChannelPolicy> {
    const next = normalize(body);
    await this.prisma.systemSetting.upsert({
      where: { key: ContentChannelPolicyService.KEY },
      create: {
        key: ContentChannelPolicyService.KEY,
        value: JSON.stringify(next),
      },
      update: { value: JSON.stringify(next) },
    });
    await this.identity.audit(
      user.userId,
      '模型广场保存用户渠道策略',
      [
        next.allowCustom ? '允许自定义渠道' : '关闭自定义渠道',
        next.disabledProviders.length
          ? `关闭算力渠道：${next.disabledProviders.join('、')}`
          : '全部算力渠道可用',
      ].join('；'),
    );
    return next;
  }

  async allowCustom(): Promise<boolean> {
    return (await this.view()).allowCustom;
  }

  /** 某个算力渠道是否被平台开启支持（默认全部支持）。 */
  async supports(provider: string): Promise<boolean> {
    return isProviderSupported(await this.view(), provider);
  }

  /** 预设对应的兜底模型类型；不是已知预设时返回空串（保持上游声明）。 */
  async presetType(preset: string): Promise<ContentMediaType | ''> {
    if (!(CONTENT_CHANNEL_PRESETS as readonly string[]).includes(preset)) {
      return '';
    }
    const policy = await this.view();
    return policy.presetTypes[preset] || '';
  }
}
