#!/usr/bin/env node
/**
 * 官方热门 ComfyUI 模板导入脚本（开发期跑一次，需要联网）。
 *
 * 产出落在 backend/prisma/data/comfy-templates/：
 *   <name>.json      工作流正文：转换成功＝API 格式（站内可直接运行），失败＝原 UI 格式（仅浏览/下载）
 *   <name>.<ext>     封面图二进制（--covers=local 时写，随仓库提交，装好依赖即可离线初始化）
 *   <name>.meta.json 卡片元数据：标题/简介/分类/分组/标签/媒体类型/format/槽位/出处/封面
 * 之后 `pnpm prisma:seed` 会按 code 幂等 upsert 进 community_workflows（见 prisma/seed-creative-community.ts）。
 *
 * 用法：
 *   node scripts/import-comfy-templates.mjs                       # 默认 top 120，浏览型 + 核心节点可运行
 *   COMFY_API_KEY=... node scripts/import-comfy-templates.mjs     # 带 Key 时拉 object_info，转换覆盖率大幅提高
 *   node scripts/import-comfy-templates.mjs --limit=200 --min-usage=100 --covers=remote
 *
 * 说明：Comfy Cloud 的 `/api/object_info` 必须用用户自己的 Key 才能取（免费套餐不含 API 访问），
 * 所以不带 Key 时只认脚本内置的核心节点表——转不动的一律按浏览型入库，不猜。
 */
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  combosFromClass,
  isApiFormat,
  suggestSlots,
  uiToApi,
} from './comfy-ui-to-api.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'backend', 'prisma', 'data', 'comfy-templates');
const SOURCE = 'https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main';
const OBJECT_INFO_URL = 'https://cloud.comfy.org/api/object_info';
const OBJECT_INFO_CACHE = join(DATA_DIR, '_object_info.json');
/** 并发：模板仓库是静态 CDN，6 路足够快也不会被限流。 */
const CONCURRENCY = 6;
const RETRIES = 3;

