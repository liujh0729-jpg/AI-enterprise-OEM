/**
 * 发稿平台推荐：按语言与付费方式（付费发稿 / 免费渠道）挑主流发布渠道。
 * 信息为公开资料整理（平台定位、语言与分发范围），价格与服务条款以各平台官网为准。
 */

export type PressLanguageKey =
  | "zh"
  | "en"
  | "ja"
  | "ko"
  | "de"
  | "fr"
  | "es"
  | "it"
  | "pt"
  | "ru"
  | "ar"
  | "th"
  | "vi"
  | "id"
  | "tr";

export const PRESS_LANGUAGES: { value: PressLanguageKey; label: string }[] = [
  { value: "zh", label: "中文" },
  { value: "en", label: "英文" },
  { value: "ja", label: "日文" },
  { value: "ko", label: "韩文" },
  { value: "de", label: "德文" },
  { value: "fr", label: "法文" },
  { value: "es", label: "西班牙文" },
  { value: "it", label: "意大利文" },
  { value: "pt", label: "葡萄牙文" },
  { value: "ru", label: "俄文" },
  { value: "ar", label: "阿拉伯文" },
  { value: "th", label: "泰文" },
  { value: "vi", label: "越南文" },
  { value: "id", label: "印尼文" },
  { value: "tr", label: "土耳其文" },
];

export type PressPricing = "paid" | "free";

export const PRESS_PRICING: { value: PressPricing; label: string }[] = [
  { value: "paid", label: "付费发稿" },
  { value: "free", label: "免费渠道" },
];

export type PressPlatform = {
  name: string;
  url: string;
  languages: PressLanguageKey[];
  pricing: PressPricing;
  intro: string;
};

