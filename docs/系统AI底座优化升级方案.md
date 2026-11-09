# 系统 AI 底座优化升级方案

> 版本：v0.1（方案稿，待评估）
> 日期：2026-11-07
> 目标：让用户更方便地用整个系统，同时让功能架构更清晰——把散落的 AI 能力收敛成统一底座，再把各模块（知识库、多维表格、数字资产、数字分身、业务模块）用 AI 升级。
> 范围：全系统 60+ 后端模块已从头到尾盘点（只读调研，未改代码）。本方案只做规划，评估通过后再进入开发。
> 关联：与 [营销工具SEO增强设计方案.md](file:///E:/wwwroot/oem-enterprise/docs/营销工具SEO增强设计方案.md) §4.4 同源——SEO 不再自建第 4 套 LLM 客户端，统一走本方案底座。

---

## 一、结论先行（一句话）

系统「不缺 AI 功能」，缺的是 **AI 底座没有收口**：取模型的路劲有三套、检索有四处、Agent 工具注册有四个表、计费有两条链路且一半模块没记账。先把底座收敛（网关 / RAG / 工具面 / 计量），再让各模块「一行接入」，用户体感和代码整洁度同时上来。

优先级：**P0 底座收敛 → P1 四大重点模块升级（知识库 / 多维表格 / 数字资产 / 数字分身）→ P2 业务副驾入口 + 各模块点状 AI**。

---

## 二、AI 底座现状与四个关键缺口（调研结论）

### 2.1 已经具备什么（不要重复建设）

| 能力 | 现状 | 位置 |
|---|---|---|
| BYO-Key 模型渠道 | 多租户自带 Key、AES-256-GCM 加密、只回掩码；协议 openai/anthropic 双方言 | [backend/src/content/model-setting.service.ts](file:///E:/wwwroot/oem-enterprise/backend/src/content/model-setting.service.ts)、[frontend/src/app/model-settings](file:///E:/wwwroot/oem-enterprise/frontend/src/app/model-settings) |
| LLM 调用 | `geoChatMulti`（实际被全系统当通用网关）、`kbChatMulti`、`parseJsonObject` | [backend/src/geo/geo-llm.client.ts](file:///E:/wwwroot/oem-enterprise/backend/src/geo/geo-llm.client.ts)、[backend/src/kb/kb-llm.ts](file:///E:/wwwroot/oem-enterprise/backend/src/kb/kb-llm.ts) |
| Agent 运行时 | 内置 11 工具 + MCP 连接器 + skill/plugin 先审后用 + 流式/JSON + 运行护栏 | [backend/src/content/agent-tools.ts](file:///E:/wwwroot/oem-enterprise/backend/src/content/agent-tools.ts)、[backend/src/content/agent-engine.ts](file:///E:/wwwroot/oem-enterprise/backend/src/content/agent-engine.ts) |
| 对外 MCP Server | 从契约 endpoints 自动派生工具，AI agent 可调本系统数据面 | [backend/src/mcp/mcp-catalog.ts](file:///E:/wwwroot/oem-enterprise/backend/src/mcp/mcp-catalog.ts) |
| 计费规则引擎 | 12 AI 科目种子、PLAN>ORG>PLATFORM 解析、`chargeByUsage`（token/call/byte/page） | [backend/src/points/billing-rule.service.ts](file:///E:/wwwroot/oem-enterprise/backend/src/points/billing-rule.service.ts)、[backend/src/ai/ai-eval.service.ts](file:///E:/wwwroot/oem-enterprise/backend/src/ai/ai-eval.service.ts) |
| 轻量 RAG | 256 维本地 hash 袋装 + 关键词/向量混合打分 + 引用问答 + 图谱/Lint | [backend/src/kb/kb-search.service.ts](file:///E:/wwwroot/oem-enterprise/backend/src/kb/kb-search.service.ts) |

### 2.2 四个关键缺口（本方案要补的地基）

1. **没有统一 AI 网关（命名错位）**：全系统的 LLM 实际都绕到 `geo/geo-llm.client.ts`（bi、crm、bigdata、service-desk、kb、lowcode、rpa、workbuddy 全在引它），名字却是 geo；`resolveKbLlm` 又只认 RPA/Workbuddy 的模型，而用户在「模型设置」配的是 content 渠道。**后果**：同一个「配模型」，不同功能读不同来源，用户配了却时好时坏；SEO 若沿用 `resolveKbLlm` 会踩这个坑（见 SEO 方案 §3.5）。`parseJsonObject`/system prompt 各模块各写一份。
2. **RAG 有但没铺开**：`Kb_*` 检索能力完整，却只被 6 个模块引用；service-desk、think-tank、legal、overseas、mailbox 都没接。且检索有**四处并存**（kb 空间、content 资料库 BM25、帮助中心内置、agent 记忆），口径不一。
3. **Agent 工具面太窄**：内置工具只覆盖出图/读库，**业务动作没工具化**（建线索、提单、查库存、发工单），Agent 无法跨模块编排；工具注册有**四个表**（内置数组 + 连接器 + skill + plugin），没有统一 manifest/权限声明。
4. **计量两套且不全**：`ai/ai-eval.service.ts` 与 `aiInsightRecord.scope` 并行；content（对话/出图/出片）、geo、ai-call **全链路不记账**，用户花了多少积分、系统花了多少模型成本都看不见。

### 2.3 贯穿性体验缺口

- **业务页没有嵌入式副驾**：AI 只有一个 `/agent` 独立页，业务页（CRM 客户详情、多维表格、资产库…）没有「带着本模块权限与数据 scope 的 AI 助手」。
- **缺确定性保底**：erp/recruit/talent-match 有规则兜底，service-desk/mailbox 没有——没配 Key 的环境直接体验断裂（违背「缺 Key 规则式产出、不抛穿」的既有口径）。
- **缺主动智能**：只有 geo 定时采集与 workbuddy-plan，业务侧没有「每日洞察推送」。

---

## 三、设计原则与硬约束（与既有架构同一口径）

1. **不新建第 N 套**：网关/RAG/工具面/计量各收口成一处，其余通过它接入；禁止再复制一份 LLM 客户端或向量实现。
2. **契约优先**：新增/改动的 AI 能力一律先在 `packages/contracts` 落 schema+endpoints，REST/OpenAPI/MCP 同源生成；前端只经 `endpoint(...)` 调用。
3. **组织隔离与身份门控**：所有数据带 (orgType, orgUserId)，经 scope 服务解析；**身份决定可见功能/数据范围**——副驾与工具调用必须带调用者权限，绝不能穿透到越权数据。
4. **网络与凭据收口**：所有出站走 `httpRequest` + `assertOutboundUrl`；Key/token 走 `AccountCrypto`（AES-256-GCM，模块独立上下文），只回掩码。
5. **不给服务器装东西**：需要算力的优先用模型、其次浏览器端；embedding 不引入外部向量库进程（先用可插拔 Provider：本地 hash 袋装为默认，配 Key 才走真实 embedding）。
6. **缺 Key 规则式兜底，不抛穿、不假数据**：分析/文案型可规则兜底并标「AI 估计」；数据型（排名/外链/真实量）无源即引导配置，绝不造数。
7. **计量一次到位**：任何模型调用落统一计量，跨模块成本/用量可见；自家账号内消耗不加确认闸。
8. **界面口径**：中文标签不裸枚举；页签 PillTabs/TabStrip；卡片整卡可点；低频配置进 Drawer；AI 结果可复制/导出/转资产。
9. **一次交付**：底座收敛（P0）先行并覆盖全部调用点（一处改动应用到全模块），再逐模块升级；对用户不碎片化分期。

---

## 四、P0：AI 底座收敛（本方案的承重墙，先做）

### 4.1 统一 AI 网关 `src/ai/ai-gateway`

把「取模型 + 发请求 + 解析 + 计量 + 重试」收成一个服务，全系统只认它：

- **统一取模型** `resolveModel(user, purpose?)`：按优先级解析——模块级覆盖 → 组织/账号在「模型设置」里的默认渠道 → 回落。彻底消除「content 渠道 vs RPA/Workbuddy vs geo」三套来源，让**用户在主模型设置页配的模型对全系统生效**（直接修掉 §3.5 那个坑）。
- **统一出口** `aiChat` / `aiJson`（内置 `parseJsonObject` + schema 校验）/ `aiEmbed` / `aiStream`（SSE 复用现有 `streamRequest` 出口）。异常吞掉返回 null 或结构化错误，交调用方走规则兜底。
- **统一计量**：网关内部直接调 `chargeByUsage`，调用方不再各自记账；content/geo/ai-call 一并补上（缺口 4）。
- **调用点迁移**：把现引 `geoChatMulti/resolveKbLlm/kbChatMulti` 的模块（kb/erp/hrm/recruit/marketing/project/crm/bi/bigdata/service-desk/lowcode/rpa/workbuddy + 未来 SEO）逐一切到网关，旧函数保留为薄适配层，一次性收敛。
- **界面**：模型设置页加「生效范围」说明与连通测试（已有测试，补「网关健康」视图）。

### 4.2 统一 RAG `KbRetrieve(scope, query, filters)`

- 抽一个跨模块检索服务：入参组织 scope + query + 过滤（空间/资料库/标签/时间），出参带引用的片段；内部封装现 kb 混合检索，**可插拔 embedding**（默认本地 hash 袋装，配 Key 走真实向量 + 重排）。
- 做成一个 **Agent 工具 + MCP 工具**（`kb_retrieve`），任意模块/技能一行挂载。
- **收敛四处检索**：content 资料库、帮助中心、agent 记忆的检索走同一评分与 topK 口径，避免不同页「搜同词得不同结果」。

### 4.3 统一 Agent 工具面 + 业务动作工具化

- 建**单一工具 manifest**（内置/连接器/skill/plugin 归一注册），统一权限声明与审计；skill-review 的权限红线复用。
- **把业务动作工具化**（第一批高价值）：`crm_create_lead`、`data_table_add_row`、`erp_check_stock`、`oa_start_flow`、`recruit_update_application`、`seo_*`（读类免费/付费类标消耗，SEO 方案已铺好 `Seo_` 契约）。这样 `/agent` 能真正跨模块干活，而不是只会出图和读库。

### 4.4 统一计量与可观测

- 合并 `ai/ai-eval` 与 `aiInsightRecord` 为一张用量事实（模块/科目/操作/用户/token/积分/时间），前端「积分/用量」页能看到**每个模块花了多少**；预算帽、欠费口径沿用现有规则引擎。

**P0 验收**：改一处取模型逻辑全站生效；SEO/知识库/客服任选一处接 RAG 成功；一笔模型调用在用量页可见。

---

## 五、P1-A：知识库升级（成为全系统统一知识底座）

**现状**：投料只支持「文本直投 + assetId 引用」，后者因资产不存正文直接 FAILED；无文件上传/URL/飞书入库、无真实 embedding、无跨空间联邦检索、无模块一行接入。见 [backend/src/kb](file:///E:/wwwroot/oem-enterprise/backend/src/kb)。

**升级项**：

| 项 | 做法 | 落点 |
|---|---|---|
| 摄取管道 | 文件上传（走本站 OSS 桶）/ URL 抓取（复用 httpRequest+cheerio）/ 飞书文档导入 / OCR+音视频转写（复用 `ocr/`）→ 异步队列编译 | 扩展 `kb-ingest.service.ts`、新增 `kb_source.type=UPLOAD\|URL\|FEISHU\|OCR` |
| 修 assetId 断链 | 资产存正文后，`kb_sources` 直接引用可编译 | [backend/src/content/digital-asset.service.ts](file:///E:/wwwroot/oem-enterprise/backend/src/content/digital-asset.service.ts) + kb-source |
| 真实向量 | `aiEmbed` Provider（默认本地袋装，配 Key 走向量+重排），chunk 带元数据/权限标签 | kb-llm.ts、kb-search.service.ts |
| 统一挂载 | 接 §4.2 `KbRetrieve`，`kb_consumers` 从「只授读写」升级为「业务模块可绑定空间并召回」 | service-desk/think-tank/legal/overseas 各自接入 |
| 检索评测 | 加召回质量回归（命中/引用正确率），链路可观测 | kb 测试 |

**收益**：知识库从「独立 wiki 页」变成「每个模块都能挂的 RAG 底座」。

---

## 六、P1-B：多维表格 / 低代码 AI 化

**现状**：已有 `/ai/fill`（一句话填一行）、`/ai/ask`（≤200 行样本不出 SQL）、项目级模型覆盖；但**无字段级 AI 列、无数据表 NL 问数/聚合、无 NL 建表**。见 [backend/src/data-table](file:///E:/wwwroot/oem-enterprise/backend/src/data-table)、[backend/src/lowcode](file:///E:/wwwroot/oem-enterprise/backend/src/lowcode)。

**升级项（3 个最值）**：

1. **字段级 AI 列**：`Field.options` 加 `ai{prompt,sourceKeys}`，新增 `POST /enterprise/data-tables/:id/ai/fill-column` 批量填列（复用网关，缺 Key 规则兜底），UI `field-panel.tsx`。→ 让表「自己长出新列」。
2. **数据表自然语言问数/聚合**：服务端**先聚合再喂模型**（省钱、防幻觉），新增 `/ai/ask`（全量口径版），升级 BI 的 NL2SQL 为统一查询入口。UI `table-detail.tsx`。
3. **NL 建表 + AI 生成视图**：一句话建表结构与字段；新增 `DataTableView`（filter/sort/kanban/dashboard），复用 KANBAN 配置。→ 把「建表」门槛降到零。

**协同**：问卷、CRM、BI、SEO 程序化页面都以多维表格为数据源/目标，AI 化后形成「技能产出→表→再生成/再问数」闭环。

---

## 七、P1-C：数字资产管理 AI 化

**现状**：资产模型 + 按账号共享已有；但 **labels 纯手工、无视觉理解、无自动打标、无相似检索、无素材推荐**；上传是服务端中转、**无浏览器直传签名**。见 [backend/src/content/digital-asset.service.ts](file:///E:/wwwroot/oem-enterprise/backend/src/content/digital-asset.service.ts)、[frontend/src/app/assets](file:///E:/wwwroot/oem-enterprise/frontend/src/app/assets)。

**升级项**：

1. **上传即自动打标**：落库后异步调视觉模型写 labels，打标弹窗给候选（中文标签，不裸枚举）。
2. **通用文档/图片理解**：抽 `content/vision.service.ts`，端点 `/digital-assets/:id/extract`，把「只收文本」的 library-extract 打通成资产驱动内容创作。
3. **以图搜图/相关素材推荐**：`DigitalAssetEntry` 加 embedding 字段，复用 §4.2 袋装/向量 cosine，列表可「找相似」。
4. **浏览器直传（性能/安全）**：给 OSS 直传签名（此前方案已提直传自有 OSS，落实签名通道），大文件不过后端。
5. **审核补全**：图/视频接入内容安全（现仅文本审核），发布前一致性校验。

---

## 八、P1-D：数字分身加强（你点名要增强的部分）

**现状（关键）**：数字分身目前只是「语气层」——`persona` 只有 name/style(7 预设)/persona(≤500 字)/每人≤20 个，**无模型、无知识库、无技能、无渠道、无独立记忆**；记忆全站按 userId 一套共用。见 [backend/src/content/agent.service.ts](file:///E:/wwwroot/oem-enterprise/backend/src/content/agent.service.ts)（composeTurn/personaBlock）。

**加强项（把它从「语气」升级成「可配置的数字员工」）**：

| 加强 | 做法 | 落点 |
|---|---|---|
| **① 挂知识库**（你重点提的） | persona 加 `libraryIds/spaceId`；`composeTurn` 前置 `Kb_recall`（KB 的 `AVATAR` 消费者已留位，接通成本最低）；persona-tab 选空间 | ContentAgentPersona 模型、`composeTurn`、[frontend/src/app/agent/_components/persona-tab.tsx](file:///E:/wwwroot/oem-enterprise/frontend/src/app/agent/_components/persona-tab.tsx) |
| **② 绑模型** | persona 加 `channelId/model`，经 §4.1 网关解析，缺省回落账号默认 | persona 模型 + 网关 resolveModel |
| **③ 渠道化** | assistant 通道加 `personaId/libraryIds`（照抄 Schedule 已绑定的全套字段），`execute` 传 `runSilent` | [backend/src/content/agent-assistant.service.ts](file:///E:/wwwroot/oem-enterprise/backend/src/content/agent-assistant.service.ts) |
| **④ 独立记忆** | memory 加 `personaId`（0=共用），分身各记各的偏好/事实 | ContentAgentMemory 模型 |
| **⑤ 会话沉淀** | 加「会话→资料库/KB 页」动作（publish / Kb_writePage），把对话变成可检索知识 | agent-library publish + kb writePage |
| **⑥ 多分身协同** | 主分身 + 评审分身编排；专题大厅 AVATAR 署名机制可直接复用 | agent-engine 编排 |

**收益**：分身可按场景配「用哪个模型 + 挂哪些知识 + 走哪个渠道 + 有自己的记忆」，从换口吻变成换「数字员工」。

---

## 九、P2-A：业务副驾入口（提升易用性的最大杠杆）

**问题**：AI 只有 `/agent` 独立页；用户在 CRM/表/资产/工单页里想要 AI，却要离开页面去另一个地方、还得重述上下文。

**方案**：做一个**带权限 scope 的嵌入式副驾**（右侧抽屉/悬浮），复用 §4.1 网关 + §4.3 业务工具 + §4.2 RAG：

- 在业务页打开副驾时注入「当前模块 + 当前记录 + 调用者权限」，AI 能就地问答、就地执行动作（受身份门控，越权数据不可见）。
- 落点：`/agent` 的对话能力组件抽成可嵌入面板；各业务页挂一个 `<AiCopilot module="crm" recordId=... />`。
- **这是「更方便使用整个系统」的核心改造**，建议 P0 底座就绪后优先做。

---

## 十、P2-B：各业务模块点状 AI 优化（按性价比排序）

| 模块 | 最值得加的 AI 点（1–2） | 备注 |
|---|---|---|
| BI | 升级为全系统统一「自然语言查询」入口 | 已有 NL2SQL，扩覆盖面 |
| CRM | 跟进记录自动摘要 + 下一步建议；赢率/线索评分 | 已有草稿/摘要，补评分 |
| service-desk | 接 §4.2 RAG 答自有知识；会话摘要写回 CRM | 补确定性兜底 |
| ERP | 库存/账期异常主动推送；生成补货建议单 | 已有 aiInsight |
| HRM | 简历/面试 RAG 问答；离职风险评分 | 已有 JD/匹配 |
| project | 站会周报自动摘要；任务智能拆分 | 已有排期风险 |
| OKR | KR 质量检查、进度总结、从 CRM 自动回填 | 现无 LLM |
| OA | 审批风险点摘要；自然语言发起流程 | 已有预审 |
| mailbox | 邮件摘要/分类/待办抽取 + LLM 起草 | 现规则保底 |
| marketing/skill | 用 `skill-generator` 批量生成其他模块技能 | 已有生成器 |
| survey | 开放题自动编码聚类 + 自动报告 | 现无 |
| distribution | 一稿多平台改写、标题标签生成 | 现无 |
| talent-match | 抽为通用「匹配/评分」能力供 CRM/服务商/OKR 复用 | 单一实现点 |
| legal/overseas/invoice/tax | 文书生成+条款风险提示；国别合规 RAG；材料抽取一致性 | 复用 `ocr/`+RAG |
| sns/social | 帖子文案生成、私信意图分类 | 现仅 aiGenerated 标记 |
| SEO/GEO | SEO 复用网关不建第 4 套；GEO 观测结论+建议生成 | 见 SEO 方案 |
| ai-call | 并入统一 Key 管理 | 非 AI 功能，归位 |

**跨模块共性优先项**：①先把「摘要/抽取/分类/评分」做成 4 个通用能力（网关之上的高阶封装），别每模块各调一次裸 LLM；②统一 RAG 问答入口；③每日洞察推送（复用 worker 凌晨窗口，按「重资源排低谷」口径）。

---

## 十一、落地顺序（一期交付，内部排序）

1. **P0 底座**：统一网关（含取模型收口，修 content/RPA/geo 三源割裂）→ 统一计量（补 content/geo/ai-call 记账）→ `KbRetrieve` → 工具 manifest + 首批业务工具。
2. **P1**：知识库摄取管道+真实向量 → 多维表格 3 项 → 数字资产 4 项 → 数字分身 6 项。
3. **P2**：业务副驾入口 → 各模块点状 AI（按 §10 性价比序）。
4. **收尾**：检索评测回归 + 全量校验（contracts build → 前后端 typecheck → 生产 build → check:architecture → api:docs:check → 导航回归 → eslint）+ 文档与 README 同步。

> 与 SEO 工作台的排期冲突处理：SEO 的 AI 一律走本方案 §4.1 网关，取模型收口这一条（P0-1）优先落地，SEO 即可直接受益，不必等全套底座。

---

## 十二、风险与边界（诚实口径）

| 风险 | 口径 |
|---|---|
| 大重构回归 | P0 改「取模型」是全系统调用点收敛，必须一次性切干净 + 回归覆盖，不留半迁移态；旧函数薄适配、灰度到网关 |
| 真实 embedding | 不引入外部向量库进程（不给服务器装东西）；默认本地袋装，真实向量走可插拔 Provider（配 Key/浏览器端） |
| 计量补全影响面 | 补 content/geo 记账会让原本「免费」的调用开始计积分——需与积分体系方案对齐口径后再放开 |
| 业务工具越权 | Agent 执行建线索/提单等动作必须带调用者 scope，身份门控，防越权写入 |
| 副驾成本 | 嵌入式副驾调用量大，须有预算帽 + 用量可见 + 缺 Key 兜底 |
| 数据型不造假 | 排名/外链/真实量无源即引导配置；分析型规则兜底标「AI 估计」 |
| MktLoop 执行引擎缺失 | 既有缺口，主动智能走 GEO worker 同款 claim+心跳，不依赖缺失引擎、不顺手扩范围 |

---

## 十三、待你拍板的决策点（评估用，编号回复即可）

1. **P0 先做「取模型收口」并让主模型设置页对全系统生效**（会改变部分模块当前实际用的模型来源）——是否同意作为第一优先级？
2. **计量补全**：给 content 对话/出图、geo、ai-call 补积分记账（原本可能不记），需与积分体系方案统一口径——本期做还是先只做网关、计量下一期？
3. **数字分身加强范围**：§8 六项（挂库/绑模型/渠道化/独立记忆/会话沉淀/多分身协同）是否全纳入，还是先做 ①挂库 + ②绑模型 + ④独立记忆 三项？
4. **业务副驾入口（P2-A）**：是否列为高优先（我认为对「更方便使用整个系统」杠杆最大），还是排在各模块点状 AI 之后？
5. **真实 embedding / 向量检索**：默认维持本地袋装 + 配 Key 才上真实向量——是否同意这个「不给服务器装东西」的折中？
6. **与 SEO 的关系**：SEO 直接复用本底座（不建第 4 套），且「取模型收口」优先落地让 SEO 受益——是否按此排期？

> 说明：本方案仅规划、未改代码。评估通过后我按「一次交付、开发期静态验证、收尾一次联调」的口径连续做完，不在每个模块结束反复追问。

---

## 附录 A：交付记录（实施进度）

> 本方案已按「一次交付、开发期静态验证、收尾一次联调」口径进入实施；下列为已落地部分（截至 2026-11-08）。

| 阶段 | 状态 | 落地内容 |
|---|---|---|
| P0-1 统一 AI 网关 | ✅ 已实现 | [backend/src/ai/ai-gateway.ts](file:///E:/wwwroot/oem-enterprise/backend/src/ai/ai-gateway.ts)：`resolveModel` 四级阶梯（本轮 override → 模块 → 账号 → 旧接入）+ `requireModel`（缺模型抛引导性错误）；`aiChat`/`tryChat`/`aiJson`/`aiStream`/`aiEmbed` + `parseJsonObject` 收口 |
| P0-1b 调用点迁移 | ✅ 已实现 | bi / crm / bigdata / service-desk / kb / lowcode / rpa / workbuddy / geo 全部改为经网关取模型与调用（旧函数薄适配，不留半迁移态） |
| P0-2 统一计量 | ✅ 已实现 | `registerAiMetering`：有科目才 `charge`，否则 `record`（用量可见 ≠ 开新扣费） |
| P0-3 统一 RAG | ✅ 已实现 | `KbRetrieve` 检索收口 + `kb_retrieve` Agent 工具 |
| P0-4 工具 manifest | ✅ 已实现 | 工具清单统一 + 首批业务动作工具（`Content_agentTools` 契约已接线） |
| P1-A 知识库摄取 | ✅ 已实现 | 摄取管道 / assetId 断链修复 / 真实向量可插拔（默认本地袋装）/ 跨模块挂载 / 检索评测 |
| **P1-B 多维表格 AI** | ✅ 已实现 | 见下 |
| P1-C 数字资产 AI | ✅ 已实现 | 打标（`Content_autoTagDigitalAsset`）/ 理解（抽取）/ 相似（`Content_similarDigitalAssets` 向量余弦）/ 直传自有 OSS |
| P1-D 数字分身加强 | ✅ 已实现 | 挂库 / 绑模型 / 渠道化 / 独立记忆（`agent-memory`）/ 会话沉淀 / 多分身协同（`agent-collaborate`） |
| P2-A 业务副驾 | ✅ 已实现 | [frontend/src/components/ai-copilot.tsx](file:///E:/wwwroot/oem-enterprise/frontend/src/components/ai-copilot.tsx) 嵌入 CRM / 多维表格 / 服务台 / 数字资产等业务页 |
| **P2-B 点状 AI** | ✅ 已实现 | 见下 |

### P1-B 交付明细（多维表格 AI 化）

**后端**

- [packages/contracts/src/automation.ts](file:///E:/wwwroot/oem-enterprise/packages/contracts/src/automation.ts)：新增 7 个契约端点 `DataTable_aiFillColumn` / `DataTable_aiAsk` / `DataTable_aiPlanTable` / `DataTable_aiPlanView` / `DataTable_views` / `DataTable_saveView` / `DataTable_removeView` 及配套 schema。
- [backend/prisma/schema.prisma](file:///E:/wwwroot/oem-enterprise/backend/prisma/schema.prisma)：新增 `DataTableView` 模型（GRID / KANBAN / DASHBOARD）；迁移 `0026_data_table_views`。删表时级联清理视图。
- [backend/src/data-table/data-table-ai.service.ts](file:///E:/wwwroot/oem-enterprise/backend/src/data-table/data-table-ai.service.ts)：`fillColumn`（AI 列批量填列，缺模型按取材列规则兜底）、`ask`（**服务端先聚合整表再喂模型**，无模型直接给聚合口径）、`planTable`（一句话建表，列键归一 + 类型校验）、`planView`（AI 生成视图，分组列 / 指标只取真实列键）。
- [backend/src/data-table/data-table-view.service.ts](file:///E:/wwwroot/oem-enterprise/backend/src/data-table/data-table-view.service.ts)：视图读写存（保存 / 删除仅表归属账号）。
- [backend/src/data-table/data-table.service.ts](file:///E:/wwwroot/oem-enterprise/backend/src/data-table/data-table.service.ts)：`Field.options.ai{prompt, source_keys}` 持久化；改列时未动 AI 配置则不覆盖。
- 接线：[data-table.controller.ts](file:///E:/wwwroot/oem-enterprise/backend/src/data-table/data-table.controller.ts)、[http/services.ts](file:///E:/wwwroot/oem-enterprise/backend/src/http/services.ts)、[http/automation-routes.ts](file:///E:/wwwroot/oem-enterprise/backend/src/http/automation-routes.ts)。

**前端**

- [field-panel.tsx](file:///E:/wwwroot/oem-enterprise/frontend/src/app/data-table/_components/field-panel.tsx)：列上配「AI 提示词 + 取材列」，带 AI 配置的列显示「AI」标并可「AI 填列」（需密码，复用网关）。
- [ai-panel.tsx](file:///E:/wwwroot/oem-enterprise/frontend/src/app/data-table/_components/ai-panel.tsx)：AI 问数会话（结论 + 聚合口径标签 + 样本行）。
- [view-panel.tsx](file:///E:/wwwroot/oem-enterprise/frontend/src/app/data-table/_components/view-panel.tsx)：视图页签（网格 / 看板 / 汇总）+「AI 生成视图」（草稿确认后保存）。
- [table-cards.tsx](file:///E:/wwwroot/oem-enterprise/frontend/src/app/data-table/_components/table-cards.tsx)：`一句话建表`（草稿可编辑后建表建列）。
- [table-detail.tsx](file:///E:/wwwroot/oem-enterprise/frontend/src/app/data-table/_components/table-detail.tsx)：挂载「视图」与「AI 问数」面板。

**校验**：data-table 单测 14 项通过（AI 列 3 / 视图 4 / 服务 3 等）；后端 `tsc --noEmit`、前端 `tsc --noEmit`、`check-architecture`、`api:docs:check` 全通过；eslint 无告警。

> 口径说明：BI 既有 NL2SQL（`ask_data`）已随 P0-1b 走统一网关取模型与计量；数据表的 `/ai/ask` 是**表内**自然语言问数的统一入口（BI 面向外部只读数据源，无本地行可服务端聚合，不做强行合并）。

### P2-B 交付明细（各模块点状 AI）

**通用能力（网关之上的高阶封装，避免各模块各调一次裸 LLM）**

- [backend/src/ai/ai-abilities.service.ts](file:///E:/wwwroot/oem-enterprise/backend/src/ai/ai-abilities.service.ts)：摘要 / 抽取 / 分类 / 评分 / RAG 问答五个原子能力，统一走网关；缺 Key 或缺模型时返回规则式结果（`mode=rule`），RAG 无模型时返回检索片段（`mode=retrieval`），不阻断业务链路。

**各模块点（先按业务 scope 取数，再交给通用能力，只给建议不自动写业务数据）**

- [backend/src/ai/ai-points.service.ts](file:///E:/wwwroot/oem-enterprise/backend/src/ai/ai-points.service.ts)：15 个模块点——CRM 线索评分、OKR KR 质检 / 进度总结、项目站会纪要 / 任务拆分、问卷报告、分发一稿多平台改写、邮箱摘要分类待办、HRM 离职风险、法务条款风险、出海国别合规、开票材料抽取、财税合规检查、社媒文案与私信意图、OA 自然语言发起流程。
- 接线：[ai.controller.ts](file:///E:/wwwroot/oem-enterprise/backend/src/ai/ai.controller.ts) 按 `Ai_*` 契约注册（自动进 OpenAPI/MCP），[http/services.ts](file:///E:/wwwroot/oem-enterprise/backend/src/http/services.ts) 装配。

**契约与前端**

- [packages/contracts/src/ai.ts](file:///E:/wwwroot/oem-enterprise/packages/contracts/src/ai.ts)：20 个 `Ai_*` 契约端点（5 通用 + 15 模块点），含新增 `Ai_oaDraftApplication`（OA 自然语言发起流程）。
- [frontend/src/api/ai.ts](file:///E:/wwwroot/oem-enterprise/frontend/src/api/ai.ts)：统一 AI 客户端；各模块入口按 `mode` 同一结构渲染。
- [new-application-drawer.tsx](file:///E:/wwwroot/oem-enterprise/frontend/src/app/oa/_components/new-application-drawer.tsx)：OA 新建申请支持「AI 起草」——一句话映射模板并预填字段，出草稿供用户核对后再存/交。

**校验**：新增 [ai-points.service.spec.ts](file:///E:/wwwroot/oem-enterprise/backend/src/ai/ai-points.service.spec.ts)（CRM 评分 / 分发改写 / 出海 RAG / 开票抽取 / OA 起草，含空描述与无模板报错）；后端全量 `npm test` 819 通过、`tsc --noEmit`、前端 `tsc --noEmit`、`check:architecture`、`api:docs:check` 全通过。

> 口径说明：§10 里部分模块点由既有专用服务承担并已随 P0-1b 走统一网关——CRM 跟进摘要走 `Crm_aiSummarize`、服务台答自有知识走 `KbRetrieve` 召回、ERP 走 `Erp_aiInsight`、SEO 走 `Seo_explainAudit`、talent-match 已是单一实现点供 HRM 复用；这些不重复造第二套 `Ai_*` 端点。
