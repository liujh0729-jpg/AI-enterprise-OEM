import {
  CANVAS_EDGE_ROLES,
  type CanvasDoc,
  type CanvasEdgeRole,
  type CanvasGenerateData,
  type CanvasNode,
} from '@enterprise/contracts';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';

/** 画布节点 → 任务表单：tool 走既有 CONTENT_TOOLS，画布只是「图 → 表单」的翻译层。 */
export type CanvasRunSpec = {
  /** 面板里这一轮选的渠道与模型：优先于节点 / 配置节点里存的旧选择 */
  channelId?: number;
  model?: string;
  size?: string;
  ratio?: string;
  resolution?: string;
  duration?: number;
  count?: number;
  /** 面板里改写过的提示词：优先于连进来的提示词节点 */
  prompt?: string;
};

export type PlannedRun = {
  tool: string;
  input: Record<string, unknown>;
  /** 只用该工具声明的槽位；空＝用「模型设置」的默认槽位 */
  models: Record<string, { channelId: number; model: string }>;
  media: 'image' | 'video' | 'music';
  count: number;
};

type AssetRef = {
  role: CanvasEdgeRole;
  media: 'image' | 'video' | 'audio';
  url: string;
  name: string;
};

const ROLE_ORDER: Record<string, number> = {};
CANVAS_EDGE_ROLES.forEach((role, index) => {
  ROLE_ORDER[role] = index;
});

const IMAGE_MAX_REFS = 6;

function roleOf(edge: { role?: string }): CanvasEdgeRole {
  const role = String(edge.role || 'asset');
  return (CANVAS_EDGE_ROLES as readonly string[]).includes(role)
    ? (role as CanvasEdgeRole)
    : 'asset';
}

function readString(raw: unknown) {
  return typeof raw === 'string' ? raw.trim() : '';
}

function readInteger(raw: unknown, min: number) {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.round(value)) : undefined;
}

/** 资产编号允许负数：本站 OSS 自建资产在台账里就是负数 id，不能当非法值抹掉。 */
function readAssetId(raw: unknown) {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.round(value) : 0;
}

/**
 * 画布封面：最近一次成功产物优先，没有产物才回落到第一张素材图。
 * 保存与「产物回写」两处共用，列表封面才不会停在素材上。
 */
export function deriveCoverUrl(doc: CanvasDoc): string {
  const products: string[] = [];
  const covers: string[] = [];
  for (const node of doc.nodes) {
    if (node.data.kind === 'generate') {
      for (const item of node.data.results) {
        const url = String(item.url || '').trim();
        if (url) products.push(url);
      }
      continue;
    }
    if (
      node.data.kind === 'asset' &&
      node.data.media === 'image' &&
      node.data.previewUrl
    ) {
      covers.push(node.data.previewUrl);
    }
  }
  // results 按时间正序追加，取最后一个＝最近一次产物
  return products.length ? products[products.length - 1] : covers[0] || '';
}

/**
 * 只认四种节点形状；doc 可能是老版本或人工改坏的 JSON，解析不出就按空处理。
 * 字段逐个回填默认值：少了 channelId / results / count 会让面板与结果回写整片报错。
 */
export function readCanvasDoc(raw: unknown): CanvasDoc {
  const source =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const nodes = Array.isArray(source.nodes)
    ? source.nodes.flatMap((item): CanvasNode[] => {
        if (!item || typeof item !== 'object') return [];
        const row = item as Record<string, unknown>;
        const id = readString(row.id);
        const type = readString(row.type) as CanvasNode['type'];
        const data = cleanNodeData(row.data);
        if (!id || !data || data.kind !== type) return [];
        return [
          {
            id,
            type,
            x: Number(row.x) || 0,
            y: Number(row.y) || 0,
            width: Number(row.width) || 220,
            data,
          },
        ];
      })
    : [];
  const edges = Array.isArray(source.edges)
    ? source.edges.flatMap((item): CanvasDoc['edges'] => {
        if (!item || typeof item !== 'object') return [];
        const row = item as Record<string, unknown>;
        const from = readString(row.from);
        const to = readString(row.to);
        if (!from || !to) return [];
        return [
          {
            id: readString(row.id) || `${from}->${to}`,
            from,
            to,
            role: roleOf({ role: readString(row.role) }),
          },
        ];
      })
    : [];
  const viewport =
    source.viewport && typeof source.viewport === 'object'
      ? (source.viewport as CanvasDoc['viewport'])
      : { x: 0, y: 0, zoom: 1 };
  return {
    version: 1,
    nodes,
    edges,
    viewport: {
      x: Number(viewport.x) || 0,
      y: Number(viewport.y) || 0,
      zoom: Number(viewport.zoom) || 1,
    },
  };
}

