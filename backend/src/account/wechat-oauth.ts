import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { httpRequest, TransportError } from '../http/transport';

/**
 * 微信开放平台「网站应用」扫码登录的最小客户端：
 * 只做 code 换 access_token/openid 与拉取用户资料两步，不需要 SDK。
 * 微信侧错误统一转成业务异常，失败不产生任何本地写入。
 */

type WechatError = { errcode?: number; errmsg?: string };

function wechatError(payload: WechatError): BusinessException {
  // 40029 = code 无效/已用；40163 = code 已被使用；其余按微信原始文案返回，便于管理员排查
  const message =
    payload.errcode === 40029 || payload.errcode === 40163
      ? '微信授权已失效，请重新扫码'
      : `微信授权失败（${payload.errcode ?? '未知'}）${payload.errmsg ? `：${payload.errmsg}` : ''}`;
  return new BusinessException(ErrorCode.BAD_REQUEST, message);
}

async function getJson<T extends WechatError>(url: string): Promise<T> {
  try {
    const result = await httpRequest<T>(url, {
      readAs: 'json',
      timeoutMs: 10_000,
      operation: 'wechat-oauth',
      maxBytes: 256 * 1024,
    });
    if (!result.ok) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        `微信接口暂不可用（HTTP ${result.status}）`,
      );
    }
    return result.data;
  } catch (error) {
    if (error instanceof BusinessException) throw error;
    throw new BusinessException(
      ErrorCode.SERVICE_UNAVAILABLE,
      error instanceof TransportError && error.kind === 'timeout'
        ? '微信服务响应超时，请稍后重试'
        : '连接微信服务失败，请稍后重试',
    );
  }
}

export type WechatTokenResult = {
  accessToken: string;
  openId: string;
  unionId?: string;
};

export async function exchangeWechatCode(
  appId: string,
  appSecret: string,
  code: string,
): Promise<WechatTokenResult> {
  const query = new URLSearchParams({
    appid: appId,
    secret: appSecret,
    code,
    grant_type: 'authorization_code',
  });
  const payload = await getJson<
    WechatError & {
      access_token?: string;
      openid?: string;
      unionid?: string;
    }
  >(`https://api.weixin.qq.com/sns/oauth2/access_token?${query.toString()}`);
  if (payload.errcode || !payload.access_token || !payload.openid) {
    throw wechatError(payload);
  }
  return {
    accessToken: payload.access_token,
    openId: payload.openid,
    unionId: payload.unionid,
  };
}

export type WechatProfileResult = {
  openId: string;
  unionId?: string;
  nickname?: string;
  avatarUrl?: string;
};

export async function fetchWechatProfile(
  accessToken: string,
  openId: string,
): Promise<WechatProfileResult> {
  const query = new URLSearchParams({
    access_token: accessToken,
    openid: openId,
    lang: 'zh_CN',
  });
  const payload = await getJson<
    WechatError & {
      openid?: string;
      unionid?: string;
      nickname?: string;
      headimgurl?: string;
    }
  >(`https://api.weixin.qq.com/sns/userinfo?${query.toString()}`);
  if (payload.errcode || !payload.openid) throw wechatError(payload);
  return {
    openId: payload.openid,
    unionId: payload.unionid,
    nickname: payload.nickname,
    avatarUrl: payload.headimgurl,
  };
}