const { values: options } = parseArgs({
  options: {
    limit: { type: 'string', default: '120' },
    'min-usage': { type: 'string', default: '0' },
    covers: { type: 'string', default: 'local' }, // local | remote | none
    'object-info': { type: 'string' },
    'refresh-object-info': { type: 'boolean', default: false },
    category: { type: 'string' }, // 只导某个分类：image|video|audio|3d|llm|tools
    'max-cover-kb': { type: 'string', default: '400' },
    'dry-run': { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
  },
});

function log(...args) {
  console.log('[comfy-import]', ...args);
}

/** 带重试的 GET：GitHub raw 偶发 5xx，单条失败不能整批中断。 */
async function get(url, init = {}, attempt = 1) {
  try {
    const response = await fetch(url, { ...init, cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response;
  } catch (caught) {
    if (attempt >= RETRIES) throw caught;
    await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    return get(url, init, attempt + 1);
  }
}

/** object_info：优先本地文件 → 缓存 → 带 Key 现拉。取不到就退回核心节点表。 */
async function loadObjectInfo() {
  if (options['object-info']) {
    const raw = await readFile(options['object-info'], 'utf8');
    log('object_info 来自 --object-info 文件');
    return JSON.parse(raw);
  }
  const key = String(process.env.COMFY_API_KEY || '').trim();
  if (!options['refresh-object-info']) {
    try {
      const cached = JSON.parse(await readFile(OBJECT_INFO_CACHE, 'utf8'));
      if (cached && Object.keys(cached).length > 100) {
        log(`object_info 用缓存（${Object.keys(cached).length} 个节点）`);
        return cached;
      }
    } catch {
      // 没有缓存，继续往下
    }
  }
  if (!key) {
    log('未提供 COMFY_API_KEY：只按内置核心节点表转换，其余记为浏览型');
    return null;
  }
  log('拉取 object_info …');
  const response = await get(OBJECT_INFO_URL, {
    headers: { 'X-API-Key': key },
  });
  const info = await response.json();
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(OBJECT_INFO_CACHE, JSON.stringify(info));
  log(`object_info 已缓存（${Object.keys(info).length} 个节点）`);
  return info;
}

/** 官方分组 → 我们的六个页签分类；groupLabel 保留官方分组名做二级筛选。 */
function categorize(entry, group) {
  const label = `${group?.category || ''} ${group?.title || ''}`.toLowerCase();
  const media = String(entry.mediaType || '').toLowerCase();
  const name = String(entry.name || '').toLowerCase();
  if (/tool/.test(label)) return 'tools';
  if (/llm|language/.test(label) || /\bllm\b/.test(name)) return 'llm';
  if (/3d|mesh|depth/.test(label) || media === '3d') return '3d';
  if (/audio|voice|music|sound/.test(label) || media === 'audio') return 'audio';
  if (/video/.test(label) || media === 'video' || name.startsWith('video_')) {
    return 'video';
  }
  if (/image|vector/.test(label) || media === 'image') return 'image';
  return 'image';
}

function groupLabel(entry, group) {
  const applied = String(group?.category || '') === 'Applied';
  const title = String(group?.title || '').trim();
  if (applied && title) return title.slice(0, 64);
  // Foundation 下的分组名（Image/Video/…）没有信息量，改用媒体动作描述场景
  const name = String(entry.name || '');
  if (name.includes('_t2i')) return '文生图';
  if (name.includes('_i2i') || name.includes('image_edit')) return '图生图';
  if (name.includes('_t2v')) return '文生视频';
  if (name.includes('_i2v')) return '图生视频';
  if (name.includes('_t2a') || name.includes('audio')) return '音频生成';
  return title ? title.slice(0, 64) : '';
}

/** 官方缩略图路径：index 里给的是仓库相对路径（output/… 或 thumbnail/…）。 */
function coverOf(entry) {
  const first = Array.isArray(entry.thumbnail)
    ? entry.thumbnail[0]
    : String(entry.thumbnail || '');
  if (!first) return '';
  if (/^https?:/i.test(first)) return first;
  return `${SOURCE}/${first.replace(/^\/+/, '')}`;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** 删掉本模板残留的封面（仓库只收得下小图；大图改走官方地址，不能把历史文件留在仓库）。 */
async function dropCovers(name) {
  const files = await readdir(DATA_DIR);
  await Promise.all(
    files
      .filter(
        (file) =>
          file.startsWith(`${name}.`) &&
          /\.(webp|png|jpe?g|gif)$/i.test(file) &&
          file !== `${name}.meta.json`,
      )
      .map((file) => unlink(join(DATA_DIR, file).replace(/\\/g, '/'))),
  );
}

async function importOne(entry, group, objectInfo) {
  const name = String(entry.name || '').trim();
  if (!/^[\w.-]{1,80}$/.test(name)) return { name, ok: false, reason: '模板名不合用' };
  const metaPath = join(DATA_DIR, `${name}.meta.json`);
  if (!options.force && (await exists(metaPath))) {
    return { name, ok: true, skipped: true };
  }
  const workflowResponse = await get(`${SOURCE}/templates/${name}.json`);
  const text = await workflowResponse.text();
  if (text.length > 4 * 1024 * 1024) return { name, ok: false, reason: '模板 JSON 超过 4MB' };
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { name, ok: false, reason: '模板 JSON 解析失败' };
  }

  // 已经是 API 格式的（极少数）直接用；否则离线转一次
  const converted = isApiFormat(raw)
    ? { ok: true, graph: raw, nodes: Object.keys(raw).length }
    : uiToApi(raw, objectInfo);
  const usable = converted.ok ? converted : null;
  const workflow = usable ? usable.graph : raw;
  const format = usable ? 'api' : 'ui';
  const combos = {};
  if (usable && objectInfo) {
    for (const [nodeId, node] of Object.entries(usable.graph)) {
      const spec = objectInfo[node.class_type];
      if (spec) combos[nodeId] = combosFromClass(spec);
    }
  }
  const slots = usable
    ? suggestSlots(usable.graph, {
        combos,
        seedKey: 'seed',
      })
    : [];

  const remoteCover = coverOf(entry);
  const maxCoverBytes = Math.max(0, Number(options['max-cover-kb']) || 0) * 1024;
  let coverFile = '';
  let coverUrl = options.covers === 'none' ? remoteCover : '';
  if (remoteCover && options.covers !== 'none') {
    const ext = (remoteCover.match(/\.(png|jpe?g|webp|gif)$/i) || [, 'webp'])[1]
      .toLowerCase()
      .replace('jpeg', 'jpg');
    const local = `${name}.${ext}`;
    if (options.covers === 'local' && !options['dry-run']) {
      try {
        const response = await get(remoteCover);
        const bytes = Buffer.from(await response.arrayBuffer());
        // 官方缩略图常见 1–2MB PNG：仓库只收小图，超上限的一律改引官方地址，
        // 并清掉同名残留封面，避免历史大图跟着仓库走
        if (bytes.length <= maxCoverBytes) {
          await writeFile(join(DATA_DIR, local), bytes);
          coverFile = local;
        } else {
          await dropCovers(name);
          coverUrl = remoteCover;
          log(`${name} 封面 ${Math.round(bytes.length / 1024)}KB 超上限，改为引用官方地址`);
        }
      } catch (caught) {
        await dropCovers(name);
        coverUrl = remoteCover;
        log(`${name} 封面下载失败（${caught.message}），改为引用官方地址`);
      }
    } else {
      coverUrl = remoteCover;
    }
  }

  const meta = {
    name,
    title: String(entry.title || name).slice(0, 200),
    summary: String(entry.description || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500),
    description: String(entry.description || '').slice(0, 8000),
    category: categorize(entry, group),
    groupLabel: groupLabel(entry, group),
    tags: (entry.tags || []).concat(entry.models || []).slice(0, 12).map(String),
    mediaType: ['image', 'video', 'audio'].includes(entry.mediaType)
      ? entry.mediaType
      : 'file',
    format,
    convertReason: usable ? '' : converted.reason || '未知',
    slots,
    coverFile,
    coverUrl,
    comfyUrl: `https://cloud.comfy.org/?template=${encodeURIComponent(name)}`,
    author: String(entry.username || 'ComfyUI').slice(0, 64),
    usage: Number(entry.usage || 0),
    nodes: usable ? usable.nodes : 0,
    sourceFile: `${name}.json`,
  };
  if (!options['dry-run']) {
    await writeFile(join(DATA_DIR, `${name}.json`), JSON.stringify(workflow));
    await writeFile(metaPath, JSON.stringify(meta, null, 2));
  }
  return { name, ok: true, format, nodes: meta.nodes, reason: meta.convertReason };
}

/** 简易并发池：顺序取任务，失败只记一条，不影响整批。 */
async function runPool(items, worker) {
  const results = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await worker(...items[index]);
      } catch (caught) {
        results[index] = { name: items[index][0]?.name, ok: false, reason: caught.message };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

async function main() {
  const limit = Math.max(1, Math.min(735, Number(options.limit) || 120));
  const minUsage = Math.max(0, Number(options['min-usage']) || 0);
  if (!['local', 'remote', 'none'].includes(options.covers)) {
    throw new Error('--covers 只能是 local | remote | none');
  }
  await mkdir(DATA_DIR, { recursive: true });

  const indexUrl = `${SOURCE}/templates/index.json`;
  log(`拉取官方模板索引 ${indexUrl}`);
  const groups = await (await get(indexUrl)).json();
  const flat = [];
  for (const group of groups) {
    for (const entry of group.templates || []) flat.push([entry, group]);
  }
  flat.sort(
    (a, b) =>
      (Number(b[0].usage || 0) - Number(a[0].usage || 0)) ||
      String(a[0].name).localeCompare(String(b[0].name)),
  );
  const objectInfo = await loadObjectInfo();

  let picked = flat.filter(([entry]) => Number(entry.usage || 0) >= minUsage);
  if (options.category) {
    picked = picked.filter(
      ([entry, group]) => categorize(entry, group) === options.category,
    );
  }
  picked = picked.slice(0, limit);
  log(`候选 ${flat.length} 个，本次导入 ${picked.length} 个${options['dry-run'] ? '（dry-run 不写文件）' : ''}`);

  const results = await runPool(
    picked.map(([entry, group]) => [entry, group, objectInfo]),
    importOne,
  );
  const written = results.filter((item) => item && item.ok && !item.skipped);
  const runnable = written.filter((item) => item.format === 'api');
  const failed = results.filter((item) => !item || !item.ok);
  log(
    `完成：可直接运行 ${runnable.length} 个，仅浏览 ${written.length - runnable.length} 个，` +
      `跳过已存在 ${results.filter((item) => item?.skipped).length} 个，失败 ${failed.length} 个`,
  );
  if (runnable.length < 40) {
    log(
      '提示：可运行条目少于 40 个。带 COMFY_API_KEY 重跑（会拉 object_info 并按真实节点定义转换）可显著提高覆盖。',
    );
  }
  for (const item of failed.slice(0, 10)) {
    log(`失败 ${item?.name}：${item?.reason}`);
  }

  // 已存在且本轮没选中的历史条目不自动清理（删文件交给开发者自己），
  // 想缩目录时：`Remove-Item backend/prisma/data/comfy-templates/*` 后重跑。
}

main().catch(async (error) => {
  console.error('[comfy-import] 失败：', error?.message || error);
  process.exitCode = 1;
});
