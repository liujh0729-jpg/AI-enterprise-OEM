import { createDecipheriv, createHash, timingSafeEqual } from 'node:crypto';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { ScrmScopeService } from './scrm.scope';
import { ScrmSyncService } from './scrm-sync.service';
import { ScrmCodeService } from './scrm-code.service';
import { orgOf } from './scrm.helpers';
import type { ApiEnv } from '../http/types';
import type { Services } from '../http/services';

/**
 * 企业微信回调：路径里带每家企业的随机 callbackKey，公开、免登录。
 *
 * - 必须安全模式：msg_signature = sha1(sort(token, timestamp, nonce, encrypt))；
 * - AES-256-CBC 解密后用 receiveid 校验确实是本企业，防止串企；
 * - 5 分钟内同一 (encrypt, timestamp, nonce) 只处理一次，事件幂等；
 * - 验签失败一律拒绝并记录来源，不处理未验签事件。
 */

const REPLAY_TTL_MS = 10 * 60_000;
const replay = new Map<string, number>();
const MAX_REPLAY = 5000;

function pruneReplay(now: number) {
  if (replay.size < MAX_REPLAY) return;
  for (const [key, at] of replay) {
    if (now - at > REPLAY_TTL_MS) replay.delete(key);
  }
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 微信系签名：四个值字典序排序后 sha1。 */
export function callbackSignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypt: string,
): string {
  return createHash('sha1')
    .update([token, timestamp, nonce, encrypt].sort().join(''))
    .digest('hex');
}

export type DecryptedCallback = { message: string; receiveId: string };

/** 解密企微安全模式报文；格式不符直接抛错，不做容错猜测。 */
export function decryptWecomPayload(
  aesKey: string,
  encryptedBase64: string,
): DecryptedCallback {
  const key = Buffer.from(`${aesKey}=`, 'base64');
  if (key.length !== 32) {
    throw new Error('EncodingAESKey 长度不正确（应为 43 位字符）');
  }
  const encrypted = Buffer.from(encryptedBase64, 'base64');
  const decipher = createDecipheriv('aes-256-cbc', key, key.subarray(0, 16));
  decipher.setAutoPadding(false);
  let plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  const pad = plain[plain.length - 1];
  if (pad < 1 || pad > 32) {
    throw new Error('回调报文填充不合法');
  }
  plain = plain.subarray(0, plain.length - pad);
  if (plain.length < 20) {
    throw new Error('回调报文长度不合法');
  }
  const length = plain.readUInt32BE(16);
  if (20 + length > plain.length) {
    throw new Error('回调报文内容长度不合法');
  }
  return {
    message: plain.subarray(20, 20 + length).toString('utf8'),
    receiveId: plain.subarray(20 + length).toString('utf8'),
  };
}

function xmlValue(xml: string, tag: string): string {
  const cdata = xml.match(
    new RegExp(`<${tag}>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`),
  );
  if (cdata) return cdata[1];
  const plain = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return plain ? plain[1].trim() : '';
}

const EVENT_TAGS = [
  'ToUserName',
  'FromUserName',
  'CreateTime',
  'MsgType',
  'Event',
  'ChangeType',
  'UserID',
  'ExternalUserID',
  'State',
  'WelcomeCode',
  'ChatId',
  'UpdateDetail',
  'TagId',
  'TagType',
  'Id',
  'AgentID',
  'Content',
];

/** 回调 XML → 事件字段（只取本项目会用到、且不含敏感正文之外的标签）。 */
export function parseWecomCallback(xml: string): Record<string, string> {
  const event: Record<string, string> = {};
  for (const tag of EVENT_TAGS) {
    const value = xmlValue(xml, tag);
    if (value) event[tag] = value;
  }
  return event;
}

export type CallbackResponse = {
  status: number;
  body: string;
  contentType: string;
};

const textResponse = (body: string, status = 200): CallbackResponse => ({
  status,
  body,
  contentType: 'text/plain; charset=utf-8',
});

export class ScrmCallbackService {
  constructor(
    private readonly scope: ScrmScopeService,
    private readonly sync: ScrmSyncService,
    private readonly codes: ScrmCodeService,
  ) {}

  /** URL 校验：验签后返回解密后的 echostr（原样纯文本）。 */
  async verifyUrl(input: {
    key: string;
    query: Record<string, string>;
    ip: string;
  }): Promise<CallbackResponse> {
    const corp = await this.scope.corpByKey(input.key);
    if (!corp || !corp.callbackTokenEnc || !corp.aesKeyEnc) {
      this.log(
        'callback_rejected',
        input.key,
        input.ip,
        '企微尚未配置回调凭据',
      );
      return textResponse('corp not ready', 403);
    }
    const secrets = this.scope.secretsOf(corp);
    const msgSignature = text(input.query.msg_signature);
    const timestamp = text(input.query.timestamp);
    const nonce = text(input.query.nonce);
    const echo = text(input.query.echostr);
    if (!msgSignature || !timestamp || !nonce || !echo) {
      this.log('callback_rejected', input.key, input.ip, '缺少验签参数');
      return textResponse('missing signature', 403);
    }
    const expected = callbackSignature(
      secrets.callbackToken,
      timestamp,
      nonce,
      echo,
    );
    if (!safeEqual(expected, msgSignature)) {
      this.log('callback_rejected', input.key, input.ip, 'URL 校验签名不匹配');
      return textResponse('invalid signature', 403);
    }
    try {
      const decrypted = decryptWecomPayload(secrets.aesKey, echo);
      if (decrypted.receiveId !== secrets.corpId) {
        this.log(
          'callback_rejected',
          input.key,
          input.ip,
          'receiveid 与 CorpID 不一致',
        );
        return textResponse('invalid receiveid', 403);
      }
      return textResponse(decrypted.message);
    } catch (error) {
      this.log(
        'callback_rejected',
        input.key,
        input.ip,
        error instanceof Error ? error.message : '解密失败',
      );
      return textResponse('decrypt failed', 400);
    }
  }

