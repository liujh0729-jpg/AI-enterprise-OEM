# OEM Enterprise · 开源企业服务工作台 + 商务社交

**在线 Demo：<https://enterprise.aiworkin.com>**

一个把 **企业服务工作台**（Hono + Prisma + MySQL + Next.js / Ant Design）与 **商务社交 SNS**
（关系 / 动态 / 小组 / 私信 / 简历 / 供求广场 / 招聘）合并移植的开源项目。

它不是一个单点工具，而是一套「企业内管 + 对外获客 + 业务撮合」的完整底座：账号与身份体系之上，
同时提供高管驾驶舱、15 个工作台模块（Agent、Workbuddy 企业云、多维表格、RPA、内容创作、营销工具、
数字资产、AI 邮箱、CRM、BI、OA、OKR、AI 客服、应用中心、专题大厅）、11 条业务服务线（营销 / 供销 /
财税 / 出海 / 灵活用工 / 物流 / IT / 知识产权 / 法律 / 智库 / 资产交易）、商务社交与招聘，
以及一个 15 个板块的平台管理后台。全部社交与供求能力**本地闭环、免 Key 可用**；
需要面向上游市场（AIworkin）发布需求 / 服务、做企业档案与资格申请时，绑定一把 AIPDD APIKey 即可打通
——**本系统不涉币、不托管上游账号、样式与交互全部本地重写**。

> 设计与迁移规格见 [`docs/开源版整体设计方案.md`](docs/开源版整体设计方案.md)。

| 规格 | 数量 |
|---|---|
| 页面路由（Next.js App Router） | 55 |
| HTTP 操作（OpenAPI 快照口径） | 1254 |
| Prisma 数据模型 | 301 |
| 后端业务模块 | 65 |
| 界面语言 | 8（含阿拉伯语整站 RTL） |
| 数据库 | MySQL 8 或 PostgreSQL（安装时二选一） |

---

## 📸 界面预览

> 以下截图取自演示站 <https://enterprise.aiworkin.com>（超级管理员视角，左侧为「工作台 / 业务服务」菜单）。

**Agent 工作台**：对话即产出图片 / 视频；页签覆盖对话、定时任务、助理、数字分身、记忆、技能、专家与 MCP 连接器。
<img src="docs/screenshots/agent.png" width="900" alt="Agent 工作台">

**营销工具**：获客、触达与数据工具一屏陈列，每张卡片自带说明与独立入口（达人建联、阿里云外呼 / 邮件推送、GEO 优化、活码引流、腾讯企点、潜客挖掘、全球大数据、多平台内容分发、SalesBuddy）。
<img src="docs/screenshots/marketing-tools.png" width="900" alt="营销工具">

**内容创作**：文生图、图生视频、视频复刻、数字人、修图去水印、提取文案、语音合成、音乐、配音、混剪、反推剧本与口播稿，另含跨境电商与国内电商「商品页优化」图包，末尾为可本地部署的视频创作工具。
<img src="docs/screenshots/content-creation.png" width="900" alt="内容创作">

**财税服务**：报税材料、申报计划、账套管理、自动化能力与需求信息；申报计划按签约企业的纳税人性质与申报频率自动生成，逐税种查看进度并进入申报单。
<img src="docs/screenshots/tax-service.png" width="900" alt="财税服务">

**AI 客服**：会话、客服团队、接待设置、常用语与知识、站点与接入、渠道接入、统计一屏管理；接待状态分在线 / 离开 / 离线，在线才参与自动分配。
<img src="docs/screenshots/ai-service-desk.png" width="900" alt="AI 客服">

---

## 🗺️ 功能地图

