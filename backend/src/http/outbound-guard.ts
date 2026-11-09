import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import {
  matchBlacklistHost,
  type BlacklistEntryLite,
} from '../feature/skill-review.rules';

/**
 * 客户自定义渠道的出站守卫：只允许 https 公网地址。
 *
 * 不跟随重定向（调用方必须传 redirect: 'manual'），发送前重新解析 DNS 并逐个校验，
 * 避免把工作台回复发进内网或云元数据服务。
 * 已知残留：解析与 fetch 之间存在 DNS rebinding 窗口，文档中已注明。
 */

const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

const BLOCKED_HOSTS = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'instance-data',
]);
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain'];

/**
 * 官方协议里只提供 http 的固定端点（百度主动推送 data.zz.baidu.com 的证书与主机名不匹配，
 * 实测 https 握手失败）。主机名是代码常量、不接受用户输入，调用方必须显式开启；
 * 开启后仍执行下面的 DNS 全地址内网/元数据校验，只放开协议这一项。
 */
const HTTP_ONLY_OFFICIAL_HOSTS = new Set(['data.zz.baidu.com']);

export type OutboundGuardOptions = {
  /** 仅对 HTTP_ONLY_OFFICIAL_HOSTS 里的常量主机生效，用户可控地址一律不放开。 */
  allowOfficialHttp?: boolean;
};

/**
 * 平台管理员黑名单（§5.9 红线 4 运行期强制）：由 AccessPolicyService 在读取/保存策略时
 * 推送到这里（TTL 15s），出站守卫保持同步判定；命中一律拒绝，开发环境不豁免。
 */
let adminBlacklist: BlacklistEntryLite[] = [];
export function setOutboundBlacklist(entries: BlacklistEntryLite[]) {
  adminBlacklist = entries;
}

function isDevelopment() {
  return (
    (process.env.ENTERPRISE_ENV || '').trim().toLowerCase() === 'development'
  );
}

function isLocalHost(host: string) {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function v4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const num = Number(part);
    if (!Number.isInteger(num) || num < 0 || num > 255) return null;
    value = (value << 8) + num;
  }
  return value >>> 0;
}

function blockedV4(ip: string): boolean {
  const value = v4ToInt(ip);
  if (value === null) return true;
  return BLOCKED_V4.some(([base, bits]) => {
    const start = v4ToInt(base);
    if (start === null) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (start & mask);
  });
}

function blockedV6(raw: string): boolean {
  const ip = raw.replace(/^\[|\]$/g, '').toLowerCase();
  if (ip === '::' || ip === '::1') return true;
  if (ip.startsWith('::ffff:')) {
    const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
    return dotted ? blockedV4(dotted[1]) : true;
  }
  const nat64 = /^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (nat64) return blockedV4(nat64[1]);
  const head = ip.split(':')[0];
  const first = head ? parseInt(head, 16) : 0;
  if ((first & 0xffc0) === 0xfe80) return true;
  if ((first & 0xfe00) === 0xfc00) return true;
  if ((first & 0xff00) === 0xff00) return true;
  return false;
}

function fail(label: string, reason: string): never {
  throw new BusinessException(ErrorCode.BAD_REQUEST, `${label}${reason}`);
}

/**
 * 同步校验：协议、字面量 IP、明显的内网主机名。
 * 保存渠道时即可调用，避免把注定无法发送的地址存进配置。
 */
export function assertOutboundUrlSync(
  raw: string,
  label = '出站地址',
  options: OutboundGuardOptions = {},
): URL {
  const input = raw.trim();
  if (!input) fail(label, '不能为空');
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    fail(label, '格式不正确，需要完整的 https:// 地址');
  }
  const dev = isDevelopment();
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const loopback = isLocalHost(host);
  const officialHttp =
    options.allowOfficialHttp === true &&
    url.protocol === 'http:' &&
    HTTP_ONLY_OFFICIAL_HOSTS.has(host);
  if (
    url.protocol !== 'https:' &&
    !officialHttp &&
    !(dev && loopback && url.protocol === 'http:')
  ) {
    fail(label, '只支持 https://（开发环境仅回环地址可用 http）');
  }
  if (url.username || url.password) {
    fail(label, '不能带账号密码，请改用校验请求头');
  }
  if (matchBlacklistHost(adminBlacklist, host)) {
    fail(label, '命中平台访问黑名单');
  }
  if (dev && loopback) return url;
  if (BLOCKED_HOSTS.has(host)) fail(label, '不能指向本机或内网主机');
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    fail(label, '不能指向内网域名');
  }
  const family = isIP(host);
  if (family === 4 && blockedV4(host)) fail(label, '不能指向内网地址');
  if (family === 6 && blockedV6(host)) fail(label, '不能指向内网地址');
  return url;
}

/** 发送前调用：同步校验 + DNS 全部地址逐个校验。 */
export async function assertOutboundUrl(
  raw: string,
  label = '出站地址',
  options: OutboundGuardOptions = {},
): Promise<URL> {
  const url = assertOutboundUrlSync(raw, label, options);
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (isDevelopment() && isLocalHost(host)) return url;
  if (isIP(host)) {
    if (isIP(host) === 4 ? blockedV4(host) : blockedV6(host)) {
      fail(label, '不能指向内网地址');
    }
    return url;
  }
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    fail(label, `域名无法解析：${host}`);
  }
  if (!addresses.length) fail(label, `域名无法解析：${host}`);
  for (const item of addresses) {
    const blocked =
      item.family === 4 ? blockedV4(item.address) : blockedV6(item.address);
    if (blocked) fail(label, '解析到内网地址，已拒绝发送');
  }
  return url;
}
