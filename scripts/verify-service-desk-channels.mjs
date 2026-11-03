/**
 * AI客服「渠道接入」：接口层实测。
 *
 * 口径：
 * - 打开发实例（默认 1690），只走接口；渠道、会话、消息都在测试主体 demo_enterprise 名下，
 *   并在结束时按本次后缀清理干净（渠道 / 访客 / 会话 / 消息 / 通知）。
 * - 微信客服只验配置与开关：密文不回显、留空沿用、停用后公开回调直接空响应。
 * - 钉钉机器人走完整双向链路：无签名被拒 → 签名回调落会话 → 重复消息去重 →
 *   工作台回复 → 回传失败只记 lastError 并提示一次，不阻断已落库的回复。
 * - 自定义渠道：出站地址护栏（非回环 http / 内网 / 元数据一律 400）、入站映射 + HMAC 验签、
 *   工作台回复按出站模板发到回环 echo 服务，并带回会话级额外字段（{{extra.x}}）。
 *
 * 用法：node scripts/verify-service-desk-channels.mjs [BASE_URL]
 */
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPrisma, createSuite } from './harness.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 只补缺失的环境变量，用于脚本内的 Prisma 清理；不打印任何凭据。 */
function loadDevEnv() {
  if (process.env.DATABASE_URL) return;
  try {
    const raw = readFileSync(join(root, 'backend/.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!match || process.env[match[1]] !== undefined) continue;
      process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    // 没有 .env 时交给 createPrisma 报错
  }
}

loadDevEnv();

const suite = createSuite({ base: process.argv[2] || 'http://127.0.0.1:1690' });
const { call, assert } = suite;

const ACCOUNT = 'demo_enterprise';
const CHANNELS = '/enterprise/service-desk/channels';
const suffix = Date.now().toString().slice(-6);
const wecomName = `冒烟微信客服-${suffix}`;
const dingName = `冒烟钉钉-${suffix}`;
const chatId = `cidSMOKE${suffix}`;
const msgId = `msgSMOKE${suffix}`;
const visitorText = `你好，冒烟测试 ${suffix}`;
const dingSecret = `smoke-secret-${suffix}`;

const hashToken = (value) => createHash('sha256').update(value).digest('hex');

async function postRaw(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
  return { status: res.status, text: await res.text() };
}

async function waitFor(fn, timeoutMs = 90_000, intervalMs = 1_500) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

const created = { channels: [], conversations: [], visitorHashes: [] };
let prisma = null;
let echoServer = null;

try {
  // ---------- 1) 清单可读 ----------
  const before = await call('GET', CHANNELS, ACCOUNT);
  assert(
    before.code === 0 && Array.isArray(before.data),
    '渠道清单可读',
    `code=${before.code}`,
  );

  // ---------- 2) 必填缺失被拒 ----------
  const missing = await call('POST', CHANNELS, ACCOUNT, {
    kind: 'wecom_kf',
    name: `冒烟缺字段-${suffix}`,
    config: { corpId: 'wwsmoke' },
  });
  assert(
    missing.code === 400 && /请填写/.test(missing.message || ''),
    '缺必填字段 → 400 且提示缺哪几项',
    `code=${missing.code} msg=${missing.message}`,
  );

  // ---------- 3) 微信客服：密文不回显、回调地址成形 ----------
  const wecom = await call('POST', CHANNELS, ACCOUNT, {
    kind: 'wecom_kf',
    name: wecomName,
    config: {
      corpId: 'wwsmoke0001',
      secret: `kf-secret-${suffix}`,
      openKfId: 'wkSMOKE',
      token: 'smoke-token',
      encodingAesKey: 'a'.repeat(43),
    },
  });
  assert(wecom.code === 0 && wecom.data?.id > 0, '新建微信客服渠道', `code=${wecom.code} msg=${wecom.message}`);
  const wecomId = wecom.data?.id || 0;
  if (wecomId) {
    created.channels.push(wecomId);
    const view = wecom.data;
    assert(
      view.config?.secret === undefined &&
        view.config?.token === undefined &&
        view.config?.encodingAesKey === undefined,
      '密文字段不回显',
      `config=${Object.keys(view.config || {}).join(',')}`,
    );
    assert(
      view.config?.corpId === 'wwsmoke0001' && view.config?.openKfId === 'wkSMOKE',
      '非密文字段原样回显',
      `config=${JSON.stringify(view.config)}`,
    );
    assert(
      ['secret', 'token', 'encodingAesKey', 'corpId', 'openKfId'].every((key) =>
        (view.configured || []).includes(key),
      ),
      'configured 覆盖全部字段（含密文字段只报有无）',
      `configured=${(view.configured || []).join(',')}`,
    );
    assert(
      view.secretKeys?.length === 3,
      'secretKeys 只列密文字段',
      `secretKeys=${(view.secretKeys || []).join(',')}`,
    );
    assert(
      /^\/api\/public\/service-desk\/channel\/[0-9a-f]{32}$/.test(view.callbackPath || ''),
      '回调地址路径成形',
      `callbackPath=${view.callbackPath}`,
    );

    // ---------- 4) 编辑留空密文 → 沿用已存值 ----------
    const edited = await call('POST', CHANNELS, ACCOUNT, {
      id: wecomId,
      kind: 'wecom_kf',
      name: `${wecomName}-改`,
      config: { corpId: 'wwsmoke0002' },
      enabled: true,
    });
    assert(
      edited.code === 0 &&
        edited.data?.name === `${wecomName}-改` &&
        edited.data?.config?.corpId === 'wwsmoke0002' &&
        ['secret', 'token', 'encodingAesKey'].every((key) =>
          (edited.data?.configured || []).includes(key),
        ),
      '编辑留空密文 → 沿用且非密文可改',
      `code=${edited.code}`,
    );

    // ---------- 5) 停用 → 公开回调空响应；再启用 ----------
    const disabled = await call('POST', CHANNELS, ACCOUNT, {
      id: wecomId,
      kind: 'wecom_kf',
      name: `${wecomName}-改`,
      config: {},
      enabled: false,
    });
    assert(disabled.code === 0 && disabled.data?.enabled === false, '停用渠道');
    const offRes = await postRaw(
      `${suite.base}${edited.data?.callbackPath}`,
      JSON.stringify({}),
    );
    assert(
      offRes.status === 200 && offRes.text === '',
      '停用后公开回调直接空响应',
      `status=${offRes.status} body=${offRes.text.slice(0, 60)}`,
    );
    const enabled = await call('POST', CHANNELS, ACCOUNT, {
      id: wecomId,
      kind: 'wecom_kf',
      name: `${wecomName}-改`,
      config: {},
      enabled: true,
    });
    assert(enabled.code === 0 && enabled.data?.enabled === true, '重新启用渠道');
  }

  // ---------- 6) 钉钉：配置、连接测试不 500 ----------
  const ding = await call('POST', CHANNELS, ACCOUNT, {
    kind: 'dingtalk_robot',
    name: dingName,
    config: {
      appKey: `dingSMOKE${suffix}`,
      appSecret: dingSecret,
      robotCode: `dingRobot${suffix}`,
    },
  });
  assert(ding.code === 0 && ding.data?.id > 0, '新建钉钉机器人渠道', `code=${ding.code} msg=${ding.message}`);
  const dingId = ding.data?.id || 0;
  const callbackPath = ding.data?.callbackPath || '';
  if (dingId) {
    created.channels.push(dingId);
    created.visitorHashes.push(hashToken(`channel|${dingId}|${chatId}`));
    const tested = await call('POST', `${CHANNELS}/${dingId}/test`, ACCOUNT);
    assert(
      tested.code === 0 && tested.data?.ok === false && typeof tested.data?.message === 'string',
      '假凭据测试连接 → 返回失败而非 500',
      `code=${tested.code} ok=${tested.data?.ok}`,
    );

    // ---------- 7) 无签名回调被拒 ----------
    const unsigned = await postRaw(
      `${suite.base}${callbackPath}`,
      JSON.stringify({
        msgtype: 'text',
        text: { content: visitorText },
        conversationId: chatId,
        senderStaffId: `staff${suffix}`,
        msgId,
      }),
    );
    assert(unsigned.status >= 400, '无签名回调被拒', `status=${unsigned.status}`);

    // ---------- 8) 签名回调 → 落会话 ----------
    const timestamp = String(Date.now());
    const sign = createHmac('sha256', dingSecret)
      .update(`${timestamp}\n${dingSecret}`)
      .digest('base64');
    const payload = JSON.stringify({
      msgtype: 'text',
      text: { content: visitorText },
      conversationId: chatId,
      senderStaffId: `staff${suffix}`,
      senderNick: `冒烟访客-${suffix}`,
      msgId,
      sessionWebhook: '',
      robotCode: `dingRobot${suffix}`,
      conversationType: '1',
    });
    const inbound = await postRaw(`${suite.base}${callbackPath}`, payload, {
      timestamp,
      sign,
    });
    assert(inbound.status === 200, '签名回调被接收', `status=${inbound.status}`);

    const found = await waitFor(async () => {
      const list = await call('GET', '/enterprise/service-desk/conversations?page=1&pageSize=50', ACCOUNT);
      const row = (list.data?.list || []).find((item) => item.siteName === dingName);
      return row || null;
    }, 20_000);
    assert(Boolean(found), '渠道消息进入客服会话列表（站名显示渠道名）');
    if (found) {
      created.conversations.push(found.id);
      const detail = await call('GET', `/enterprise/service-desk/conversations/${found.id}`, ACCOUNT);
      const messages = detail.data?.messages || [];
      const visitor = messages.filter((item) => item.senderType === 'visitor' && item.content === visitorText);
      assert(visitor.length === 1, '访客消息落库且只一条', `count=${visitor.length}`);

      // ---------- 9) 重复回调去重 ----------
      const dup = await postRaw(`${suite.base}${callbackPath}`, payload, { timestamp, sign });
      const afterDup = await call('GET', `/enterprise/service-desk/conversations/${found.id}`, ACCOUNT);
      const dupVisitor = (afterDup.data?.messages || []).filter(
        (item) => item.senderType === 'visitor' && item.content === visitorText,
      );
      assert(
        dup.status === 200 && dupVisitor.length === 1,
        '同一 msgId 重复回调 → 去重',
        `status=${dup.status} count=${dupVisitor.length}`,
      );

      // ---------- 10) 工作台回复 → 回传失败降级 ----------
      const reply = await call('POST', `/enterprise/service-desk/conversations/${found.id}/messages`, ACCOUNT, {
        content: `冒烟回复 ${suffix}`,
      });
      assert(reply.code === 0, '回复先落库（不因外部回传失败而阻塞）', `code=${reply.code}`);
      const failed = await waitFor(async () => {
        const channels = await call('GET', CHANNELS, ACCOUNT);
        const row = (channels.data || []).find((item) => item.id === dingId);
        return row && row.lastError ? row : null;
      }, 90_000);
      assert(Boolean(failed), '外部回传失败记到渠道 lastError');

      const afterReply = await call('GET', `/enterprise/service-desk/conversations/${found.id}`, ACCOUNT);
      const rows = afterReply.data?.messages || [];
      assert(
        rows.some((item) => item.senderType === 'agent' && item.content === `冒烟回复 ${suffix}`),
        '回复保留在会话里',
      );
      assert(
        rows.filter((item) => item.senderType === 'system' && item.content.includes('渠道派发失败')).length === 1,
        '回传失败提示只出现一次',
      );
    }
  }

  // ---------- 11) 自定义渠道：出站护栏 ----------
  const customName = `冒烟自定义-${suffix}`;
  const customChatId = `cusChat${suffix}`;
  const customMsgId = `cusMsg${suffix}`;
  const customUserName = `冒烟对方-${suffix}`;
  const customUserId = `cusUser${suffix}`;
  const customSecret = `custom-secret-${suffix}`;
  const extraTenant = `tenant-${suffix}`;
  const extraThread = `thread-${suffix}`;
  const echoRecords = [];

  const startEcho = () =>
    new Promise((resolve, reject) => {
      echoServer = createServer((req, res) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
          echoRecords.push({
            method: req.method,
            headers: req.headers,
            raw: Buffer.concat(chunks).toString('utf8'),
          });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        });
      });
      echoServer.on('error', reject);
      echoServer.listen(0, '127.0.0.1', () => resolve(echoServer.address().port));
    });
  const echoPort = await startEcho();

  const customConfig = {
    inboundMapping: JSON.stringify({
      chatId: 'data.chat.id',
      userId: 'data.sender.id',
      userName: 'data.sender.name',
      text: 'data.message.text',
      messageId: 'data.message.id',
      extra: { tenant: 'data.chat.tenantId', thread: 'data.message.threadId' },
    }),
    outboundUrl: `http://127.0.0.1:${echoPort}/reply`,
    outboundMethod: 'POST',
    outboundHeaders: JSON.stringify({
      'Content-Type': 'application/json',
      'X-Chat': '{{chatId}}',
    }),
    outboundBody: JSON.stringify({
      chat_id: '{{chatId}}',
      to: '{{userId}}',
      name: '{{userName}}',
      text: '{{text}}',
      tenant: '{{extra.tenant}}',
      thread: '{{extra.thread}}',
    }),
    securityMode: 'hmac',
    securityHeader: 'X-Signature',
    securitySecret: customSecret,
    ackStatus: '200',
    ackBody: 'ok',
  };

  const rejected = async (label, patch, pattern) => {
    const res = await call('POST', CHANNELS, ACCOUNT, {
      kind: 'custom',
      name: `冒烟坏渠道-${suffix}`,
      config: { ...customConfig, ...patch },
    });
    if (res.code === 0 && res.data?.id) created.channels.push(res.data.id);
    assert(
      res.code === 400 && (!pattern || pattern.test(res.message || '')),
      label,
      `code=${res.code} msg=${res.message}`,
    );
  };
  await rejected('自定义：http 非回环地址被拒', { outboundUrl: 'http://example.com/hook' }, /https/);
  await rejected('自定义：云元数据地址被拒', { outboundUrl: 'https://169.254.169.254/latest/meta-data' }, /内网/);
  await rejected('自定义：内网网段被拒', { outboundUrl: 'https://10.0.0.8/hook' }, /内网/);
  await rejected('自定义：内网域名被拒', { outboundUrl: 'https://metadata.google.internal/hook' }, /内网/);
  await rejected('自定义：入站映射缺 chatId 被拒', { inboundMapping: JSON.stringify({ text: 'a.b' }) }, /chatId/);
  await rejected('自定义：出站方法不在白名单被拒', { outboundMethod: 'TRACE' }, /GET/);
  await rejected('自定义：hmac 缺密钥被拒', { securitySecret: '' }, /密钥/);

  // ---------- 12) 自定义渠道：入站映射 + 出站模板 + 会话额外字段 ----------
  const custom = await call('POST', CHANNELS, ACCOUNT, {
    kind: 'custom',
    name: customName,
    config: customConfig,
  });
  assert(custom.code === 0 && custom.data?.id > 0, '新建自定义渠道', `code=${custom.code} msg=${custom.message}`);
  const customId = custom.data?.id || 0;
  if (customId) {
    created.channels.push(customId);
    created.visitorHashes.push(hashToken(`channel|${customId}|${customChatId}`));
    const view = custom.data;
    assert(
      view.config?.securitySecret === undefined && (view.configured || []).includes('securitySecret'),
      '自定义：校验密钥不回显、只报已配置',
      `config=${Object.keys(view.config || {}).join(',')}`,
    );
    const customCallback = view.callbackPath || '';

    const probe = await call('POST', `${CHANNELS}/${customId}/test`, ACCOUNT);
    assert(
      probe.code === 0 && probe.data?.ok === true,
      '自定义：测试连接（HEAD 探测回环地址）通过',
      `code=${probe.code} ok=${probe.data?.ok} msg=${probe.data?.message}`,
    );

    const inboundBody = JSON.stringify({
      data: {
        chat: { id: customChatId, tenantId: extraTenant },
        sender: { id: customUserId, name: customUserName },
        message: { text: visitorText, id: customMsgId, threadId: extraThread },
      },
    });
    const badSign = await postRaw(`${suite.base}${customCallback}`, inboundBody, {
      'X-Signature': 'not-a-valid-signature',
    });
    assert(badSign.status >= 400, '自定义：签名错误回调被拒', `status=${badSign.status}`);

    const goodSign = createHmac('sha256', customSecret).update(inboundBody).digest('hex');
    const inbound = await postRaw(`${suite.base}${customCallback}`, inboundBody, {
      'X-Signature': goodSign,
    });
    assert(
      inbound.status === 200 && inbound.text === 'ok',
      '自定义：签名回调按回执内容响应',
      `status=${inbound.status} body=${inbound.text.slice(0, 40)}`,
    );

    const found = await waitFor(async () => {
      const list = await call('GET', '/enterprise/service-desk/conversations?page=1&pageSize=50', ACCOUNT);
      const row = (list.data?.list || []).find((item) => item.siteName === customName);
      return row || null;
    }, 20_000);
    assert(Boolean(found), '自定义：回调按入站映射落成会话');
    if (found) {
      created.conversations.push(found.id);
      const detail = await call('GET', `/enterprise/service-desk/conversations/${found.id}`, ACCOUNT);
      const messages = detail.data?.messages || [];
      assert(
        messages.some((item) => item.senderType === 'visitor' && item.content === visitorText),
        '自定义：访客文本按映射取出并落库',
      );
      assert(
        detail.data?.visitor?.nickname === customUserName,
        '自定义：访客名按映射带出',
        `nickname=${detail.data?.visitor?.nickname}`,
      );

      prisma = prisma || createPrisma();
      const stored = await prisma.serviceDeskConversation.findUnique({
        where: { id: found.id },
      });
      assert(
        stored?.externalMeta?.tenant === extraTenant && stored?.externalMeta?.thread === extraThread,
        '自定义：会话级额外字段落库',
        `externalMeta=${JSON.stringify(stored?.externalMeta)}`,
      );

      const replyText = `冒烟自定义回复 ${suffix}`;
      const reply = await call('POST', `/enterprise/service-desk/conversations/${found.id}/messages`, ACCOUNT, {
        content: replyText,
      });
      assert(reply.code === 0, '自定义：工作台回复先落库', `code=${reply.code}`);

      const delivered = await waitFor(async () => {
        const posts = echoRecords.filter((item) => item.method === 'POST');
        return posts.length ? posts[0] : null;
      }, 20_000);
      assert(Boolean(delivered), '自定义：回复按出站地址发出');
      if (delivered) {
        const payload = JSON.parse(delivered.raw);
        assert(
          payload.chat_id === customChatId &&
            payload.to === customUserId &&
            payload.name === customUserName &&
            payload.text === replyText,
          '自定义：出站模板替换基础变量',
          `payload=${delivered.raw.slice(0, 160)}`,
        );
        assert(
          payload.tenant === extraTenant && payload.thread === extraThread,
          '自定义：出站模板带回会话级额外字段',
          `payload=${delivered.raw.slice(0, 160)}`,
        );
        assert(
          delivered.headers['x-chat'] === customChatId,
          '自定义：出站请求头支持占位符',
          `x-chat=${delivered.headers['x-chat']}`,
        );
        assert(
          delivered.headers['x-signature'] === createHmac('sha256', customSecret).update(delivered.raw).digest('hex'),
          '自定义：出站按密钥签名',
        );
      }
    }
  }
} catch (error) {
  assert(false, '实测过程未抛异常', String(error?.stack || error).slice(0, 400));
} finally {
  // ---------- 清理：先接口删渠道，再按后缀清会话/访客/消息/通知 ----------
  try {
    for (const id of created.channels) {
      const removed = await call('DELETE', `${CHANNELS}/${id}`, ACCOUNT);
      if (removed.code !== 0) created.channels = created.channels.filter((item) => item !== id);
    }
    loadDevEnv();
    prisma = prisma || createPrisma();
    for (const id of created.conversations) {
      await prisma.serviceDeskMessage.deleteMany({ where: { conversationId: id } });
      await prisma.serviceDeskConversation.deleteMany({ where: { id } });
    }
    if (created.visitorHashes.length) {
      await prisma.serviceDeskVisitor.deleteMany({ where: { tokenHash: { in: created.visitorHashes } } });
    }
    await prisma.notification.deleteMany({ where: { title: { contains: suffix } } });
    await prisma.serviceDeskChannel.deleteMany({ where: { name: { contains: suffix } } });
    const leftover = await prisma.serviceDeskChannel.count({ where: { name: { contains: suffix } } });
    assert(leftover === 0, '测试渠道已清理干净', `leftover=${leftover}`);
  } catch (error) {
    console.error(`清理失败，请手工核对后缀 ${suffix}：${error?.message || error}`);
    process.exitCode = 1;
  } finally {
    await prisma?.$disconnect().catch(() => undefined);
    await new Promise((resolve) => (echoServer ? echoServer.close(resolve) : resolve()));
  }
  console.log(`\n结果：${suite.summary()}`);
  if (suite.counts().failed > 0) process.exitCode = 1;
}
