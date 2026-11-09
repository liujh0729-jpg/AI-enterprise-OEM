import { createCipheriv, randomBytes } from 'node:crypto';
import {
  callbackSignature,
  decryptWecomPayload,
  parseWecomCallback,
} from './scrm-callback';
import { ScrmComplianceService } from './scrm-compliance';
import { ScrmCrypto } from './scrm-crypto';
import type { PrismaService } from '../prisma/prisma.service';
import type { ScrmScopeService } from './scrm.scope';
import type { ScrmSopService } from './scrm-sop.service';
import type { AiEvalService } from '../ai/ai-eval.service';
import type { HrmOrg } from '../hrm/hrm.scope';
import { stub } from '../../test/doubles';

/** 企微回调：AESKey 是 32 字节密钥的 base64（去掉末尾 =），报文用 AES-256-CBC。 */
function wecomAesKey(): string {
  return randomBytes(32).toString('base64').replace(/=+$/, '');
}

function encryptWecomPayload(
  aesKey: string,
  message: string,
  receiveId: string,
): string {
  const key = Buffer.from(`${aesKey}=`, 'base64');
  const body = Buffer.from(message, 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length, 0);
  const raw = Buffer.concat([
    randomBytes(16),
    length,
    body,
    Buffer.from(receiveId, 'utf8'),
  ]);
  const pad = 32 - (raw.length % 32);
  const padded = Buffer.concat([raw, Buffer.alloc(pad, pad)]);
  const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString(
    'base64',
  );
}

describe('scrm callback crypto', () => {
  it('签名与参数顺序无关，且改动任一参数都会变', () => {
    const token = 'token-1';
    const signature = callbackSignature(token, '1730000000', 'nonce', 'cipher');
    expect(callbackSignature(token, '1730000000', 'nonce', 'cipher')).toBe(
      signature,
    );
    expect(
      callbackSignature(token, '1730000000', 'nonce', 'cipher-2'),
    ).not.toBe(signature);
  });

  it('安全模式报文可解出消息与 receiveid', () => {
    const aesKey = wecomAesKey();
    const message =
      '<xml><Event><![CDATA[change_external_contact]]></Event></xml>';
    const encrypted = encryptWecomPayload(aesKey, message, 'ww-corp-1');
    expect(decryptWecomPayload(aesKey, encrypted)).toEqual({
      message,
      receiveId: 'ww-corp-1',
    });
  });

  it('AESKey 长度不对直接报错，不做容错猜测', () => {
    expect(() => decryptWecomPayload('short', 'AAAA')).toThrow(
      'EncodingAESKey 长度不正确',
    );
  });

  it('回调 XML 同时支持 CDATA 与纯文本标签', () => {
    const event = parseWecomCallback(
      [
        '<xml>',
        '<ToUserName><![CDATA[ww-corp-1]]></ToUserName>',
        '<MsgType><![CDATA[event]]></MsgType>',
        '<Event><![CDATA[change_external_contact]]></Event>',
        '<ChangeType>add_external_contact</ChangeType>',
        '<ExternalUserID><![CDATA[wm-1]]></ExternalUserID>',
        '</xml>',
      ].join(''),
    );
    expect(event.ToUserName).toBe('ww-corp-1');
    expect(event.ChangeType).toBe('add_external_contact');
    expect(event.ExternalUserID).toBe('wm-1');
    expect(event.UserID).toBeUndefined();
  });
});

describe('scrm credential crypto', () => {
  const original = process.env.EXTERNAL_CRED_KEY;

  afterEach(() => {
    if (original === undefined) delete process.env.EXTERNAL_CRED_KEY;
    else process.env.EXTERNAL_CRED_KEY = original;
  });

  it('未配置密钥时启动即报错，避免明文落库', () => {
    delete process.env.EXTERNAL_CRED_KEY;
    expect(() => new ScrmCrypto()).toThrow('EXTERNAL_CRED_KEY 未配置');
  });

  it('加密可逆，且空值不产生密文', () => {
    process.env.EXTERNAL_CRED_KEY = 'unit-test-key';
    const crypto = new ScrmCrypto();
    const sealed = crypto.encrypt('secret-value');
    expect(sealed).not.toContain('secret-value');
    expect(crypto.decrypt(sealed)).toBe('secret-value');
    expect(crypto.encrypt('')).toBe('');
    expect(crypto.decrypt('')).toBe('');
  });

  it('密文被篡改时解密失败', () => {
    process.env.EXTERNAL_CRED_KEY = 'unit-test-key';
    const crypto = new ScrmCrypto();
    const [iv, tag, body] = crypto.encrypt('secret-value').split(':');
    // 翻转首字符，保证密文一定变化（GCM 会因认证标签不匹配而拒绝）
    const flipped = `${body[0] === 'A' ? 'B' : 'A'}${body.slice(1)}`;
    const tampered = [iv, tag, flipped].join(':');
    expect(() => crypto.decrypt(tampered)).toThrow();
  });
});

