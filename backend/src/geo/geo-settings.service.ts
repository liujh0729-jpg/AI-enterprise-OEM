import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { CurrentUser } from '../auth/current-user';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { PrismaService } from '../prisma/prisma.service';
import { geoChat } from './geo-llm.client';
/**
 * GEO 采集平台设置：十二家采集平台的 API Key 与模型 / 接口地址，**按账号归属**。
 * - 每个账号在「营销工具」里配自己的 Key；管理员也只是一名普通账号，不能替别人配置；
 * - Key 只落 AES-256-GCM 密文，列表只回「已配置 / 未配置」，任何接口都不回明文；
 * - 采集与解析严格按项目的 ownerUserId 取该账号自己的 Key，不共享、不回落 backend/.env；
 * - 只有配过 Key 与模型的平台，该账号的前台才可用（可在项目里勾选、参与自动采集）；
 * - 保存即时生效，不需要重启。
 */
export type GeoProviderSpec = {
  code: string;
  /** 观测记录里的平台名（与 geo-shared 的 GEO_PLATFORMS 同口径）。 */
  platform: string;
  label: string;
  purpose: string;
  defaultBaseUrl: string;
  modelHint: string;
  /** 调用方言：openai＝`POST {baseUrl}/chat/completions` + Bearer；anthropic＝`POST {baseUrl}/messages` + x-api-key。 */
  api?: 'openai' | 'anthropic';
};
/** 十二家采集平台；观测解析默认用豆包（火山方舟）文本模型。 */
export const GEO_PROVIDERS: GeoProviderSpec[] = [
  {
    code: 'doubao',
    platform: '豆包',
    label: '豆包（火山方舟）',
    purpose: '采集 + 观测解析（默认解析模型）',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    modelHint: '如 doubao-seed-1-6-250615，或控制台创建的接入点 ep-xxxxxxxx',
  },
  {
    code: 'qwen',
    platform: '千问',
    label: '千问（阿里百炼 / Qwen）',
    purpose: '采集',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    modelHint: '如 qwen-plus',
  },
  {
    code: 'kimi',
    platform: 'Kimi',
    label: 'Kimi（Moonshot）',
    purpose: '采集',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    modelHint: '如 moonshot-v1-8k',
  },
  {
    code: 'yuanbao',
    platform: '元宝',
    label: '元宝（腾讯混元）',
    purpose: '采集（与元宝 App 回答有风格差，报告需标注）',
    defaultBaseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    modelHint: '如 hunyuan-turbos-latest',
  },
  {
    code: 'deepseek',
    platform: 'DeepSeek',
    label: 'DeepSeek（官方）',
    purpose: '采集（联网能力实施时核实）',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    modelHint: '如 deepseek-chat',
  },
  {
    code: 'glm',
    platform: 'GLM',
    label: 'GLM（智谱）',
    purpose: '采集',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    modelHint: '如 glm-4-plus',
  },
  {
    code: 'mimo',
    platform: 'MiMo',
    label: 'MiMo（小米）',
    purpose: '采集',
    defaultBaseUrl: 'https://api.xiaomimimo.com/v1',
    modelHint: '如 mimo-v2.5',
  },
  {
    code: 'minimax',
    platform: 'MiniMax',
    label: 'MiniMax（稀宇科技）',
    purpose: '采集',
    defaultBaseUrl: 'https://api.minimaxi.com/v1',
    modelHint: '如 MiniMax-M1',
  },
  {
    code: 'gpt',
    platform: 'GPT',
    label: 'GPT（OpenAI）',
    purpose: '采集（境外服务，需可访问的网络或中转地址）',
    defaultBaseUrl: 'https://api.openai.com/v1',
    modelHint: '如 gpt-4o-mini',
  },
  {
    code: 'claude',
    platform: 'Claude',
    label: 'Claude（Anthropic）',
    purpose: '采集（走 Messages API，境外服务）',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    modelHint: '如 claude-sonnet-4-5',
    api: 'anthropic',
  },
  {
    code: 'gemini',
    platform: 'Gemini',
    label: 'Gemini（Google AI Studio）',
    purpose: '采集（Google 的 OpenAI 兼容端点，境外服务）',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    modelHint: '如 gemini-2.5-flash',
  },
  {
    code: 'grok',
    platform: 'Grok',
    label: 'Grok（xAI）',
    purpose: '采集（境外服务）',
    defaultBaseUrl: 'https://api.x.ai/v1',
    modelHint: '如 grok-4',
  },
];
export type GeoProviderView = {
  code: string;
  platform: string;
  label: string;
  purpose: string;
  modelHint: string;
  defaultBaseUrl: string;
  model: string;
  baseUrl: string;
  configured: boolean;
  source: 'db' | 'none';
  updatedBy: string;
  updatedAt: Date | null;
};
export class GeoSettingsService {
  private readonly key: Buffer;
  constructor(private readonly prisma: PrismaService) {
    // 沿用外报凭据的密钥源（独立派生上下文），不额外要求新的环境变量
    const source = String(process.env.EXTERNAL_CRED_KEY || '').trim();
    if (!source) {
      throw new Error(
        'EXTERNAL_CRED_KEY 未配置：GEO 平台密钥加密沿用该密钥源（见 backend/.env.example）',
      );
    }
    this.key = createHash('sha256')
      .update(`aiworkin-geo-provider-key|${source}`)
      .digest();
  }
  private encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv, tag, body].map((part) => part.toString('base64')).join(':');
  }
  private decrypt(sealed: string): string {
    const [ivB64, tagB64, bodyB64] = sealed.split(':');
    if (!ivB64 || !tagB64 || !bodyB64) {
      throw new BusinessException(ErrorCode.INTERNAL_ERROR, '密钥密文格式非法');
    }
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.key,
        Buffer.from(ivB64, 'base64'),
      );
      decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(bodyB64, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new BusinessException(
        ErrorCode.INTERNAL_ERROR,
        '密钥密文无法解密（凭据加密密钥已变更？），请重新保存该平台的 API Key',
      );
    }
  }
  private spec(code: string): GeoProviderSpec {
    const found = GEO_PROVIDERS.find((item) => item.code === code);
    if (!found) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        `没有「${code}」这个采集平台`,
      );
    }
    return found;
  }
  /** 当前账号的平台清单：只回「是否已配置 + 模型 / 地址」，绝不回密钥。 */
  async list(userId: string): Promise<{
    providers: GeoProviderView[];
  }> {
    const rows = await this.prisma.geoProviderSetting.findMany({
      where: { userId },
    });
    const byCode = new Map(rows.map((row) => [row.code, row]));
    return {
      providers: GEO_PROVIDERS.map((spec) => {
        const row = byCode.get(spec.code);
        const source: GeoProviderView['source'] = row?.keyCipher
          ? 'db'
          : 'none';
        return {
          code: spec.code,
          platform: spec.platform,
          label: spec.label,
          purpose: spec.purpose,
          modelHint: spec.modelHint,
          defaultBaseUrl: spec.defaultBaseUrl,
          model: row?.model || '',
          baseUrl: row?.baseUrl || '',
          configured: source !== 'none',
          source,
          updatedBy: row?.updatedBy || '',
          updatedAt: row?.updatedAt || null,
        };
      }),
    };
  }
  /** 当前账号的前台可用平台清单：该账号同时配好 Key 与模型的平台（未配置即前台不可选、不参与采集）。 */
  async availablePlatforms(userId: string): Promise<string[]> {
    const rows = await this.prisma.geoProviderSetting.findMany({
      where: { userId },
    });
    const ready = new Set(
      rows.filter((row) => row.keyCipher && row.model).map((row) => row.code),
    );
    return GEO_PROVIDERS.filter((spec) => ready.has(spec.code)).map(
      (spec) => spec.platform,
    );
  }
  /** 保存：apiKey 缺省＝保留原 Key（只改模型 / 地址）；清空 Key 走 clear。 */
  async save(
    user: CurrentUser,
    code: string,
    body: {
      apiKey?: unknown;
      model?: unknown;
      baseUrl?: unknown;
    },
  ) {
    this.spec(code);
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    const hasModel = body.model !== undefined;
    const hasBaseUrl = body.baseUrl !== undefined;
    if (!apiKey && !hasModel && !hasBaseUrl) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '没有需要保存的内容');
    }
    const model = hasModel
      ? text(body.model ?? '')
          .trim()
          .slice(0, 128)
      : undefined;
    let baseUrl: string | undefined;
    if (hasBaseUrl) {
      baseUrl = text(body.baseUrl ?? '')
        .trim()
        .replace(/\/+$/, '');
      if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '接口地址需以 http:// 或 https:// 开头',
        );
      }
    }
    const updatedBy = user.username || user.userId;
    const patch = {
      ...(model === undefined ? {} : { model }),
      ...(baseUrl === undefined ? {} : { baseUrl }),
      ...(apiKey ? { keyCipher: this.encrypt(apiKey) } : {}),
    };
    await this.prisma.geoProviderSetting.upsert({
      where: { userId_code: { userId: user.userId, code } },
      update: { ...patch, updatedBy },
      create: {
        userId: user.userId,
        code,
        updatedBy,
        model: model || '',
        baseUrl: baseUrl || '',
        keyCipher: apiKey ? this.encrypt(apiKey) : null,
      },
    });
    return this.list(user.userId);
  }
  /** 清空当前账号在该平台的整行配置：Key 与模型 / 地址覆盖一并去掉，该平台随即不可用。 */
  async clear(user: CurrentUser, code: string) {
    this.spec(code);
    await this.prisma.geoProviderSetting.deleteMany({
      where: { userId: user.userId, code },
    });
    return this.list(user.userId);
  }
  /** 采集取数口：只认指定账号自己保存的 Key（未配置即不可用，绝不共享别人的 Key）。 */
  async resolve(
    userId: string,
    code: string,
  ): Promise<{
    spec: GeoProviderSpec;
    apiKey: string;
    model: string;
    baseUrl: string;
    source: 'db' | 'none';
  }> {
    const spec = this.spec(code);
    const row = await this.prisma.geoProviderSetting.findUnique({
      where: { userId_code: { userId, code } },
    });
    return {
      spec,
      apiKey: row?.keyCipher ? this.decrypt(row.keyCipher) : '',
      model: row?.model || '',
      baseUrl: row?.baseUrl || spec.defaultBaseUrl,
      source: row?.keyCipher ? 'db' : 'none',
    };
  }
  /** 连通测试：用当前账号「生效的 Key / 模型 / 地址」真发一次最小请求，证明这条 Key 可用。 */
  async test(user: CurrentUser, code: string) {
    const { spec, apiKey, model, baseUrl, source } = await this.resolve(
      user.userId,
      code,
    );
    if (!apiKey) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `未配置 ${spec.label} 的 API Key：请在本页填入并保存后再试`,
      );
    }
    if (!model) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `未填写模型 / 接入点（${spec.modelHint}）`,
      );
    }
    const result = await geoChat({
      baseUrl,
      apiKey,
      model,
      api: spec.api,
      prompt: '请只回复四个字：连通正常',
      maxTokens: 16,
      timeoutMs: 20000,
    });
    return {
      ok: true,
      code: spec.code,
      label: spec.label,
      platform: spec.platform,
      model,
      baseUrl,
      source,
      elapsedMs: result.elapsedMs,
      reply: result.reply,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
    };
  }
}
