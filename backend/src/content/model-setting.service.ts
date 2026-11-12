import {
  CONTENT_CHANNEL_PRESET_LABELS,
  CONTENT_CHANNEL_PROVIDER_LABELS,
  CONTENT_MEDIA_TYPE_LABELS,
  CONTENT_MEDIA_TYPES,
  isProviderSupported,
  type ContentChannelPolicy,
  type ContentMediaType,
  type ContentModel,
  type ContentModelChannel,
  type ContentModelSlot,
} from '@enterprise/contracts';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { loadChannelCredentials } from '../ai/ai-channels';
import { assertAiAllowed } from '../ai/ai-guard.service';
import { CurrentUser } from '../auth/current-user';
import { IdentityService } from '../identity/identity.service';
import { ModelKeyService } from '../aiworkin/model-key.service';
import { PrismaService } from '../prisma/prisma.service';
import { ContentCrypto, maskSecret } from './content-crypto';
import { DOUBAO_ASR_VARIANTS } from './openspeech.client';
import { ContentModelCatalogService } from './model-catalog.service';
import { ContentChannelPolicyService } from './channel-policy.service';
import { LOCALAPI_CHANNEL_ID, localApiBaseUrl } from '../model-plaza/localapi';
import {
  platformModelFor,
  PLATFORM_CAPABILITIES,
} from '../model-plaza/platform-defaults.service';
import {
  aipddBaseUrl,
  assertBaseUrl,
  assertMediaType,
  assertPreset,
  assertProvider,
  isPreset,
  mediakitDefaultBaseUrl,
  presetBaseUrl,
  presetProtocol,
  volcengineDefaultBaseUrl,
} from './content-shared';

const CHANNEL_NAME_MAX = 64;

type ResolvedTarget = {
  baseUrl: string;
  apiKey: string;
  provider: 'aipdd' | 'localapi' | 'custom' | 'volcengine' | 'mediakit';
  protocol: 'openai' | 'anthropic';
  asrProtocol?: 'openspeech' | 'openai';
  model: string;
  channelId: number;
};

type ChannelRow = {
  id: number;
  provider: string;
  name: string;
  baseUrl: string;
  keyCipher: string;
  asrKeyCipher?: string;
  preset?: string;
  enabled: boolean;
};

/** 模型广场目录行 → 内容创作槽位口径（LocalAPI 渠道的候选模型）。 */
function plazaModelSlot(row: {
  modelKey: string;
  displayName: string;
  endpoints: unknown;
  modalities: unknown;
}) {
  const endpoints = Array.isArray(row.endpoints)
    ? row.endpoints.map((item) => text(item)).filter(Boolean)
    : [];
  const modalities = (row.modalities || {}) as {
    input?: unknown;
    output?: unknown;
  };
  const inputs = Array.isArray(modalities.input)
    ? modalities.input.map((item) => text(item))
    : [];
  const has = (endpoint: string) => endpoints.includes(endpoint);
  const kind =
    has('/images/generations') || has('/images/edits')
      ? 'image'
      : has('/videos')
        ? 'video'
        : has('/audio/speech')
          ? 'audio'
          : has('/audio/transcriptions')
            ? 'asr'
            : has('/embeddings')
              ? 'embedding'
              : has('/chat/completions')
                ? 'text'
                : 'other';
  return {
    id: row.modelKey,
    kind,
    vision: kind === 'text' && inputs.includes('image'),
    endpoints,
  };
}

/**
 * 自定义 OpenAI 兼容渠道的模型兜底：上游没声明 kind 时，按平台为该预设配置的
 * 模型类型归类；vision 仍算文本模型，只是同时带视觉标记。
 */
function applyPresetMediaType(
  models: ContentModel[],
  mediaType: ContentMediaType | '',
) {
  if (!mediaType) return models;
  return models.map((model) => {
    if (model.kind !== 'other') return model;
    return mediaType === 'vision'
      ? { ...model, kind: 'text', vision: true }
      : { ...model, kind: mediaType, vision: false };
  });
}

/**
 * 内容创作的模型设置：渠道（AIPDD / 自定义 OpenAI 兼容 / 火山 MediaKit）+
 * 每种类型的默认模型。
 * AIPDD 的 Key 优先取本账号在模型设置里单独保存的那把，其次「API Key 管理」里的 sk- Key；
 * 其余渠道的 Key 走 ContentCrypto 加密，接口只回掩码。
 */
