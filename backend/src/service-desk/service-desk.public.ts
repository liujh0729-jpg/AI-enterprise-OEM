import type { Context } from 'hono';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { streamSSE } from 'hono/streaming';
import { randomBytes } from 'node:crypto';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { ApiEnv } from '../http/types';
import type { Services } from '../http/services';

const WINDOW_MS = 60_000;
const hits = new Map<string, { count: number; resetAt: number }>();
const limited = (key: string, max = 120) => {
  const now = Date.now();
  const row = hits.get(key);
  if (!row || row.resetAt < now) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  row.count += 1;
  return row.count > max;
};

const clientIp = (c: Context<ApiEnv>) =>
  (c.req.header('x-forwarded-for') || '').split(',')[0].trim() ||
  c.req.header('x-real-ip') ||
  '0.0.0.0';

const json = (data: unknown, status = 200) =>
  new Response(
    JSON.stringify({ code: status === 200 ? 0 : status, message: 'ok', data }),
    {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    },
  );

/**
 * 访客公开通道：只认 siteKey + 访客令牌，不需要登录。
 * 同域 iframe `/embed/service-desk` 调用这些接口；来源域名按站点白名单校验。
 */
export function registerServiceDeskPublic(
  app: OpenAPIHono<ApiEnv>,
  services: Services,
) {
  const desk = services.controllers.serviceDeskController;

  app.post('/api/public/service-desk/open/session', async (c) => {
    if (limited(`sd:${clientIp(c)}`)) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '请求过于频繁',
      );
    }
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    const data = await desk.openSession(
      body,
      c.req.header('origin') || '',
      c.req.header('user-agent') || '',
    );
    return json(data);
  });

  app.get('/api/public/service-desk/open/messages/:id', async (c) => {
    const token = String(c.req.query('token') || '');
    const afterId = Number(c.req.query('afterId') || 0);
    const data = await desk.openMessages(
      token,
      Number(c.req.param('id')),
      afterId,
    );
    return json(data);
  });

  app.post('/api/public/service-desk/open/messages/:id', async (c) => {
    if (limited(`sd:msg:${clientIp(c)}`, 60)) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '发送过于频繁',
      );
    }
    const body: Record<string, unknown> = await c.req
      .json<Record<string, unknown>>()
      .catch(() => ({}));
    const token = typeof body.token === 'string' ? body.token : '';
    const data = await desk.openSend(token, Number(c.req.param('id')), body);
    return json(data);
  });

  app.post('/api/public/service-desk/open/rate/:id', async (c) => {
    const body: Record<string, unknown> = await c.req
      .json<Record<string, unknown>>()
      .catch(() => ({}));
    const token = typeof body.token === 'string' ? body.token : '';
    const data = await desk.openRate(token, Number(c.req.param('id')), body);
    return json(data);
  });

  /** 访客附件：只允许图片与常见文档，单件 10MB。 */
  app.post('/api/public/service-desk/open/upload', async (c) => {
    const form = await c.req.formData();
    const tokenValue = form.get('token');
    const token = typeof tokenValue === 'string' ? tokenValue : '';
    const file = form.get('file');
    if (!(file instanceof File)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择要上传的文件');
    }
    if (file.size > 10 * 1024 * 1024) {
      throw new BusinessException(
        ErrorCode.PAYLOAD_TOO_LARGE,
        '附件不能超过 10MB',
      );
    }
    const visitor = await services.serviceDesk.visitorByToken(token);
    const name = String(file.name || 'file');
    const ext = (name.split('.').pop() || 'bin').toLowerCase().slice(0, 8);
    if (!/^(png|jpg|jpeg|gif|webp|pdf|doc|docx|xls|xlsx|txt|zip)$/.test(ext)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '不支持该文件类型');
    }
    const path = `service-desk/${visitor.ownerUserId}/${Date.now()}-${randomBytes(
      4,
    ).toString('hex')}.${ext}`;
    const uploaded = await services.oss.upload(
      path,
      Buffer.from(await file.arrayBuffer()),
    );
    return json({ url: uploaded.url, name, size: uploaded.size });
  });

  /**
   * 官方平台回调：URL 里带渠道随机串，凭据由企业自己配。
   * GET 用于企业微信/公众号的 URL 校验（原样回 echostr），POST 收消息事件。
   */
  const channelHeaders = (c: Context<ApiEnv>) => {
    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return headers;
  };

  app.get('/api/public/service-desk/channel/:token', async (c) => {
    const query: Record<string, string> = {};
    for (const [key, value] of Object.entries(c.req.query())) {
      query[key] = String(value);
    }
    const received = await desk.receiveChannel(String(c.req.param('token')), {
      method: 'GET',
      query,
      headers: channelHeaders(c),
      rawBody: '',
    });
    return new Response(received.response.body, {
      status: received.response.status,
      headers: {
        'content-type':
          received.response.contentType || 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  });

  app.post('/api/public/service-desk/channel/:token', async (c) => {
    const query: Record<string, string> = {};
    for (const [key, value] of Object.entries(c.req.query())) {
      query[key] = String(value);
    }
    const received = await desk.receiveChannel(String(c.req.param('token')), {
      method: 'POST',
      query,
      headers: channelHeaders(c),
      rawBody: await c.req.text(),
    });
    return new Response(received.response.body, {
      status: received.response.status,
      headers: {
        'content-type':
          received.response.contentType || 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  });

  /** 官网入口图标：跨域脚本要读站点名称/主色/客户上传的图标，其他配置不外露。 */
  app.get('/api/public/service-desk/open/site', async (c) => {
    if (limited(`sd:site:${clientIp(c)}`, 240)) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '请求过于频繁',
      );
    }
    const data = await desk.publicSite(String(c.req.query('key') || ''));
    return new Response(JSON.stringify({ code: 0, message: 'ok', data }), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=60',
        'access-control-allow-origin': '*',
      },
    });
  });

  /** 官网接入脚本：圆形图标入口 + 同域 iframe，右上角单色关闭图标收回窗口。 */
  app.get('/api/public/service-desk/embed.js', () => {
    const script = `(function(){
var s=document.currentScript||document.querySelector('script[data-site-key]');
if(!s)return;var key=s.getAttribute('data-site-key')||'';if(!key)return;
var label=s.getAttribute('data-label')||'在线咨询';
var src=new URL(s.src);var base=src.origin;
var color='#3370ff';var avatar='';
var chatIcon='<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
var host=document.createElement('div');
host.style.cssText='position:fixed;right:20px;bottom:20px;z-index:2147483000;font-family:inherit;display:flex;flex-direction:column;align-items:flex-end';
var wrap=document.createElement('div');
wrap.style.cssText='position:relative;display:none;margin-bottom:12px';
var panel=document.createElement('iframe');
panel.src=base+'/embed/service-desk?key='+encodeURIComponent(key);
panel.setAttribute('title',label);
panel.style.cssText='display:block;width:380px;max-width:calc(100vw - 40px);height:560px;max-height:calc(100vh - 120px);border:0;border-radius:14px;box-shadow:0 12px 40px rgba(15,23,42,.18);background:#fff';
var close=document.createElement('button');
close.type='button';
close.setAttribute('aria-label','关闭');
close.setAttribute('title','关闭');
close.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
close.style.cssText='position:absolute;top:8px;right:8px;z-index:2;width:28px;height:28px;padding:0;border:0;border-radius:50%;display:flex;align-items:center;justify-content:center;background:transparent;color:#4e5969;cursor:pointer;line-height:1';
close.onmouseenter=function(){close.style.background='rgba(15,23,42,.06)';};
close.onmouseleave=function(){close.style.background='transparent';};
wrap.appendChild(panel);wrap.appendChild(close);
var btn=document.createElement('button');
btn.type='button';
btn.setAttribute('aria-label',label);
btn.title=label;
btn.style.cssText='width:56px;height:56px;padding:0;border:0;border-radius:50%;display:flex;align-items:center;justify-content:center;overflow:hidden;background:'+color+';color:#fff;box-shadow:0 8px 24px rgba(15,23,42,.22);cursor:pointer;transition:transform .18s ease';
btn.innerHTML=chatIcon;
function paint(){
if(avatar){
btn.style.background='#fff';
btn.innerHTML='';
var img=document.createElement('img');
img.src=avatar;img.alt='';img.style.cssText='width:100%;height:100%;object-fit:cover;display:block';
btn.appendChild(img);
}else{
btn.style.background=color;
btn.innerHTML=chatIcon;
}
}
function setOpen(open){wrap.style.display=open?'block':'none';}
btn.onclick=function(){setOpen(wrap.style.display!=='block');};
close.onclick=function(){setOpen(false);btn.focus();};
host.appendChild(wrap);host.appendChild(btn);document.body.appendChild(host);
paint();
window.fetch(base+'/api/public/service-desk/open/site?key='+encodeURIComponent(key),{credentials:'omit'})
.then(function(r){return r.json();})
.then(function(res){
var data=res&&res.data;if(!data)return;
var app=data.appearance||{};
if(typeof app.color==='string'&&/^#[0-9a-fA-F]{3,8}$/.test(app.color))color=app.color;
if(typeof app.avatar==='string'&&/^(https?:)?\\/\\//.test(app.avatar))avatar=app.avatar;
if(typeof app.title==='string'&&app.title)panel.setAttribute('title',app.title);
paint();
})
.catch(function(){});
})();`;
    return new Response(script, {
      status: 200,
      headers: {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': 'public, max-age=300',
        'access-control-allow-origin': '*',
      },
    });
  });

  app.get('/api/public/service-desk/open/stream/:id', async (c) => {
    const token = String(c.req.query('token') || '');
    const conversationId = Number(c.req.param('id'));
    const conversation = await services.serviceDesk.visitorConversationOf(
      token,
      conversationId,
    );
    return streamSSE(c, async (stream) => {
      let closed = false;
      const ping = setInterval(() => {
        void stream.write(': ping\n\n').catch(() => undefined);
      }, 10_000);
      const off = services.serviceDesk.stream(
        conversation.ownerUserId,
        conversationId,
        async (event) => {
          if (closed) return;
          await stream
            .writeSSE({ event, data: JSON.stringify({ conversationId }) })
            .catch(() => undefined);
        },
      );
      stream.onAbort(() => {
        closed = true;
        clearInterval(ping);
        off();
      });
      await new Promise<void>((resolve) => {
        stream.onAbort(resolve);
      });
    });
  });
}
