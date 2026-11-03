import { MCP_API_KEY_PREFIX } from '@enterprise/contracts';

/**
 * 标准 MCP 客户端普遍只肯发 `Authorization: Bearer ...`，本站机器通道的 Key 又在 `X-Api-Key` 上。
 * 两种写法背后是同一把 `ek_` Key、同一套校验、同一条审计，所以这里只把「看起来像 Key 的 Bearer」挑出来，
 * JWT（不以 `ek_` 开头）一律不认，避免把会话令牌喂进 Key 校验分支。
 */
export function bearerApiKey(
  authorization: string | undefined,
): string | undefined {
  const match = /^\s*bearer\s+(\S+)\s*$/i.exec(authorization ?? '');
  const value = match?.[1];
  return value?.startsWith(MCP_API_KEY_PREFIX) ? value : undefined;
}
