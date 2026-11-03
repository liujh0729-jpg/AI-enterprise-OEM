import type { MarketingQrChild, MarketingQrCode } from '../../generated/prisma';
import { ossObjectKey, ossPublicUrl } from '../oss/oss.config';

const escapeHtml = (value: string) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const safeLink = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.toString()
      : '';
  } catch {
    return '';
  }
};

const shell = (title: string, body: string, code: string) => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/>
<meta name="robots" content="noindex,nofollow"/>
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
padding:24px 16px;background:#f5f6f8;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#1f2329}
.card{width:100%;max-width:420px;background:#fff;border-radius:16px;padding:24px 20px 20px;
box-shadow:0 6px 28px rgba(15,23,42,.08);text-align:center}
h1{font-size:20px;line-height:1.4;margin:0 0 8px;font-weight:600}
p.note{margin:0 0 18px;color:#646a73;font-size:14px;line-height:1.6;white-space:pre-wrap}
img.qr{display:block;width:100%;max-width:320px;margin:0 auto;border-radius:12px;background:#f2f3f5}
.tip{margin-top:12px;color:#8f959e;font-size:13px}
a.btn{display:block;margin:8px auto 0;padding:14px 18px;border-radius:12px;background:#3370ff;
color:#fff;text-decoration:none;font-size:16px;font-weight:500;max-width:320px}
a.btn:active{opacity:.86}
.domain{margin-top:8px;color:#8f959e;font-size:12px;word-break:break-all}
pre.text{margin:0;padding:14px;border-radius:12px;background:#f5f6f8;text-align:left;
white-space:pre-wrap;word-break:break-word;font-size:15px;line-height:1.7}
button.copy{margin-top:12px;padding:10px 22px;border:1px solid #d0d3d6;border-radius:10px;
background:#fff;font-size:14px;color:#1f2329}
.empty{color:#8f959e;font-size:14px;line-height:1.7}
footer{margin-top:20px;color:#a8abb0;font-size:12px}
</style></head><body><main class="card">${body}
<footer>内容由发布者提供</footer></main>
<script>document.addEventListener('click',function(e){
var el=e.target.closest('[data-lk-click]');if(!el)return;
try{var u=el.getAttribute('data-lk-origin')||'';if(u&&navigator.sendBeacon){navigator.sendBeacon(u+'/api/public/lk/c/${escapeHtml(
  code,
)}/'+el.getAttribute('data-lk-click')+'','1');}}catch(_){}
});</script></body></html>`;

/** 图片地址解析：后台配置了 OSS 时由 OssService 提供，未注入时回退部署默认桶。 */
const imageUrlOf = (
  input: { urlOf?: (key: string) => string },
  key: string,
) => (input.urlOf ? input.urlOf(key) : ossPublicUrl(ossObjectKey(key)));

export function renderLanding(input: {
  code: MarketingQrCode;
  child: MarketingQrChild | null;
  result: string;
  origin: string;
  codeText: string;
  urlOf?: (key: string) => string;
}) {
  const title = input.code.title || input.code.name || '扫码查看';
  if (input.result === 'DISABLED') {
    return shell(
      '链接已停用',
      '<h1>链接已停用</h1><p class="empty">该链接已被发布者或平台停用。</p>',
      input.codeText,
    );
  }
  if (!input.child) {
    return shell(
      title,
      `<h1>${escapeHtml(title)}</h1><p class="empty">${
        input.result === 'EMPTY'
          ? '活动内容正在准备中，请稍后再试。'
          : '活动已结束，感谢关注。'
      }</p>`,
      input.codeText,
    );
  }
  const note = input.code.note
    ? `<p class="note">${escapeHtml(input.code.note)}</p>`
    : '';
  let content = '';
  if (input.child.kind === 'IMAGE' && input.child.imageKey) {
    content = `<img class="qr" alt="${escapeHtml(input.child.name)}" src="${escapeHtml(
      imageUrlOf(input, input.child.imageKey),
    )}"/><div class="tip">长按识别二维码，或保存图片后识别</div>`;
  } else if (input.child.kind === 'LINK') {
    const link = safeLink(input.child.linkUrl);
    const host = link ? new URL(link).host : '';
    content = link
      ? `<a class="btn" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer"
           data-lk-click="${input.child.id}" data-lk-origin="${escapeHtml(input.origin)}">打开链接</a>
         <div class="domain">${escapeHtml(host)}</div>`
      : '<p class="empty">链接内容不可用</p>';
  } else {
    content = `<pre class="text">${escapeHtml(input.child.textContent)}</pre>
      <button class="copy" onclick="navigator.clipboard&&navigator.clipboard.writeText(this.previousElementSibling.innerText).then(()=>{this.innerText='已复制'})">复制内容</button>`;
  }
  return shell(
    title,
    `<h1>${escapeHtml(title)}</h1>${note}${content}`,
    input.codeText,
  );
}

/** 官网脚本链路用的 JSON：只返回渲染所需字段。 */
export function embedPayload(input: {
  code: MarketingQrCode;
  child: MarketingQrChild | null;
  result: string;
  urlOf?: (key: string) => string;
}) {
  return {
    title: input.code.title || input.code.name || '',
    note: input.code.note || '',
    result: input.result,
    child: input.child
      ? {
          id: input.child.id,
          kind: input.child.kind,
          name: input.child.name,
          imageUrl:
            input.child.kind === 'IMAGE' && input.child.imageKey
              ? imageUrlOf(input, input.child.imageKey)
              : '',
          linkUrl:
            input.child.kind === 'LINK' ? safeLink(input.child.linkUrl) : '',
          text: input.child.kind === 'TEXT' ? input.child.textContent : '',
        }
      : null,
  };
}

/** 客户官网引入的脚本：读 data-lk / URL 参数 lk，命中后以 Shadow DOM 弹层渲染。 */
export function embedScript() {
  return `(function(){
var script=document.currentScript||document.querySelector('script[data-lk]');
if(!script)return;
var code=script.getAttribute('data-lk')||'';
var mode=script.getAttribute('data-mode')||'auto';
var label=script.getAttribute('data-label')||'在线咨询';
var src=new URL(script.src);var base=src.origin;
var q=new URLSearchParams(location.search);var hit=q.get('lk')||q.get('code')||'';
if(mode==='auto'&&hit!==code)return;
function boot(){
  var host=document.createElement('div');host.style.cssText='position:fixed;right:20px;bottom:20px;z-index:2147483000';
  var root=host.attachShadow?host.attachShadow({mode:'open'}):host;
  var btn=document.createElement('button');
  btn.textContent=label;
  btn.style.cssText='border:0;border-radius:999px;padding:12px 20px;background:#3370ff;color:#fff;font-size:15px;box-shadow:0 6px 20px rgba(51,112,255,.35);cursor:pointer';
  root.appendChild(btn);
  var panel=document.createElement('div');
  panel.style.cssText='display:none;width:320px;max-width:calc(100vw - 40px);background:#fff;border-radius:14px;box-shadow:0 12px 40px rgba(15,23,42,.18);padding:18px;margin-top:12px';
  root.appendChild(panel);
  document.body.appendChild(host);
  btn.onclick=function(){
    if(panel.style.display==='block'){panel.style.display='none';return;}
    panel.style.display='block';
    if(panel.dataset.loaded)return;
    panel.dataset.loaded='1';
    window.fetch(base+'/api/public/lk/e/'+encodeURIComponent(code)+location.search)
      .then(function(r){return r.json()})
      .then(function(payload){
        var data=payload&&payload.data?payload.data:payload;
        var html='<div style="font-size:16px;font-weight:600;margin-bottom:8px">'+(data.title||'')+'</div>';
        if(data.note)html+='<div style="color:#646a73;font-size:13px;line-height:1.6;margin-bottom:12px;white-space:pre-wrap">'+data.note+'</div>';
        var c=data.child;
        if(!c){html+='<div style="color:#8f959e;font-size:14px">活动已结束</div>';}
        else if(c.kind==='IMAGE'&&c.imageUrl){html+='<img src="'+c.imageUrl+'" style="width:100%;border-radius:10px"/><div style="color:#8f959e;font-size:12px;margin-top:8px">长按识别或保存图片</div>';}
        else if(c.kind==='LINK'&&c.linkUrl){html+='<a href="'+c.linkUrl+'" target="_blank" rel="noopener noreferrer" style="display:block;text-align:center;padding:12px;border-radius:10px;background:#3370ff;color:#fff;text-decoration:none">打开链接</a>';}
        else {html+='<pre style="white-space:pre-wrap;background:#f5f6f8;border-radius:10px;padding:12px;font-size:14px">'+(c.text||'')+'</pre>';}
        panel.innerHTML=html;
      })
      .catch(function(){panel.innerHTML='<div style="color:#8f959e;font-size:14px">加载失败，请稍后重试</div>';});
  };
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();`;
}