/** 合规检查只依赖词表、台账与 SOP 触发，用最小桩验证方向语义。 */
function complianceWith(
  words: {
    word: string;
    action: string;
    direction: string;
    replacement: string;
    groupName: string;
  }[],
) {
  const createMany = jest.fn(
    async (args: { data: { direction: string; contactId: number }[] }) => ({
      count: args.data.length,
    }),
  );
  const triggerKeyword = jest.fn(async () => undefined);
  const prisma = {
    scrmSensitiveWord: { findMany: jest.fn(async () => words) },
    scrmSensitiveHit: { createMany },
    scrmContact: { findFirst: jest.fn(async () => null) },
  };
  const service = new ScrmComplianceService(
    stub<PrismaService>(prisma),
    stub<ScrmScopeService>({}),
    stub<ScrmSopService>({ triggerKeyword }),
    stub<AiEvalService>({}),
  );
  return { service, createMany, triggerKeyword };
}

const org = stub<HrmOrg>({ orgType: 'ENTERPRISE', orgUserId: 'u-1' });

describe('scrm compliance direction semantics', () => {
  it('出站 BLOCK 拦截并写台账', async () => {
    const { service, createMany } = complianceWith([
      {
        word: '保本',
        action: 'BLOCK',
        direction: 'OUTBOUND',
        replacement: '',
        groupName: '承诺用语',
      },
    ]);
    const result = await service.inspect(org, {
      texts: ['这个产品保本保收益'],
      direction: 'OUTBOUND',
      contactId: 9,
    });
    expect(result.blocked).toBe(true);
    expect(result.hits).toEqual([
      { word: '保本', action: 'BLOCK', group: '承诺用语' },
    ]);
    expect(createMany).toHaveBeenCalledTimes(1);
    const data = createMany.mock.calls[0][0].data;
    expect(data[0].direction).toBe('OUTBOUND');
    expect(data[0].contactId).toBe(9);
  });

  it('出站 REPLACE 改写后放行', async () => {
    const { service } = complianceWith([
      {
        word: '保本',
        action: 'REPLACE',
        direction: 'OUTBOUND',
        replacement: '稳健',
        groupName: '承诺用语',
      },
    ]);
    const result = await service.inspect(org, {
      texts: ['这个产品保本'],
      direction: 'OUTBOUND',
      record: false,
    });
    expect(result.blocked).toBe(false);
    expect(result.replaced).toBe('这个产品稳健');
  });

  it('入站即使配置 BLOCK 也只告警，不改写客户消息', async () => {
    const { service, createMany, triggerKeyword } = complianceWith([
      {
        word: '保本',
        action: 'BLOCK',
        direction: 'INBOUND',
        replacement: '',
        groupName: '承诺用语',
      },
    ]);
    const result = await service.inspect(org, {
      texts: ['你们这个保本吗'],
      direction: 'INBOUND',
      contactId: 12,
      staffUserId: 'staff-1',
    });
    expect(result.blocked).toBe(false);
    expect(result.replaced).toBe('你们这个保本吗');
    expect(result.hits[0].action).toBe('ALERT');
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(triggerKeyword).toHaveBeenCalledTimes(1);
  });

  it('手动试检不写台账', async () => {
    const { service, createMany } = complianceWith([
      {
        word: '保本',
        action: 'BLOCK',
        direction: 'OUTBOUND',
        replacement: '',
        groupName: '',
      },
    ]);
    const result = await service.inspect(org, {
      texts: ['保本'],
      direction: 'OUTBOUND',
      record: false,
    });
    expect(result.blocked).toBe(true);
    expect(createMany).not.toHaveBeenCalled();
  });
});
