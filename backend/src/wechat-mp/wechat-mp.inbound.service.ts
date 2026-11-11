import { resolveSiteUrl, joinSiteUrl } from '../common/site-url';
import type { PrismaService } from '../prisma/prisma.service';
import type { WechatMpBindingService } from './wechat-mp.binding.service';
import {
  assertWechatMpSignature,
  buildWechatMpTextReply,
  decryptWechatMpXml,
  maskOpenId,
  xmlValue,
} from './wechat-mp-crypto';
import type { WechatMpSettingsService } from './wechat-mp.settings';

type ReplySource = {
  enabled: boolean;
  text: string;
  linkText: string;
  linkUrl: string;
};

type InboundMessage = {
  toUser: string;
  fromUser: string;
  msgType: string;
  event: string;
  eventKey: string;
  content: string;
  msgId: string;
  createTime: string;
};

/**
 * 服务号回调：验签、解密、幂等、关注/扫码/文本/菜单事件与被动回复。
 * 被动回复不调用任何微信出站接口，保证 5 秒内返回；失败只记日志，回 success 让微信停止重试。
 */
export class WechatMpInboundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: WechatMpSettingsService,
    private readonly bindings: WechatMpBindingService,
  ) {}

  /** 公众号后台「服务器配置」URL 校验。 */
  async verify(query: Record<string, string>) {
    const runtime = await this.settings.requireRuntime();
    const echo = String(query.echostr || '');
    if (!echo) return '';
    if (query.msg_signature) {
      assertWechatMpSignature(runtime.token, query, 'msg_signature', echo);
      return runtime.encodingAesKey
        ? decryptWechatMpXml(echo, runtime.encodingAesKey, runtime.appId)
        : '';
    }
    assertWechatMpSignature(runtime.token, query, 'signature');
    return echo;
  }

  async handlePost(rawBody: string, query: Record<string, string>) {
    const runtime = await this.settings.runtime();
    if (!runtime) return 'success';
    let xml = rawBody;
    const encrypted = xmlValue(rawBody, 'Encrypt');
    if (encrypted) {
      if (!runtime.encodingAesKey) {
        throw new Error('服务号启用了安全模式，但未配置 EncodingAESKey');
      }
      assertWechatMpSignature(runtime.token, query, 'msg_signature', encrypted);
      xml = decryptWechatMpXml(
        encrypted,
        runtime.encodingAesKey,
        runtime.appId,
      );
    } else {
      assertWechatMpSignature(runtime.token, query, 'signature');
    }
    const message: InboundMessage = {
      toUser: xmlValue(xml, 'ToUserName'),
      fromUser: xmlValue(xml, 'FromUserName'),
      msgType: xmlValue(xml, 'MsgType'),
      event: xmlValue(xml, 'Event'),
      eventKey: xmlValue(xml, 'EventKey'),
      content: xmlValue(xml, 'Content'),
      msgId: xmlValue(xml, 'MsgId'),
      createTime: xmlValue(xml, 'CreateTime'),
    };
    if (!message.fromUser || !message.toUser) return 'success';
    const eventId =
      message.msgId ||
      `evt:${message.fromUser}:${message.createTime}:${message.event}:${message.eventKey}`;
    try {
      await this.prisma.wechatMpInboundEvent.create({
        data: {
          msgId: eventId.slice(0, 96),
          openId: message.fromUser,
          msgType: message.msgType.slice(0, 24),
          event: message.event.slice(0, 32),
          eventKey: message.eventKey.slice(0, 64),
          payload: xml.slice(0, 8000),
        },
      });
    } catch (error) {
      // 微信会重试同一 MsgId：唯一键冲突说明已处理过，直接回 success。
      if ((error as { code?: string })?.code === 'P2002') return 'success';
      console.error(
        JSON.stringify({
          event: 'wechat_mp_inbound_log_failed',
          openId: maskOpenId(message.fromUser),
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    try {
      const reply = await this.route(message);
      return reply
        ? buildWechatMpTextReply({
            toUser: message.fromUser,
            fromUser: message.toUser,
            content: reply,
          })
        : 'success';
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'wechat_mp_inbound_failed',
          openId: maskOpenId(message.fromUser),
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      return 'success';
    }
  }

  private async route(message: InboundMessage) {
    if (message.msgType === 'event') {
      if (message.event === 'subscribe') {
        return this.subscribe(
          message.fromUser,
          message.eventKey.replace(/^qrscene_/, ''),
        );
      }
      if (message.event === 'SCAN') {
        return this.scan(message.fromUser, message.eventKey);
      }
      if (message.event === 'unsubscribe') {
        await this.bindings.markUnsubscribed(message.fromUser);
        return '';
      }
      if (message.event === 'CLICK') {
        await this.bindings.touch(message.fromUser);
        return this.textReply(message.fromUser, message.eventKey);
      }
      return '';
    }
    if (message.msgType === 'text') {
      await this.bindings.touch(message.fromUser);
      return this.textReply(message.fromUser, message.content);
    }
    return '';
  }

  private async subscribe(openId: string, scene: string) {
    const settings = await this.settings.load();
    if (scene) {
      const result = await this.bindings.bindFromScene(openId, scene);
      if (!result.ok) return result.message;
      await this.bindings.markSubscribed(openId);
      const follow = await this.replyText(settings.followReply, '');
      return [result.message, follow].filter(Boolean).join('\n');
    }
    await this.bindings.markSubscribed(openId);
    const binding = await this.bindings.findByOpenId(openId);
    const follow = await this.replyText(
      settings.followReply,
      '欢迎关注！登录网页后点击右上角微信图标，即可把账号与微信绑定。',
    );
    if (!binding) {
      return [follow, '绑定后可直接在手机上处理任务、审批与客服回复。']
        .filter(Boolean)
        .join('\n');
    }
    return follow;
  }

  private async scan(openId: string, scene: string) {
    if (!scene) return '';
    const settings = await this.settings.load();
    const result = await this.bindings.bindFromScene(openId, scene);
    if (!result.ok) return result.message;
    await this.bindings.markSubscribed(openId);
    const follow = await this.replyText(settings.followReply, '');
    return [result.message, follow].filter(Boolean).join('\n');
  }

  private async textReply(openId: string, content: string) {
    const text = String(content || '').trim();
    if (!text) return '';
    if (/^(退订|取消|unsubscribe)$/i.test(text)) {
      await this.bindings.setMuted(openId, true);
      return '已关闭微信提醒。任务与审批仍会保存在站内消息中心，回复「订阅」可重新开启。';
    }
    if (/^(订阅|恢复|subscribe)$/i.test(text)) {
      await this.bindings.setMuted(openId, false);
      return '已恢复微信提醒。';
    }
    const settings = await this.settings.load();
    const matched = settings.keywordReplies.find(
      (item) =>
        item.enabled &&
        item.keyword &&
        (item.match === 'exact'
          ? text === item.keyword
          : text.includes(item.keyword)),
    );
    if (matched) return this.replyText(matched, matched.text);
    if (settings.defaultReply.enabled) {
      return this.replyText(settings.defaultReply, '');
    }
    return '';
  }

  private async replyText(reply: ReplySource, fallback: string) {
    if (!reply.enabled) return '';
    const text = String(reply.text || fallback || '').trim();
    const siteUrl = await resolveSiteUrl(this.prisma);
    const link = String(reply.linkUrl || '').trim();
    const absolute = link.startsWith('/')
      ? joinSiteUrl(siteUrl, link)
      : /^https:\/\//i.test(link)
        ? link
        : '';
    const linkLine = absolute
      ? `${reply.linkText || '打开链接'}：${absolute}`
      : '';
    return [text, linkLine].filter(Boolean).join('\n');
  }
}