| 分组 | 模块 | 一句话 | 上游凭证 |
|---|---|---|---|
| 首页 | 高管驾驶舱 | 身份与资质、我的待办、业务台账；平台管理员侧为平台总览与审核待办 | 否 |
| 工作台 | Agent | 对话直接产出图片 / 视频，结果进本账号的 AIPDD 数字资产 | AIPDD |
| 工作台 | Workbuddy 企业云 | 计划任务（AI 澄清任务书）、Agent、企业云账号与 AI 调用账号托管 | 腾讯云 |
| 工作台 | 多维表格 | 自建结构化数据表、8 种列类型、API Key 机器通道、飞书同步 | 否 |
| 工作台 | RPA 自动化 | 云端 RPA 任务 / 账号 / 脚本，本地比特浏览器认领执行并回传 | AIPDD |
| 工作台 | 内容创作 | 文生图 / 视频、数字人、配音配乐、混剪、去水印与超分、商品页优化图包、Drama Agent | AIPDD |
| 工作台 | 营销工具 | 达人建联、阿里云外呼 / 邮件推送、GEO 优化、活码引流、企点、潜客挖掘、全球大数据、多平台内容分发、SalesBuddy | 各家自助 / 本地插件 |
| 工作台 | 数字资产管理 | 与 AIPDD 数字资产完全同步：检索、打标签、上传登记 | AIPDD |
| 工作台 | AI 邮箱服务 | 多邮箱 POP3 / IMAP 读取，正文附件不落库，按话术草拟或自动回复 | 邮箱授权码 |
| 工作台 | CRM | 线索、客户、商机、销售合同、回款、订单、审批与报表 | 否 |
| 工作台 | BI 智能分析 | 内置策展数据集 + 外部只读数据源，智能问数、图表、仪表板 | 否 |
| 工作台 | OA | 请假 / 报销 / 付款 / 采购 / 用章表单与多级审批，结果回写业务 | 否 |
| 工作台 | OKR 计划 | 周期、公司到个人的目标树、周日报、复盘评分 | 否 |
| 工作台 | AI 客服 | 一个账号挂多个官网站点，真人接待 + AI 三种应答模式 | 否 |
| 工作台 | 应用中心 | 内建应用 + 应用市场，四个页签按关键词检索 | 否 |
| 工作台 | 专题大厅 | 企业内 / 公开专题讨论，发起人可结案并让 AI 总结 | 否 |
| 业务服务 | 营销 / 供销 / 财税 / 出海 / 灵活用工 / 物流 / IT / 知识产权 / 法律 / 智库 / 资产交易 | 服务商资源库 → 详情 → 签约；需求消息通道与业务台账 | 部分 |
| 商务人脉 | 商务社交 | 好友 / 拉黑、动态、豆瓣式小组、私信、职场简历 | 否 |
| 商务人脉 | 招聘 | 全职 / 兼职 / 实习 / 临时 / 劳务派遣岗位，私信对接 | 本地否 / 同步是 |
| 商务人脉 | 供求广场 | 通用发布需求 / 服务，两段式：本地免 Key + 可选同步上游 | 本地否 / 同步是 |
| 管理设置 | 身份与资质 / 职员·代理人 / 签约管理 / 积分中心 / 我的邀请 | 认证、团队、签约台账、双币积分、邀请关系 | 否 |
| 平台后台 | 15 个板块（见下文） | 备案审核、服务商与类目资质、签约监管、财税账号池、GEO / 活码监管、积分风控、系统设置 | — |
| 开放集成 | API Key / API 文档 / MCP Server / 模型设置 | ek_ Key 调 `/api/v1`、MCP 接入、模型选择 | 部分 |
| 帮助与文档 | 帮助中心 `/help` | 按章节的版本化知识库（快速开始 / 工作台工具 / 内容与营销 / 多平台分发 / 业务与管理设置）；同一份知识以 MCP 只读工具开放，可直接问 Agent 获取官方用法 | 否 |

---

## 📖 功能详解

### 一、账户、身份与会话

- **本地账户闭环**：注册（用户名 / 邮箱 / 手机通道可选）、登录、找回、改密、换绑、注销；登录日志与平台级封禁。
- **用户名与邮箱小写归一化**：MySQL 排序规则大小写不敏感、PostgreSQL 敏感，统一按小写存储与查重，两库行为一致；存量库可用
  `pnpm --filter aiworkin-enterprise-api db:normalize-usernames` 幂等回填。
- **本站自签会话**：只接受本地签发的 SSO 会话（issuer `enterprise-sso`，密钥由 `JWT_SECRET` 经 HKDF 派生），
  每次请求核对账号状态与 `tokenVersion`——改密、换绑、封禁立即失效；上游平台令牌一律拒绝。
- **多身份与主体类型**：平台管理员、企业用户、服务商、服务商职员（代理人）四种身份；
  主体分企业、个体工商户、个人三类。切换身份后侧栏按身份重组：平台管理员只看到 `平台管理` 板块，
  不含个人账户视角的「管理设置」。
- **认证与资质**：企业信息提交即生效；服务商备案需平台审核；职员需绑定或挂靠服务商。
- **邀请码**：每个账号一把专属邀请码，注册时选填即建立邀请关系；「我的邀请」展示邀请码、注册链接、被谁邀请、已邀请人数。

### 二、高管驾驶舱

- 普通身份：身份与资质状态、我的待办、业务台账汇总。
- 平台管理员：平台数据总览、待办审核与服务商服务类型分布。

### 三、工作台（15 个模块）