export class ContentModelSettingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly modelKeys: ModelKeyService,
    private readonly crypto: ContentCrypto,
    private readonly catalog: ContentModelCatalogService,
    private readonly channelPolicy: ContentChannelPolicyService,
  ) {}

  /** AIPDD 渠道：不单独配 Key，直接用当前用户绑定的 AIPDD APIKey（设计 3.4）。 */
  aipddKey(user: CurrentUser, token?: string) {
    return this.modelKeys.requireKey(token);
  }

  private view(
    row: ChannelRow & { verifiedAt?: Date | null },
    policy?: ContentChannelPolicy,
  ): ContentModelChannel {
    const keyReady = Boolean(row.keyCipher);
    const verified = Boolean(row.verifiedAt);
    const provider =
      row.provider === 'mediakit'
        ? 'mediakit'
        : row.provider === 'volcengine'
          ? 'volcengine'
          : 'custom';
    const supported = isProviderSupported(policy, provider);
    const available = supported && row.enabled && keyReady && verified;
    return {
      id: row.id,
      provider,
      name: row.name,
      baseUrl: row.baseUrl,
      keyMasked: row.keyCipher
        ? maskSecret(this.crypto.decrypt(row.keyCipher))
        : '',
      asrKeyMasked: row.asrKeyCipher
        ? maskSecret(this.crypto.decrypt(row.asrKeyCipher))
        : '',
      preset: row.preset || '',
      enabled: row.enabled,
      verified,
      available,
      unavailableReason: available
        ? ''
        : !supported
          ? '平台管理员已关闭该算力渠道'
          : !row.enabled
            ? '渠道已停用'
            : !keyReady
              ? '未配置 API Key'
              : '尚未通过连通校验，请在渠道里点「测试连通」',
    };
  }

  async settings(user: CurrentUser, token?: string) {
    const [rows, slotRows, policy] = await Promise.all([
      this.prisma.contentModelChannel.findMany({
        where: { userId: user.userId },
        orderBy: { id: 'asc' },
      }),
      this.prisma.contentModelSlot.findMany({
        where: { userId: user.userId },
      }),
      this.channelPolicy.view(),
    ]);
    const localAipdd = rows.find((row) => row.provider === 'aipdd');
    // AIPDD 不读渠道本地 Key，只看当前用户绑定的 AIPDD APIKey（未绑定即未配置）
    const key = this.modelKeys.status(token);
    const aipddSupported = isProviderSupported(policy, 'aipdd');
    const localapiSupported = isProviderSupported(policy, 'localapi');
    const slots: ContentModelSlot[] = CONTENT_MEDIA_TYPES.map((mediaType) => {
      const row = slotRows.find((item) => item.mediaType === mediaType);
      return {
        mediaType,
        channelId: row?.channelId || 0,
        model: row?.model || '',
      };
    });
    return {
      channels: [
        {
          id: 0,
          provider: 'aipdd' as const,
          name: 'AIPDD',
          baseUrl: aipddBaseUrl(),
          keyMasked: key.keyMasked,
          asrKeyMasked: '',
          preset: 'aipdd',
          enabled: aipddSupported,
          verified: key.configured,
          available: aipddSupported && key.configured,
          unavailableReason: !aipddSupported
            ? '平台管理员已关闭 AIPDD 算力渠道'
            : key.configured
              ? ''
              : '当前账号还没有绑定 AIPDD API Key',
        },
        {
          id: LOCALAPI_CHANNEL_ID,
          provider: 'localapi' as const,
          name: 'LocalAPI',
          baseUrl: localApiBaseUrl(),
          keyMasked: '',
          asrKeyMasked: '',
          preset: 'localapi',
          enabled: localapiSupported,
          verified: true,
          available: localapiSupported,
          unavailableReason: localapiSupported
            ? ''
            : '平台管理员已关闭该算力渠道',
        },
        ...rows
          .filter((row) => row.provider !== 'aipdd')
          .map((row) =>
            this.view(row as ChannelRow & { verifiedAt?: Date | null }, policy),
          ),
      ],
      slots,
      aipdd: {
        baseUrl: aipddBaseUrl(),
        configured: key.configured,
        keyMasked: key.keyMasked,
        localChannelId: localAipdd?.id || 0,
      },
      policy,
    };
  }

  async saveSettings(
    user: CurrentUser,
    body: Record<string, unknown>,
    token?: string,
  ) {
    const rows = await this.prisma.contentModelChannel.findMany({
      where: { userId: user.userId },
      select: {
        id: true,
        provider: true,
        enabled: true,
        keyCipher: true,
        verifiedAt: true,
      },
    });
    const aipddKey = this.modelKeys.status(token);
    const policy = await this.channelPolicy.view();
    const byId = new Map(rows.map((row) => [row.id, row]));
    const rawSlots = Array.isArray(body.slots) ? body.slots : [];
    for (const item of rawSlots) {
      if (!item || typeof item !== 'object') continue;
      const slot = item as Record<string, unknown>;
      const mediaType = assertMediaType(slot.mediaType);
      const channelId = Number(slot.channelId || 0);
      if (!Number.isInteger(channelId) || channelId < LOCALAPI_CHANNEL_ID) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '渠道编号无效');
      }
      if (
        (channelId === 0 && !isProviderSupported(policy, 'aipdd')) ||
        (channelId === LOCALAPI_CHANNEL_ID &&
          !isProviderSupported(policy, 'localapi'))
      ) {
        // 内置虚拟渠道（0=AIPDD / -1=LocalAPI）被平台关闭时不能选作默认模型
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          channelId === 0
            ? '平台管理员已关闭 AIPDD 算力渠道，不能选作默认模型'
            : '平台管理员已关闭 LocalAPI 算力渠道，不能选作默认模型',
        );
      }
      if (channelId === 0 && !aipddKey.configured) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          'AIPDD 渠道还没有可用的 API Key，请先在「API Key 管理」生成一把，或改用 LocalAPI',
        );
      }
      if (channelId > 0) {
        const channel = byId.get(channelId);
        if (!channel) {
          throw new BusinessException(
            ErrorCode.BAD_REQUEST,
            '所选渠道已不存在，请刷新后重选',
          );
        }
        if (
          !isProviderSupported(
            policy,
            channel.provider === 'volcengine'
              ? 'volcengine'
              : channel.provider === 'mediakit'
                ? 'mediakit'
                : 'custom',
          )
        ) {
          throw new BusinessException(
            ErrorCode.BAD_REQUEST,
            '该渠道已被平台管理员关闭，不能选作默认模型',
          );
        }
        if (!channel.enabled || !channel.keyCipher) {
          throw new BusinessException(
            ErrorCode.BAD_REQUEST,
            '所选渠道还没有配置好 API Key，不能作为默认模型',
          );
        }
        if (!channel.verifiedAt) {
          throw new BusinessException(
            ErrorCode.BAD_REQUEST,
            '所选渠道尚未通过连通校验，请先在「模型设置 → 渠道」里点「测试连通」',
          );
        }
      }
      const model = text(slot.model).trim().slice(0, 128);
      await this.prisma.contentModelSlot.upsert({
        where: {
          userId_mediaType: { userId: user.userId, mediaType },
        },
        create: { userId: user.userId, mediaType, channelId, model },
        update: { channelId, model },
      });
    }
    await this.identity.audit(user.userId, '内容创作保存模型设置', '默认模型');
    return this.settings(user, token);
  }

  async saveChannel(user: CurrentUser, body: Record<string, unknown>) {
    const provider = assertProvider(body.provider);
    if (provider === 'localapi') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        'LocalAPI 是内置渠道，无需新增；直接在默认模型里选择即可',
      );
    }
    const policy = await this.channelPolicy.view();
    // 平台管理员关闭的算力渠道：既不能新增，也不能改（避免绕过闸门换 Key/地址）
    if (!isProviderSupported(policy, provider)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `平台管理员已关闭「${CONTENT_CHANNEL_PROVIDER_LABELS[provider]}」算力渠道，无法新增或修改`,
      );
    }
    if (provider === 'custom' && Number(body.id || 0) <= 0) {
      if (!policy.allowCustom) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '平台管理员已关闭新增自定义 OpenAI 兼容渠道；可继续使用 AIPDD 或 LocalAPI，或联系平台管理员开启后再试',
        );
      }
    }
    // 预设只对「自定义 OpenAI 兼容」渠道有意义：OpenAI / Claude / DeepSeek …
    // 决定默认地址和协议（Claude 走 Anthropic 原生 /messages）
    const preset = provider === 'custom' ? assertPreset(body.preset) : '';
    // AIPDD 允许在本账号单独保存一把 Key（优先于「API Key 管理」里的 Key；两处都没有才算未配置）
    const name =
      provider === 'aipdd'
        ? 'AIPDD'
        : text(body.name).trim().slice(0, CHANNEL_NAME_MAX) ||
          (provider === 'mediakit'
            ? '火山 AI MediaKit'
            : provider === 'volcengine'
              ? '火山引擎'
              : preset && preset !== 'custom'
                ? (isPreset(preset)
                    ? CONTENT_CHANNEL_PRESET_LABELS[preset]
                    : '') || 'OpenAI 兼容渠道'
                : 'OpenAI 兼容渠道');
    const baseUrl =
      provider === 'aipdd'
        ? aipddBaseUrl()
        : provider === 'mediakit'
          ? assertBaseUrl(
              text(body.baseUrl) || mediakitDefaultBaseUrl(),
              provider,
            )
          : provider === 'volcengine'
            ? assertBaseUrl(
                text(body.baseUrl) || volcengineDefaultBaseUrl(),
                provider,
              )
            : assertBaseUrl(
                text(body.baseUrl) || presetBaseUrl(preset),
                provider,
              );
    const apiKey = text(body.apiKey).trim();
    const id = Number(body.id || 0);
    const existing =
      id > 0
        ? await this.prisma.contentModelChannel.findFirst({
            where: { id, userId: user.userId },
          })
        : await this.prisma.contentModelChannel.findFirst({
            where: { userId: user.userId, provider, name },
          });
    if (id > 0 && !existing) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '渠道不存在');
    }
    // AIPDD 渠道不保存单独 Key，始终取账号在「API Key 管理」里的 Key
    const keyCipher =
      provider === 'aipdd'
        ? ''
        : apiKey
          ? this.crypto.encrypt(apiKey)
          : (existing?.keyCipher ?? '');
    const asrApiKey = text(body.asrApiKey).trim();
    const asrKeyCipher = asrApiKey
      ? this.crypto.encrypt(asrApiKey)
      : (existing?.asrKeyCipher ?? '');
    // 换 Key / 换地址 / 换协议都要重新校验，旧渠道的「已验证」不能沿用
    const credentialsChanged = Boolean(
      apiKey ||
      (existing &&
        (existing.baseUrl !== baseUrl ||
          existing.preset !== (preset || '') ||
          existing.provider !== provider ||
          Boolean(asrApiKey))),
    );
    const verifiedAt = credentialsChanged
      ? null
      : (existing?.verifiedAt ?? null);
    const row = existing
      ? await this.prisma.contentModelChannel.update({
          where: { id: existing.id },
          data: {
            name,
            baseUrl,
            keyCipher,
            asrKeyCipher,
            provider,
            preset,
            verifiedAt,
          },
        })
      : await this.prisma.contentModelChannel.create({
          data: {
            userId: user.userId,
            provider,
            name,
            baseUrl,
            keyCipher,
            asrKeyCipher,
            preset,
            verifiedAt,
          },
        });
    await this.identity.audit(
      user.userId,
      '内容创作保存模型渠道',
      `${row.name}（${provider}）`,
    );
    return this.view(row);
  }

  async removeChannel(user: CurrentUser, id: string) {
    const channelId = Number(id);
    if (!Number.isInteger(channelId) || channelId <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '渠道编号无效');
    }
    const existing = await this.prisma.contentModelChannel.findFirst({
      where: { id: channelId, userId: user.userId },
    });
    if (!existing) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '渠道不存在');
    }
    await this.prisma.$transaction([
      this.prisma.contentModelChannel.delete({ where: { id: channelId } }),
      this.prisma.contentModelSlot.updateMany({
        where: { userId: user.userId, channelId },
        data: { channelId: 0, model: '' },
      }),
    ]);
    await this.identity.audit(
      user.userId,
      '内容创作删除模型渠道',
      existing.name,
    );
    return { removed: true };
  }

  /** 取某个渠道的凭据；Agent 按「先选渠道再选模型」传 channelId 时也走这里。实现收口在 ai/ai-channels。 */
  async channelCredentials(
    user: CurrentUser,
    channelId: number,
    token?: string,
    mediaType?: string,
  ) {
    return loadChannelCredentials({
      prisma: this.prisma,
      userId: user.userId,
      channelId,
      token,
      mediaType,
    });
  }

  async models(user: CurrentUser, channelId: number, token?: string) {
    const target = await this.channelCredentials(user, channelId, token);
    if (channelId === LOCALAPI_CHANNEL_ID) {
      // LocalAPI 直接读本站模型广场目录：按端点/模态归一到槽位口径，避免再走一次 HTTP 猜 kind
      const rows = await this.prisma.modelCatalog.findMany({
        where: { enabled: true },
        orderBy: [{ sort: 'desc' }, { id: 'asc' }],
      });
      return {
        channelId,
        baseUrl: target.baseUrl,
        models: rows.map((row) => plazaModelSlot(row)),
      };
    }
    if (target.provider === 'mediakit') {
      // MediaKit 不是 OpenAI 兼容网关，没有 /models；能力固定两项，由增强档位驱动
      return {
        channelId,
        baseUrl: target.baseUrl,
        models: [
          {
            id: 'enhance-video-generative',
            kind: 'enhance',
            vision: false,
            endpoints: [],
          },
          {
            id: 'erase-video-subtitle-pro',
            kind: 'enhance',
            vision: false,
            endpoints: [],
          },
        ],
      };
    }
    const result = await this.catalog.list(
      target.baseUrl,
      target.apiKey,
      target.protocol,
    );
    const models = [...result.models];
    if (target.provider === 'volcengine') {
      // 豆包语音识别是独立产品线（openspeech v3），不在方舟 /models 里，这里补上固定候选
      for (const [id, spec] of Object.entries(DOUBAO_ASR_VARIANTS)) {
        models.push({
          id,
          kind: 'asr',
          vision: false,
          endpoints: ['/api/v3/auc/bigmodel/submit'],
        });
        void spec;
      }
    }
    if (target.provider === 'custom') {
      const mediaType = await this.channelPolicy.presetType(
        target.preset || '',
      );
      return {
        channelId,
        baseUrl: result.baseUrl,
        models: applyPresetMediaType(models, mediaType),
      };
    }
    return { channelId, baseUrl: result.baseUrl, models };
  }

  async testChannel(
    user: CurrentUser,
    body: Record<string, unknown>,
    token?: string,
  ) {
    const provider = assertProvider(body.provider || 'custom');
    const saved = Number(body.id || 0);
    if (saved === LOCALAPI_CHANNEL_ID || provider === 'localapi') {
      const target = await this.channelCredentials(
        user,
        LOCALAPI_CHANNEL_ID,
        token,
      );
      const result = await this.catalog.list(
        target.baseUrl,
        target.apiKey,
        target.protocol,
      );
      return {
        ok: true,
        baseUrl: result.baseUrl,
        modelCount: result.models.length,
        message: `LocalAPI 连通正常，共 ${result.models.length} 个模型`,
      };
    }
    if (provider === 'mediakit') {
      const baseUrl = assertBaseUrl(
        text(body.baseUrl) || mediakitDefaultBaseUrl(),
        provider,
      );
      let apiKey = text(body.apiKey).trim();
      if (!apiKey && saved > 0) {
        apiKey = (await this.channelCredentials(user, saved, token)).apiKey;
      }
      const ok = Boolean(apiKey);
      if (ok && saved > 0 && !text(body.apiKey).trim()) {
        await this.prisma.contentModelChannel.updateMany({
          where: { id: saved, userId: user.userId },
          data: { verifiedAt: new Date() },
        });
      }
      return {
        ok,
        baseUrl,
        modelCount: 0,
        message: apiKey
          ? 'MediaKit 没有模型清单接口；Key 已就绪，提交超分/擦除任务时会与上游校验'
          : '还没有填写 MediaKit API Key',
      };
    }
    let baseUrl = text(body.baseUrl).trim();
    let apiKey = text(body.apiKey).trim();
    let protocol: 'openai' | 'anthropic' = presetProtocol(
      assertPreset(body.preset),
    );
    if (saved > 0) {
      const target = await this.channelCredentials(user, saved, token);
      baseUrl = baseUrl || target.baseUrl;
      apiKey = apiKey || target.apiKey;
      protocol = target.protocol;
    }
    const result = await this.catalog.list(
      assertBaseUrl(
        baseUrl || presetBaseUrl(assertPreset(body.preset)),
        provider,
      ),
      apiKey,
      protocol,
    );
    // 只测「已保存的渠道本身」才落校验标记；带新 Key / 新地址的临时测试不写库
    if (saved > 0 && !text(body.apiKey).trim() && !text(body.baseUrl).trim()) {
      await this.prisma.contentModelChannel.updateMany({
        where: { id: saved, userId: user.userId },
        data: { verifiedAt: new Date() },
      });
    }
    return {
      ok: true,
      baseUrl: result.baseUrl,
      modelCount: result.models.length,
      message: `连通正常，共 ${result.models.length} 个模型`,
    };
  }

  /** 某个类型的默认槽位（可能没设）；给「按本轮选择覆盖渠道」的场景用，不在这里报错。 */
  async slotOf(user: CurrentUser, mediaType: ContentMediaType) {
    return this.prisma.contentModelSlot.findUnique({
      where: { userId_mediaType: { userId: user.userId, mediaType } },
    });
  }

  /**
   * 取某类型这一轮要用的「渠道 + Key + 模型」：
   * 传了 override（用户在本轮功能里先选渠道再选模型）就用它，否则回落到「模型设置」的默认槽位。
   * 缺哪一项就按中文口径报错，不猜。
   */
  async resolveTarget(
    user: CurrentUser,
    mediaType: ContentMediaType,
    token?: string,
    override?: { channelId: number; model: string },
    guard = true,
  ): Promise<ResolvedTarget> {
    // §5.7 安全三件套：主开关/限流先于取模型收口；递归取默认槽位时不重复占名额。
    if (guard) await assertAiAllowed(user.userId);
    const label = CONTENT_MEDIA_TYPE_LABELS[mediaType] || mediaType;
    if (override && !override.model.trim()) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `「${label}」还没有选模型，请先选渠道和模型`,
      );
    }
    const picked = override
      ? { channelId: override.channelId, model: override.model.trim() }
      : null;
    if (!picked) {
      const slot = await this.prisma.contentModelSlot.findUnique({
        where: { userId_mediaType: { userId: user.userId, mediaType } },
      });
      if (!slot?.model) {
        // 个人未配置该类型时继承平台默认模型（完成真实充值 + 管理员已开启才命中）。
        const platform = await platformModelFor(
          this.prisma,
          user.userId,
          mediaType,
        ).catch(() => null);
        if (platform) {
          return {
            ...(await this.channelCredentials(
              user,
              LOCALAPI_CHANNEL_ID,
              token,
              mediaType,
            )),
            model: platform.modelKey,
            channelId: LOCALAPI_CHANNEL_ID,
          };
        }
        const inheritable = (
          PLATFORM_CAPABILITIES as readonly string[]
        ).includes(mediaType);
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `请先在「模型设置」里为「${label}」选择默认模型${
            inheritable
              ? '；完成充值并到账后，未配置的类型也会自动继承平台默认模型'
              : ''
          }`,
        );
      }
      return this.resolveTarget(
        user,
        mediaType,
        token,
        { channelId: slot.channelId, model: slot.model },
        false,
      );
    }
    const target = await this.channelCredentials(
      user,
      picked.channelId,
      token,
      mediaType,
    );
    // Claude 原生协议只有文本/视觉能力，其余类型一律要求换渠道，避免用户拿到 404 猜原因
    if (
      target.protocol === 'anthropic' &&
      mediaType !== 'text' &&
      mediaType !== 'vision'
    ) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `「${label}」不能用 Claude（Anthropic）渠道：它只提供文本与视觉，请为这一类型选别的渠道`,
      );
    }
    return { ...target, model: picked.model, channelId: picked.channelId };
  }

  /** 兼容旧调用：没有本轮选择时用默认槽位。 */
  resolveSlot(
    user: CurrentUser,
    mediaType: ContentMediaType,
    token?: string,
  ): Promise<ResolvedTarget> {
    return this.resolveTarget(user, mediaType, token);
  }

  /** MediaKit 凭据（超分/擦除用）：只取启用中的 mediakit 渠道，Key 解密后仅在本进程使用。 */
  async mediakitCredentials(user: CurrentUser) {
    if (!(await this.channelPolicy.supports('mediakit'))) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '平台管理员已关闭火山 AI MediaKit 算力渠道，暂不能使用超分/擦除',
      );
    }
    const channel = await this.prisma.contentModelChannel.findFirst({
      where: { userId: user.userId, provider: 'mediakit', enabled: true },
      orderBy: { id: 'asc' },
    });
    if (!channel) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请先在「模型设置」里添加火山 AI MediaKit 渠道并填写 Key',
      );
    }
    const apiKey = this.crypto.decrypt(channel.keyCipher);
    if (!apiKey) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '火山 AI MediaKit 还没有保存 Key，请到「模型设置」补齐',
      );
    }
    return { baseUrl: channel.baseUrl, apiKey };
  }
}
