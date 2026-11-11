// 平台页采集器：注入到各平台的「消费侧」页面（搜索页 / 话题页 / 详情页 / 评论区 / 账号页），
// 接收后台的 AIPDD_COLLECT 指令，把页面上公开可见的内容与评论抓成结构化条目。
// 只读 DOM：不取 Cookie、不发平台接口请求、不点击提交类按钮、不绕过验证码。
// 遇登录墙 / 验证码 / 风控页立刻停下并回报原因，由后台保留标签页交人工接手。
// 选择器是多平台自动化里最容易碎的一环：每个字段都给候选列表，全部落空时如实报 PAGE_CHANGED。
(() => {
  if (window.__AIPDD_ENTERPRISE_COLLECTOR__) return;
  window.__AIPDD_ENTERPRISE_COLLECTOR__ = true;

  const MAX_SCROLL_ROUNDS = 40;
  const SCROLL_MIN_MS = 1200;
  const SCROLL_MAX_MS = 2600;
  const MAX_NEXT_URLS = 10;
  const EXCERPT_MAX = 4000;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const HOST_PLATFORM = [
    [/xiaohongshu\.com$/, "XHS"],
    [/douyin\.com$/, "DOUYIN"],
    [/zhihu\.com$/, "ZHIHU"],
    [/weibo\.com$|weibo\.cn$/, "WEIBO"],
    [/bilibili\.com$/, "BILIBILI"],
    [/weixin\.sogou\.com$|mp\.weixin\.qq\.com$/, "WX_MP"],
  ];

  // ---------- 通用 DOM 工具 ----------

  function textOf(node) {
    if (!node) return "";
    return String(node.innerText || node.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function abs(href) {
    const raw = String(href || "").trim();
    if (!raw || raw.startsWith("javascript:")) return "";
    try {
      const url = new URL(raw, location.href);
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
    } catch (_) {
      return "";
    }
  }

  /** 候选选择器逐个试，返回第一个命中的节点（含 root 自身）。 */
  function first(root, selectors) {
    if (!root) return null;
    for (const selector of selectors || []) {
      try {
        if (root.matches?.(selector)) return root;
        const found = root.querySelector(selector);
        if (found) return found;
      } catch (_) {
        // 平台页里可能有非法选择器字符，跳过这一条继续试下一条
      }
    }
    return null;
  }

  /** 候选选择器的并集，按 DOM 顺序去重。 */
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
    // querySelectorAll 分组返回，合并后按文档顺序排一次，滚动加载的新节点才排在后面
    return out.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  }

  /** 「1.2万」「3,456」「赞 42」→ 数字；解析不出来按 0，不猜。 */
  function countOf(raw) {
    const value = String(raw || "").replace(/[^\d.万亿kKmM]/g, "");
    if (!value) return 0;
    const number = Number.parseFloat(value);
    if (!Number.isFinite(number)) return 0;
    if (/万|w/i.test(String(raw))) return Math.round(number * 10000);
    if (/亿/i.test(String(raw))) return Math.round(number * 100000000);
    if (/k/i.test(String(raw))) return Math.round(number * 1000);
    if (/m/i.test(String(raw))) return Math.round(number * 1000000);
    return Math.round(number);
  }

  function hash(raw) {
    let value = 5381;
    const text = String(raw || "");
    for (let index = 0; index < text.length; index += 1) {
      value = ((value << 5) + value + text.charCodeAt(index)) >>> 0;
    }
    return value.toString(36);
  }

  function idFrom(profileUrl, patterns) {
    const url = String(profileUrl || "");
    for (const pattern of patterns || []) {
      const matched = url.match(pattern);
      if (matched?.[1]) return decodeURIComponent(matched[1]).slice(0, 120);
    }
    return "";
  }

  function visible(node) {
    if (!node || !node.getClientRects?.().length) return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 40 && rect.height > 20;
  }

  // ---------- 登录墙 / 验证码 / 风控识别 ----------

  const CAPTCHA_NODES = [
    "iframe[src*='captcha']",
    "iframe[src*='verify']",
    "#captcha",
    ".captcha-verify-container",
    "[class*='geetest_panel']",
    "[class*='geetest_widget']",
    "[class*='secsdk-captcha']",
    "[id*='tcaptcha']",
    "[class*='tcaptcha']",
    ".verify-wrap",
    ".JDJRV-wrap",
    "[class*='captcha-verify']",
  ];
  const RISK_TEXT =
    /访问异常|操作频繁|操作过于频繁|请求频繁|账号存在风险|环境异常|访问受限|系统检测到异常|完成下列验证|请完成验证|拖动滑块|滑动验证|人机验证/;
  const LOGIN_TEXT = /请先登录|登录后(?:查看|继续|操作|参与)|立即登录|扫码登录|登录查看全部|当前未登录/;
  const LOGIN_HOST = /^(passport|login|account|accounts|auth|signin)\./i;
  const LOGIN_PATH = /\/(login|signin|passport)(\/|$)/i;

  function urlGuard() {
    if (LOGIN_HOST.test(location.hostname)) return "NEED_LOGIN";
    if (LOGIN_PATH.test(location.pathname)) return "NEED_LOGIN";
    if (/passport\.weibo|login\.sina|security\.weibo|account\.xiaohongshu|security\.douyin|account\.bilibili/i.test(location.hostname)) {
      return "NEED_LOGIN";
    }
    return "";
  }

  /** 验证码容器常常预载在 DOM 里但不可见：只认可见且有面积的节点，避免正常页误判。 */
  function captchaGuard() {
    for (const selector of CAPTCHA_NODES) {
      let nodes = [];
      try {
        nodes = Array.from(document.querySelectorAll(selector));
      } catch (_) {
        nodes = [];
      }
      if (nodes.some(visible)) return "CAPTCHA";
    }
    return "";
  }

  /** 风控提示是短横幅：只在「自身文本短 + 命中关键词 + 可见」的节点上判定，不拿整页文本猜。 */
  function riskGuard() {
    if (RISK_TEXT.test(document.title || "")) return "RISK_CONTROL";
    const nodes = document.querySelectorAll("div,p,span,h1,h2");
    for (let index = 0; index < nodes.length && index < 3000; index += 1) {
      const node = nodes[index];
      const own = String(node.textContent || "").trim();
      if (!own || own.length > 200) continue;
      if (!RISK_TEXT.test(own)) continue;
      if (visible(node)) return "RISK_CONTROL";
    }
    return "";
  }

  function guard() {
    return urlGuard() || captchaGuard() || riskGuard();
  }

  // ---------- 平台规则 ----------
  // list*：搜索/话题页的内容卡片；comment*：详情页评论区；post*：内容正文与发布者；
  // accountLink：账号页里指向其内容的链接；userId：从主页链接抽平台用户标识。

  const RULES = {
    XHS: {
      listCard: ["section.note-item", "div.note-item", "[class*='note-item']"],
      listLink: ["a[href*='/search_result/']", "a[href*='/explore/']", "a.cover", "a[href*='/discovery/item/']"],
      listAuthor: [".author-wrapper .name", ".author .name", "a.name", ".name"],
      listAuthorLink: ["a[href*='/user/profile/']", ".author-wrapper a"],
      listLikes: [".like-wrapper .count", ".like .count", ".count"],
      commentCard: [".parent-comment", ".comment-item", "[class*='comment-item']", ".comment-inner-container"],
      commentAuthor: [".author .name", ".author-wrapper .name", ".name"],
      commentAuthorLink: [".author a[href*='/user/profile/']", "a[href*='/user/profile/']"],
      commentText: [".content .note-text", ".note-text", ".content"],
      commentLikes: [".like .count", ".like-wrapper .count", ".count"],
      postAuthor: [".author-wrapper .username", ".info .username", ".username", ".author .name"],
      postAuthorLink: [".author-wrapper a[href*='/user/profile/']", "a[href*='/user/profile/']"],
      postText: ["#detail-desc .note-text", ".note-content .note-text", "#detail-desc", ".desc"],
      postTitle: ["#detail-title", ".title"],
      postLikes: [".like-wrapper .count", ".engage-bar .like-wrapper .count", ".count"],
      postComments: [".chat-wrapper .count", ".engage-bar .chat-wrapper .count"],
      accountLink: ["section.note-item a[href*='/explore/']", "a[href*='/explore/']", "a[href*='/search_result/']"],
      userId: [/\/user\/profile\/([A-Za-z0-9]+)/],
    },
    DOUYIN: {
      listCard: ["[data-e2e='scroll-list'] > div", "li[data-e2e='scroll-list-item']", "[class*='search-result-card']", "div[data-e2e='video-card']"],
      listLink: ["a[href*='/video/']", "a[href*='/note/']", "a[href*='/search/']"],
      listAuthor: ["[data-e2e='video-author-name']", "a[href*='/user/'] span", ".author-name", "[class*='author'] span"],
      listAuthorLink: ["a[href*='/user/']"],
      listLikes: ["[data-e2e='video-like-count']", "[class*='like-count']", ".like-count"],
      commentCard: ["[data-e2e='comment-list'] [data-e2e='comment-item']", ".comment-item", "[class*='comment-mainContent']", "[data-e2e='comment-item']"],
      commentAuthor: ["[data-e2e='comment-username']", ".comment-item-name", "a[href*='/user/'] span", ".name"],
      commentAuthorLink: ["a[href*='/user/']"],
      commentText: ["[data-e2e='comment-content']", ".comment-item-content", ".content", "p"],
      commentLikes: ["[data-e2e='comment-like-count']", ".comment-item-like-count", ".like-count"],
      postAuthor: ["[data-e2e='video-author-name']", ".author-name", "a[href*='/user/'] span"],
      postAuthorLink: ["[data-e2e='video-author-link']", "a[href*='/user/']"],
      postText: ["[data-e2e='video-desc']", ".video-info-detail", ".desc", "h1"],
      postTitle: ["h1", "[data-e2e='video-title']"],
      postLikes: ["[data-e2e='video-like-count']", ".like-count"],
      postComments: ["[data-e2e='video-comment-count']", ".comment-count"],
      accountLink: ["a[href*='/video/']", "a[href*='/note/']"],
      userId: [/\/user\/([A-Za-z0-9_-]+)/],
    },
    ZHIHU: {
      listCard: [".SearchResult-Card", ".List-item", "[class*='SearchResult-Card']"],
      listLink: [".ContentItem-title a[href*='/question/']", "a[href*='/p/']", ".ContentItem-title a", "h2 a"],
      listAuthor: [".AuthorInfo-name a", ".AuthorInfo-name", ".UserLink-link"],
      listAuthorLink: [".AuthorInfo-name a[href*='/people/']", "a[href*='/people/']"],
      listLikes: [".ContentItem-actions button[aria-label*='赞同']", ".VoteButton--up", "button[aria-label*='赞同']"],
      commentCard: [".CommentItemV2", ".CommentItem", "[class*='CommentItem']"],
      commentAuthor: [".CommentItemV2-meta a", ".CommentItem-meta a", ".UserLink-link"],
      commentAuthorLink: ["a[href*='/people/']", ".CommentItemV2-meta a"],
      commentText: [".CommentContent", ".CommentItemV2-content", ".comment-content"],
      commentLikes: [".CommentItemV2-likeBtn", ".CommentItem-likeBtn", "button[aria-label*='赞']"],
      postAuthor: [".AuthorInfo-name a", ".AuthorInfo-name", ".UserLink-link"],
      postAuthorLink: [".AuthorInfo a[href*='/people/']", "a[href*='/people/']"],
      postText: [".RichContent-inner", ".Post-RichTextContainer", ".RichText"],
      postTitle: [".QuestionHeader-title", "h1.Post-Title", "h1"],
      postLikes: [".VoteButton--up", "button[aria-label*='赞同']"],
      postComments: [".ContentItem-actions button[aria-label*='评论']", "button[aria-label*='评论']"],
      accountLink: [".ContentItem-title a[href*='/question/']", "a[href*='/p/']", ".List-item a[href*='/question/']"],
      userId: [/\/people\/([^/?#]+)/, /\/org\/([^/?#]+)/],
    },
    WEIBO: {
      listCard: [".card-wrap[action-type='feed_list_item']", ".card-wrap", "[class*='wbpro-list']"],
      listLink: ["a[href*='/detail/']", ".from a[href*='weibo.com']", "a[action-type='feed_list_item_detail']"],
      listAuthor: [".info .name", ".name", "a[href*='weibo.com/'][nick-name]"],
      listAuthorLink: [".info a.name[href*='weibo.com']", "a.name[href*='weibo.com']", "a[href*='weibo.com/']"],
      listLikes: ["li[action-type='feed_list_like'] em", ".card-act li:nth-child(3) em", ".like-count"],
      listComments: ["li[action-type='feed_list_comment'] em", ".card-act li:nth-child(2) em"],
      commentCard: [".wbpro-comment", ".list-item.comment", "[class*='comment-item']", ".comment-item"],
      commentAuthor: [".wbpro-text a[usercard]", "a[usercard]", ".name", ".wbpro-nick"],
      commentAuthorLink: ["a[href*='weibo.com/'][usercard]", "a[href*='weibo.com/']", "a[href*='/u/']"],
      commentText: [".wbpro-text", ".comment-text", ".text", ".content"],
      commentLikes: [".wbpro-like em", ".like-count", "em"],
      postAuthor: [".ProfileHeader_name__aHmYB", ".head-cut a", ".info .name", "a[usercard]"],
      postAuthorLink: ["a[href*='weibo.com/'][usercard]", ".head-cut a[href*='weibo.com']", "a[href*='/u/']"],
      postText: ["[node-type='feed_list_content']", ".wbpro-text", ".detail_text", ".card-feed .txt"],
      postTitle: ["h1", ".title"],
      postLikes: ["li[action-type='feed_list_like'] em", ".like-count", "em"],
      postComments: ["li[action-type='feed_list_comment'] em", ".comment-count"],
      accountLink: [".card-wrap a[href*='/detail/']", "a[href*='weibo.com/'][action-type]", ".wbpro-list a[href*='/detail/']"],
      userId: [/weibo\.com\/(?:u\/)?(\d+)/, /\/u\/(\d+)/, /weibo\.com\/([^/?#]+)/],
    },
    BILIBILI: {
      listCard: [".bili-video-card", ".video-list > li", "li.bili-video-card__wrap", ".video-card"],
      listLink: ["a[href*='/video/BV']", "a[href*='/video/av']", "a[href*='//www.bilibili.com/video/']"],
      listAuthor: [".bili-video-card__info--author", ".up-name__text", ".up-name", "a[href*='space.bilibili.com']"],
      listAuthorLink: ["a[href*='space.bilibili.com']", ".bili-video-card__info--author a"],
      listLikes: [".bili-video-card__stats--item:nth-child(1) span", ".bili-video-card__stats span"],
      commentCard: [".reply-item", ".list-item.reply-wrap", "[class*='reply-item']", ".comment-item"],
      commentAuthor: [".user-name", ".sub-user-name", "a.name", ".root-reply .user-name"],
      commentAuthorLink: [".reply-face a[href*='space.bilibili.com']", "a[href*='space.bilibili.com']", "a.name"],
      commentText: [".reply-content", ".root-reply .text", ".text", ".comment-content"],
      commentLikes: [".like span", ".reply-like span", ".like-count"],
      postAuthor: [".up-name", ".up-info .username", "a.up-name", ".membersinfo-upcard .username"],
      postAuthorLink: [".up-info a[href*='space.bilibili.com']", "a[href*='space.bilibili.com']"],
      postText: ["#v_desc .desc-info-text", ".video-desc", ".basic-desc-info", "h1"],
      postTitle: ["h1.video-title", "h1[title]", "h1"],
      postLikes: [".video-like-container .like-count", ".like span", "#arc_toolbar_like span"],
      postComments: [".comment-maintenance-mode", ".reply-header .total-count", ".comment-header .count"],
      accountLink: ["a[href*='/video/BV']", ".bili-video-card a[href*='/video/']"],
      userId: [/space\.bilibili\.com\/(\d+)/],
    },
    WX_MP: {
      listCard: [".news-list li", "ul.news-list > li", ".txt-box", ".sogou-vr-wrap"],
      listLink: ["h3 a[href*='/link?url=']", "h3 a", "a[uigs^='article_title']", "a[href*='mp.weixin.qq.com']"],
      listAuthor: [".account", "a.account", ".s-p a", ".txt-box .s-p"],
      listAuthorLink: ["a[href*='mp.weixin.qq.com/profile']", "a.account", "a[href*='openid=']"],
      listLikes: [".s-p .like", ".read-count"],
      commentCard: [".comment_item", "#js_comment_area .comment_item", "[class*='comment_item']"],
      commentAuthor: [".comment_nickname", ".nickname", "a.nickname"],
      commentAuthorLink: [".comment_nickname a", "a.nickname"],
      commentText: [".comment_content", ".comment-content", ".content"],
      commentLikes: [".comment_praise .num", ".praise_num", ".num"],
      postAuthor: ["#js_name", ".rich_media_meta_nickname", "#js_author_name", ".profile_nickname"],
      postAuthorLink: ["#js_name", "a[href*='mp.weixin.qq.com/profile']", "#js_profile_qrcode"],
      postText: ["#js_content", ".rich_media_content", "#page-content"],
      postTitle: ["#activity-name", ".rich_media_title", "h1"],
      postLikes: ["#js_like_num", ".like_num", "#like3"],
      postComments: ["#js_comment_num", ".comment_num"],
      accountLink: ["a[href*='mp.weixin.qq.com/s']", "h3 a[href*='/link?url=']"],
      userId: [/openid=([^&/?#]+)/, /[?&]biz=([^&#]+)/, /mp\.weixin\.qq\.com\/profile\/([^/?#]+)/],
    },
  };

  // ---------- 条目组装 ----------

  function ruleOf(platform) {
    return RULES[String(platform || "").toUpperCase()] || null;
  }

  function platformOfHost() {
    for (const [pattern, platform] of HOST_PLATFORM) {
      if (pattern.test(location.hostname)) return platform;
    }
    return "";
  }

  function authorOf(card, rule, prefix) {
    const link = first(card, rule[`${prefix}AuthorLink`]);
    const nameNode = first(card, rule[`${prefix}Author`]);
    const profileUrl = link ? abs(link.getAttribute("href")) : "";
    const nickname = textOf(nameNode) || String(link?.getAttribute("nick-name") || "").trim();
    // 主页链接里没有 ID 时退回昵称：服务端按「平台 + 平台用户标识」去重，空标识会被直接过滤掉。
    const platformUserId = idFrom(profileUrl, rule.userId) || nickname.slice(0, 120);
    return { platformUserId, nickname: nickname.slice(0, 120), profileUrl: profileUrl.slice(0, 500) };
  }

  /** 评论证据 URL 必须逐条不同，否则同一页的评论会被服务端按 (leadId,url) 去重成一条。 */
  function commentUrl(card) {
    const base = location.href.split("#")[0];
    const raw =
      card.getAttribute("data-id") ||
      card.getAttribute("data-comment-id") ||
      card.getAttribute("data-commentid") ||
      card.id ||
      "";
    const id = String(raw).replace(/^comment[-_]?/i, "").trim();
    if (id && /^[\w-]{1,60}$/.test(id)) return `${base}#comment-${id}`.slice(0, 500);
    return `${base}#comment-${hash(textOf(card))}`.slice(0, 500);
  }

  function metricsOf(card, rule, prefix) {
    const likes = countOf(textOf(first(card, rule[`${prefix}Likes`])));
    const comments = countOf(textOf(first(card, rule[`${prefix}Comments`])));
    const metrics = {};
    if (likes) metrics.likes = likes;
    if (comments) metrics.comments = comments;
    const timeNode = first(card, ["time[datetime]", "time", "[class*='date']", "[class*='time']"]);
    const publishedAt = timeNode?.getAttribute?.("datetime") || "";
    if (publishedAt && !Number.isNaN(Date.parse(publishedAt))) {
      metrics.publishedAt = new Date(publishedAt).toISOString();
    }
    return metrics;
  }

  function extractList(rule, platform, maxItems) {
    const items = [];
    const nextUrls = [];
    for (const card of all(document, rule.listCard)) {
      if (items.length >= maxItems) break;
      const link = first(card, rule.listLink);
      const url = link ? abs(link.getAttribute("href")) : "";
      const excerpt = textOf(card).slice(0, EXCERPT_MAX);
      if (!excerpt) continue;
      const author = authorOf(card, rule, "list");
      if (!author.platformUserId) continue;
      items.push({
        platform,
        ...author,
        sourceType: "SEARCH",
        url: (url || location.href).slice(0, 500),
        excerpt,
        metrics: metricsOf(card, rule, "list"),
      });
      if (url && nextUrls.length < MAX_NEXT_URLS && !nextUrls.includes(url)) nextUrls.push(url);
    }
    return { items, nextUrls };
  }

  function extractComments(rule, platform, maxItems) {
    const items = [];
    for (const card of all(document, rule.commentCard)) {
      if (items.length >= maxItems) break;
      const textNode = first(card, rule.commentText);
      const excerpt = (textNode ? textOf(textNode) : textOf(card)).slice(0, EXCERPT_MAX);
      if (!excerpt) continue;
      const author = authorOf(card, rule, "comment");
      if (!author.platformUserId) continue;
      items.push({
        platform,
        ...author,
        sourceType: "COMMENT",
        url: commentUrl(card),
        excerpt,
        metrics: metricsOf(card, rule, "comment"),
      });
    }
    return items;
  }

  /** 内容页没有开放评论区时退回抓正文与发布者：作者本身就是可跟进的线索，不硬造评论。 */
  function extractPost(rule, platform) {
    const body = first(document, rule.postText);
    const title = first(document, rule.postTitle);
    const excerpt = [textOf(title), textOf(body)].filter(Boolean).join("\n").slice(0, EXCERPT_MAX);
    if (!excerpt) return null;
    const author = authorOf(document, rule, "post");
    if (!author.platformUserId) return null;
    return {
      platform,
      ...author,
      sourceType: "POST",
      url: location.href.split("#")[0].slice(0, 500),
      excerpt,
      metrics: metricsOf(document, rule, "post"),
    };
  }

  function extractAccountLinks(rule) {
    const urls = [];
    for (const node of all(document, rule.accountLink)) {
      const url = abs(node.getAttribute("href"));
      if (!url || url === location.href) continue;
      if (!urls.includes(url)) urls.push(url);
      if (urls.length >= MAX_NEXT_URLS) break;
    }
    return urls;
  }

  // ---------- 公开联系方式补抓（D7=B）----------
  // 只在达人主页「已公开可见」的区域抽取邮箱/微信/电话/官网：节点必须可见（visible），
  // 每条结果带可见性标注（PROFILE_PUBLIC=资料区命中节点；BIO_PUBLIC=公开简介文本命中）。
  // 不读 Cookie、不点展开、不抓隐藏字段；抓不到就如实留空，绝不猜。

  /** 资料区选择器：命中这些区域的联系方式算「主页公开资料」，可信度高于简介文本。 */
  const PROFILE_PUBLIC_NODES = [
    "[class*='profile']",
    "[class*='Profile']",
    "[class*='desc']",
    "[class*='Desc']",
    "[class*='bio']",
    "[class*='Bio']",
    "[class*='intro']",
    "[class*='Intro']",
    "[class*='signature']",
    "[class*='Signature']",
    "[class*='contact']",
    "[class*='Contact']",
  ];
  const CONTACT_SCAN_MAX_NODES = 4000;
  const CONTACT_VALUE_MAX = 200;
  const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/;
  const PHONE_RE = /(?:\+?86[-\s]?)?1[3-9]\d{9}/;
  // 「微信/微 信/vx/wechat/威信」后接分隔符与账号名；账号名限定常见字符，避免误吃整句。
  const WECHAT_RE =
    /(?:微信|微\s*信|威信|vx|VX|Vx|wechat|WeChat|WECHAT)\s*[:：\-—]?\s*([A-Za-z0-9_-]{5,20})/;
  const NON_HOMEPAGE_HOST = /(?:xiaohongshu|douyin|zhihu|weibo|bilibili|kuaishou|weixin|qq|toutiao)\./i;

  /** 只扫「短文本 + 可见」的节点：整页文本会把导航/脚注里的噪声也当成联系方式。 */
  function contactNodes() {
    const nodes = document.querySelectorAll("div,span,p,li,a,section,header");
    const out = [];
    for (let index = 0; index < nodes.length && index < CONTACT_SCAN_MAX_NODES; index += 1) {
      const node = nodes[index];
      const own = String(node.textContent || "").trim();
      if (!own || own.length > 400) continue;
      if (!visible(node)) continue;
      out.push(node);
    }
    return out;
  }

  function publicRegion(node) {
    for (const selector of PROFILE_PUBLIC_NODES) {
      try {
        if (node.matches?.(selector)) return true;
      } catch (_) {
        // 非法选择器字符，跳过继续
      }
    }
    return false;
  }

  /**
   * 从页面可见区域抽取公开联系方式；同名同类只留第一条，按 field 去重。
   * 命中「资料区节点」标 PROFILE_PUBLIC，仅命中简介文本标 BIO_PUBLIC。
   */
  function extractContacts(rule) {
    const found = new Map();
    const push = (field, value, visibility) => {
      const clean = String(value || "").trim().slice(0, CONTACT_VALUE_MAX);
      if (!clean || found.has(field)) return;
      found.set(field, { field, value: clean, visibility });
    };
    const nodes = contactNodes();
    for (const node of nodes) {
      const text = String(node.textContent || "").trim();
      const visibility = publicRegion(node) ? "PROFILE_PUBLIC" : "BIO_PUBLIC";
      const email = text.match(EMAIL_RE);
      if (email && !found.has("email")) push("email", email[0], visibility);
      const wechat = text.match(WECHAT_RE);
      if (wechat && !found.has("wechat")) push("wechat", wechat[1], visibility);
      const phone = text.match(PHONE_RE);
      if (phone && !found.has("phone")) push("phone", phone[0].replace(/[\s-]/g, ""), visibility);
      if (!found.has("homepage")) {
        const link = node.matches?.("a[href]") ? node : node.querySelector?.("a[href]");
        const href = link ? abs(link.getAttribute("href")) : "";
        // 只认外链型个人官网；平台自身站点链接不是「联系方式」。
        if (href && !NON_HOMEPAGE_HOST.test(new URL(href).hostname)) {
          push("homepage", href, visibility);
        }
      }
    }
    return [...found.values()];
  }

  /** 主页（账号页）补抓：内容链接 + 公开联系方式，联系方式随一条 PROFILE 证据回传。 */
  function extractProfile(rule, platform) {
    const contacts = extractContacts(rule);
    if (!contacts.length) return null;
    const author = authorOf(document, rule, "post");
    const bioNode = first(document, [
      "[class*='desc']",
      "[class*='bio']",
      "[class*='signature']",
      "[class*='intro']",
      ".user-desc",
      ".profile-desc",
    ]);
    const excerpt = (textOf(bioNode) || textOf(document.querySelector("main, #app, body"))).slice(
      0,
      EXCERPT_MAX,
    );
    return {
      platform,
      platformUserId: author.platformUserId,
      nickname: author.nickname,
      profileUrl: location.href.split("#")[0].slice(0, 500),
      sourceType: "PROFILE",
      url: location.href.split("#")[0].slice(0, 500),
      excerpt,
      metrics: {},
      contacts,
    };
  }

  // ---------- 滚动加载 ----------

  /** 评论区往往在自己的滚动容器里（小红书/抖音），只滚 window 加载不出更多。 */
  function mainScroller() {
    const nodes = document.querySelectorAll("div,section,main");
    let best = null;
    let bestArea = 0;
    for (let index = 0; index < nodes.length && index < 2000; index += 1) {
      const node = nodes[index];
      if (node.scrollHeight <= node.clientHeight + 80) continue;
      const overflowY = getComputedStyle(node).overflowY;
      if (overflowY !== "auto" && overflowY !== "scroll") continue;
      const area = node.clientHeight * node.clientWidth;
      if (area > bestArea) {
        best = node;
        bestArea = area;
      }
    }
    return best;
  }

  async function scrollLoad(countOf, maxItems) {
    const scroller = mainScroller();
    let previous = -1;
    let stable = 0;
    for (let round = 0; round < MAX_SCROLL_ROUNDS; round += 1) {
      if (countOf() >= maxItems) return;
      window.scrollTo(0, document.body.scrollHeight);
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
      await sleep(SCROLL_MIN_MS + Math.random() * (SCROLL_MAX_MS - SCROLL_MIN_MS));
      // 滚动过程中也可能弹验证码/风控：每轮都查，命中就停，不继续加载。
      if (guard()) return;
      const next = countOf();
      // 连续四轮没有新节点就认为到底了，不无限滚下去占着用户的浏览器。
      stable = next === previous ? stable + 1 : 0;
      previous = next;
      if (stable >= 3) return;
    }
  }

  // ---------- 主流程 ----------

  async function collect(payload) {
    const platform = String(payload.platform || "").toUpperCase() || platformOfHost();
    const rule = ruleOf(platform);
    if (!rule) {
      return { items: [], nextUrls: [], stopReason: "PAGE_CHANGED", error: `采集器没有 ${platform || "该页面"} 的抓取规则` };
    }
    const declared = platformOfHost();
    if (declared && declared !== platform) {
      return { items: [], nextUrls: [], stopReason: "PAGE_CHANGED", error: `当前页面属于 ${declared}，与监控源声明的 ${platform} 不一致` };
    }
    const blocked = guard();
    if (blocked) {
      return { items: [], nextUrls: [], stopReason: blocked, error: "" };
    }
    const maxItems = Math.min(500, Math.max(1, Number(payload.limits?.maxItems) || 200));
    const kind = String(payload.kind || "search");

    if (kind === "account") {
      const nextUrls = extractAccountLinks(rule);
      const profile = extractProfile(rule, platform);
      const items = profile && profile.platformUserId ? [profile] : [];
      if (!nextUrls.length && !items.length) {
        return { items: [], nextUrls: [], stopReason: loginPrompt() ? "NEED_LOGIN" : "PAGE_CHANGED", error: "账号页没有解析到内容链接或公开联系方式，可能未登录或页面结构已变化" };
      }
      return { items, nextUrls, stopReason: "", error: "" };
    }

    if (kind === "content") {
      await scrollLoad(() => all(document, rule.commentCard).length, maxItems);
      const after = guard();
      if (after) return { items: [], nextUrls: [], stopReason: after, error: "" };
      const comments = extractComments(rule, platform, maxItems);
      if (comments.length) return { items: comments, nextUrls: [], stopReason: "", error: "" };
      const post = extractPost(rule, platform);
      if (post) return { items: [post], nextUrls: [], stopReason: "", error: "" };
      return {
        items: [],
        nextUrls: [],
        stopReason: loginPrompt() ? "NEED_LOGIN" : "PAGE_CHANGED",
        error: "内容页没有解析到评论或正文，可能未登录、评论区未开放或页面结构已变化",
      };
    }

    await scrollLoad(() => all(document, rule.listCard).length, maxItems);
    const after = guard();
    if (after) return { items: [], nextUrls: [], stopReason: after, error: "" };
    const { items, nextUrls } = extractList(rule, platform, maxItems);
    if (!items.length) {
      // 搜索页无结果与结构变化要分开：无结果不是失败，如实报 0 条即可。
      if (emptyResult()) return { items: [], nextUrls: [], stopReason: "", error: "" };
      return {
        items: [],
        nextUrls: [],
        stopReason: loginPrompt() ? "NEED_LOGIN" : "PAGE_CHANGED",
        error: "搜索页没有解析到内容卡片，可能未登录、无结果或页面结构已变化",
      };
    }
    return { items, nextUrls, stopReason: "", error: "" };
  }

  function loginPrompt() {
    const nodes = document.querySelectorAll("div,p,span,a,button,h1,h2");
    for (let index = 0; index < nodes.length && index < 3000; index += 1) {
      const own = String(nodes[index].textContent || "").trim();
      if (!own || own.length > 120) continue;
      if (LOGIN_TEXT.test(own) && visible(nodes[index])) return true;
    }
    return false;
  }

  function emptyResult() {
    const nodes = document.querySelectorAll("div,p,span");
    for (let index = 0; index < nodes.length && index < 3000; index += 1) {
      const own = String(nodes[index].textContent || "").trim();
      if (!own || own.length > 80) continue;
      if (/没有找到|暂无结果|无相关|没有找到相关|空空如也|换个词试试|未找到相关/.test(own) && visible(nodes[index])) {
        return true;
      }
    }
    return false;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "AIPDD_COLLECT") return false;
    (async () => {
      try {
        sendResponse(await collect(message.payload || {}));
      } catch (error) {
        sendResponse({
          items: [],
          nextUrls: [],
          stopReason: "PAGE_CHANGED",
          error: String(error?.message || error).slice(0, 1000),
        });
      }
    })();
    return true;
  });
})();