  /** 事件回调：验签 → 解密 → receiveid 校验 → 重放去重 → 分发。 */
  async receive(input: {
    key: string;
    query: Record<string, string>;
    rawBody: string;
    ip: string;
  }): Promise<CallbackResponse> {
    const corp = await this.scope.corpByKey(input.key);
    if (!corp || !corp.callbackTokenEnc || !corp.aesKeyEnc) {
      this.log(
        'callback_rejected',
        input.key,
        input.ip,
        '企微尚未配置回调凭据',
      );
      return textResponse('corp not ready', 403);
    }
    const secrets = this.scope.secretsOf(corp);
    const msgSignature = text(input.query.msg_signature);
    const timestamp = text(input.query.timestamp);
    const nonce = text(input.query.nonce);
    const encrypt = xmlValue(input.rawBody, 'Encrypt');
    if (!msgSignature || !timestamp || !nonce || !encrypt) {
      this.log('callback_rejected', input.key, input.ip, '缺少安全模式参数');
      return textResponse('plaintext mode unsupported', 403);
    }
    const expected = callbackSignature(
      secrets.callbackToken,
      timestamp,
      nonce,
      encrypt,
    );
    if (!safeEqual(expected, msgSignature)) {
      this.log('callback_rejected', input.key, input.ip, '事件签名不匹配');
      return textResponse('invalid signature', 403);
    }
    const now = Date.now();
    pruneReplay(now);
    const replayKey = createHash('sha1')
      .update(`${encrypt}|${timestamp}|${nonce}`)
      .digest('hex');
    if (replay.has(replayKey)) {
      return textResponse('success');
    }
    replay.set(replayKey, now);

    let event: Record<string, string>;
    try {
      const decrypted = decryptWecomPayload(secrets.aesKey, encrypt);
      if (decrypted.receiveId !== secrets.corpId) {
        replay.delete(replayKey);
        this.log(
          'callback_rejected',
          input.key,
          input.ip,
          'receiveid 与 CorpID 不一致',
        );
        return textResponse('invalid receiveid', 403);
      }
      event = parseWecomCallback(decrypted.message);
    } catch (error) {
      replay.delete(replayKey);
      this.log(
        'callback_rejected',
        input.key,
        input.ip,
        error instanceof Error ? error.message : '解密失败',
      );
      return textResponse('decrypt failed', 400);
    }
    if (!corp.enabled) {
      return textResponse('success');
    }
    const org = orgOf({ orgType: corp.orgType, orgUserId: corp.orgUserId });
    const ip = input.ip;
    const isAdd =
      event.Event === 'change_external_contact' &&
      (event.ChangeType === 'add_external_contact' ||
        event.ChangeType === 'add_half_external_contact');
    // 欢迎语必须用事件里的 WelcomeCode 在 20 秒内发出，先发再落库
    if (isAdd) {
      try {
        await this.codes.sendWelcomeOnAdd(org, secrets, event);
      } catch (error) {
        console.warn(
          JSON.stringify({
            event: 'scrm_welcome_failed',
            key: input.key,
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }
    try {
      const note = await this.sync.handleEvent(org, secrets, event);
      if (note) {
        console.log(
          JSON.stringify({
            event: 'scrm_callback',
            key: input.key,
            ip,
            type: event.Event || event.MsgType || '',
            result: note,
          }),
        );
      }
      if (isAdd) {
        await this.codes.afterAdded(org, secrets, event);
      }
    } catch (error) {
      // 事件幂等，单次处理失败不阻塞应答；记录后等下一次事件/定时对账补齐
      console.warn(
        JSON.stringify({
          event: 'scrm_callback_failed',
          key: input.key,
          ip,
          type: event.Event || event.MsgType || '',
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    return textResponse('success');
  }

  private log(event: string, key: string, ip: string, message: string) {
    console.warn(JSON.stringify({ event, callbackKey: key, ip, message }));
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** 公开回调路由：不走登录态、不走统一信封，按企微规范原样应答。 */
export function registerScrmPublic(
  app: OpenAPIHono<ApiEnv>,
  services: Services,
) {
  const receiver = services.scrm.callback;
  const queryOf = (c: { req: { query: () => Record<string, unknown> } }) => {
    const query: Record<string, string> = {};
    for (const [name, value] of Object.entries(c.req.query())) {
      query[name] = String(value);
    }
    return query;
  };
  const ipOf = (c: { req: { header: (name: string) => string | undefined } }) =>
    (c.req.header('x-forwarded-for') || '').split(',')[0].trim() ||
    c.req.header('x-real-ip') ||
    '0.0.0.0';

  app.get('/enterprise/wecom-scrm/callback/:key', async (c) => {
    const received = await receiver.verifyUrl({
      key: String(c.req.param('key') || ''),
      query: queryOf(c),
      ip: ipOf(c),
    });
    return new Response(received.body, {
      status: received.status,
      headers: {
        'content-type': received.contentType,
        'cache-control': 'no-store',
      },
    });
  });

  app.post('/enterprise/wecom-scrm/callback/:key', async (c) => {
    const received = await receiver.receive({
      key: String(c.req.param('key') || ''),
      query: queryOf(c),
      rawBody: await c.req.text(),
      ip: ipOf(c),
    });
    return new Response(received.body, {
      status: received.status,
      headers: {
        'content-type': received.contentType,
        'cache-control': 'no-store',
      },
    });
  });
}
