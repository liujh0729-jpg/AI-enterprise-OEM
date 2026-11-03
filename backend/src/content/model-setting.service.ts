import {
  CONTENT_CHANNEL_PRESET_LABELS,
  CONTENT_MEDIA_TYPE_LABELS,
  CONTENT_MEDIA_TYPES,
  type ContentMediaType,
  type ContentModelChannel,
  type ContentModelSlot,
} from '@enterprise/contracts';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { IdentityService } from '../identity/identity.service';
import { ModelKeyService } from '../aiworkin/model-key.service';
import { PrismaService } from '../prisma/prisma.service';
import { ContentCrypto, maskSecret } from './content-crypto';
import { DOUBAO_ASR_VARIANTS } from './openspeech.client';
import { ContentModelCatalogService } from './model-catalog.service';
import {
  aipddBaseUrl,
  assertBaseUrl,
  assertMediaType,
  assertPreset,
  assertProvider,
  mediakitDefaultBaseUrl,
  presetBaseUrl,
  presetProtocol,
  volcengineDefaultBaseUrl,
} from './content-shared';

const CHANNEL_NAME_MAX = 64;

type ResolvedTarget = {
  baseUrl: string;
  apiKey: string;
  provider: 'aipdd' | 'custom' | 'volcengine' | 'mediakit';
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

/**
 * 内容创作的模型设置：渠道（AIPDD 内置 / 自定义 OpenAI 兼容 / 火山 MediaKit）+
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
  ) {}

  /** AIPDD 内置渠道：不单独配 Key，直接用当前用户绑定的 AIPDD APIKey（设计 3.4）。 */
  async aipddKey(user: CurrentUser, token?: string) {
    return this.modelKeys.requireKey(token);
  }

  private view(row: ChannelRow): ContentModelChannel {
    return {
      id: row.id,
      provider:
        row.provider === 'mediakit'
          ? 'mediakit'
          : row.provider === 'volcengine'
            ? 'volcengine'
            : 'custom',
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
    };
  }

  async settings(user: CurrentUser, token?: string) {
    const [rows, slotRows] = await Promise.all([
      this.prisma.contentModelChannel.findMany({
        where: { userId: user.userId },
        orderBy: { id: 'asc' },
      }),
      this.prisma.contentModelSlot.findMany({
        where: { userId: user.userId },
      }),
    ]);
    const localAipdd = rows.find((row) => row.provider === 'aipdd');
    // AIPDD 不读渠道本地 Key，只看当前用户绑定的 AIPDD APIKey（未绑定即未配置）
    const key = await this.modelKeys.status(token);
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
          enabled: true,
        },
        ...rows
          .filter((row) => row.provider !== 'aipdd')
          .map((row) => this.view(row as ChannelRow)),
      ],
      slots,
      aipdd: {
        baseUrl: aipddBaseUrl(),
        configured: key.configured,
        keyMasked: key.keyMasked,
        localChannelId: localAipdd?.id || 0,
      },
    };
  }

  async saveSettings(
    user: CurrentUser,
    body: Record<string, unknown>,
    token?: string,
  ) {
    const channelIds = new Set(
      (
        await this.prisma.contentModelChannel.findMany({
          where: { userId: user.userId },
          select: { id: true },
        })
      ).map((row) => row.id),
    );
    const rawSlots = Array.isArray(body.slots) ? body.slots : [];
    for (const item of rawSlots) {
      if (!item || typeof item !== 'object') continue;
      const slot = item as Record<string, unknown>;
      const mediaType = assertMediaType(slot.mediaType);
      const channelId = Number(slot.channelId || 0);
      if (!Number.isInteger(channelId) || channelId < 0) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '渠道编号无效');
      }
      if (channelId !== 0 && !channelIds.has(channelId)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '所选渠道已不存在，请刷新后重选',
        );
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
                ? CONTENT_CHANNEL_PRESET_LABELS[preset as never] ||
                  'OpenAI 兼容渠道'
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
    // AIPDD 内置渠道不保存单独 Key，始终取账号在「API Key 管理」里的 Key
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
    const row = existing
      ? await this.prisma.contentModelChannel.update({
          where: { id: existing.id },
          data: { name, baseUrl, keyCipher, asrKeyCipher, provider, preset },
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

  /** 取某个渠道的凭据；Agent 按「先选渠道再选模型」传 channelId 时也走这里。 */
  async channelCredentials(
    user: CurrentUser,
    channelId: number,
    token?: string,
    mediaType?: string,
  ) {
    if (channelId === 0) {
      const apiKey = await this.modelKeys.requireKey(token);
      return {
        baseUrl: aipddBaseUrl(),
        apiKey,
        provider: 'aipdd' as const,
        protocol: 'openai' as const,
      };
    }
    const row = await this.prisma.contentModelChannel.findFirst({
      where: { id: channelId, userId: user.userId },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '渠道不存在');
    }
    if (!row.enabled) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '该渠道已停用');
    }
    const isVolcengine = row.provider === 'volcengine';
    // 火山引擎：语音识别走豆包语音（openspeech）的独立 Key，其余走方舟 Key
    const useAsrKey = isVolcengine && mediaType === 'asr';
    const apiKey = this.crypto.decrypt(
      useAsrKey ? row.asrKeyCipher || '' : row.keyCipher,
    );
    if (useAsrKey && !apiKey) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '这个火山引擎渠道还没有保存豆包语音识别的 Key（它和方舟 Key 不是同一个，请到「模型设置」补齐）',
      );
    }
    const protocol =
      row.provider === 'volcengine'
        ? ('openai' as const)
        : presetProtocol(String(row.preset || ''));
    return {
      baseUrl: row.baseUrl,
      apiKey,
      provider:
        row.provider === 'mediakit'
          ? ('mediakit' as const)
          : isVolcengine
            ? ('volcengine' as const)
            : ('custom' as const),
      asrProtocol: useAsrKey ? ('openspeech' as const) : ('openai' as const),
      protocol,
    };
  }

  async models(user: CurrentUser, channelId: number, token?: string) {
    const target = await this.channelCredentials(user, channelId, token);
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
    return { channelId, baseUrl: result.baseUrl, models };
  }

  async testChannel(
    user: CurrentUser,
    body: Record<string, unknown>,
    token?: string,
  ) {
    const provider = assertProvider(body.provider || 'custom');
    if (provider === 'mediakit') {
      const baseUrl = assertBaseUrl(
        text(body.baseUrl) || mediakitDefaultBaseUrl(),
        provider,
      );
      const saved = Number(body.id || 0);
      let apiKey = text(body.apiKey).trim();
      if (!apiKey && saved > 0) {
        apiKey = (await this.channelCredentials(user, saved, token)).apiKey;
      }
      return {
        ok: Boolean(apiKey),
        baseUrl,
        modelCount: 0,
        message: apiKey
          ? 'MediaKit 没有模型清单接口；Key 已就绪，提交超分/擦除任务时会与上游校验'
          : '还没有填写 MediaKit API Key',
      };
    }
    const saved = Number(body.id || 0);
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
  ): Promise<ResolvedTarget> {
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
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `请先在「模型设置」里为「${label}」选择默认模型`,
        );
      }
      return this.resolveTarget(user, mediaType, token, {
        channelId: slot.channelId,
        model: slot.model,
      });
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
