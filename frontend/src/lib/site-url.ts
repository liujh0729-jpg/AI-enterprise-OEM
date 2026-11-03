/**
 * 本站绝对地址的统一取数口径（与后端 common/site-url.ts 同一套规则）：
 * 「平台管理后台 → 站点设置 → 站点域名」配了的值优先，没配就按浏览器当前访问域名推导。
 * 页面上不再写死 http://127.0.0.1:1690、https://enterprise.aiworkin.com 这类地址——
 * 换域名、换端口、局域网访问、Docker 访问都不用改代码。
 */

/** 站点域名尚未配置且页面还没拿到浏览器地址时的占位（只用于展示，不能当真实地址用）。 */
export const SITE_BASE_PLACEHOLDER = "https://你的域名";

/**
 * 规范化站点地址：只认 http/https，省略协议时按 https 补齐，只保留「协议 + 域名(:端口)」。
 * 非法或空值返回空串，调用方据此回落到当前访问域名。
 */
export function normalizeSiteUrl(raw?: string | null): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value || /[\s@]/.test(value)) return "";
  const hasScheme = /^https?:\/\//i.test(value);
  // 写了别的协议（ftp:/data: 等）一律不收
  if (!hasScheme && /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return "";
  // 省略协议时只接受「域名(:数字端口)(/路径)」，避免 ftp:xxx 之类的串被当成域名
  if (!hasScheme && !/^[^\s/?#@]+(:\d{1,5})?(\/\S*)?$/.test(value)) return "";
  const withScheme = hasScheme ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (!url.hostname) return "";
    return url.origin;
  } catch {
    return "";
  }
}

/** 当前访问域名：只在浏览器里取得到，SSR 阶段返回空串。 */
export function currentSiteOrigin(): string {
  if (typeof window === "undefined") return "";
  return normalizeSiteUrl(window.location.origin);
}

/** 拼绝对地址：base 为空时原样返回相对路径（展示处自行决定用占位还是留白）。 */
export function joinSiteUrl(base: string, path: string): string {
  if (!base) return path;
  const root = base.replace(/\/+$/, "");
  const suffix = path.replace(/^\/+/, "");
  return suffix ? `${root}/${suffix}` : root;
}
