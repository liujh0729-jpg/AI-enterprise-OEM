import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';

/** 与界面展示同口径的掩码：前 4 位 + 省略号 + 后 4 位。 */
export function maskPlatformKey(plain: string) {
  const value = String(plain || '');
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

/**
 * 模型调用凭证（设计 3.4「模型配置贯通」）：开源版不再向账号侧代查/代申 sk- Key，
 * 路由层已经把「用户绑定的 AIPDD APIKey」解析好作为 token 传入——绑定了 Key，
 * 上游模型配置即整体一致，无需二次配置；未绑定则给出引导性 403。
 * （原「测试兜底 Key CONTENT_TEST_AIPDD_KEY」与 Java `api_key/list` 内省逻辑随 M3 删除。）
 */
export class ModelKeyService {
  status(token?: string) {
    return {
      configured: Boolean(token),
      keyMasked: token ? maskPlatformKey(token) : '',
    };
  }

  requireKey(token?: string) {
    if (!token) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '请先在「模型服务 → API Key 管理」绑定 AIPDD API Key，再使用模型能力',
      );
    }
    return token;
  }
}