| 模块 | 能力要点 |
|---|---|
| **Agent** | 与模型对话直接产出图片 / 视频，生成结果自动存进本账号的 AIPDD 数字资产；「记忆」页签同时保存 Agent 长期记忆与你在全站的操作留痕。模型与 Key 在「开放集成 → 模型设置」配置。 |
| **Workbuddy 企业云** | 计划任务：口水话经 AI 澄清成任务书、拆条派发、同步 Agent 消息；Agent：创建 / 版本 / 会话；Workbuddy Enterprise 账号：用户自己的 SecretId / SecretKey 密文保存、可多把并行；AI 调用账号：第三方平台口令 / API Key / Cookie 加密保存，按企业云账号绑定授权，经机器通道按绑定取用。 |
| **多维表格** | 按账号归属的自建结构化数据表：自定义列（八种类型）、逐条录入行数据、可经 API Key 机器通道读写；另提供与飞书多维表格的同步入口与飞书事件回调。 |
| **RPA 自动化** | RPA 任务（建任务即绑定脚本＋账号＋运行参数）、RPA 账号（口令密文保存）、RPA 脚本（Automa JSON / JS / Python，可由 AIPDD 文字模型按需求生成）；本地比特浏览器凭 API Key 认领执行并回传结果。 |
| **内容创作** | 一屏工具卡片：文生图、文生 / 图生视频、视频复刻、数字人视频、视频换人换产品、图片修图 / 去水印、音视频提取文案、语音合成、音乐创作、视频配音、混剪短视频、视频反推剧本、口播稿 / 公众号文章；两张商品页优化卡片（**跨境电商商品页优化**：Amazon / Etsy / 独立站英文图包，按购买理由驱动主图与详情图；**国内电商商品页优化**：淘宝 / 天猫 / 京东 / 拼多多 / 抖音 750px 长详情图包，文案守广告法极限词），建图包 → 大模型出规划（购买理由、风格锁、逐张提示词）→ 逐张出图，可填「逐张内容说明」按主图 1..N / 详情图 1..N 顺序对应生成；末尾为「视频创作工具」（AIPDD Drama Agent，支持直接粘贴 AIPDD / AIworkin 的 API Key）。视频超分与去水印走火山 AI MediaKit，需在模型设置里新增 MediaKit 渠道并填 Key 后才会出现。生成结果自动进数字资产。 |
| **营销工具** | 达人建联（按类目 / 平台 / 粉丝数筛选达人并查看联系方式）、阿里云智能外呼（多维表格名单映射为外呼任务组）、阿里云邮件推送（联系人同步到阿里云收件人列表）、GEO-AI 引擎优化（品牌在 AI 问答中的可见度、选题池、发稿平台推荐）、活码引流（固定入口 + 多子码随机 / 顺序 / 权重分发，限额、访客粘性、渠道统计，短链用自己域名）、腾讯企点（客户数据 / 企微运营 / 会员触达，客户可写进本系统 CRM）、Google 潜客线索挖掘、五个全球大数据工具（企业数据 / 全球贸易 / 全球商务人士 / 全球达人 / 全球 POI）、AI 销售管理 SalesBuddy；**多平台内容分发**——一条内容经 AIPDD Enterprise 浏览器插件同发 13 家渠道（动态图文：微博 / 小红书 / 抖音 / 快手 / 视频号 / 知识星球；文章：知乎 / 今日头条 / 百家号 / B站专栏 / 公众号 / 简书 / 豆瓣），正文用富文本编辑器书写、入库前按白名单清洗，再由插件按渠道能力自动降级为带样式 HTML / Markdown / 纯文本；草稿—待分发—已投递—成功 / 失败状态与逐平台结果均在本系统台账可查，发布动作在你已登录的浏览器本地完成、平台账号凭据不出本机。 |
| **数字资产管理** | 与 AIPDD 数字资产完全同步：按文件 / 图片 / 视频 / 音频查询、打标签、直接上传（上传即登记到平台，本地不存副本）。 |
| **AI 邮箱服务** | 按登录账号添加多个邮箱（POP3 / IMAP），实时读取收件箱与草稿箱，**邮件正文与附件一律不落库**；可配置场景话术，回复方式选「只写草稿」或「写草稿并自动回复」；Agent 定时任务通过邮件工具按话术草拟回复；列表显示今日已发送 / 已出草稿与本月累计处理量。 |
| **CRM** | 账号级客户关系管理：线索、客户、商机、销售合同、回款、订单、审批与报表，含跟进记录与 AI 辅助；成员与权限复用本账号的「职员与代理人」。 |
| **BI 智能分析** | 账号级 BI：内置 CRM 策展数据集 + 外部 PostgreSQL / MySQL 只读数据源；支持智能问数、图表与仪表板。 |
| **OA** | 按组织归属的表单申请与多级审批：请假、报销、付款、采购、用章；成员来自「职员与代理人」，可关联 CRM 等业务数据，审批结果回写，另有定时提醒与待办。 |
| **OKR 计划** | 按组织归属：年度 / 季度 / 月度周期，公司到个人的目标树，周 / 日计划，日报周报与周期复盘评分。 |
| **AI 客服** | 账号级客服：一个账号可挂多个官网站点，访客从官网客服窗口（同域 iframe `/embed/service-desk`）进入，由本组织职员 / 代理人真人接待；含会话、客服团队、接待设置、常用语与知识、站点与接入、渠道接入、统计七个页签。接待状态分在线 / 离开 / 离线，仅在线参与自动分配；AI 按设置做固定文案、回复建议或自动应答，自动模式可随时转人工，纯 AI 接待模式不转人工。 |
| **应用中心** | 内建应用与应用市场合并入口：首页按关键词搜索「我构建的 / 本企业构建的 / 应用市场的应用」，另有企业创建、我创建的、我加入的、应用市场四个页签。内建应用实体落多维表格、成员按角色权限读写；应用市场是外部公开目录的只读展示，本站不存应用、不代上架也不代评价。 |
| **专题大厅** | 发布企业内或公开的专题讨论：企业内由本组织与签约 / 承办伙伴的职员参与，公开对所有登录账号开放；发起人可结案（AI 总结全部发言与回复）、重新结案、关闭或删除；发言可选本人或数字分身署名。 |

### 四、业务服务（11 条线）

统一形态：**服务商资源库**（列表浏览 → 详情 → 发起签约）+ **需求 / 服务发布** + **业务台账**。
服务商须先完成备案并通过对应类目资质，资源才对外展示；某板块只有一家服务商时不展示列表，直接内嵌其详情。

