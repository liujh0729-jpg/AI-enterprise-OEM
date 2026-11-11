// 分发效果读取器（D8）：注入到各平台创作中心/作品页，接收后台的 AIPDD_METRICS 指令，
// 把页面上公开可见的阅读/播放、点赞、评论计数（1.2万/亿 折叠回整数）读成结构化效果。
// 只读 DOM：不取 Cookie、不发平台接口请求、不绕过验证码；遇登录墙/验证码立刻如实回报。
// 计数是各平台最容易改版的一环：每个字段都给候选选择器，全部落空时报 0，不猜。
(() => {
  if (window.__AIPDD_ENTERPRISE_METRICS__) return;
  window.__AIPDD_ENTERPRISE_METRICS__ = true;

  function textOf(node) {
    if (!node) return "";
    return String(node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
  }

  /** 「1.2万」「3,456」「赞 42」→ 数字；解析不出来按 0，不猜。与 collector.js 同一口径。 */
  function countOf(raw) {
    const text = String(raw || "");
    const value = text.replace(/[^\d.万亿kKmM]/g, "");
    if (!value) return 0;
    const number = Number.parseFloat(value);
    if (!Number.isFinite(number)) return 0;
    if (/万|w/i.test(text)) return Math.round(number * 10000);
    if (/亿/i.test(text)) return Math.round(number * 100000000);
    if (/k/i.test(text)) return Math.round(number * 1000);
    if (/m/i.test(text)) return Math.round(number * 1000000);
    return Math.round(number);
  }

  function first(root, selectors) {
    if (!root) return null;
    for (const selector of selectors || []) {
      try {
        const found = root.querySelector(selector);
        if (found) return found;
      } catch (_) {
        // 平台页可能有非法选择器字符，跳过继续下一条
      }
    }
    return null;
  }

  function all(root, selectors) {
    const out = [];
    const seen = new Set();
    for (const selector of selectors || []) {
      let nodes = [];
      try {
        nodes = Array.from(root.querySelectorAll(selector));
      } catch (_) {
        nodes = [];
      }
      for (const node of nodes) {
        if (seen.has(node)) continue;
        seen.add(node);
        out.push(node);
      }
    }
    return out;
  }

  // 登录墙 / 验证码：命中即停下并由后台转人工，不硬读半截数据。
  const LOGIN_TEXT = /请先登录|登录后(?:查看|继续|操作)|立即登录|扫码登录|当前未登录/;
  const CAPTCHA_NODES = [
    "iframe[src*='captcha']",
    "iframe[src*='verify']",
    "#captcha",
    "[class*='geetest_panel']",
    "[id*='tcaptcha']",
    ".verify-wrap",
  ];

  function captchaGuard() {
    for (const selector of CAPTCHA_NODES) {
      let nodes = [];
      try {
        nodes = Array.from(document.querySelectorAll(selector));
      } catch (_) {
        nodes = [];
      }
      if (nodes.some((node) => node.getClientRects?.().length)) return "CAPTCHA";
    }
    return "";
  }

  function loginGuard() {
    if (/^(passport|login|account|accounts|auth|signin)\./i.test(location.hostname)) return "NEED_LOGIN";
    if (LOGIN_TEXT.test(document.title || "")) return "NEED_LOGIN";
    return "";
  }

  // ---------- 平台效果规则 ----------
  // row：内容行；views/likes/comments：行内候选选择器。效果页地址由 background.js 的
  // METRIC_PAGES 决定（哪个创作中心页有阅读/播放数据），本脚本只管在已打开的页面里读数。
  const METRIC_RULES = {
    weibo: {
      row: [".card-wrap[action-type='feed_list_item']", ".card-wrap", "article"],
      views: ["[class*='read'] em", ".woo-like-count"],
      likes: ["li[action-type='feed_list_like'] em", ".woo-like-count", "[class*='like'] em"],
      comments: ["li[action-type='feed_list_comment'] em", "[class*='comment'] em"],
    },
    xiaohongshu: {
      row: ["[class*='note-item']", "tr", "[class*='data-item']"],
      views: ["[class*='view']", "[class*='read']", "[class*='browse']"],
      likes: ["[class*='like']", "[class*='praise']"],
      comments: ["[class*='comment']"],
    },
    douyin: {
      row: ["[class*='content-card']", "tr", "[class*='video-item']"],
      views: ["[class*='play']", "[class*='view']", "[class*='count']"],
      likes: ["[class*='like']", "[class*='praise']"],
      comments: ["[class*='comment']"],
    },
    zhihu: {
      row: ["[class*='CreationItem']", ".Card", "tr"],
      views: ["[class*='read']", "[class*='view']", "[class*='Read']"],
      likes: ["[class*='like']", "[class*='vote']", "[class*='赞同']"],
      comments: ["[class*='comment']"],
    },
    toutiao: {
      row: ["[class*='article-item']", "tr", "[class*='feed-card']"],
      views: ["[class*='read']", "[class*='view']", "[class*='show']"],
      likes: ["[class*='like']", "[class*='digg']"],
      comments: ["[class*='comment']"],
    },
    bilibili: {
      row: ["[class*='article-item']", ".article-list-item", "tr"],
      views: ["[class*='view']", "[class*='read']", "[class*='play']"],
      likes: ["[class*='like']"],
      comments: ["[class*='comment']"],
    },
    jianshu: {
      row: [".note-list li", "article", "[class*='note-item']"],
      views: ["[class*='read']", "[class*='views']", "[class*='meta'] span"],
      likes: ["[class*='like']", "[class*='praise']"],
      comments: ["[class*='comment']"],
    },
    douban: {
      row: [".note-item", "article", "[class*='note']"],
      views: ["[class*='view']", "[class*='read']"],
      likes: ["[class*='like']", "[class*='up']"],
      comments: ["[class*='comment']"],
    },
    weixin: {
      row: ["[class*='appmsg']", ".weui-desktop-mass-appmsg__item", "tr"],
      views: ["[class*='read']", "[class*='view']"],
      likes: ["[class*='like']"],
      comments: ["[class*='comment']"],
    },
    weixin_channels: {
      row: ["[class*='post-item']", "[class*='feed-item']", "tr"],
      views: ["[class*='play']", "[class*='view']"],
      likes: ["[class*='like']"],
      comments: ["[class*='comment']"],
    },
    kuaishou: {
      row: ["[class*='video-item']", "[class*='work-item']", "tr"],
      views: ["[class*='play']", "[class*='view']"],
      likes: ["[class*='like']"],
      comments: ["[class*='comment']"],
    },
    zsxq: {
      row: ["[class*='topic-item']", "[class*='card']"],
      views: ["[class*='read']", "[class*='view']"],
      likes: ["[class*='like']"],
      comments: ["[class*='comment']"],
    },
    baijiahao: {
      row: ["[class*='content-item']", "tr", "[class*='feed-item']"],
      views: ["[class*='read']", "[class*='view']"],
      likes: ["[class*='like']", "[class*='praise']"],
      comments: ["[class*='comment']"],
    },
  };

  function ruleOf(code) {
    return METRIC_RULES[String(code || "").toLowerCase()] || null;
  }

  /** 行是否属于该条作品：优先按平台作品标识/链接匹配，匹配不到时若全页只有一行也认。 */
  function rowMatches(rowNode, item) {
    const needle = (item.publishedItemId || "").trim();
    const url = (item.publishedUrl || "").trim();
    const links = all(rowNode, ["a"]);
    for (const link of links) {
      const href = String(link.getAttribute("href") || "");
      if (needle && href.includes(needle)) return true;
      if (url && (href === url || url.endsWith(href))) return true;
    }
    return false;
  }

  function pickCount(root, selectors) {
    for (const selector of selectors || []) {
      let nodes = [];
      try {
        nodes = Array.from(root.querySelectorAll(selector));
      } catch (_) {
        nodes = [];
      }
      for (const node of nodes) {
        const value = countOf(textOf(node));
        if (value) return value;
      }
    }
    return 0;
  }

  /** 单个平台读一次：命中内容行就按行读，否则退回整页读数（详情页场景）。 */
  function readOne(rule, item) {
    const rows = all(document, rule.row);
    let target = rows.find((node) => rowMatches(node, item)) || null;
    if (!target && rows.length === 1) target = rows[0];
    const scope = target || document;
    return {
      platformCode: item.platformCode,
      publishedItemId: (item.publishedItemId || "").slice(0, 120),
      views: pickCount(scope, rule.views),
      likes: pickCount(scope, rule.likes),
      comments: pickCount(scope, rule.comments),
      capturedAt: new Date().toISOString(),
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "AIPDD_METRICS") return false;
    const item = message.payload || {};
    const rule = ruleOf(item.platformCode);
    if (!rule) {
      sendResponse({ ok: false, errorMsg: `插件不认识该平台：${item.platformCode}` });
      return false;
    }
    const guard = loginGuard() || captchaGuard();
    if (guard) {
      sendResponse({
        ok: false,
        code: guard,
        errorMsg: guard === "CAPTCHA" ? "页面出现验证码，已停下等人工处理" : "需要先登录该平台",
      });
      return false;
    }
    try {
      sendResponse({ ok: true, metric: readOne(rule, item) });
    } catch (error) {
      sendResponse({ ok: false, errorMsg: String(error?.message || error) });
    }
    return false;
  });
})();
