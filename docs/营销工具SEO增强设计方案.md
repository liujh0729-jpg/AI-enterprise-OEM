# 营销工具 SEO 增强设计方案

> 版本：v1.0（正式稿：一期开发完成，静态验证全通过；运行时联调待用户提供 DataForSEO Key 后一次走查。落地偏差与验收见 §十三）
> 日期：2026-11-07（v0.2 同日评估通过并进入开发；v0.3 为落地中发现的偏差修正；v1.0 开发收尾转正式稿）
> 参考包：OpenSEO（open-seo-main.zip，Semrush/Ahrefs 的开源替代）
> 要求：只借鉴思路，不抄代码；基于本系统现有架构重写。
> 评估结论：决策点 1/2/3/5 同意；决策点 4「追加」＝原「不纳入本期」5 项全部纳入本期（见 §5.10–5.14）。
> 备份：/e/wwwroot/oem-enterprise-backups/pre-seo-workbench-20261107.{tar.gz,diff,status}（已校验）。
> v0.3 修订摘要：①AI 模型通道来源写实（§3.5）②DataForSEO 凭证存储口径写实（§5.1/§6）③端点数按契约更正为 77（§7）④迁移生成补「滞后库用 schema 差分」防重复建表（§6）⑤出站/分享/OAuth 安全升为硬约束（§3.3/§5.8/§5.11）⑥成本与收录口径补强（§5.10/§5.13/§5.14/§9）⑦新增与全系统 AI 底座方案的衔接（§4.4）。

---

## 一、参考包分析：OpenSEO 是什么，值得借鉴什么

### 1.1 它做了什么

OpenSEO 是一个「自带数据源钥匙、按量付费」的 SEO 工具，六大主工作流：

| 工作流 | 用户旅程 | 数据来源 |
|---|---|---|
| 关键词研究 | 种子词/竞品/GSC 查询 → 发现词 → 补指标 → 看 SERP 验证 → 排序机会 → 保存打标 | DataForSEO Labs + Google Ads 量 + SERP |
| 排名跟踪 | 建跟踪器（域名+地区+设备+深度）→ 定时/手动检查 → 历史快照与趋势 | DataForSEO SERP |
| 竞品洞察 | 竞品域名 → 概览/排名词/相关页/SERP 重叠竞争者/外链 → 主题分组与差距 | DataForSEO |
| 外链分析 | 目标域名 → 概览/明细/引荐域/历史 | DataForSEO Backlinks |
| 站点审计 | 起始 URL+页数上限 → 自爬 → 检查 → Lighthouse → 页面/问题/性能报告 | 自研爬虫 + DataForSEO Lighthouse API |
| AI 可见性 | 品牌+问题集+引擎 → 定期采集 AI 回答 → 提及率/引用率/趋势/引用源 | DataForSEO llm_scraper + 模型 API |

### 1.2 最值得借鉴的五个机制（不是功能清单，是设计思想）

1. **项目共享上下文 + 研究日志**：每个站点有一份共享档案（业务概述/目标/定位/竞品/关键页），所有工作流开始前先读它、结束后写回研究日志；30 天内同参数的付费查询直接复用缓存，不重复花钱。
   → 因果链：没有上下文，AI 每次都在「重新认识你的业务」，产出泛泛；没有研究日志，同一个竞品域名一周查三次付三次钱。
2. **付费操作预估 + 单飞约束**：花钱的动作先展示预估消耗；同一个跟踪器同时只允许一个在途检查（数据库唯一索引保证），付费步骤失败不自动重试。
   → 因果链：SEO 数据按次计费，失控的并发和重试会直接烧钱。
3. **多次读取取信**：排名检查每词读 3 次 SERP，位置差 ≤2 算一致、取最优，避免单次抓取波动造成假涨假跌。
4. **「提及/引用」双指标 + 引用源分类**：AI 可见性不只看「有没有提到我」，还看「引用了谁的页面」，把引用源分成榜单/论坛/竞品页/自有页，行动建议直接指向「该上哪个榜单、该改哪个页」。
5. **三层分离：技能=方法论、MCP=数据面、报告=统一交付物**：分析步骤写成可复用的方法论文档，数据能力全部暴露成 MCP 工具给 AI agent 调用，最终产出一律落成自包含报告（可分享链接）。

### 1.3 不照搬的部分

| OpenSEO 的做法 | 本方案的处理 | 原因 |
|---|---|---|
| 全套数据依赖 DataForSEO 付费 Key | 三层数据源：自有抓取免费 + DataForSEO 可选 + 系统 LLM 兜底 | 本系统口径是「缺 Key 规则式产出」，不能让用户不配 Key 就全瘫 |
| 本地 Lighthouse / 自研 Worker 爬虫（Cloudflare DO） | 爬虫走 httpRequest 统一传输层；Lighthouse 走 DataForSEO API（可选） | 本系统硬约束：不给服务器装 Chrome/渲染服务；所有网络请求必须走 transport |
| GSC/GA4 OAuth 自动同步 | CSV 导入 + OAuth 自动同步双轨（§5.11） | CSV 零配置即可用；OAuth 需用户自备 Google Cloud 凭证，配好后 worker 每日同步 |
| 本地 SEO 网格排名（Maps 3×3/5×5） | 纳入本期（§5.10），走 DataForSEO Maps SERP | 用户已同意追加；不装本地 Maps 服务 |
| 报告整页 HTML 存数据库 + 独立分享表 | 复用 MktArtifact（kind=SEO_REPORT）+ 平台机制 publicShare | 本系统已有资产与公开分享底座，不重造 |
| 独立账号/计费/团队体系 | 全部复用本系统 org 隔离、积分计费、身份体系 | 一体化系统不引入第二套账号 |

---

## 二、现状与差距

### 2.1 本系统已有的 SEO 相关能力（不重复建设）

| 已有能力 | 位置 | 覆盖范围 |
|---|---|---|
| GEO-AI 引擎优化 | 营销工具 geo 页签 + backend/src/geo + GEO worker(1695) | **AI 可见性全链已覆盖**：12 引擎（DeepSeek/豆包/元宝/Kimi/千问/GLM/GPT/Claude/Gemini 等）、每周凌晨自动采集、豆包 LLM 解析提及/名次/情绪/引用题材、曝光分/提及率/上榜率/引用质量、竞品对比矩阵、缺口分析、四维评分选题池、发稿平台推荐 |
| SEO 落地页简报技能 | mkt.service.ts 内置技能 seo-brief | 纯提示词模板：关键词+页面类型 → 意图/H1H2/标题 meta/长尾词/内外链/结构化数据建议；**无真实 SERP、无抓取数据** |
| 品牌上下文 | MktContext（每 org 一份） | 品牌/行业/定位/语气/受众/关键词/竞品，技能运行时注入 |
| 内容资产 | MktArtifact（kind/body/status） | 技能产出沉淀，可接渠道能力调用与分发 |
| 公开分享 | 平台机制 publicShare + 资产分享策略 | 能力 URL 分享，已有管理端策略 |
| 多平台内容分发 | distribution（13 渠道台账） | 内容发布结果回写，**发布后的 URL 目前没有收录提交动作** |

### 2.2 差距表（OpenSEO 思路 × 本系统现状）

