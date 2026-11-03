import type { PrismaService } from '../prisma/prisma.service';

/** 承载站点设置的键名（与 platform/site-settings.service.ts 里的 SITE_KEY 一致）。 */
const SITE_SETTINGS_KEY = 'site_settings';

/** 读库结果缓存时间：多实例部署时，别的进程改了配置也能在这个周期内追上。 */
const CACHE_TTL_MS = 60_000;

let cached: { value: string; at: number } | null = null;

/**
 * 规范化站点对外地址：只认 http/https，省略协议时按 https 补齐，只保留「协议 + 域名(:端口)」。
 * 非法或空值返回空串，由调用方决定回落当前访问域名还是不给绝对地址。
 */
export function normalizeSiteUrl(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value || /[\s@]/.test(value)) return '';
  const hasScheme = /^https?:\/\//i.test(value);
  // 写了别的协议（ftp:/data: 等）一律不收
  if (!hasScheme && /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return '';
  // 省略协议时只接受「域名(:数字端口)(/路径)」，否则 ftp:xxx、mailto:xxx 会被当成域名拼出鬼地址
  const bareHost = /^[^\s/?#@]+(:\d{1,5})?(\/\S*)?$/;
  if (!hasScheme && !bareHost.test(value)) return '';
  const withScheme = hasScheme ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (!url.hostname) return '';
    return url.origin;
  } catch {
    return '';
  }
}

/** 站点设置保存后调用：让下一次读取立刻拿到新域名。 */
export function invalidateSiteUrlCache() {
  cached = null;
}

/**
 * 当前生效的站点对外地址（origin）：
 * 管理员在「平台管理后台 → 站点设置 → 站点域名」填的值优先，其次环境变量 SITE_URL，
 * 两者都没配置返回空串——后台任务（IM 推送、邮件链接等）据此知道「还没告诉我域名」。
 */
export async function resolveSiteUrl(prisma: PrismaService): Promise<string> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  let value = '';
  try {
    const row = await prisma.systemSetting.findUnique({
      where: { key: SITE_SETTINGS_KEY },
    });
    if (row?.value) {
      const stored = JSON.parse(row.value) as { siteUrl?: unknown };
      value = normalizeSiteUrl(stored.siteUrl);
    }
  } catch {
    // 读库失败或 JSON 破损按「未配置」处理，不影响调用方其他逻辑
  }
  if (!value) value = normalizeSiteUrl(process.env.SITE_URL);
  cached = { value, at: Date.now() };
  return value;
}

/**
 * 拼站内绝对链接：没配置对外地址时返回空串——对外推送（IM 卡片、邮件）拼不出绝对地址就不给链接，
 * 而不是把一个站内相对路径发出去（对方点开只会是无效地址）。
 */
export function joinSiteUrl(base: string, path: string): string {
  if (!base) return '';
  const root = base.replace(/\/+$/, '');
  const suffix = path.replace(/^\/+/, '');
  return suffix ? `${root}/${suffix}` : root;
}