function cleanNodeData(raw: unknown): CanvasNode['data'] | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const kind = readString(row.kind);
  if (kind === 'prompt') return { kind, text: text(row.text) };
  if (kind === 'asset') {
    const media = readString(row.media);
    return {
      kind,
      assetId: readAssetId(row.assetId),
      name: text(row.name),
      media: media === 'video' || media === 'audio' ? media : 'image',
      url: text(row.url),
      previewUrl: text(row.previewUrl),
    };
  }
  if (kind === 'config') {
    return {
      kind,
      channelId: readInteger(row.channelId, 0) ?? 0,
      channelName: text(row.channelName),
      model: text(row.model),
      ...(row.size ? { size: text(row.size) } : {}),
      ...(row.ratio ? { ratio: text(row.ratio) } : {}),
      ...(row.resolution ? { resolution: text(row.resolution) } : {}),
      ...(Number(row.duration) > 0 ? { duration: Number(row.duration) } : {}),
      ...(Number(row.count) >= 1
        ? { count: Math.round(Number(row.count)) }
        : {}),
    };
  }
  if (kind === 'generate') {
    const media = readString(row.media);
    const refs = readMentionRefs(row.refs);
    const results = Array.isArray(row.results)
      ? row.results.flatMap((item) => {
          if (!item || typeof item !== 'object') return [];
          const result = item as Record<string, unknown>;
          const url = readString(result.url);
          const jobId = Number(result.jobId);
          if (!url || !Number.isFinite(jobId)) return [];
          return [
            {
              jobId,
              url,
              assetId: text(result.assetId),
              media: text(result.media),
            },
          ];
        })
      : [];
    return {
      kind,
      media: media === 'video' || media === 'music' ? media : 'image',
      prompt: text(row.prompt),
      channelId: readInteger(row.channelId, 0) ?? 0,
      channelName: text(row.channelName),
      model: text(row.model),
      ...(row.size ? { size: text(row.size) } : {}),
      ...(row.ratio ? { ratio: text(row.ratio) } : {}),
      ...(row.resolution ? { resolution: text(row.resolution) } : {}),
      ...(Number(row.duration) > 0 ? { duration: Number(row.duration) } : {}),
      count: readInteger(row.count, 1) ?? 1,
      lyrics: text(row.lyrics),
      refs,
      results,
      lastRunId: text(row.lastRunId),
    };
  }
  return null;
}

/**
 * 提示词里 @ 的数字资产：记号（图片1）与地址成对保存，同一个记号只留第一条。
 * 记号是给用户看的，喂给模型的仍是 url；标不出形状的整条丢掉，不让坏数据进快照。
 */
function readMentionRefs(raw: unknown): CanvasGenerateData['refs'] {
  if (!Array.isArray(raw)) return [];
  const out: CanvasGenerateData['refs'] = [];
  const used = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const label = readString(row.label);
    const url = readString(row.url);
    const media = readString(row.media);
    if (!label || !url || used.has(label)) continue;
    if (media !== 'image' && media !== 'video' && media !== 'audio') continue;
    used.add(label);
    out.push({
      label,
      media,
      assetId: readAssetId(row.assetId),
      name: text(row.name),
      url,
    });
  }
  return out;
}

function label(data: { kind: string; media?: string }) {
  switch (data.kind) {
    case 'prompt':
      return '提示词';
    case 'asset':
      return '素材';
    case 'config':
      return '配置';
    default:
      return data.media === 'video'
        ? '视频生成'
        : data.media === 'music'
          ? '音乐生成'
          : '生图';
  }
}