/** 付费渠道：新闻通讯社、软文分发平台，按篇或套餐收费。 */
const PAID_PLATFORMS: Omit<PressPlatform, "pricing">[] = [
  {
    name: "投媒网",
    url: "https://toumeiw.cn/",
    languages: ["zh"],
    intro:
      "国内软文与新闻稿自助发稿平台，整合 10 万+ 媒体资源，提供 AI 写稿与 GEO 内容分发，适合中文品牌曝光与搜索收录。",
  },
  {
    name: "媒介盒子",
    url: "https://www.meijiehezi.com/",
    languages: ["zh"],
    intro:
      "面向中小企业的自助软文发稿平台，整合上万家新闻媒体与自媒体资源，支持自助下单、快速分发，适合常规品牌稿件批量投放。",
  },
  {
    name: "美通社 PR Newswire（Cision）",
    url: "https://www.prnewswire.com/",
    languages: [
      "zh",
      "en",
      "ja",
      "ko",
      "de",
      "fr",
      "es",
      "it",
      "pt",
      "ru",
      "ar",
    ],
    intro:
      "全球企业新闻通讯社，支持 40+ 语言、覆盖 170+ 国家与 44 万个新闻编辑室，在欧洲与各国通讯社（如 dpa 旗下 news aktuell）有独家分发协议。",
  },
  {
    name: "美国商业资讯 Business Wire",
    url: "https://www.businesswire.com/",
    languages: ["zh", "en", "ja", "ko", "de", "fr", "es", "it", "pt"],
    intro:
      "伯克希尔·哈撒韦旗下新闻通讯社，支持 30+ 语言，分发网络覆盖 8.9 万+ 媒体与渠道，适合上市公司与全球品牌发布。",
  },
  {
    name: "环球通讯社 GlobeNewswire",
    url: "https://www.globenewswire.com/",
    languages: ["en", "de", "fr", "es", "it", "pt"],
    intro:
      "Intrado 旗下新闻稿分发服务，在北美与欧洲渠道深厚，常用于上市公司信息披露与 IR 通稿。",
  },
  {
    name: "EIN Presswire",
    url: "https://www.einpresswire.com/",
    languages: ["en", "de", "fr", "es", "ar"],
    intro:
      "按篇计价的新兴新闻稿分发平台，提供多语种稿件发布与媒体监测，性价比较高，适合中小企业试水海外曝光。",
  },
  {
    name: "ACCESSWIRE",
    url: "https://www.accesswire.com/",
    languages: ["en", "de", "fr", "es"],
    intro:
      "面向北美与欧洲的新闻稿分发服务（Issuer Direct 旗下），配套发布报告与媒体监测，适合中小市值公司。",
  },
  {
    name: "24-7 Press Release",
    url: "https://www.24-7pressrelease.com/",
    languages: ["en"],
    intro:
      "自 2004 年运营的英文新闻稿分发服务，按篇计价（基础套餐 49 美元起），流程简单，适合预算有限的中小企业。",
  },
  {
    name: "PR.com",
    url: "https://www.pr.com/",
    languages: ["en"],
    intro:
      "英文新闻稿发布与公司主页服务平台，可把稿件分发到数千家媒体与记者，并提供企业档案主页。",
  },
  {
    name: "Presswire",
    url: "https://presswire.com/",
    languages: ["en"],
    intro:
      "英国及国际新闻稿分发服务，按稿件定制媒体名单直投记者编辑，可选送 Press Association WIRE 新闻终端与政府部门。",
  },
  {
    name: "PR TIMES",
    url: "https://prtimes.jp/",
    languages: ["ja"],
    intro:
      "日本最大级新闻稿发布服务（法人向），与 260+ 站点提携、月间约 9,000 万 PV，可直接触达日本媒体与生活者。",
  },
  {
    name: "Dream News",
    url: "https://www.dreamnews.jp/",
    languages: ["ja"],
    intro:
      "日本自助新闻稿发布平台，面向中小企业与个人，按固定费用不限次数发布，适合持续性日常发稿。",
  },
  {
    name: "뉴스와이어 NEWSWIRE",
    url: "https://www.newswire.co.kr/",
    languages: ["ko"],
    intro:
      "韩国代表性新闻稿发布服务，稿件分发至韩国主要媒体、门户与行业记者，是进入韩语市场的常用渠道。",
  },
  {
    name: "PresseBox",
    url: "https://www.pressebox.com/",
    languages: ["de", "en"],
    intro:
      "德国新闻稿发布平台（United News Network 运营），向德语媒体、行业门户与记者分发稿件，支持附件与多媒体素材。",
  },
  {
    name: "presseportal.de",
    url: "https://www.presseportal.de/",
    languages: ["de"],
    intro:
      "德国 dpa 旗下 news aktuell 运营的公关门户，是德国覆盖最广的新闻稿发布渠道之一，企业与机构稿件可直接触达编辑部。",
  },
  {
    name: "24 Presse",
    url: "https://www.24presse.com/",
    languages: ["fr"],
    intro:
      "法国新闻稿撰写与分发服务平台，可按地区与行业选择媒体包下单，并提供发布效果报告。",
  },
  {
    name: "Europa Press",
    url: "https://www.europapress.es/",
    languages: ["es"],
    intro:
      "马德里独立通讯社，西班牙主要新闻稿与多媒体信息分发渠道，与美通社等国际通讯社有翻译分发合作。",
  },
  {
    name: "Adnkronos",
    url: "https://www.adnkronos.com/",
    languages: ["it"],
    intro:
      "意大利领先的在线新闻通讯社与新闻稿分发机构，稿件可进入意大利主流媒体与行业门户。",
  },
  {
    name: "Maxpress",
    url: "https://www.maxpress.com.br/",
    languages: ["pt"],
    intro:
      "巴西新闻稿发布与媒体关系平台，面向巴西及葡语市场媒体分发企业稿件，并可监测转载效果。",
  },
  {
    name: "PRNEWS.io",
    url: "https://prnews.io/",
    languages: ["ru", "en"],
    intro:
      "面向俄语与欧洲市场的付费新闻稿/品牌内容投放平台，媒体库覆盖俄罗斯及独联体，可在线选媒体下单。",
  },
  {
    name: "Pressfeed",
    url: "https://pressfeed.ru/",
    languages: ["ru"],
    intro:
      "俄罗斯媒体与专家对接平台，企业发布新闻线索与稿件，记者自主取用并采访，适合俄语市场媒体关系建设。",
  },
  {
    name: "Zawya",
    url: "https://www.zawya.com/",
    languages: ["ar", "en"],
    intro:
      "中东与北非地区的商业新闻与新闻稿发布平台（LSEG 旗下），面向海湾地区投资者、企业与媒体。",
  },
  {
    name: "Al Bawaba",
    url: "https://www.albawaba.com/",
    languages: ["ar", "en"],
    intro:
      "中东新闻门户与内容分发服务，覆盖阿拉伯语读者与区域媒体，适合面向中东北非的品牌曝光。",
  },
  {
    name: "ThaiPR.net",
    url: "https://www.thaipr.net/",
    languages: ["th"],
    intro:
      "泰国新闻稿发布与媒体监测平台，覆盖泰国主要纸媒、电视与在线媒体，是泰语市场常用发稿渠道。",
  },
  {
    name: "Media OutReach Newswire",
    url: "https://www.media-outreach.com/",
    languages: ["en", "zh", "ja", "ko", "th", "vi", "id"],
    intro:
      "亚洲发源的全球通讯社，在亚太 26 个国家和地区设有分发网络，多语言稿件直投记者邮箱并同步至财经终端。",
  },
  {
    name: "Vietnam News（越通社 VNA）",
    url: "https://vietnamnews.vn/",
    languages: ["en", "vi"],
    intro:
      "越南通讯社（VNA）旗下英文日报及其在线平台，是越南官方对外发声渠道，可通过其编辑部发布企业消息。",
  },
  {
    name: "ANTARA",
    url: "https://www.antaranews.com/",
    languages: ["id", "en"],
    intro:
      "印度尼西亚国家通讯社，印尼媒体的主要新闻来源，可通过其新闻稿服务发布企业消息并覆盖全国媒体。",
  },
  {
    name: "Anadolu Ajansı",
    url: "https://www.aa.com.tr/",
    languages: ["tr", "en"],
    intro:
      "土耳其官方通讯社，覆盖 150+ 国家，提供土耳其语、英语等多语种新闻发布，是进入土耳其市场的权威渠道。",
  },
];