| 能力 | OpenSEO | 本系统现状 | 差距结论 |
|---|---|---|---|
| AI 可见性 | 5 引擎、提及/引用双指标 | GEO 12 引擎、指标更全 | **已覆盖，不重建**；只做联动（体检增加 AI 爬虫封锁检查、报告引用 GEO 数据） |
| 站点体检 | 自爬+32 项检查+Lighthouse | 无 | **新建**（自有抓取免费层） |
| 关键词研究 | Labs 发现+指标+SERP 验证+保存打标 | seo-brief 一次性文案，无词库 | **新建**（数据型词库+研究流程） |
| 排名跟踪 | 跟踪器+定时+历史快照 | 无 | **新建**（依赖可选数据源） |
| 竞品洞察 | 域名概览/排名词/SERP 重叠 | GEO 有 AI 侧竞品对比，传统搜索侧无 | **新建**（有 Key 真数据 / 无 Key 抓公开页对比） |
| 外链分析 | 概览/明细/历史 | 无 | **新建**（依赖可选数据源） |
| 结构化数据 | schema 技能建议 | seo-brief 里一句建议 | **新建**（JSON-LD 生成+校验+导出） |
| 收录提交 | IndexNow | 无 | **新建**（免费协议，诚实标注覆盖范围） |
| GSC 数据 | OAuth 同步+striking distance | 无 | **新建 CSV 导入版**（5–20 名机会词优先） |
| 项目上下文+研究日志 | 每站点共享档案+30 天复用 | MktContext 是 org 级品牌档案，无站点级、无研究日志 | **新建站点档案+研究日志**，品牌信息从 MktContext 带出 |
| SEO 报告 | 自包含 HTML+分享 | 无 SEO 聚合报告 | **新建**，复用 MktArtifact+publicShare |
| 付费预估+单飞 | 成本预估+唯一在途 | GEO 采集有 claim+心跳单飞 | **复用 GEO worker 模式** |

**一句话定位**：GEO 管「AI 引擎里看不看得见我」，本期 SEO 工作台管「传统搜索引擎里找不找得到我、排得好不好」；两者在营销工具里并列互补，数据互相引用。

---

## 三、设计原则与硬约束（架构对齐清单）

写实现前必须逐条满足，与既往模块同一口径：