| 板块 | 内容 |
|---|---|
| 营销服务 | 达人探店 / 直播带货 · 需求消息通道 |
| 供销网络 | B2B 供需协同：服务站、商品订货、线下服务预约（报价由服务商或其指派职员完成） |
| 财税服务 | 报税材料、申报计划、账套管理、自动化能力与需求信息；申报计划按签约企业的纳税人性质（一般 / 小规模）与申报频率（月 / 季 / 年）自动生成；企业能力开通后可由企享云做自动申报、自动开票与已开发票查询 |
| 跨境出海 | 跨境出海服务商与出海服务工具 |
| 灵活用工 | 资源库、用工需求（含用工进件）与灵工发薪（平台级启停，缺省启用） |
| 物流服务 | 境内陆运 / 跨境货代 · 需求消息通道 |
| IT 服务 | AI 实施 / 软件开发 / 算力 / 硬件 / 数据 · 需求消息通道 |
| 知识产权 | 机构 / 代理人资源库、需求消息与咨询维权 |
| 法律服务 | 律师 / 律所资源库与需求消息 |
| 智库服务 | 机构 / 专家资源库与需求消息 |
| 资产交易 | 资产租售与居间服务 · 需求消息通道 |

- **签约**：企业发起 → 服务商确认 → 进入签约台账；平台管理员可在「签约监管」解除生效中的签约。
- **能力开通**：电子报税 / 电子开票属付费能力，服务商按服务企业配置，企业提交开通申请、平台审核；
  企业维度的开通 / 关闭与企享云账号匹配统一在后台「财税管理」。
- **业务看板**：财税 / 供销 / 出海等板块的「需求信息 / 服务发布」直接转发 AIworkin 运行时，
  本系统不存需求与服务数据。

### 五、商务人脉（社交 / 招聘 / 供求）

- **商务社交**：结识同行人（好友 / 拉黑）、发布动态（公开 / 仅好友）、豆瓣式小组（发现 / 加入小组、分类发帖、
  逐条匿名、楼层回复与推荐、组长 / 管理员置顶加精与入组审批）、站内私信、职场简历（与主页分叉的独立 HTML 页，
  可在私信里投递，雇主点开即看并导出 PDF）。账号被封禁时社交能力自动拦截。
- **招聘**：发布全职 / 兼职 / 实习 / 临时 / 劳务派遣岗位进招聘广场信息流，靠站内私信对接（可附简历），
  本系统不做 ATS 简历库与筛选；已绑定 AIPDD Key 时可把岗位同步为 AIworkin 用工需求（类目固定取「灵活用工」子树）。
- **供求广场**：通用发布需求 / 服务，进本地信息流，可被浏览与私信对接。
  **两段式发布**是本项目核心口径：默认在本地免 Key 发布；勾选「同步发布到 AIworkin」时，
  经统一凭证解析器以用户绑定的 Key 调上游 `POST /market/listings`，并镜像回上游审核 / 撤回状态。

### 六、管理设置

| 模块 | 内容 |
|---|---|
| 身份与资质 | 用户信息提交即生效；服务商备案需审核；职员需绑定或挂靠 |
| 职员 / 代理人管理 | 团队概览、挂靠审批与在职职员；内含 IM 连接（飞书 / 企业微信）目录同步与回调 |
| 签约管理 | 签约概览与全部签约（企业发起、服务商确认） |
| 积分中心 | 积分与 AWcoin 双币展示、充值、赠送、流水与订单 |
| 我的邀请 | 专属邀请码、注册链接、邀请关系与人数 |

### 七、平台管理后台（`/admin`，15 个板块）

| 板块 | 说明 |
|---|---|
| 总览 | 平台数据总览、待办审核与服务商服务类型分布 |
| 注册用户 | 全部账号：用户名、昵称、邮箱、账号状态 |
| 企业用户 | 已通过企业信息认证的用户（企业 / 个体工商户） |
| 服务商备案 | 备案申请审核，通过后自动获得服务商角色 |
| 服务商管理 | 已备案服务商与其服务类型资质，可逐项停用 / 恢复（停用即资源下线并拦截该类型新建业务） |
| 灵活用工 | 「灵工发薪」板块的平台级启停（默认启用） |
| 签约监管 | 全部签约台账，可解除生效中的签约 |
| 供销网络监管 | 服务站、商品订货与服务预约单的全平台总览 |
| 服务商能力开通 | 财税自动化付费开通申请审核 |
| 财税管理 | 企享云报税 API Key 账号池与税号匹配，审核付费开通申请 |
| GEO 管理设置 | 每周 GEO 自动采集任务量（计划 / 实际、逐项目明细） |
| 活码监管 | 全平台活码清单：归属账号、入口域名、累计扫码；违规可下架 |
| 积分与充值 | 汇率与档位、注册 / 邀请奖励、赠送限额与风控、模块价目与用量、账户调整与充值订单 |
| 服务商展示与同步 | 数据源在 AIworkin、展示权在本系统：同步策略（手动 / 定时）、立即同步、逐项展示开关与排序权重 |
| 系统设置 | 文件存储（OSS）、AIPDD 平台 Key、平台级参数与站点设置（页签切换，保存即生效） |