/**
 * 纯函数：把某个生成节点 + 入边的 prompt/asset/config 解算成一次提交参数。
 * 素材优先级：首帧/尾帧 > 参考图/参考视频 > 音频（仅在同时有视频时走对口型）。
 */
export function planNodeRun(
  doc: CanvasDoc,
  nodeId: string,
  override?: CanvasRunSpec,
): PlannedRun {
  const node = doc.nodes.find((item) => item.id === nodeId);
  if (!node) {
    throw new BusinessException(
      ErrorCode.NOT_FOUND,
      '画布节点不存在，可能已被删除',
    );
  }
  if (node.type !== 'generate' || node.data.kind !== 'generate') {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '只有生成节点可以提交任务',
    );
  }
  const base: CanvasGenerateData = node.data;
  const data: CanvasGenerateData = { ...base, ...cleanSpec(override) };

  const incoming = doc.edges
    .filter((edge) => edge.to === nodeId)
    .sort(
      (a, b) => (ROLE_ORDER[roleOf(a)] ?? 9) - (ROLE_ORDER[roleOf(b)] ?? 9),
    );
  const byId = new Map<string, CanvasNode>(
    doc.nodes.map((item) => [item.id, item]),
  );

  const prompts: string[] = [];
  const assets: AssetRef[] = [];
  let config: CanvasNode | undefined;
  for (const edge of incoming) {
    const source = byId.get(edge.from);
    if (!source || source.id === nodeId) continue;
    const role = roleOf(edge);
    if (source.type === 'prompt' && source.data.kind === 'prompt') {
      const value = String(source.data.text || '').trim();
      if (value && !prompts.includes(value)) prompts.push(value);
      continue;
    }
    if (source.type === 'asset' && source.data.kind === 'asset') {
      const url = String(source.data.url || '').trim();
      if (!url) continue;
      const media =
        source.data.media === 'video' || source.data.media === 'audio'
          ? source.data.media
          : 'image';
      // 首尾帧只能是图片；连了视频/音频就当参考素材处理，不静默丢素材
      const mapped: CanvasEdgeRole =
        (role === 'first-frame' || role === 'last-frame') && media !== 'image'
          ? 'asset'
          : role;
      if (assets.some((item) => item.url === url)) continue;
      assets.push({
        role: mapped,
        media,
        url,
        name: String(source.data.name || url),
      });
      continue;
    }
    if (source.type === 'config' && source.data.kind === 'config' && !config) {
      config = source;
    }
  }
  // 提示词里 @ 的数字资产和连线素材同权：一并当参考素材，地址去重
  for (const ref of data.refs) {
    if (assets.some((item) => item.url === ref.url)) continue;
    assets.push({
      role: 'asset',
      media: ref.media,
      url: ref.url,
      name: ref.name || ref.url,
    });
  }

  const cfg = config && config.data.kind === 'config' ? config.data : undefined;
  // 优先级：面板这一轮的选择 > 配置节点 > 生成节点自己存的
  const channelId = Number.isInteger(override?.channelId)
    ? Number(override?.channelId)
    : Number(cfg?.channelId ?? data.channelId) || 0;
  const model = String(
    override?.model?.trim() || cfg?.model || data.model || '',
  ).trim();
  const size = String(cfg?.size ?? data.size ?? '').trim();
  const ratio = String(cfg?.ratio ?? data.ratio ?? '').trim();
  const resolution = String(cfg?.resolution ?? data.resolution ?? '').trim();
  const duration = Number(cfg?.duration ?? data.duration ?? override?.duration);
  const lyrics = String(data.lyrics || '');

  const prompt = (
    override?.prompt?.trim() ||
    prompts.join('\n\n') ||
    String(data.prompt || '')
  ).trim();
  const media = data.media;
  const images = assets.filter((item) => item.media === 'image');
  const videos = assets.filter((item) => item.media === 'video');
  const audios = assets.filter((item) => item.media === 'audio');
  const firstFrame = assets.find((item) => item.role === 'first-frame');
  const lastFrame = assets.find((item) => item.role === 'last-frame');

  const rawCount = Number(override?.count ?? data.count ?? 1);
  const count =
    media === 'image' ? Math.min(4, Math.max(1, Math.round(rawCount) || 1)) : 1;

  const guardPrompt = (allowEmpty = false) => {
    if (!prompt && !allowEmpty) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '生成节点还没有提示词：请在面板里填写，或连一个提示词节点进来',
      );
    }
  };

  if (media === 'music') {
    guardPrompt();
    return {
      tool: 'music',
      input: {
        prompt,
        lyrics: String(lyrics || '').trim(),
        duration:
          Number.isFinite(duration) && duration > 0 ? duration : undefined,
      },
      models: pickModels('music', channelId, model),
      media,
      count: 1,
    };
  }

  if (media === 'image') {
    if (firstFrame || lastFrame) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '首帧 / 尾帧只用于视频生成，请把它们连到视频生成节点',
      );
    }
    if (videos.length || audios.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '生图只接收图片素材，请把视频 / 音频素材连到视频生成节点',
      );
    }
    if (images.length) {
      // 有参考图就是「按参考图出图」，提示词必须写清楚要改什么
      guardPrompt();
      return {
        tool: 'image-edit',
        input: {
          imageUrls: images.slice(0, IMAGE_MAX_REFS).map((item) => item.url),
          prompt,
          size: size || undefined,
        },
        models: pickModels('image', channelId, model),
        media,
        count,
      };
    }
    guardPrompt();
    return {
      tool: 'image',
      input: { prompt, size: size || undefined },
      models: pickModels('image', channelId, model),
      media,
      count,
    };
  }

  // video：首尾帧 → video；参考素材 → video-ref；只有音频 + 视频底板 → lip-sync（对口型不吃时长）
  if (audios.length && !videos.length) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '音频素材只能用来驱动已有视频（对口型），请同时连一个视频素材',
    );
  }
  if (audios.length && videos.length && !images.length && !firstFrame) {
    return {
      tool: 'lip-sync',
      input: {
        base: videos[0].url,
        audio: audios[0].url,
        prompt,
      },
      models: pickModels('video', channelId, model),
      media,
      count: 1,
    };
  }
  // 走到这里都是按时长计费的视频生成：时长必填，不给默认值（由用户在面板里填）
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '请先填写视频时长（秒），再生成视频',
    );
  }
  const spec = {
    duration,
    ratio: ratio || undefined,
    resolution: resolution || undefined,
  };
  if (firstFrame || lastFrame) {
    guardPrompt();
    return {
      tool: 'video',
      input: {
        prompt,
        firstFrame: firstFrame?.url || '',
        lastFrame: lastFrame?.url || '',
        ...spec,
      },
      models: pickModels('video', channelId, model),
      media,
      count: 1,
    };
  }
  if (images.length || videos.length) {
    guardPrompt();
    return {
      tool: 'video-ref',
      input: {
        prompt,
        references: images.slice(0, IMAGE_MAX_REFS).map((item) => item.url),
        ...spec,
      },
      models: pickModels('video', channelId, model),
      media,
      count: 1,
    };
  }
  guardPrompt();
  return {
    tool: 'video',
    input: { prompt, ...spec },
    models: pickModels('video', channelId, model),
    media,
    count: 1,
  };
}

/** 只带该工具声明的槽位；没选模型时留空＝走「模型设置」的默认槽位。 */
function pickModels(
  slot: 'image' | 'video' | 'music',
  channelId: number,
  model: string,
) {
  if (!model) return {};
  // 0＝AIPDD 渠道，是合法选择；负数/非整数才算没选渠道
  if (!Number.isInteger(channelId) || channelId < 0) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '还没有选渠道：请先选模型渠道，再选该渠道下的模型',
    );
  }
  return { [slot]: { channelId, model } };
}

function cleanSpec(override?: CanvasRunSpec) {
  if (!override) return {};
  const out: Partial<CanvasGenerateData> = {};
  if (override.size !== undefined) out.size = String(override.size);
  if (override.ratio !== undefined) out.ratio = String(override.ratio);
  if (override.resolution !== undefined)
    out.resolution = String(override.resolution);
  if (override.duration !== undefined) out.duration = Number(override.duration);
  if (override.count !== undefined) out.count = Number(override.count);
  return out;
}

/** 节点卡片上的一句话摘要（任务行与列表用）。 */
export function nodeLabel(node: CanvasNode) {
  return label(node.data);
}