1. **契约优先**：新增 `packages/contracts/src/seo.ts`（zod schema + endpoints），汇总进 endpoints.ts，`pnpm build` 出 dist；REST/OpenAPI/MCP 同源自动生成。前端只经 `endpoint(endpoints.Seo_xxx)` 调用。
2. **组织隔离**：所有表带 (orgType, orgUserId)，服务经 `HrmScopeService.resolve(user)` 取 scope，与 mkt/geo/mechanisms 一致。
3. **网络统一传输（安全硬约束）**：爬虫、DataForSEO、IndexNow、百度提交、竞品/线索抓取全部走 `httpRequest`（timeoutMs/maxBytes/concurrency/limiterKey/operation 标签），架构检查禁止裸 fetch。因这些 URL **由用户输入**（目标站/竞品站/线索站），SSRF 风险面大，必须先过 `assertOutboundUrl`（[backend/src/http/outbound-guard.ts:143](file:///E:/wwwroot/oem-enterprise/backend/src/http/outbound-guard.ts#L143)）：仅 https、发送前 DNS 逐地址校验、禁内网/云元数据/回环、命中平台黑名单即拒；抓取一律 `redirect: 'manual'` 并自限重定向次数、带 `maxBytes` 有界读取，防止被打爆内存或被 302 引到内网。**唯一协议例外（落地偏差，见 §十三）**：百度主动推送官方端点 `data.zz.baidu.com` 证书与主机名不匹配、实测 https 握手失败，outbound-guard 以代码常量白名单 `HTTP_ONLY_OFFICIAL_HOSTS` + 调用方显式 `allowOfficialHttp` 仅放开协议这一项，主机名不接受用户输入、仍执行 DNS 全地址内网/元数据校验；用户可控地址一律不放开 http。
4. **不给服务器装东西**：不装 Chrome/Lighthouse/渲染服务。页面抓取是纯 HTTP+HTML 解析（新增 cheerio 纯 JS 依赖）；真实性能分走 DataForSEO Lighthouse API（可选）；无 Key 时给静态性能线索并诚实标注。
5. **AI 统一通道（来源写实）**：SEO 全部 AI 走 `resolveKbLlm + kbChatMulti`（缺 Key 规则式兜底、LLM 异常不抛穿），消耗经 `AiEvalService.chargeByUsage` 计积分、科目进 billing-rule 种子。**关键事实**：[backend/src/kb/kb-llm.ts:151](file:///E:/wwwroot/oem-enterprise/backend/src/kb/kb-llm.ts#L151) 的 `resolveKbLlm` 实际取的是 **AIPDD baseDataToken + RPA/Workbuddy 的模型设置**（`rpaLlmSetting.model || workbuddyLlmSetting.model`），**不是「模型设置」页配的 content 渠道**。因此会出现「用户在主模型设置里配好了、SEO 的 AI 仍不可用」的割裂。落地要求：① SEO Drawer 增加「AI 通道」状态行，实时显示 `resolveKbLlm` 是否就绪（未就绪时引导去 RPA/Workbuddy 配模型，而不是笼统说「未配置」）；② 不新建第 4 套 LLM 客户端；③ 与 §4.4 的统一 AI 网关方案衔接后，把 SEO 的取模型来源收敛到同一入口（本项为后续优化，不阻塞本期规则式兜底链路可用）。
6. **数据源 Key 按账号加密自持**：DataForSEO Key 照 GeoProviderSetting 模式（userId+code 复合主键、AES-256-GCM 密文、不共享、不回显明文）。
7. **不造假数据**：排名/外链/真实搜索量必须有真实数据源；无 Key 时显示「未配置数据源」引导，绝不产出模拟排名。文案/分析型功能才允许规则式兜底，且标注「AI 估计」。
8. **界面口径**：中文标签不裸枚举（ severity→严重/警告/提示，device→移动端/桌面端）；页签一律 PillTabs/TabStrip；卡片入口整卡可点；低频配置收进 Drawer 不单开页签；单选不出控件。
9. **不新增导航菜单**：SEO 工作台是营销工具页内新卡片（第 19 个工具），不改既有 GEO/技能库入口名字。
10. **定时走现有 worker**：排名检查调度挂 GEO worker 进程（新增 SeoRankScheduler，claim+心跳单飞同款），凌晨低谷窗口执行，不新增进程、不依赖 MktLoop（其执行引擎缺失是既有缺口，不在本期范围）。
11. **自己账号内消耗不加确认闸**：付费检查展示预估消耗（信息性），不加阻断式审批弹窗。
12. **一次交付**：下述全部模块一期做完再验收，内部可排序，对用户不分期。

---

## 四、总体设计

### 4.1 入口与信息架构

营销工具页新增卡片：

> **SEO 优化**（key: `seo`，排在「GEO-AI引擎优化」卡片之后）
> 描述：站点体检、关键词研究与词库、排名跟踪、竞品洞察、外链分析、结构化数据与收录提交、SEO 报告；自有抓取免费可用，配 DataForSEO Key 解锁真实搜索量/排名/外链，AI 解读走系统模型计积分。

页签内结构（Panel + PillTabs，10 个视图）+ 站点设置 Drawer：

```
SEO 优化
├─ 站点切换 Select（多站点时渲染；单站点不渲染控件）+「站点设置」Drawer
│    Drawer：站点档案 / DataForSEO Key / Google 连接（GSC·GA4 OAuth）/ 百度站长 token / AI 通道状态（resolveKbLlm 是否就绪）
├─ 概览        健康分/词库数/排名趋势/外链概览/GEO 提及率/GA4 流量 + setup 待办清单
├─ 站点体检    体检任务列表 → 发起体检 → 问题清单/页面明细/性能线索/AI 修复建议
├─ 关键词      研究（种子词/竞品/GSC）→ 机会词表 → 保存打标 → 聚类映射 → 转选题/转创作
│              GSC 双轨：CSV 导入 + OAuth 每日同步；striking distance 5–20 名优先
├─ 排名跟踪    跟踪器配置 → 关键词清单 → 手动/定时检查 → 历史快照与趋势
├─ 竞品洞察    竞品域名 → 有 Key 真数据 / 无 Key 公开页结构对比 + AI 差距分析
├─ 外链        子页签：外链分析（概览/明细/引荐域/历史）｜外链建设（线索/联系方式/外联草稿/台账）
├─ 本地 SEO    网格排名跟踪器（3×3/5×5）→ 逐点 Maps 搜索 → 热力网格 + 中心点竞品列表
├─ 程序化页面  选多维表格数据源 + 模板 → 批量生成落地页（含 JSON-LD/sitemap）→ 预览/导出/转资产
├─ 结构化数据与收录  JSON-LD 生成校验 + IndexNow（Bing 系）+ 百度站长主动提交 + 分发 URL 联动
└─ SEO 报告    聚合生成 → 存内容资产 → 公开分享/导出
```

### 4.2 三层数据源（本期最重要的业务决策）

| 层 | 来源 | 费用 | 支撑功能 | 缺 Key 行为 |
|---|---|---|---|---|
| ① 自有抓取 | httpRequest 直接抓目标站 HTML/robots/sitemap | 免费 | 站点体检、竞品公开页对比、结构化数据校验、IndexNow 托管验证 | 永远可用 |
| ② 搜索数据 | DataForSEO（用户自带 Key，按量向 DataForSEO 付费） | 用户自付，本系统不计积分 | 真实搜索量/难度、SERP 排名、外链、竞品排名词、Lighthouse 性能分 | 显示「未配置数据源」+引导，不造假 |
| ③ 系统 LLM | resolveKbLlm（AIPDD Key + 模型设置） | 计积分（新科目） | 关键词扩展兜底、意图聚类兜底、体检解读/修复建议、竞品差距分析、JSON-LD 生成、报告撰写 | 规则式兜底（结构化提纲+通用指引），标注「AI 估计」 |

DataForSEO 引擎覆盖：Google/Bing/Yahoo/百度/Naver/Seznam（以官方端点文档为准，接入时逐引擎验证；百度侧先验证 SERP 端点可用性再放开选项）。

### 4.3 工作流闭环（借鉴「设计按整条业务流」口径，不留断点）

```
站点档案（上下文）
   ↓
站点体检 ──问题──→ AI 修复建议 ──→ 内容创作/seo-brief 技能 ──→ 内容资产
   ↓ 页面清单/词频                                    ↓
关键词研究 ←─ GSC CSV（striking distance 5–20 名）      多平台分发
   ↓ 保存词库/聚类映射                                 ↓ 发布 URL
排名跟踪 ←─ 机会词一键转入                          IndexNow 提交
   ↓ 趋势                                          ↓
竞品洞察 / 外链分析 ──差距──→ GEO 监控问题（AI 侧联动）  收录台账
   ↓
SEO 报告（聚合全部 + GEO 提及率）──→ MktArtifact ──→ publicShare 分享
   ↓
研究日志（30 天复用，写回上下文）
```

每个环节的产出都是下一环节的输入：体检页面清单成为关键词聚类的映射目标；GSC 机会词一键转排名跟踪；分发台账的 URL 一键提交 IndexNow；关键词可转 GEO 监控问题；报告聚合所有模块数据。

### 4.4 与「全系统 AI 底座」方案的衔接（架构清晰化）

本系统正在规划把散落的 AI 能力（`geoChatMulti` / `resolveKbLlm` / content 渠道三套取模型路径、kb 本地 hash 袋装向量与资料库/帮助中心/记忆多套检索）收敛成**统一 AI 网关 + 统一 RAG**。SEO 作为新增模块，必须顺着这个方向，不做 AI 孤岛：

- **取模型**：SEO 只认一个 `resolveKbLlm` 入口（现状收敛到 RPA/Workbuddy 模型），未来统一网关上线后改一行来源即可，业务代码不动。
- **上下文**：站点档案 + MktContext 是结构化注入；若用户把品牌资料/竞品资料放进知识库，体检解读、竞品差距、报告撰写可通过 `Kb_recall` 追加检索增强（RAG），本期先预留注入位，不强依赖。
- **交付物**：SEO 报告复用 MktArtifact + publicShare，与内容分发、技能库产出同一条资产链，不另立报告体系。
- **工具面**：`Seo_` 契约自动进 MCP，Agent 可直接调用 SEO 数据面，与「Agent 编排业务动作」方向一致。

---

## 五、功能模块设计

### 5.1 站点档案与数据源设置

- **SeoProject**：域名、品牌名、目标地区/语言（默认中国/中文，可改）、竞品列表、关键页列表（URL+角色：枢纽页/内容页/转化页）、备注。品牌信息（行业/定位/受众）从 MktContext 自动带出，不重复填。
- **数据源 Key（存储口径写实）**：DataForSEO 用 **login + password（HTTP Basic）**，不是单一 API Key。契约请求体分 `login`/`password` 两字段，落库时**合并为 `login:password` 存进单列 `credentialCipher`**（AES-256-GCM，`accountName` 另存 login 掩码用于展示），接口只回「已配置/未配置」绝不回明文；与 GEO 平台 Key 同一交互模式（Drawer 内设置、修改/删除走密码确认）。「测试连接」调 DataForSEO 余额/任务状态端点（`/v3/.../balance`，Basic Auth）验证凭证有效并回显余额，而不是发一次 SERP 试探（省钱）。
- **setup 待办清单**（借鉴 OpenSEO onboarding「完成态由真实状态推导」）：建站点档案 → 跑首次体检 → 导入 GSC 或配数据源 → 建排名跟踪 → 生成首份报告；每项完成态查真实数据，不存手动勾选。
- **注册引导（落地补强）**：数据源抽屉里两个面板都直接给出对应官网 URL 与分步注册指引，用户不用去搜——DataForSEO 面板链到官网 `dataforseo.com` 与控制台 `app.dataforseo.com`（在「API Access」页取 login/password）；Google 面板链到 `console.cloud.google.com`（建 OAuth 客户端 + 在 API 库启用 Search Console API / Google Analytics Data API）、`search.google.com/search-console` 与 `analytics.google.com`（准备站点资源与媒体资源），并提示把回调地址登记进「已获授权的重定向 URI」。

### 5.2 站点体检（免费层核心）

- **输入**：起始 URL + 页数上限（默认 50，上限 200）+ 是否抓子域。
- **抓取流程**（四阶段，借鉴 OpenSEO 但用本系统传输层重写）：
  1. 发现：抓 robots.txt（解析允许/禁止规则、sitemap 声明）+ sitemap.xml（URL 集合）；
  2. 爬取：同域限定、尊重 robots、并发窗口+limiterKey 限流、maxBytes 有界读取、429 退避；每页记录抓取状态（成功/被拒/超时/非 HTML）；
  3. 解析：cheerio 提取 title/meta description/canonical/h1–h6/字数/图片及 alt/内外链/JSON-LD/hreflang/robots meta/页面字节数/阻塞脚本数；
  4. 检查：约 30 项规则（下表），产出问题清单（严重/警告/提示三级）+ 页面明细 + 健康分。
- **检查项分组**（每项给「为什么影响排名 + 怎么修」）：

| 组 | 检查项示例 |
|---|---|
| 可抓取性 | robots 误封、sitemap 缺失/失效、孤儿页（不在 sitemap 且无内链）、断链（4xx/5xx）、重定向链 |
| 索引信号 | 缺 title/重复 title、缺 meta description/重复、canonical 缺失/冲突、noindex 误用、hreflang 错误 |
| 内容质量 | 薄内容（字数阈值）、H1 缺失/多个、关键词自蚕食（多页同 title 目标词） |
| 结构化数据 | JSON-LD 缺失/解析错误/必填字段缺失 |
| 体验线索 | 图片缺 alt、混合内容（HTTP 资源）、页面体积过大、阻塞脚本过多、图片未懒加载 |
| AI 爬虫联动 | robots.txt 是否封锁 GPTBot/ClaudeBot/PerplexityBot/OAI-SearchBot 等 → 直接提示「AI 引擎抓不到你，GEO 可见度受损」，链到 GEO 页签 |

- **性能口径（诚实）**：无 Key 给「静态性能线索」（HTML 体积、阻塞资源数、图片懒加载缺失），明确标注非 Lighthouse 实测；配 DataForSEO Key 可选跑 Lighthouse API（移动端+桌面端，首页+每类模板 1 页、≤10 页，借鉴 OpenSEO auto 策略），得真实分数与 LCP/CLS/INP/TTFB。
- **AI 修复建议**：问题清单 → LLM 按「影响面×修复成本」排序给 top 修复项（计积分）；缺模型 Key 时规则式给每类问题的通用修复指引。
- **边界**：基于服务端 HTML，SPA 客户端渲染内容测不到（不装 Chrome）；结果页明确标注此口径。

### 5.3 关键词研究与词库

- **三个入口**：种子词扩展 / 竞品域名挖词 / GSC CSV 导入。
- **有数据源 Key**：DataForSEO Labs 相关词+建议词+域名排名词，补搜索量/CPC/竞争度/关键词难度/意图，SERP 验证（看前 10 结果类型判断可竞争性）。
- **无 Key**：LLM 扩展（注入品牌上下文+体检抓到的页面 title/h1 词频）→ 产出「AI 估计词表」，明确标注无真实搜索量；不展示假的量/难度数字。
- **GSC CSV 导入**：用户在 Search Console 导出效果 CSV（查询/页面/点击/展示/CTR/排名），系统解析入库；**striking distance 规则**（借鉴 OpenSEO）：排名 5–20 位的词优先排序——这些词「差一口气进首页」，优化性价比最高；一键转排名跟踪、一键转选题。
- **词库**：保存词+标签（主题/意图/目标页面三个维度）；聚类映射：有 Key 按 SERP 结果重叠聚类（不是词面相似），无 Key LLM 按意图聚类；簇 → 映射体检页面清单里的现有页 / 建议新建页。
- **出口联动**：词 → GEO 监控问题（AI 侧）；词 → 内容创作/seo-brief 技能（文案侧）；词 → 排名跟踪（监控侧）。

### 5.4 排名跟踪（需数据源）

- **跟踪器**：域名+地区+语言+设备（移动端/桌面端）+深度（前 10/20/50/100）+频率（每日/每周/每月）。
- **检查机制**：DataForSEO SERP；每词读取次数可配 1–3 次（默认 1 次省钱；3 次时借鉴「位置差≤2 取最优」取信机制）；检查前展示预估 API 消耗（信息性，不设审批闸）。
- **单飞约束**：同一跟踪器同时只允许一个在途检查（SeoRankRun 状态+唯一约束，照 GEO claim 模式）；付费步骤失败不自动重试，标记失败原因。
- **定时**：挂 GEO worker 新增 SeoRankScheduler，凌晨低谷窗口（默认 03:00–05:00，与 GEO 采集窗口错开），按频率算 nextRunAt；进程重启后 claim 心跳超时自动释放。
- **历史**：词×设备×检查批次快照，未进前 N 记 null（不是 0）；删词保留历史快照；趋势图+涨跌标注。
- **无 Key**：跟踪器可建、词可加，检查动作显示「未配置数据源」引导；不产模拟排名。

### 5.5 竞品洞察

- 竞品清单来自站点档案（MktContext.competitors 带出+手动增删）。
- **有 Key**：域名概览（权重/流量估计）、竞品排名词、与我的词库重叠度、SERP 重叠竞争者发现（按词集找反复出现的域名）。
- **无 Key（免费层）**：抓竞品公开页（首页+关键页，同体检爬虫）做结构对比——title/h 结构/字数/schema/内链布局 → LLM 差距分析（「竞品有 FAQ schema 你没有」「竞品枢纽页内链 30 条你 5 条」），计积分、缺模型规则式兜底。
- 产出 → 差距行动清单 → 转选题/转体检复查。

### 5.6 外链分析（需数据源）

- DataForSEO Backlinks：概览（外链数/引荐域/锚文本分布）、明细列表、引荐域列表、历史快照留存（每次查询存 SeoBacklinkSnapshot，看增长趋势）。
- 无 Key：空状态+配置引导（此功能无免费替代，诚实告知）。
- 外链**建设**（找 prospects、发 outreach）不在本期——那是外联销售流程，属 lead-prospecting/cold-email 侧；本期只做「看」。

### 5.7 结构化数据与收录提交

- **JSON-LD 生成**：选页面类型（文章/产品/FAQ/组织/面包屑）→ 填字段或从体检抓取的页面自动预填 → LLM 生成 → 校验（必填字段、与页面实际内容一致性）→ 复制/导出 .json。
- **IndexNow**（免费协议）：
  - 生成 key → 引导用户把 `/{key}.txt` 托管到站点根目录 → 系统抓取验证托管 → 提交 URL 列表到 api.indexnow.org → 提交台账（时间/URL 数/响应码）。**托管兜底口径**：本期只支持「根目录 key 文件」一种验证；若站点无法放根文件（部分 SaaS/CDN），明确告知改由站点自行完成 IndexNow 验证，本系统不代验、不强上（不承诺 DNS TXT 等其它验证方式）。
  - **诚实口径**（界面明示）：仅通知 Bing/Yandex/Seznam/Naver 等参与方；**Google 明确不参与、百度不参与**；返回成功=「已通知」，**不保证抓取与收录**。
  - 联动：多平台分发台账里发布成功的 URL，可勾选一键提交 IndexNow。
- sitemap 检查并入体检（发现阶段），不单独做 sitemap 生成器。

### 5.8 SEO 报告

- **聚合生成**：体检健康分+问题摘要、词库机会词、排名趋势、外链概览、GEO 提及率/引用率（读 geo report 接口）→ LLM 撰写结构化报告（现状→机会→top 行动→证据），计积分；缺模型规则式拼装数据摘要。
- **落地复用**：存 MktArtifact（kind=SEO_REPORT，body=Markdown）；分享走平台机制 publicShare（资产分享策略已有）；导出 Markdown/自包含 HTML。
- **分享前脱敏（硬约束）**：公开分享链接面向站外，报告正文与 JSON 明细**不得含** DataForSEO/百度/Google 凭据、联系方式提取到的邮箱原文、未公开的机会词与竞品内部数据；落 publicShare 前统一走脱敏函数剥离敏感字段，只保留结论与聚合指标。
- 同站点同周期重复生成时替换旧草稿（借鉴 OpenSEO「同题替换不重复保存」），研究日志记录生成参数。

### 5.9 研究日志与上下文（贯穿机制）

- **SeoResearchLog**：项目+操作类型+参数哈希+结果引用+时间。30 天内同项目同参数的付费查询（关键词指标/外链/竞品概览）直接返回缓存结果并标注「复用 N 天前查询」；90 天清理。
- 所有 LLM 提示词注入站点档案+MktContext 品牌上下文；工作流结束写回日志。
- 与营销技能库联动：技能目录新增 2 行编排技能（`seo-audit-brief` 体检解读、`seo-keyword-brief` 词库机会简报），inputs 选站点/体检批次，运行时调 Seo_ 数据端点再走技能产出机制——兑现 Gauzy 方案「seo-audit 挂技能目录」的既定口径，不改技能机制。

### 5.10 本地 SEO 网格排名（追加项，需 DataForSEO Key）

- **跟踪器**：商家名称 + 目标关键词 + 中心坐标（经纬度）+ 网格规格（3×3 / 5×5）+ 半径公里数。
- **检查**：以中心点按半径铺网格，每个格点调 DataForSEO Google Maps SERP（带坐标定位），在结果里找目标商家名次；找不到记 null。借鉴 OpenSEO LocalRankWorkflow：每点 1 次付费查询、并发上限 6、检查前展示预估消耗（**格点数 × 读取次数 × 单价**：3×3=9、5×5=25，读取>1 时按倍数放大，务必把乘法摊开显示给用户）。
- **产出**：热力网格（前端 SVG/表格渲染，名次越好颜色越深，null 灰色）+ 四统计块（平均名次/夺冠格点数/前 3 格点数/覆盖格点数）+ 中心点搜索结果列表（目标与竞品同框对比）。
- **历史**：每次检查存快照，看网格变化趋势。无 Key：引导配置，不造假名次。

### 5.11 GSC/GA4 OAuth 自动同步（追加项，与 CSV 导入双轨）

- **凭证**：组织级 Google OAuth 客户端（clientId/clientSecret，AES-256-GCM 加密），在站点设置 Drawer 配置；界面展示需登记的回调地址（`/api/backend/enterprise/seo/google/callback`）与所需 scope，用户去 Google Cloud Console 建 OAuth 同意屏幕+凭证。
- **连接流程**：点「连接 Search Console」/「连接 GA4」→ 跳 Google 授权（access_type=offline 拿 refresh_token）→ 回调校验 state → 存 refresh_token（加密）→ 拉属性列表让用户选站点/媒体资源。
- **OAuth 安全硬约束**：`state` 由服务端签发并**绑定 (orgType, orgUserId, service) + 短 TTL + 一次性**（签名或存库比对），回调必须校验一致且用后即失效，防 CSRF / 授权链接转授；scope 取**最小只读集**（GSC `webmasters.readonly`、GA4 `analytics.readonly`）；refresh_token / client_id / client_secret 全部 AES-256-GCM 加密，界面永不回显；换 token、刷新失败均记录 syncError 供 Drawer 展示，绝不明文落日志。
- **同步**：GSC 每日同步 searchanalytics.query（近 28 天，query×page×date 维度）入 SeoGscRow（source=OAUTH，与 CSV 导入同表分析）；GA4 每日 runReport（会话/用户/互动/转化×页面×日期）入 SeoGa4Row。挂 GEO worker 凌晨窗口，token 过期自动用 refresh_token 换新。
- **诚实口径**：未配 OAuth 时 CSV 导入照常可用；OAuth 同步状态/最后同步时间/失败原因在 Drawer 与概览可见；GA4 数据进概览流量卡与报告。

### 5.12 外链建设与外联（追加项）

- **线索发现**：查询模式（"best X"/"X alternatives"/"X statistics"/资源页）→ DataForSEO SERP → 提取域名去重（对照已有外链）→ 候选线索；无 Key 时支持手动录入线索域名。
- **联系方式提取（免费层）**：httpRequest 抓线索站首页/联系页 → cheerio 提取 mailto、联系表单链接、关于页链接 → LLM 挑最佳联系路径；**只提取页面真实存在的联系方式，绝不编造邮箱**。
- **外联草稿**：LLM 结合品牌上下文+线索页摘要+我方资产生成个性化外联邮件草稿 → 存 MktArtifact（kind=OUTREACH_DRAFT）；缺模型规则式给模板框架。
- **台账**：线索状态流（待筛选→待联系→已生成草稿→已发送→已回复→已获链/忽略），备注跟进；「已发送」可手动标记或转既有邮件推送渠道，**不做自动群发**（与 OpenSEO 只起草一致，避免垃圾邮件风险）。

### 5.13 程序化 SEO 批量页面（追加项，挂多维表格+内容资产）

- **输入**：选一张多维表格（DataTable）作数据源 + 目标关键词模式 + 页面模板（LLM 按样例行生成，或用户自带 `{{列名}}` 占位模板）。
- **生成（成本优先，确定性打底）**：先做**纯模板渲染**（`{{列名}}` 占位 + JSON-LD + slug + 枢纽页内链 + sitemap 片段），不调模型就能出可用页；LLM 只用于「补文案/摘要/去模板味」这一层，按行计积分、**默认逐行调 1 次**，可勾选「仅对首屏字段用 LLM，正文走模板」进一步降本；先预览样例 3 行，确认后批量生成（页数上限 200，缺模型时退回纯占位替换、不产假数据）。枢纽页与 sitemap 一次生成不重复计费。
- **产出**：页面清单预览 → 导出自包含 zip（每页 HTML + sitemap.xml + 索引页）→ 可转内容资产/接多平台分发。**页面托管在客户自有域名**（导出 bundle 由客户部署），本系统不代托管，符合客户域名归属口径。
- **兑现 Gauzy 口径**：DataTable 反向作为 programmatic-seo 数据源（表→批量页面），形成「技能产出→表→再生成」闭环。

### 5.14 百度站长主动提交（追加项，国内收录补充）

- **凭证（含前置校验）**：站点 + 百度搜索资源平台 token（加密存 SeoProject 关联凭证），界面引导用户去站长平台获取。**前置**：站点必须已在百度搜索资源平台完成归属验证且开通「普通收录-主动推送」，否则提交返回 `not_same_site`/配额为 0；首次保存凭证先发一条探针 URL 校验，凭证无效或站点未验证直接报错拦下，不让用户白提。
- **提交**：httpRequest POST `data.zz.baidu.com/urls?site={site}&token={token}`（每行一个 URL），解析响应（success/remain/not_same_site/not_valid），落提交台账。
- **联动**：与 IndexNow 并列在「结构化数据与收录」视图；分发台账 URL 可同时勾选提交百度+IndexNow。
- **诚实口径**：百度提交配额由站长平台决定（remain 字段展示）；成功=已推送，不保证收录。

---

## 六、数据模型（Prisma，MySQL 主库 + PG 派生）

全部带 (orgType, orgUserId) 复合索引，命名照 Geo/Mkt 系列：

| model | 关键字段 | 说明 |
|---|---|---|
| SeoProject | domain/brandName/locationCode/languageCode/competitors(Json)/keyPages(Json)/note | 站点档案，domain+org 唯一 |
| SeoProviderSetting | userId+code 复合主键/accountName/credentialCipher/connected | DataForSEO **login:password 合并后**的单个密文存 `credentialCipher`，accountName 存 login 掩码；照 GeoProviderSetting 但 Basic Auth |
| SeoResearchLog | projectId/action/paramsHash/resultRef/createdAt | 30 天复用、90 天清理 |
| SeoKeyword | projectId/keyword/tags(Json)/clusterId/volume/cpc/difficulty/intent/source(DATAFORSEO\|AI\|GSC)/metricsAt | 词库；AI 来源的量字段为 null |
| SeoKeywordCluster | projectId/name/intent/mappedPageUrl | 聚类→页面映射 |
| SeoGscImport | projectId/fileName/rowCount/dateRange | 导入批次 |
| SeoGscRow | importId/query/page/clicks/impressions/ctr/position | GSC 明细 |
| SeoAudit | projectId/startUrl/maxPages/status/phase/healthScore/pageCount/issueCount/errorCode | 体检任务 |
| SeoAuditPage | auditId/url/fetchStatus/title/metaDescription/canonical/h1(Json)/wordCount/images(Json)/links(Json)/jsonLd(Json)/bytes/blockingScripts | 页面明细 |
| SeoAuditIssue | auditId/pageId?/type/severity/detail(Json)/fixHint | 问题清单 |
| SeoRankTracker | projectId/domain/locationCode/languageCode/device/depth/frequency/nextRunAt/enabled | 跟踪器 |
| SeoRankKeyword | trackerId/keyword/pinned | 跟踪词 |
| SeoRankRun | trackerId/status(trigger)/startedAt/finishedAt/costEstimate/errorCode | 单飞约束载体 |
| SeoRankSnapshot | runId/keyword/device/position(nullable)/url/serpFeatures(Json) | 历史快照，无 FK 保留删词历史 |
| SeoBacklinkSnapshot | projectId/totalBacklinks/referringDomains/payload(Json)/queriedAt | 外链历史 |
| SeoIndexnowKey | projectId/keyValue/verifiedAt | 每站点 key |
| SeoIndexnowSubmission | projectId/urls(Json)/responseCode/submittedBy/createdAt | 提交台账 |
| SeoLocalTracker | projectId/businessName/keyword/centerLat/centerLng/gridSize/radiusKm | 本地网格跟踪器 |
| SeoLocalRun | trackerId/status/costEstimate/startedAt/finishedAt | 网格检查批次 |
| SeoLocalPoint | runId/row/col/lat/lng/rank(nullable)/competitors(Json) | 格点名次快照 |
| SeoGoogleClient | orgType+orgUserId 唯一/clientIdCipher/clientSecretCipher | 组织级 OAuth 客户端 |
| SeoGoogleConnection | org/service(GSC\|GA4)/refreshTokenCipher/propertyId/propertyName/lastSyncAt/syncError | 授权连接 |
| SeoGa4Row | connectionId/date/page/sessions/users/engagement/conversions | GA4 同步明细 |
| SeoLinkProspect | projectId/domain/url/sourceQuery/contactEmail/contactUrl/outreachAngle/status/draftArtifactId/note | 外链建设台账 |
| SeoProgrammaticRun | projectId/tableId/keywordPattern/template/rowCount/status | 批量生成批次 |
| SeoProgrammaticPage | runId/slug/title/metaDescription/body/jsonLd(Json) | 生成的页面 |
| SeoBaiduCredential | projectId 唯一/site/tokenCipher | 百度站长凭证 |
| SeoBaiduSubmission | projectId/urls(Json)/response(Json)/submittedBy/createdAt | 百度提交台账 |

迁移（落地实况修正）：**不要直接对滞后线上库跑 `gen-migration-delta.ps1` 生成 SEO 增量**——该脚本按 `--from-url 线上库 ↔ 全量 schema` 出差异，而本地线上库落后于已提交的 0017–0022 迁移，会把 recruit/pj/erp/mkt 等**别人在建的表一并 CREATE**，`migrate deploy` 顺序执行时重复建表直接失败，还混进一堆无关的 `MODIFY TEXT/DROP DEFAULT` 漂移 ALTER。正确做法（本期 0023 已按此产出）：临时复制一份**去掉 28 个 Seo 模型的 schema**，`prisma migrate diff --from-schema-datamodel <无SEO schema> --to-schema-datamodel schema.prisma --script`，得到**纯 SEO 28 张表、0 条 ALTER** 的增量，再套脚本的 TEXT 默认值剥离规则（MySQL TEXT 不能带 DEFAULT）写入 `0023_seo_workbench/migration.sql`。PG 派生照现有 `gen-prisma-schema.mjs` 流程（本期未强制重生成，属收尾项）。`SeoGscRow` 用 `source` 字段区分 CSV/OAUTH。

---

## 七、契约与 API

新增 `packages/contracts/src/seo.ts`，operationId 前缀 `Seo_`，经 `moduleHandlers('Seo_', controller)` 自动挂路由（参数序 user/路径参/query/body），自动进 OpenAPI 与 MCP。端点分组（**契约实际 78 个**，下表为分组导览、非穷举；以 `packages/contracts/src/seo.ts` 的 `seoEndpoints` 为准，验收按契约对账）：

| 组 | 端点（动词） |
|---|---|
| 站点 | projects / createProject / updateProject / removeProject / overview |
| 数据源 | settings / saveProvider / clearProvider / testProvider |
| 体检 | startAudit / audits / audit / auditIssues / auditPages / explainAudit / lighthouse（可选） |
| 关键词 | researchKeywords / saveKeywords / keywords / removeKeyword / clusterKeywords / keywordMetrics |
| GSC | importGsc / gscImports / gscAnalysis（striking distance） |
| 排名 | createTracker / trackers / updateTracker / removeTracker / addRankKeywords / removeRankKeyword / runRankCheck / estimateRankCost / rankHistory |
| 竞品 | analyzeCompetitor / competitorOverview（有 Key）/ competitorPages（免费对比） |
| 外链 | backlinksOverview / backlinksProfile / backlinksHistory |
| 结构化 | generateSchema / validateSchema |
| IndexNow | setupIndexnow / verifyIndexnow / submitIndexnow / indexnowHistory |
| 百度提交 | saveBaiduCredential / submitBaidu / baiduHistory |
| 本地 SEO | createLocalTracker / localTrackers / runLocalCheck / localGrid / localHistory |
| Google 同步 | saveGoogleClient / googleAuthUrl / googleCallback / googleConnections / disconnectGoogle / syncGoogle / gscProperties / ga4Properties |
| 外链建设 | discoverProspects / prospects / addProspect / extractContact / draftOutreach / updateProspect / removeProspect |
| 程序化页面 | programmaticPreview / programmaticGenerate / programmaticRuns / programmaticPages / programmaticExport |
| 报告 | generateReport / reports / report / shareReport |
| 日志 | researchLog |

MCP 口径（借鉴 OpenSEO 工具面设计）：读类端点免费；付费类端点在 description 写明消耗口径与预估参数；异步体检/排名检查返回任务 id+轮询端点。AI agent 可直接调用本系统 SEO 数据面。

feature-catalog：`marketing-tools` 前缀数组追加 `/enterprise/seo`；不新增菜单种子（页内卡片）。

---

## 八、前端设计

- 新文件：`frontend/src/app/marketing-tools/_components/seo-tab.tsx` + 子组件（seo-overview / seo-audit / seo-keywords / seo-rank / seo-competitors / seo-backlinks（含外链分析+建设子页签）/ seo-local / seo-programmatic / seo-schema（含 IndexNow+百度提交）/ seo-reports / seo-settings-drawer）。
- page.tsx：ToolKey 加 `"seo"`、TOOLS 加卡片（GEO 之后）、渲染链加分支；PAGE_META 营销工具描述改「十九个工具」。
- 组件复用：Panel+PillTabs（extra 右对齐）、StatGrid/StatCard、Notice、EmptyState、ToolCard；表格用 ProTable 既有模式；消息用 App.useApp()。
- 交互口径：修改/删除站点与 Key 走 usePasswordConfirm；整卡可点；空状态不放与 Panel extra 重复的动作按钮；无 Key 的数据型视图用 Notice 引导配置（不是「接口待接入」占位）。
- 中文标签映射表（实现时进 seo 契约常量）：severity→严重/警告/提示；device→移动端/桌面端；frequency→每日/每周/每月；source→数据源实测/AI 估计/GSC 导入；fetchStatus→成功/被拒绝/超时/非页面。
- 类型一律 `z.infer` 契约 schema，API 走 `@/api/seo` 的 endpoint 助手，nullable 信封 `|| []` 收口。

---

## 九、调度与计费

- **调度**：GEO worker 进程内新增 SeoRankScheduler（setInterval tick + claim/心跳，照 geo-collection.scheduler 重写），凌晨 03:00–05:00 窗口；`SEO_RANK_DISABLED=1` 可关；/health 暴露 seo 积压数。实施完成后需重启 worker 生效——按「不例行重启」口径，先摆进程 StartTime/mtime 证据再征询。
- **积分科目**（billing-rule 种子新增，照 mkt_skill_run 模式）：
  | code | 单价 | 免费额度 | 触发 |
  |---|---|---|---|
  | seo_audit_ai | 2 | 100 | 体检 AI 解读/修复建议 |
  | seo_keyword_ai | 1 | 200 | 无 Key 关键词扩展/聚类 |
  | seo_competitor_ai | 2 | 100 | 竞品差距分析 |
  | seo_schema_ai | 1 | 100 | JSON-LD 生成 |
  | seo_report_ai | 2 | 50 | 报告撰写 |
  | seo_outreach_ai | 1 | 100 | 外联草稿/联系方式挑选 |
  | seo_programmatic_ai | 0.5 | 200 | 程序化页面逐行生成 |
- **DataForSEO 费用**：用户自付（Key 是用户自己的），本系统不计积分、不加价；研究日志复用避免重复扣费；检查前展示预估消耗（排名/本地网格/外链/竞品）。**预估口径**：单价按 DataForSEO 官方当期价折算、可配置（存 `SeoProviderSetting` 或环境变量），界面明确标注为**参考值、非账单**；不同端点/引擎单价不同，宁可显示区间或「以实际扣费为准」，不写死成精确数字误导用户。
- **自有抓取**：免费，但受页数上限/并发/限流约束，防止把目标站抓挂（礼貌爬虫）。

---

## 十、实施顺序与验证计划（一期交付）

内部顺序（对用户不分期）：

0. 备份工作区（已完成：pre-seo-workbench-20261107.tar.gz/diff/status，gzip 校验通过）
1. 契约 seo.ts + Prisma 模型 + 迁移 + feature 前缀
2. 数据源连接器（httpRequest 版 DataForSEO 客户端）+ Key 设置 + 研究日志
3. 体检爬虫 + 检查项 + AI 解读（cheerio 依赖）
4. 关键词研究 + 词库 + 聚类 + GSC CSV 导入
5. 排名跟踪 + worker 调度
6. 竞品洞察 + 外链分析
7. 结构化数据 + IndexNow + 百度站长提交 + 分发联动
8. 本地 SEO 网格排名
9. GSC/GA4 OAuth 自动同步（Google 客户端配置+授权回调+worker 同步）
10. 外链建设（线索发现/联系方式提取/外联草稿/台账）
11. 程序化 SEO 批量页面（多维表格数据源+模板+导出 zip）
12. SEO 报告 + 分享 + 技能库 2 行编排技能
13. 前端 10 视图 + Drawer + 卡片入口
14. 计费科目 + 文档（本方案转正式稿、README、Gauzy 方案附录 D 对账）+ 全量校验

验证计划（开发期静态验证，收尾一次联调）：

- contracts build → 前后端 typecheck → 生产 build
- Jest 单测：robots 解析、sitemap 发现、体检检查项（fixture HTML）、GSC CSV 解析与 striking distance 排序、研究日志 30 天复用、排名单飞约束、IndexNow 提交参数、缺 Key 兜底不产假数据
- check:architecture（httpRequest 收口）+ api:docs:check + 导航回归（营销工具仍一个菜单）+ 定向 eslint
- 联调（服务运行时）：真实站点体检一遍、GSC 样例 CSV 导入、DataForSEO Key 实测（用户提供 Key 后）、无 Key 路径走查；浏览器点击通过再报完成
- 性能/重资源动作（批量体检、定时排名）验证放凌晨低谷窗口

---

## 十一、风险与边界（诚实口径清单）

| 风险 | 口径 |
|---|---|
| DataForSEO 付费依赖 | 排名/外链/真实量无 Key 不可用，不造假；Key 由用户自持自付 |
| 百度数据 | DataForSEO 宣称支持百度 SERP，接入时逐端点验证，验证不过不放开该引擎选项 |
| 无 Chrome | SPA 客户端渲染内容审计盲区；Lighthouse 走 API；界面标注「基于服务端 HTML」 |
| IndexNow | 不覆盖 Google/百度；成功=已通知≠已收录；界面明示 |
| GSC | CSV 手动导入 + OAuth 自动同步双轨；未配 OAuth 时 CSV 照常可用；界面明示数据截止日期与同步状态 |
| Google OAuth | 需用户自备 Google Cloud OAuth 凭证与同意屏幕；回调地址须登记；refresh_token 加密存储 |
| 百度提交 | 配额由站长平台决定（展示 remain）；成功=已推送≠已收录 |
| 本地 SEO | 依赖 DataForSEO Maps SERP；逐点付费，格点数×单价预估；无 Key 不造假名次 |
| 外链建设 | 只提取页面真实联系方式，绝不编造邮箱；只起草不自动群发 |
| 程序化页面 | 页面托管在客户自有域名（导出 bundle 自部署）；逐行 LLM 计积分，页数上限 200 |
| 目标站反爬 | 部分页抓取失败记录 fetchStatus，不硬闯；robots 尊重 |
| 爬虫礼貌 | 页数上限 200、并发限流、429 退避，避免抓挂客户站点 |
| MktLoop 执行引擎缺失 | 既有缺口，本期 SEO 调度不依赖它，不顺手扩范围 |
| AI 模型通道来源 | `resolveKbLlm` 实为 AIPDD Key + RPA/Workbuddy 模型（非 content 渠道），未配则 AI 功能走规则式兜底；Drawer 显示通道就绪状态并引导去配模型 |
| 迁移滞后库重复建表 | 对滞后线上库跑 delta 会重复建 0017–0022 表；本期改用去 SEO 模型的 schema 差分产出纯 28 表增量（见 §6） |
| 出站 SSRF | 用户可填任意 URL，必须过 `assertOutboundUrl`+`redirect:manual`+`maxBytes`，禁内网/元数据（见 §3.3） |
| LLM 解析准确性 | 体检解读/聚类为 AI 辅助，标注「AI 估计」；规则检查项是确定性结果 |

---

## 十二、追加纳入本期的 5 项（评估决策点 4＝追加，已全部纳入）

1. 本地 SEO 网格排名 → §5.10（DataForSEO Maps SERP，3×3/5×5 热力网格）
2. GSC/GA4 OAuth 自动同步 → §5.11（与 CSV 导入双轨，worker 每日同步）
3. 外链建设/outreach → §5.12（线索发现/联系方式提取/外联草稿/台账，只起草不群发）
4. 程序化 SEO 批量页面 → §5.13（多维表格数据源+模板+导出 zip，客户自有域名托管）
5. 百度站长主动提交 → §5.14（data.zz.baidu.com 推送+台账，与 IndexNow 并列）

---

## 十三、落地偏差与验收记录（v1.0 正式稿）

### 13.1 落地偏差（与方案口径的差异，均已在代码与界面诚实标注）

1. **百度推送 HTTP-only 例外**（对 §3.3「仅 https」的唯一偏差）：`data.zz.baidu.com` 官方端点证书与主机名不匹配、https 握手失败，故 outbound-guard 增 `HTTP_ONLY_OFFICIAL_HOSTS` 常量白名单 + 调用方显式 `allowOfficialHttp`，只放开协议一项；主机名为代码常量不接受用户输入，DNS 全地址内网/元数据校验照常执行。用户可控 URL 一律仍仅 https。
2. **分发台账 → 收录联动的同主机约束**（对 §5.7/§5.14 联动的写实）：IndexNow 与百度主动推送都只接受「已验证自有域名」的 URL（后端 `sameHostUrls` 强校验，跨主机注定被拒）。13 家分发平台均为第三方域名，其发布链接无法经此通知收录。故联动 UI（分发结果抽屉「收录提交」面板）按所选 SEO 站点主机预筛：落在客户自有域名的发布链接可勾选提交，第三方平台链接禁选并明示「第三方平台域名」原因，不留必失败死路。
3. **编排技能取数实现**（兑现 §5.9「不改技能机制」）：`seo-audit-brief`/`seo-keyword-brief` 在 `runSkill` 内按 skillKey 注入 `input.seoData`——经 prisma 读组织隔离的体检/词库数据（等价于 `Seo_` 端点取数，避免跨模块服务耦合），再走既有技能产出机制；`ensureBuiltinSkills` 用 `update:{}` 保证只新增目录行、不改既有技能。

### 13.2 静态验证结果（2026-11-07，开发期全通过）

| 验证项 | 结果 |
|---|---|
| contracts build / 前后端 typecheck / 前后端生产 build | 全通过（`/marketing-tools` 静态预渲染） |
| Jest SEO 单测 | 10 套件 94 用例通过：robots/sitemap 解析、体检检查项（fixture HTML）、GSC CSV 解析与 striking distance（5–20）、研究日志 30 天复用、排名单飞约束、IndexNow 提交参数（host/key/keyLocation/urlList）与同主机校验、缺 Key 不造假、gridPoints/medianPosition、extractContact、JSON-LD 生成校验、程序化渲染 |
| check:architecture | 445 业务路由通过（httpRequest 收口、禁裸 fetch） |
| api:docs:check | OpenAPI 契约通过（78 个 `Seo_` 端点同源） |
| 导航回归 | 8/8 通过（营销工具仍一个菜单，SEO 为页内第 19 张卡片） |
| 定向 eslint | SEO 前端视图/查询/API、distribution 联动、mkt 编排技能、SEO 单测全通过 |

### 13.3 待联调（运行时，收尾一次走查；重资源动作放凌晨低谷窗口）

- 真实站点体检一遍、GSC 样例 CSV 导入、无 Key 路径走查（浏览器点击通过再报完成）。
- DataForSEO Key 实测（用户提供 Key 后）：真实搜索量/排名/外链/本地网格/Lighthouse。
- Google OAuth 双轨（用户自备 Cloud 凭证与同意屏幕后）：GSC/GA4 授权回调 + worker 同步。
- 百度站长提交（用户完成站点归属验证 + 推送 token 后）：探针校验 + 主动推送。
- 批量体检/定时排名/程序化批量生成等重资源动作排凌晨低谷窗口跑。

### 13.4 补缺口交付（2026-11-07，按「有缺口就增加功能」补齐）

| 缺口（方案口径） | 落地 |
|---|---|
| §5.7「复制/导出 .json」 | 结构化数据结果区新增「导出 .json」：先校验为合法 JSON 再下载（`application/ld+json`），非法时明确报错不产出坏文件 |
| §5.8「导出 Markdown/自包含 HTML」 | 报告查看弹窗新增「导出 Markdown」与「导出 HTML」；HTML 为单文件自包含（内联样式、移动端适配，可直接发送或打印为 PDF） |
| §5.3「机会词一键转排名跟踪」 | 词库勾选、GSC「触手可及」表勾选 → 共用「转排名跟踪」组件（选跟踪器、展示已有词数/设备/频率、自动去重、单次上限 200）；无跟踪器时引导先去新建，不产空操作 |
| 安全 | Markdown→HTML 先整体转义再还原语法，报告正文不能注入脚本；下载统一走 `frontend/src/lib/download.ts` |

验证：前端 typecheck、定向 eslint、生产 build（`/marketing-tools` 静态预渲染）全通过。

### 13.5 跨模块联动补全（2026-11-07，按「全接完再汇报」补齐）

| 方案口径 | 落地 | 关键实现 |
|---|---|---|
| §5.3「词 → GEO 监控问题」 | 词库勾选、GSC「触手可及」表勾选 → 共用「转 GEO 监控」组件 | 选 GEO 项目 + 问题类型（类型取自 `useGeoMeta().questionTypes`，不硬编码）；按项目已有问题去重后再逐条创建，单次上限 100；无 GEO 项目时引导先建项目，不产空操作。复用既有 `Geo_createQuestion`，不新增接口 |
| §5.12「已发送 → 转既有邮件推送渠道，不做自动群发」 | 外链潜客勾选 → 「转邮件推送」弹窗 → 阿里云邮件推送「收件人列表」 | 新增 `Seo_pushProspectsToMail`（原子完成：建多维表格 → 写联系方式行 → 建导入批次/追加收件人列表）；只同步联系人，**不发送邮件、不改潜客状态**；无邮箱潜客跳过并在结果里报数；复用 `AliyunMailService.createImport`，不另造发送链路 |
| §5.13「可转内容资产 / 接多平台分发」 | 程序化页面每行「存为资产」 | 调用 `Mkt_saveArtifact`，kind=`SEO_PAGE`、status=`DRAFT`；超过 2 万字符（契约上限）先拦截并提示精简后重生成；内容资产列表补中文类型标签（SEO 页面/外链草稿等），不露裸枚举 |

验证（本轮 23:2x 复跑，SEO 范围内全零报错）：`src/seo` typecheck 0 错、eslint 0 错（含 252 处 prettier 格式化）、SEO Jest 9 套件 91 用例通过；`api:docs:check` OpenAPI 契约检查通过、`check:architecture` 通过（445 业务路由）；前端全量 `tsc --noEmit` 通过、`next build` 通过；后端全量 Jest 83 套件 717 用例通过。三端机械对照：`Seo_` 契约 78 端点 = `seo.controller.ts` 78 方法 = `frontend/src/api/seo.ts` 78 处暴露，无「契约有、实现无」的占位接口；Google OAuth 闭环已核对——`googleAuthUrl` 生成的 `redirect_uri`（`api/backend/enterprise/seo/google/callback`）由契约 `Seo_googleCallback` 注册为真实路由，会话走 Cookie（`credentials: "same-origin"` + 服务端 Cookie 回退），因此浏览器顶层重定向能带上门禁，`state` 密文可解、`refresh_token` 落库。

> 说明（2026-11-07 23:2x 收口复跑）：`acquisition-*` 卡点已全清（`dayjs` 显式声明、contracts `dist` 重建、Prisma client 重建、`with-heap.mjs` 默认堆 6144→10240）。同工作区并行开发的企业微信 SCRM 也已接管修到绿：后端 `scrm.controller.ts` 注入属性名与路由方法名同名冲突（`contacts`/`chats`/`codes`/`transfers`/`sops`/`materials`/`sidebar` 统一改为 `*Service`，路由方法名必须保持等于契约后缀）、`scrm-mass.service.ts` 非 async 回调里 `await`（改 `await Promise.all(targets.map(async …))`）、`scrm.helpers.ts` 补 `export { clip }`、`scrm-compliance.ts` 的 `aiJson<T>` 泛型对齐契约的 `{key,label,score}`（不再声明契约里不存在的 `note`）；前端 8 处契约信封 `T | null` 兜底与 `batchTag` / `batchTagByFilter` 返回值按分支收窄。本方案范围自身再清掉 21 个真实 lint 错误（17 个 `no-base-to-string`：`Row` 里的 `unknown` 不再 `String()` 直拼，统一走 `text()`；并修掉 `metaMap` 把空白描述聚成「共用同一段描述」的误报——空白描述应计入 `META_MISSING`），`src/seo` 现在 typecheck / eslint / Jest 91 用例全零报错。此刻根 `pnpm build` 仍有报错，但全部落在同工作区第三个在写的未跟踪模块 `src/gaps`（`onboarding` / `after-sales` / `quotation-doc` 共 21 条，均为 `include` 了 schema 里还不存在的关联，需该功能自行补 Prisma 模型与迁移），不属于本方案，也不代其改动 schema。

---

## 附录 A：OpenSEO 机制 → 本系统落地对照表

| OpenSEO 机制 | 本系统落地 | 复用/新建 |
|---|---|---|
| project-context 共享档案 | SeoProject + MktContext 带出 | 新建+复用 |
| research log 30 天复用 | SeoResearchLog（paramsHash 命中即复用） | 新建 |
| 付费预估+审批 | 预估消耗展示（信息性，不设闸，照自家账号口径） | 新建 |
| 单飞唯一索引 | SeoRankRun claim+心跳（照 GEO 模式） | 复用模式 |
| SERP 3 次取信 | 读取次数可配 1–3，3 次时位置差≤2 取最优 | 新建 |
| 提及/引用双指标 | GEO 已有，报告直接引用 geo report | 复用 |
| 引用源分类行动 | GEO citationGenre 已有；体检 AI 爬虫封锁检查联动 | 复用+新建 |
| skills 方法论/MCP 数据面/报告交付 | 技能库 2 行编排技能 + Seo_ 契约自动 MCP + MktArtifact 报告 | 复用 |
| 自包含 HTML 报告+分享 token | MktArtifact + publicShare | 复用 |
| GSC striking distance | CSV 导入 + 5–20 名优先排序 | 新建 |
| IndexNow | httpRequest 提交 + 托管验证 + 台账 + 分发联动 | 新建 |
| Lighthouse auto 策略 | DataForSEO API，首页+模板页≤10，移动+桌面 | 新建（可选） |
| 爬虫 robots/sitemap/并发窗口 | httpRequest+cheerio 重写，outbound-guard 防护 | 新建 |
| LocalRankWorkflow 网格 | SeoLocalTracker/Run/Point + Maps SERP 逐点 + 热力网格 | 新建 |
| GSC OAuth 同步 | SeoGoogleClient/Connection + worker 每日同步（与 CSV 双轨） | 新建 |
| link-prospecting 技能 | 线索发现+联系方式提取+外联草稿+台账（只起草不群发） | 新建 |
| programmatic-seo→data-table | 多维表格行→批量页面+JSON-LD+sitemap→导出 zip | 新建 |
| 百度站长提交 | data.zz.baidu.com 推送+台账（IndexNow 国内补充） | 新建 |

## 附录 B：决策点评估结论（2026-11-07 用户确认）

1. 卡片命名「SEO 优化」——**同意**。
2. 三层数据源策略（无 Key 不造假、只引导配置）——**同意**。
3. GSC CSV 导入——**同意**（并按决策点 4 追加 OAuth 自动同步双轨）。
4. 原「不纳入本期」5 项——**追加**，全部纳入本期（§5.10–5.14）。
5. 积分科目单价/免费额度——**同意**（追加 seo_outreach_ai、seo_programmatic_ai 两科目）。

> 结论：按此执行，进入开发。一期交付全部模块，开发期静态验证，收尾一次联调汇报。