### 八、开放集成

- **API Key 管理**：两套 Key 分开管——本系统 `ek_` Key 用于调用开放接口（`/api/v1`），生成 / 重置 / 吊销都在本页；
  AIPDD API Key（`sk-`）同页绑定，开通同步发布、服务商数据同步、建联资源等上游能力。Key 加密保存、永不回显。
- **API 文档**：本系统实际对外提供的接口清单，由契约层派生，与 MCP 服务端 `list_operations`、OpenAPI 文档同源。
- **MCP Server**：Codex、Claude Desktop、Cursor、自研脚本与 Workbuddy 用同一把 API Key 连进来；
  服务端先分析本账号的智能体记忆，再按授权自动执行本站动作。
- **模型设置**：Agent 与内容创作共用的模型配置——AIPDD 内置渠道直接用 sk- Key，也可接其他 OpenAI 兼容网关与火山 MediaKit，并为每种类型选默认模型。
- **帮助中心**：`/help` 章节化知识库随代码版本化维护（知识文件在 `backend/src/help`），覆盖各模块用法；同一份内容以 MCP `Help_chapters / Help_topic / Help_search` 三个只读动作开放，用户直接问 Agent 也能拿到官方用法。
- **OpenAPI 快照**：`/api/openapi.json`（1254 个操作），CI 校验与仓库快照一致。

### 九、积分与计费

- **积分**：微信充值、账号间赠送、模块价目与用量扣减（数字资产存储、CRM / BI / OA / AI 客服等），流水与充值订单一屏可查。
- **AWcoin**：只读展示余额与来源，**永不互兑**。
- **后台配置**：汇率与充值档位、注册 / 邀请奖励、赠送限额与风控、逐模块价目、账户调整与订单查询。

### 十、多语言、站点与通知

- **8 种界面语言**：简体中文 · English · Tiếng Việt · 日本語 · العربية · Français · Español · Русский；
  管理员可设站点默认语言，访客随时切换，阿拉伯语整站 RTL。
- **站点域名三级优先级**：后台「站点设置 → 站点域名」＞ `SITE_URL` ＞ 访客当前地址；
  MCP / API 端点、IM 回调、客服嵌入脚本、活码入口、邀请链接等绝对地址统一按此拼接（见下文「站点域名」）。
- **菜单显隐**：业务服务逐项、开放集成逐项、AI 增值服务整组，均可由后台站点设置控制（只隐藏菜单，链接仍可访问）。
- **系统消息**：客服、需求与商机、身份与签约、财税与申报、自动化与集成、账号与平台六类事件集中提醒。

---

## 🧱 技术栈与架构