/** 免费渠道：自有账号发布，不按篇付费，靠内容与社区规则获取曝光。 */
const FREE_PLATFORMS: Omit<PressPlatform, "pricing">[] = [
  {
    name: "知乎",
    url: "https://www.zhihu.com/",
    languages: ["zh"],
    intro:
      "中文问答社区，机构号与个人号可免费发布回答与文章，内容易被搜索引擎收录，适合专业解答与品牌可信度建设。",
  },
  {
    name: "微信公众号",
    url: "https://mp.weixin.qq.com/",
    languages: ["zh"],
    intro:
      "微信官方内容后台，注册订阅号/服务号后可免费群发图文，直接触达私域粉丝，是中文品牌自有内容阵地的核心。",
  },
  {
    name: "今日头条",
    url: "https://www.toutiao.com/",
    languages: ["zh"],
    intro:
      "字节跳动旗下资讯平台，注册头条号即可免费发布图文与视频，由算法推荐分发，适合大众化话题的广泛曝光。",
  },
  {
    name: "百度百家号",
    url: "https://baijiahao.baidu.com/",
    languages: ["zh"],
    intro:
      "百度内容平台，注册百家号后免费发文，内容优先进入百度搜索与信息流，对中文搜索与 GEO 收录最直接。",
  },
  {
    name: "小红书",
    url: "https://www.xiaohongshu.com/",
    languages: ["zh"],
    intro:
      "生活方式社区，企业号与个人号可免费发布笔记，种草与口碑内容传播快，适合消费品牌与本地生活商家。",
  },
  {
    name: "微博",
    url: "https://weibo.com/",
    languages: ["zh"],
    intro:
      "中文社交媒体平台，官方账号可免费发布图文与话题，热点响应与短平快传播能力突出，适合活动与事件营销。",
  },
  {
    name: "Reddit",
    url: "https://www.reddit.com/",
    languages: ["en"],
    intro:
      "全球最大的兴趣社区，按 subreddit 免费发帖与讨论，需遵守各版块规则、避免硬广，适合海外真实口碑与用户洞察。",
  },
  {
    name: "Medium",
    url: "https://medium.com/",
    languages: ["en"],
    intro:
      "免费写作与博客平台，长文可被搜索引擎收录并进入 Medium 推荐流，适合创始人观点、行业分析与品牌故事。",
  },
  {
    name: "Quora",
    url: "https://www.quora.com/",
    languages: ["en"],
    intro:
      "英文问答社区，免费回答问题并署名品牌信息，适合专业型答案的长期搜索曝光，同样忌讳直接推销。",
  },
  {
    name: "LinkedIn",
    url: "https://www.linkedin.com/",
    languages: ["en", "zh", "ja", "ko", "de", "fr", "es", "it", "pt"],
    intro:
      "职业社交平台，企业与个人主页可免费发布动态与文章，B2B 决策人群集中，适合企业新闻与雇主品牌传播。",
  },
  {
    name: "Substack",
    url: "https://substack.com/",
    languages: ["en"],
    intro:
      "免费开通讯与订阅专栏的平台，可沉淀自己的邮件订阅列表，适合长期内容运营与私域读者积累。",
  },
  {
    name: "Hacker News",
    url: "https://news.ycombinator.com/",
    languages: ["en"],
    intro:
      "面向开发者与创业者的技术社区，可免费提交链接（如 Show HN），优质内容曝光极大，但对营销内容非常敏感。",
  },
  {
    name: "DEV Community",
    url: "https://dev.to/",
    languages: ["en"],
    intro:
      "开发者写作社区，免费发布技术文章并同步到多个技术渠道，适合开发者工具与开源项目的技术内容推广。",
  },
  {
    name: "note",
    url: "https://note.com/",
    languages: ["ja"],
    intro:
      "日本常用免费内容平台，企业与个人均可开设账号发布文章与专栏，便于在日本读者中建立长期内容资产。",
  },
  {
    name: "Tistory",
    url: "https://www.tistory.com/",
    languages: ["ko"],
    intro:
      "韩国代表性免费博客平台（Kakao 运营），可自建博客发文并被韩国搜索引擎收录，适合韩语市场的长期内容沉淀。",
  },
  {
    name: "VC.ru",
    url: "https://vc.ru/",
    languages: ["ru"],
    intro:
      "俄罗斯商业与创业内容平台，公司与作者可免费发布专栏与动态，面向俄语商业读者，适合品牌故事与行业观点。",
  },
  {
    name: "Pantip",
    url: "https://pantip.com/",
    languages: ["th"],
    intro:
      "泰国最大的网络社区，可免费开帖讨论，是泰国消费者口碑与话题发酵的重要阵地，发帖需遵守版块规则。",
  },
  {
    name: "Kaskus",
    url: "https://www.kaskus.co.id/",
    languages: ["id"],
    intro:
      "印尼老牌网络社区，支持免费发帖与品牌讨论区，适合印尼本地用户口碑与社区运营。",
  },
  {
    name: "Ekşi Sözlük",
    url: "https://eksisozluk.com/",
    languages: ["tr"],
    intro:
      "土耳其知名词条与讨论社区，可免费创建品牌词条、回答问题，内容常被搜索引擎引用，需遵守社区规范。",
  },
];

export const PRESS_PLATFORMS: PressPlatform[] = [
  ...PAID_PLATFORMS.map((item) => ({ ...item, pricing: "paid" as const })),
  ...FREE_PLATFORMS.map((item) => ({ ...item, pricing: "free" as const })),
];