- **后端**：[Hono 4](https://hono.dev) + `@hono/zod-openapi`、Prisma 5.22、MySQL 8 / PostgreSQL、Zod 4，Node.js ≥ 24
- **前端**：Next.js 16（App Router）+ React 19 + Ant Design 6 / Pro Components + `@tanstack/react-query` 5
- **契约层**：`packages/contracts` 是前后端、MCP、OpenAPI 的唯一事实源（1254 个操作、错误码、MCP 目录）
- **鉴权**：本站自签 SSO 会话（HKDF 派生密钥 + 账号版本核对）+ 开放接口 `ek_` Key + 上游 AIPDD `sk-` Key 三套通道分离

```
浏览器 ── Next.js（SSR/CSR，/api/backend/* 同源反代）
             │
             ├── Hono API（/api/backend 业务、/api/v1 开放接口与 MCP、/api/public 公开端点）
             │        ├── 账户 / 身份 / 会话     ├── 工作台（CRM·BI·OA·OKR·RPA·表格…）
             │        ├── 业务服务 11 条线        ├── 社交 / 招聘 / 供求
             │        ├── 积分与 OSS 存储底座     └── 平台后台
             │        └── 上游通道（AIPDD / AIworkin，用户 Key 或平台 Key）
             └── Prisma ── MySQL 8 / PostgreSQL（301 个模型，16 个迁移）
```

## 📁 目录结构

```
oem-enterprise/
├── backend/                 # Hono API
│   ├── prisma/              # schema.prisma（301 模型）+ migrations/（16 个）+ seed
│   └── src/                 # 65 个业务模块
│       ├── http/ account/ identity/ auth/    # 装配、账户、身份、会话
│       ├── aiworkin/ content/ agent-memory/  # 上游通道、Agent、内容创作与数字资产
│       ├── ecom-pdp/ domestic-pdp/           # 跨境 / 国内电商商品页优化图包
│       ├── crm/ bi/ oa/ okr/ data-table/ rpa/ workbuddy/ livecode/ lowcode/
│       ├── social/ sns/ supply/ marketing/ logistics/ tax/ flex/ overseas/
│       ├── legal/ ip/ think-tank/ asset/ smart-service/                       # 业务服务线
│       ├── points/ oss/ asset/               # 积分计费与存储
│       ├── mcp/ openapi/                     # 开放接口与 MCP 服务端
│       ├── admin/ platform/                  # 平台后台与站点设置
│       └── common/ shared/                   # 方言适配、错误码、鉴权、上游凭证
├── frontend/                # Next.js 应用（53 个页面路由，/social /admin 等）
├── packages/contracts/      # 前后端共享契约、错误码、MCP 目录
├── scripts/                 # 安装、迁移、校验与冒烟脚本
├── infra/                   # nginx / 部署样例
└── docs/                    # 整体设计方案、OpenAPI 快照、路由基线、截图与二维码资源
```

---

## 🚀 快速开始（本地开发）

前置：Node ≥ 24、pnpm ≥ 10、一个可访问的 **MySQL 8 或 PostgreSQL** 实例（二选一）。

### 方式 A：一键安装（推荐，可选数据库）

```bash
pnpm install
pnpm setup            # 交互式：选 MySQL / PostgreSQL → 填连接信息 → 写 backend/.env → 生成客户端 → 建表
# 或非交互：pnpm setup --db postgres --host 127.0.0.1 --port 5432 --user app --password *** --database enterprise --yes
pnpm dev:api & pnpm dev:web
```

`pnpm setup` 会：① 写入 `backend/.env` 的 `DATABASE_URL` 与 `DB_PROVIDER`；② MySQL 走迁移历史 `prisma migrate deploy`，PostgreSQL 由 `schema.prisma` 派生 `schema.postgres.prisma` 后 `prisma db push`；③ 按所选方言生成 Prisma Client。

> Prisma 的 Client 与建表语句按方言生成：切换数据库后重新执行 `pnpm setup`（或 `pnpm --filter aiworkin-enterprise-api prisma:generate:pg`）即可。

### 方式 B：手动配置

```bash
# 1) 安装依赖（会触发 prisma generate）
pnpm install

# 2) 配置后端环境变量
cp backend/.env.example backend/.env
#   编辑 backend/.env：设置 DATABASE_URL（MySQL 或 PostgreSQL）、DB_PROVIDER、JWT_SECRET、EXTERNAL_CRED_KEY
#   （JWT_SECRET / EXTERNAL_CRED_KEY 为本地随机串，缺失时后端拒绝启动）

# 3) 配置前端环境变量
cp frontend/.env.example frontend/.env.local

# 4) 初始化数据库（迁移/db push + 生成客户端）
#   MySQL：
pnpm --filter aiworkin-enterprise-api prisma:migrate:deploy
pnpm --filter aiworkin-enterprise-api prisma:generate
#   PostgreSQL（改用派生 schema）：
pnpm --filter aiworkin-enterprise-api db:push:pg

# 4b)（可选）灌入演示数据：企业档案 / 服务商名录 / 律师·知产·灵工 / 供销营销等
#     仅用于名录与详情展示；演示身份不是可登录账号，登录后仍请用步骤 5 注册的本地账号。
pnpm --filter aiworkin-enterprise-api prisma:seed

# 5) 起后端（默认 1690）与前端（默认 15890）
pnpm dev:api
pnpm dev:web
```

浏览器打开 `http://127.0.0.1:15890`，注册一个本地账号即可进入社交与供求广场。
前端通过 Next.js 服务端把 `/api/backend/*` 代理到后端，浏览器侧保持同源。

### 创建平台管理员（首次部署必须）

平台管理员**不会**随安装/启动自动创建，需用 `backend/scripts/seed-admin.ts` 显式创建（幂等，`--reset` 可重置密码）：

```bash
# 1) 在 backend/.env 设置 ADMIN_USERNAME / ADMIN_PASSWORD
# 2) 执行（首次创建；已有同名账号则跳过）
pnpm --filter aiworkin-enterprise-api exec tsx scripts/seed-admin.ts
```

创建后用该账号登录，侧栏出现平台后台入口；未创建时只能注册普通用户，进不了平台后台。

### 关键环境变量

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | 数据库连接串：MySQL `mysql://user:pass@127.0.0.1:3306/enterprise` 或 PostgreSQL `postgresql://user:pass@127.0.0.1:5432/enterprise?schema=public` |
| `DB_PROVIDER` | `mysql` / `postgres`：原生 SQL 方言分支依据（单据号自增、JSON 列取值）；缺省时由 `DATABASE_URL` 协议推断 |
| `PORT` | 后端监听端口，默认 `1690` |
| `JWT_SECRET` / `JWT_ISSUER` | 本地会话签名密钥，生产必须替换为随机值 |
| `EXTERNAL_CRED_KEY` | AIPDD Key / 外报凭据的 AES-256-GCM 派生密钥，单独配置、不回退 JWT_SECRET |
| `AIPDD_PLATFORM_KEY` | 平台级 AIPDD APIKey 的部署兜底（基础数据通道）；后台「系统配置 → AIPDD 平台 Key」保存后以库内密文为准 |
| `AIWORKIN_BASE_URL` / `AIWORKIN_ENABLED` | 上游市场地址与开关（关闭后仅本地闭环可用） |
| `CORS_ORIGIN_PATTERNS` | 允许的跨域来源（逗号分隔） |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 执行 `seed-admin` 脚本创建平台管理员时读取的账号密码（不随启动自动创建） |

> 所有密钥仅存本机 `.env`（已在 `.gitignore` 中），任何接口永不回显 AIPDD Key 原文。

### 数据库兼容性（MySQL / PostgreSQL）

系统安装时二选一，运行期以 `DB_PROVIDER`（缺省由 `DATABASE_URL` 协议推断）为准，业务在两种库上等价可跑。为抹平方言差异已做如下处理：

- **Schema 单一事实源**：以 `prisma/schema.prisma`（MySQL）为准，安装 PostgreSQL 时由 `scripts/gen-prisma-schema.mjs` 确定性派生 `schema.postgres.prisma`（`provider=postgresql`，`@db.TinyInt→@db.SmallInt`、`@db.DateTime→@db.Timestamp`）。MySQL 走迁移历史建表，PostgreSQL 走 `prisma db push`。
- **单据号自增**：`document-number.ts` 按方言分支——MySQL 用 `INSERT IGNORE`+`LAST_INSERT_ID`，PostgreSQL 用 `ON CONFLICT DO NOTHING`+`UPDATE … RETURNING`。
- **JSON 列取值**：`common/sql-json.ts` 的 `jsonText()` 按方言生成 `->>` 路径（PostgreSQL `col->>'key'` / MySQL `col->>'$.key'`），供大数据取数、线索挖掘的跨任务去重查询使用。
- **BI 问数/图表**：`bi/bi.internal.ts` 的 `internalScope()` 按方言下发占位符（PostgreSQL `$1`/`ANY($2::text[])` / MySQL `?`）；`bi.query.service.ts` 的图表标识符引用按目标库选择（应用库或外部数据源的 PG双引号/MYSQL反引号）。
- **客户端生成**：`postinstall` 走 `scripts/prisma-generate-auto.mjs`，根据 `DB_PROVIDER`/`DATABASE_URL` 自动选默认或派生 schema 生成，避免重装依赖时 PG 客户端被 MySQL 版覆盖。
- **用户名大小写**：登录与唯一约束以**小写归一化**统一口径（MySQL 默认排序规则大小写不敏感、PostgreSQL 敏感），邮箱同样小写存储，保证两库登录/查重行为一致；改动前已存在的混合大小写账号在 MySQL 上仍可正常登录（CI 命中），存量库可执行 `pnpm --filter aiworkin-enterprise-api db:normalize-usernames` 一次性回填（幂等，双库通用，撞名会跳过并列表提示）。

> 已知差异：自由文本搜索（`contains` 关键字）在 MySQL 大小写不敏感、PostgreSQL 大小写敏感——Prisma 的 `mode:'insensitive'` 在 MySQL 连接器上不受支持，故不对全部搜索语句强行统一。中文等主内容不含大小写，不受影响；如需拉丁文搜索也保持一致，可在 PostgreSQL 侧以大小写不敏感的 ICU 排序规则建库，或对相应字段做小写归一化后检索。

---

## 🐳 Docker Compose（含 MySQL）

根目录 `docker-compose.yml` 编排 **MySQL + 后端 + 前端** 三个服务，适合一键体验：

```bash
# 全部服务依赖均自带本地演示默认值（${VAR:-default}），直接拉起即可：
docker compose up --build
# 需要自定义口令 / 域名时，在根目录新建 .env 覆盖 MYSQL_* / JWT_SECRET / EXTERNAL_CRED_KEY 等
# 后端 http://localhost:1690  前端 http://localhost:15890
```

首次启动后端会自动执行 `prisma migrate deploy` 建表。首次启动后还需在容器内创建平台管理员（compose 已注入
`ADMIN_USERNAME` / `ADMIN_PASSWORD`，默认 `admin` / `admin-Startup-2026`，可在根目录 `.env` 覆盖）：

```bash
docker compose exec api pnpm --filter aiworkin-enterprise-api exec tsx scripts/seed-admin.ts
```

生产部署请替换 `JWT_SECRET` / `EXTERNAL_CRED_KEY`
为强随机值，并使用独立的数据库与反向代理（`infra/nginx/` 提供样例配置）。

---

## 🌐 站点域名（对外访问地址）

全站不写死本机地址：MCP / API 接入端点、IM 回调与卡片「去处理」链接、在线客服嵌入脚本、
活码入口、邀请链接、支付回调建议值等绝对地址，统一按下列优先级拼接：

1. 「平台管理后台 → 站点设置 → 站点域名」填写的值（只认 http/https，可带端口，存库即生效，无需重启）
2. 后端环境变量 `SITE_URL`
3. 访客当前访问地址（`window.location.origin`，单域名部署无需任何配置）

本机开发一项都不用填：开发态由 Next 反代 `/api/*`，生产态由 Nginx 先取 `/api/*`，
所以 `https://你的域名/api/v1/mcp` 这类端点在两种形态下都成立。
后台改完域名后，该域名会自动并入 CORS / 来源校验白名单；`SITE_URL` 变量本身改动仍需重启。

---

## 🔑 AIPDD API Key 绑定与上游通道

- 用户在「开放集成 → API Key 管理」页的「AIPDD API Key 绑定」板块绑定一把 AIPDD 平台签发的 API Key（sk-）；
  多用户可绑同一把 Key（N:1，按指纹归并），密文以 AES-256-GCM 落库。
  原独立页「AIPDD Key 绑定」（`/developer/aipdd`）已并入 API Key 管理，旧地址重定向到 `/developer/keys`。
  这两页（API Key 管理 / 模型设置）属账号级自助，**平台管理员身份下侧栏不展示**，要配请切到企业 / 个人身份（平台级 Key 在「系统配置 → AIPDD 平台 Key」），直接访问链接仍可用。
- 同一板块承担注册引导：管理员在「站点设置」填入 AIPDD 推荐码后，新用户按引导去 www.aipdd.work 注册并填写该码
  可获赠算力（邀请佣金归管理员）；可用 env `AIPDD_REFERRAL_CODE` 设默认码、`AIPDD_REGISTER_URL` 覆盖注册地址（仅认 http/https）。
- `backend/src/common/upstream-token.ts` 是访问上游的 **唯一凭证入口**：业务代码不再把本地会话令牌当上游凭证，
  而是换成用户绑定的 Key；未绑定用户触发上游动作时得到引导性 `403`（本地发布不受影响）。
- **基础数据走平台 Key，不走用户 Key**：省市字典、平台字典项这类参照数据与用户身份无关，由管理员在
  「平台管理后台 → 系统配置 → AIPDD 平台 Key」统一配置一把平台 Key（同一套 `sk-` 格式校验与在线验真，
  AES-256-GCM 密文落 `system_settings.aipdd_platform_key`，只回掩码，优先级高于 env `AIPDD_PLATFORM_KEY`，
  且被通用系统参数接口读写隔离）。解析链：平台 Key → 本人绑定 Key → 都没有时地区回落本地内置省市字典
  （`backend/src/shared/region-dictionary.ts`，数据源 `GEO_CENTERS`），所以未配置平台 Key 也不会卡住表单，
  但平台字典项仍需 Key。
- 发布需求、同步上游、建联资源等 **用户动作仍使用各自绑定的 Key**，不受平台 Key 影响。
- `AIPDD_KEY_VERIFY=off` 时绑定不做在线验真（便于离线演示）；设为在线模式会调用上游核验。

---

## 🧪 构建、测试与 CI

后端单测在 `backend/test/jest-unit.json` 下运行（ts-jest），CI 另跑环境模板、OpenAPI 快照、上传与迁移校验：

```bash
pnpm --filter aiworkin-enterprise-api test          # 后端单测（34 个套件 / 263 例）
pnpm test:uploads                                   # 附件与发票图片上传校验
pnpm test:environment                               # 部署模板与环境变量口径
pnpm api:docs:check                                 # OpenAPI 快照是否与契约层一致
pnpm build                                          # contracts → 后端 tsc → 前端 next build
```

- **前端构建堆上限**：`build` 与 `typecheck` 统一走 `frontend/scripts/with-heap.mjs`，默认
  `--max-old-space-size=6144`（默认约 4GB 堆在冷启动编译 55 个页面时会 OOM，退出码 134）；
  可用 `NODE_HEAP_MB` 覆盖，已显式配置时透传。
- **CI（GitHub Actions）**：安装依赖 → contracts 构建 → 架构与路由基线（`check-architecture`）→ 环境模板 →
  OpenAPI 快照 → typecheck → lint（存量债务，不阻塞）→ 后端单测 → 上传校验 →
  **MySQL 8 空库执行 `prisma migrate deploy`（0001→0016）** → 前后端构建。
- **依赖数据库的集成脚本**：`pnpm test:regression` / `test:query-plans` / `test:performance` / `test:geo-recovery`
  面向本机 PostgreSQL 一次性空库（`createdb` + `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`），
  与默认 MySQL 方言不兼容，保留为本地按需执行。
- **冒烟脚本**（PowerShell，纯 ASCII，随机用户名保证幂等）：

```powershell
pwsh scripts/smoke-m5.ps1   # 社交板块闭环（关系/动态/小组/私信/简历/封禁继承）
pwsh scripts/smoke-m6.ps1   # 供求广场：本地免 Key 发布 + 未绑 Key 同步上游 403
pwsh scripts/smoke-site-url.ps1            # 站点域名归一 / CORS / 公开回显 + 页面 200
pwsh scripts/smoke-aipdd-platform-key.ps1  # 平台 AIPDD Key：密文不外泄 + 地区字典兜底
```

---

## 🧹 相对上游商业版的裁剪

本开源版是「合并 + 脱敏 + 本地化」的产物，明确**不包含**：

- SNS 原版 NestJS 后端与 aiworkin.com 蓝白视觉（信息架构保留，样式全部重写为 AntD）；
- awcoin 奖励 / 结算等涉币业务（供求广场只镜像上游状态，不涉币；积分中心的 AWcoin 仅只读展示）；
- 平台代查 / 代申 `sk-` Key、`DEV_AUTO_LOGIN` 就地签发等机制（演示数据随 `prisma:seed` 提供，
  但演示身份不可一键登录，须正常本地注册）；
- 上游 Java 目录服务：数据源改为本地 `users` 表。

---

## 💬 社区

加入 AI 企业服务系统讨论群，请扫下面二维码即可。欢迎发现问题和提出改进建议，好的建议我们会实现并共享源码。

<div align="center">
<img src="docs/assets/wechat-group-qr.png" width="260" alt="AI 企业服务系统讨论群 · 微信二维码">
</div>

---

## 📄 License

Released under the [Apache License 2.0](LICENSE).