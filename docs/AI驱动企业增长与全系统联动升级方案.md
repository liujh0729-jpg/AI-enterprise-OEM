# AI 驱动企业增长与全系统联动升级方案

> 版本：v0.1（方案稿，待确认）
> 日期：2026-11-07
> 范围：OKR 2.0 / 项目铁三角 / 外部资源协作 / 全系统 AI 化 / 模块联动 / 统一抽象 / UI 与代码整改
> 状态：**仅规划，未改代码**。确认后按「一次交付、内部排序」执行，不在每个模块结束反复追问。
> 关联文档：
> - [系统AI底座优化升级方案.md](file:///E:/wwwroot/oem-enterprise/docs/系统AI底座优化升级方案.md)：P0 底座、P1-A 知识库、P1-B 多维表格已落地；P1-C/D、P2 仍在推进。本方案不重复设计，只做**业务联动与统一抽象**，并把 AI 底座作为承重墙引用。
> - [企微SCRM一体化方案.md](file:///E:/wwwroot/oem-enterprise/docs/企微SCRM一体化方案.md)、[营销获客智能体设计方案.md](file:///E:/wwwroot/oem-enterprise/docs/营销获客智能体设计方案.md)、[营销工具SEO增强设计方案.md](file:///E:/wwwroot/oem-enterprise/docs/营销工具SEO增强设计方案.md)、[借鉴Gauzy一体化升级方案.md](file:///E:/wwwroot/oem-enterprise/docs/借鉴Gauzy一体化升级方案.md)
> - [ub-mode/README.md](file:///E:/wwwroot/oem-enterprise/docs/ub-mode/README.md)、[ub-mode/SKILL.md](file:///E:/wwwroot/oem-enterprise/docs/ub-mode/SKILL.md)

---

## 〇、结论先行

系统现在「模块很多、单点 AI 不少」，但**没有形成一条从目标到增长结果的闭环**：

1. **OKR 是规则模板，不是 AI 拆解**：`draftObjective` 用固定 KR 模板，`decomposeSuggest` 按人数平均拆目标值，没有 LLM、没有项目铁三角、没有任务与考核联动。
2. **项目只有预算两个数，没有成本模型**：`budgetAmount/budgetHours` 之外没有费率、物料、设备、外部服务与费用归集，交付成本算不清。
3. **外部协作没有统一主体**：项目成员只有 `STAFF | ASSIGNMENT`，供应商在 ERP、需求方在 AIworkin、个人在项目里各是一套，无法统一准入/合同/验收/结算/评价。
4. **数据主键两套口径**：CRM/OKR/服务台按 `ownerUserId`，HRM/ERP/项目按 `(orgType, orgUserId)`，组织切换与跨模块联动天然断层。
5. **事件总线覆盖不全、动作太少**：全仓只有 14 处 `dispatch`、覆盖 9 个业务模块，规则动作只有 webhook/notify/insight/task 四种；CRM/OKR/OA/HRM/服务台/知识库/数据表基本不发事件。
6. **联动是点状而非链路**：SCRM→CRM 已有「提升为线索」，CRM 订单→项目只有 `source='CRM_ORDER'` 的字符串，营销/获客→CRM 有部分，任务↔需求发布、服务台↔CRM、项目↔财务基本没有。
7. **AI 调用仍有旁路**：约 12 个模块直接调 `geoChatMulti`，不经过统一网关的计量/护栏；Agent 业务工具只有 5 个。
8. **UI/IA 不统一**：13 个文件仍用 antd `<Tabs>`，营销工具一页堆 17+ 个工具视图，首页仍是待办/统计而不是目标驱动。
9. **代码结构承载不了下一步**：`routes.ts` 16,186 行、446 个 `createRoute`；`okr.service.ts` 3,175 行；`project.service.ts` 1,809 行；`mechanism.service.ts` 2,417 行；前端无组件测试。

**本方案的主线不是再加功能，而是加三层「承重结构」：**

- **统一主体**：所有业务数据都能回答「属于哪个组织、由谁负责、和哪个外部主体合作」。
- **统一工作项**：需求 → 项目 → 任务 → 工时 → 验收 → 考核 → 结算，是同一条链上的不同状态。
- **统一事件**：任何状态变化都变成可订阅、可自动化、可计量、可追溯的经营事件。

在这三层之上，OKR 2.0 负责「定目标与拆解」，外部协作负责「补能力与履约」，增长联动负责「把获客、销售、交付、复购串起来」，AI 底座负责「让每一步更省事」，ub-mode 负责「让代码配得上这套结构」。

---

## 一、现状审计（只读调研结论）

### 1.1 已经具备、不要重复建设

| 能力 | 现状 | 位置 |
|---|---|---|
| 组织与成员 | `OrgStaff` 支持 STAFF/AGENT、多岗位、能力说明；`OrgDepartment`、`OrgPosition` 已存在 | [schema.prisma:3329](file:///E:/wwwroot/oem-enterprise/backend/prisma/schema.prisma#L3329)、[:3360](file:///E:/wwwroot/oem-enterprise/backend/prisma/schema.prisma#L3360)、[:3376](file:///E:/wwwroot/oem-enterprise/backend/prisma/schema.prisma#L3376) |
| OKR 主体 | 周期/目标/KR/进度/计划/汇报/评分/指标快照齐全，支持公司/部门/个人三级 | [schema.prisma:5097](file:///E:/wwwroot/oem-enterprise/backend/prisma/schema.prisma#L5097)、[okr.service.ts](file:///E:/wwwroot/oem-enterprise/backend/src/okr/okr.service.ts) |
| OKR 自动指标 | 已支持 `CRM_ORDER` 等指标源回填 KR | [okr.metrics.service.ts:64](file:///E:/wwwroot/oem-enterprise/backend/src/okr/okr.metrics.service.ts#L64) |
| 项目铁三角雏形 | 项目有起止、预算金额/工时；里程碑有交付物/验收说明；任务有估时/故事点 | [schema.prisma:7770](file:///E:/wwwroot/oem-enterprise/backend/prisma/schema.prisma#L7770)、[:7839](file:///E:/wwwroot/oem-enterprise/backend/prisma/schema.prisma#L7839)、[:7865](file:///E:/wwwroot/oem-enterprise/backend/prisma/schema.prisma#L7865) |
| 项目风险/洞察 | `riskOf` 已按逾期、预算、进度做规则判断 | [project.service.ts:955](file:///E:/wwwroot/oem-enterprise/backend/src/project/project.service.ts#L955) |
| 任务 WBS 建议 | 已有 `wbsSuggest`，LLM 可用时出任务 JSON，缺模型规则回落 | [project.service.ts:871](file:///E:/wwwroot/oem-enterprise/backend/src/project/project.service.ts#L871) |
| 自动化底座 | `dispatch` + `RuleDefinition` + WebhookOutbox + 通知/洞察/建任务 | [mechanism.service.ts:1258](file:///E:/wwwroot/oem-enterprise/backend/src/mechanisms/mechanism.service.ts#L1258)、[:1311](file:///E:/wwwroot/oem-enterprise/backend/src/mechanisms/mechanism.service.ts#L1311) |
| SCRM → CRM | 企微联系人可幂等提升为 CRM 线索 | [scrm-contact.service.ts:491](file:///E:/wwwroot/oem-enterprise/backend/src/wecom-scrm/scrm-contact.service.ts#L491) |
| 需求发布 | 资产/灵活用工/IP 等板块可发布需求并同步 AIworkin，已有幂等键 | [demand-sync.service.ts:40](file:///E:/wwwroot/oem-enterprise/backend/src/aiworkin/demand-sync.service.ts#L40) |
| AI 底座 | 统一网关/计量/RAG/工具 manifest 已落地；知识库摄取、多维表格 AI 已完成 | [ai-gateway.ts](file:///E:/wwwroot/oem-enterprise/backend/src/ai/ai-gateway.ts)、[系统AI底座优化升级方案.md](file:///E:/wwwroot/oem-enterprise/docs/系统AI底座优化升级方案.md) |
| 统一 UI 组件 | `PageHero / Panel / TabStrip / PillTabs / StatGrid / EmptyState` 已存在 | [panel.tsx](file:///E:/wwwroot/oem-enterprise/frontend/src/components/ui/panel.tsx) |

### 1.2 十个结构性断点

#### 断点 1：OKR「AI」名不副实

- `draftObjective` 直接套 `AUTO_KR_TEMPLATES`，只把方向写进标题/描述；成员岗位与能力只用于生成提示文案，不参与拆解。[okr.service.ts:183](file:///E:/wwwroot/oem-enterprise/backend/src/okr/okr.service.ts#L183)、[:894](file:///E:/wwwroot/oem-enterprise/backend/src/okr/okr.service.ts#L894)
- `decomposeSuggest` 按 `parent target / candidates.length` 平均分目标值，没有容量、成本、依赖、外部资源校验。[okr.service.ts:953](file:///E:/wwwroot/oem-enterprise/backend/src/okr/okr.service.ts#L953)
- 契约只有 `Okr_draftObjective` / `Okr_decomposeSuggest` / `Okr_planGenerate` 三个草稿端点，输入里没有项目铁三角、没有对话轮次、没有任务考核。[okr.ts:506](file:///E:/wwwroot/oem-enterprise/packages/contracts/src/okr.ts#L506)、[:525](file:///E:/wwwroot/oem-enterprise/packages/contracts/src/okr.ts#L525)、[:541](file:///E:/wwwroot/oem-enterprise/packages/contracts/src/okr.ts#L541)
- 任务与 KR 没有关联表；KR 进度靠手动/自动指标，不来自项目任务完成。

#### 断点 2：项目成本不是一个模型

- 项目只有 `budgetAmount`、`budgetHours` 两个标量；没有人工费率、物料、设备、外部服务、费用归集。[schema.prisma:7782](file:///E:/wwwroot/oem-enterprise/backend/prisma/schema.prisma#L7782)
- 任务有 `estimateHours`，工时在 `PjTimeLog`，但没有「工时 × 费率 = 成本」的换算。
- ERP 有供应商与采购单，但没有回写到项目成本；项目预算 vs 实际无法闭环。
- 项目 `source='CRM_ORDER'` 只是创建时可选参数，没有从订单自动建项目。[project.service.ts:254](file:///E:/wwwroot/oem-enterprise/backend/src/project/project.service.ts#L254)

#### 断点 3：外部主体没有统一抽象

- 项目成员 `principalType` 只有 `STAFF | ASSIGNMENT`。[schema.prisma:7794](file:///E:/wwwroot/oem-enterprise/backend/prisma/schema.prisma#L7794)、[project.service.ts:339](file:///E:/wwwroot/oem-enterprise/backend/src/project/project.service.ts#L339)
- 供应商是 ERP 的 `ErpVendor`；个人/OPC 只能塞进 `ASSIGNMENT`；需求方在 AIworkin 平台；三套主体互不认识。
- 没有统一的外部主体准入、资质、费率、可用性、合同、验收、评价。

#### 断点 4：租户主键两套口径

- CRM/OKR/服务台/资产等按 `ownerUserId`：`CrmLead.ownerUserId`、`OkrObjective.ownerUserId`。[schema.prisma:3946](file:///E:/wwwroot/oem-enterprise/backend/prisma/schema.prisma#L3946)、[:5097](file:///E:/wwwroot/oem-enterprise/backend/prisma/schema.prisma#L5097)
- HRM/ERP/项目/组织按 `(orgType, orgUserId)`：`HrmReview`、`ErpVendor`、`PjProject`。
- 后果：组织主体切换器切不到 CRM/OKR；同一企业的职员看不到企业客户与目标；跨模块联动只能靠 `ownerUserId` 猜。

#### 断点 5：事件总线覆盖不全

- 全仓 `dispatch` 只有 14 个调用点、覆盖 9 个业务模块（获客雷达/触达、RPA、招聘、项目、营销、ERP、Workbuddy 等），CRM/OKR/OA/HRM/服务台/知识库/数据表基本不发事件。
- 规则动作只有 4 种：webhook / notify / insight / task；没有「更新 KR、建线索、建项目、发需求、发营销、发起审批、通知外部方、建采购单」。
- 没有事件日志与执行日志，无法重放、无法排查「规则为什么没触发」。

#### 断点 6：联动是点状，不是链路

| 联动 | 现状 | 缺口 |
|---|---|---|
| OKR ↔ 任务 ↔ 自动化 | 计划可链接日程；任务完成不回写 KR | 缺 KR↔任务关联、任务完成事件、自动更新 KR |
| 任务 ↔ 需求发布 | 无 | 任务不能一键外发需求，需求响应不能回到任务 |
| 营销/获客 ↔ CRM | 获客有 `crmLeadId` 映射 | 缺统一来源/活动归因与 ROI 回传 |
| 销售 ↔ 增长 | CRM 订单/合同/回款独立 | 订单不自动建项目、不回填 OKR、不做增长预测 |
| SCRM ↔ CRM | 可提升为线索 | 缺双向同步、客户 360 时间线、标签/归属同步 |
| 项目 ↔ ERP/财务 | 采购单独立 | 缺项目成本归集、预算 vs 实际、结算触发 |
| 服务台 ↔ CRM/KB | AI 接待可接服务台 | 会话不沉淀客户、不写 KB、CSAT 不进 OKR |
| HRM ↔ OKR | 九宫格绩效独立 | 缺任务/KR 证据进入考核 |

#### 断点 7：数字分身仍是「语气层」

- `ContentAgentPersona` 只有 name/style/persona 三个业务字段，没有模型、知识库、工具、渠道、独立记忆。[schema.prisma:2743](file:///E:/wwwroot/oem-enterprise/backend/prisma/schema.prisma#L2743)、[agent.service.ts:341](file:///E:/wwwroot/oem-enterprise/backend/src/content/agent.service.ts#L341)
- 知识库 `KbConsumer` 已预留 `AVATAR` 类型，但没有接通。[schema.prisma:7057](file:///E:/wwwroot/oem-enterprise/backend/prisma/schema.prisma#L7057)
- 记忆按 `userId` 共用一套，分身之间不能各记各的。

#### 断点 8：AI 调用仍有旁路

- 直接引 `geoChatMulti` 的文件：bi、crm、content/skill-generator、feature/skill-review、kb、lowcode、question-hall、service-desk、geo 等；部分绕过统一网关的模型解析、护栏与计量。
- `kbChatMulti` 仍是旧适配层，项目 WBS、ERP、HRM、营销等仍经它调用。
- Agent 业务工具只有 `crm_create_lead`、`data_table_add_row`、`erp_check_stock`、`oa_start_flow`、`recruit_update_application` 五个，跨模块编排能力弱。

#### 断点 9：UI/IA 不统一

- 13 个文件仍用 antd `<Tabs>`：admin 的 features/points/settings/skill-generator，bi-panels，content 的 domestic/ecom PDP，crm-ops/crm-parties，login，points，tax 的 invoice-request/tax-tools-more。
- 3 处 `Segmented`（其中 `globals.css`、`panel.tsx` 是样式/实现，业务页仍有 1 处）。
- `useI18n` 只在 11 个文件出现，模块 UI 基本中文硬编码，与 README 的 8 语言能力不匹配。
- 营销工具页把 17+ 个工具视图塞进同一页；首页是待办/统计，不是「目标—增长—交付」驾驶舱。

#### 断点 10：代码结构承载不了下一步

| 文件 | 行数 | 问题 |
|---|---:|---|
| [routes.ts](file:///E:/wwwroot/oem-enterprise/backend/src/http/routes.ts) | 16,186 | 446 个 `createRoute` 手写样板，契约与路由重复 |
| [okr.service.ts](file:///E:/wwwroot/oem-enterprise/backend/src/okr/okr.service.ts) | 3,175 | 周期/目标/KR/计划/汇报/指标/评分混在一个类 |
| [mechanism.service.ts](file:///E:/wwwroot/oem-enterprise/backend/src/mechanisms/mechanism.service.ts) | 2,417 | 调度/规则/动作/Outbox 混在一起 |
| [project.service.ts](file:///E:/wwwroot/oem-enterprise/backend/src/project/project.service.ts) | 1,809 | 项目/任务/工时/洞察/WBS 混在一起 |
| 前端测试 | 0 | 只有 TypeScript 与手测，没有组件/交互回归 |

已有可复用的好模式：`automation-routes.ts` 里的 `moduleHandlers(prefix, controller)` 已按契约前缀自动装配句柄，可作为 `routes.ts` 收敛的起点。[automation-routes.ts](file:///E:/wwwroot/oem-enterprise/backend/src/http/automation-routes.ts)

---

## 二、设计原则（ub-mode 与增长思想的落地口径）

1. **先让它工作，再让它正确**：OKR 2.0 先跑通「输入目标 → 对话 → 拆解 → 确认 → 落任务/OKR」主链路，再补模拟、评分、复盘；不允许先造一堆半成品表。
2. **攻击前提**：不假设「AI 直接生成最终 OKR」。AI 只出**候选方案 + 假设 + 风险**，人确认后才落库。
3. **先减后加**：不新建第 N 套 LLM 客户端、第 N 套向量库、第 N 套外部主体表；能扩展现有模型的，不新建平行模型。
4. **领域建模与边界纪律**：OKR、项目、外部协作、事件、AI 能力各自一个边界；跨边界只通过契约与事件，不互相读表。
5. **类型纪律**：新增/改动一律 contracts 先行；禁止 `as never`、禁止 `Row` 兜底业务字段；OpenAPI / MCP / 前端同源。
6. **幂等**：事件、规则动作、需求发布、订单→项目、任务同步、AI 批量写，全部要有幂等键。
7. **共享状态先分离再串行**：同一项目/同一 KR 的并发更新用版本号或事务串行，不用「最后写入者赢」。
8. **缺 Key 规则兜底、不假数据**：分析/文案可规则兜底并标「AI 估计」；金额、成本、排名、真实指标无源即引导配置，绝不造数。
9. **身份决定可见与可做**：副驾、Agent 工具、外部方门户都带调用者 scope；越权数据不可见、越权动作不可执行。
10. **增长思想**：每个功能都要能回答「它让哪个增长环节更快/更省/更可预测」；不能进入增长飞轮的功能，降级为配置项而不是主入口。
11. **OPC 与生态链**：一个人/小团队也能用「目标 + 外部资源池 + 项目交付」跑完整闭环；大企业能把供应商/OPC/个人纳入同一套准入与验收。
12. **一次交付**：对外不分期；内部按批次推进，每批保持可编译、可运行、可回归。

---

## 三、统一抽象层（承重设计）

这一层是后面所有联动的前提。原则：**能加字段就不新建表，能建读模型就不复制数据。**

### 3.1 统一租户与主体：`OrgScope` + `PrincipalRef`

**目标**

- `OrgScope = { orgType: 'ENTERPRISE' | 'PROVIDER', orgUserId: string }`
- `PrincipalRef = { type: 'STAFF' | 'AGENT' | 'PARTY' | 'CUSTOMER', id: string }`
- 所有业务表至少能解析出 `OrgScope`；所有「人/外部方」字段统一用 `PrincipalRef` 表达。

**做法**

1. 新建 `TenantScopeService`（`backend/src/common/tenant-scope.service.ts`）：
   - `fromUser(user)`：按当前身份返回 `OrgScope`；个人主体回落 `('ENTERPRISE', userId)`。
   - `assert(user, scope)`：校验调用者是否属于该组织。
   - `where(scope)`：统一生成 Prisma where 片段。
2. 给 `ownerUserId` 口径的表补 `orgType/orgUserId`：
   - 第一批：`CrmLead/CrmCustomer/CrmOpportunity/CrmContract/CrmOrder`、`OkrCycle/OkrObjective/OkrKeyResult/OkrPlan/OkrReport`、`ServiceDeskConversation`。
   - 迁移：`orgType='ENTERPRISE', orgUserId=owner_user_id` 回填；保留 `ownerUserId` 作为「创建人/归属人」兼容列，不再作为租户键。
   - 读取：新代码一律经 `TenantScopeService`；旧代码通过兼容视图/适配层过渡，**不留长期双写**。
3. 项目/HRM/ERP 已有组织键，统一改用 `TenantScopeService`，去掉各模块自己拼 `orgType/orgUserId` 的散落逻辑。

**验收**

- 同一企业下，A 职员创建的 CRM 线索、OKR 目标，B 职员在组织切换后可见（受角色/可见性控制）。
- 服务商主体切换后，看不到企业主体的 CRM/OKR。
- 所有新增查询都带 `OrgScope`，架构检查能拦住裸 `ownerUserId` 查询。

### 3.2 统一外部主体：`BizParty`

**目标**：供应商、OPC、个人、合作伙伴、客户，都是「外部主体」，只是角色和能力不同。

**模型（新增 `BizParty`）**

| 字段 | 说明 |
|---|---|
| `orgType/orgUserId` | 归属组织 |
| `kind` | `VENDOR` / `OPC` / `INDIVIDUAL` / `PARTNER` / `CUSTOMER` |
| `name/contactName/phone/email/taxNo/address` | 基础档案 |
| `roles` | JSON 数组，一个主体可同时是供应商+合作方 |
| `capabilities` | JSON：能力标签、行业、区域、交付类型 |
| `rateCard` | JSON：按角色/工时/成果的报价区间 |
| `availability` | JSON：可接单时间、产能、档期 |
| `compliance` | JSON：资质、合同、保密、发票类型、状态 |
| `rating` | 交付质量/响应/配合度综合分（由评价回写） |
| `source` | `MANUAL` / `DEMAND` / `ERP` / `CRM` |
| `status` | `ACTIVE` / `PAUSED` / `BLACKLISTED` |

**兼容策略**

- `ErpVendor` 增加 `partyId`，新供应商写 `BizParty` 并回填 `partyId`；旧供应商懒迁移。
- `CrmCustomer` 增加 `partyId`（可选），客户 360 可关联外部合作方。
- `PjProjectMember.principalType` 增加 `PARTY`，`principalId = BizParty.id`；任务 `assigneeType` 增加 `PARTY`。
- 不删除现有 ERP/CRM 表，避免大爆炸式迁移。

**验收**

- 一个供应商在 ERP 采购、项目成员、需求响应、验收评价里是同一个 `partyId`。
- 外部个人/OPC 不需要先建 ERP 供应商，也能进项目并结算。

### 3.3 统一工作项：`WorkItemView`

**目标**：需求、项目、任务、工时、验收、结算不是六张互不相干的表，而是同一条交付链的视图。

**做法（读模型，不新建大表）**

- 以 `PjTask` 为交付主键，补：
  - `sourceType/sourceId`：`DEMAND` / `CRM_ORDER` / `OA` / `OKR` / `MANUAL`
  - `acceptanceCriteria` JSON：验收清单 `[{ key, label, required, evidence }]`
  - `qualityRubric` JSON：质量档位与评分口径
  - `assessmentWeight`：考核权重
  - `assigneeType` 增加 `PARTY`
- 新增 `WorkItemService`：按 `sourceType/sourceId` 聚合出统一的 `WorkItemView`（需求方、承接方、预算、工期、验收、状态、证据）。
- 需求发布、CRM 订单、OA 审批、OKR 拆解都只写自己的源数据 + `sourceType/sourceId`，不复制任务内容。

**验收**

- 同一个外部需求，能从需求单号追到项目、任务、工时、验收、结算。
- 任务详情能显示「它来自哪个目标/订单/需求」。

### 3.4 统一目标树：`GoalTree`

**目标**：战略目标 → 公司 OKR → 部门 OKR → 个人 OKR → KR → 任务 → 验收 → 考核，是一条可追溯的树。

**做法**

- 保留 `OkrObjective/OkrKeyResult` 作为目标主数据。
- 新增 `OkrTaskLink`：
  - `orgType/orgUserId`
  - `objectiveId`、`krId`
  - `taskId`
  - `weight`（该任务对 KR 的贡献权重）
  - `targetValue`（可选：任务完成量如何折算成 KR 值）
  - `acceptance` JSON（覆盖/补充任务验收标准）
  - `ownerMemberUserId`
  - 唯一键 `(krId, taskId)`
- `OkrObjective` 增加 `briefId`（关联目标书），`OkrKeyResult` 增加 `evidenceRequired`。
- 目标树查询 `GoalTreeService`：一次返回目标、KR、任务、验收、进度、负责人、外部方。

**验收**

- 任务完成 → KR 进度按 `weight/targetValue` 自动更新（或给出待确认更新）。
- 每个职员的 OKR 能下钻到具体任务与验收证据。

### 3.5 统一经营事件：`ActivityEvent`

**目标**：任何状态变化都可订阅、可自动化、可审计、可重放。

**做法**

1. 新增 `EventLog` 表：
   - `id`、`orgType/orgUserId`、`event`、`payload` JSON、`actorId`、`source`、`idempotencyKey`（唯一）、`occurredAt`、`status`。
2. 统一入口 `EventBus.emit(scope, event, payload, options)`：
   - 写 `EventLog` → 调 `MechanismService.dispatch` → 记 `RuleExecution`。
   - 幂等键默认 `event + source + sourceId + version`。
3. 事件目录（第一批）：

| 域 | 事件 |
|---|---|
| CRM | `crm.lead.created` / `crm.lead.converted` / `crm.opportunity.won` / `crm.contract.signed` / `crm.order.created` / `crm.order.paid` |
| OKR | `okr.objective.committed` / `okr.kr.updated` / `okr.kr.at_risk` / `okr.review.submitted` |
| 项目 | `project.created` / `project.task.completed` / `project.task.overdue` / `project.milestone.accepted` / `project.cost.overrun` |
| 外部协作 | `party.added` / `party.engaged` / `demand.published` / `demand.replied` / `party.delivery.accepted` / `party.reviewed` |
| 营销/获客 | `acquisition.lead.captured` / `scrm.contact.added` / `marketing.campaign.sent` |
| 服务台 | `service_desk.conversation.created` / `service_desk.conversation.closed` |
| HRM | `hrm.review.submitted` / `hrm.staff.joined` / `hrm.staff.left` |
| 知识/数据 | `kb.page.published` / `data_table.row.created` / `content.published` |

4. 事件契约放进 `packages/contracts/src/events.ts`，payload 用 zod 定义，前后端/自动化共用。

**验收**

- 任一事件在 `EventLog` 可查、可重放、可看到触发了哪些规则。
- 新增事件不需要改 `MechanismService` 核心代码。

### 3.6 统一 AI 能力：`AiCapability`

**目标**：模块不直接拼 prompt，而是调用带 schema、带计量、带兜底的「能力」。

**做法**

- 在现有 `ai-gateway` 之上加能力注册表：
  - `summarize` / `extract` / `classify` / `score` / `draft` / `plan` / `chat` / `embed`
  - 每个能力有：输入 schema、输出 schema、prompt 版本、兜底策略、计量科目。
- OKR 拆解、WBS、风险洞察、客户摘要、工单分类、简历匹配都走能力注册表。
- 能力注册表同时暴露为 Agent 工具与 MCP 工具，避免每个模块各写一套。

**验收**

- 同一「摘要」能力在 CRM/服务台/项目/OKR 输出结构一致，计量口径一致。
- 新增能力不改调用方代码。

### 3.7 统一知识与资产引用：`KnowledgeAssetRef`

**目标**：知识库页面、数字资产、多维表格行、内容文档，都能被同一套「引用 + 权限 + 召回」机制使用。

**做法**

- 定义 `KnowledgeAssetRef = { kind: 'KB_PAGE' | 'DIGITAL_ASSET' | 'DATA_ROW' | 'DOC', id, title, spaceId?, labels[] }`。
- `KbRetrieve` 接受 `KnowledgeAssetRef[]` 作为过滤/优先级来源。
- 数字分身、副驾、技能、自动化动作都只认 `KnowledgeAssetRef`，不直接读各模块表。

**验收**

- 分身/副驾能引用知识库页面、数字资产、表格行，并显示来源。
- 权限跟随引用者，不越权召回。

---

## 四、OKR 2.0：从「填表」到「AI 经营对话」

### 4.1 用户旅程（目标体验）

1. 用户新建「目标书」，输入：
   - **总体业务目标**：例如「2027 年华东区新签合同额增长 40%」
   - **项目范围**：做什么、达到什么目标、交付物
   - **时间**：工期、关键节点、复盘节奏
   - **成本**：预算金额、人力（角色/人数/工时）、物力、设备、外部服务
2. 系统先做**前置检查**：组织架构、部门、岗位、对应人、费率/日历是否齐全；缺什么当场引导补。
3. AI 读取组织快照（部门/岗位/成员能力/当前负载/历史交付/CRM 管道/供应商池/知识库），开始**互动式澄清**。
4. AI 给出 2–3 套拆解方案（稳健/平衡/进取），每套包含：目标树、KR、任务、负责人、工期、成本、外部资源、风险、假设。
5. 系统做**容量与预算模拟**：人力是否超载、预算是否超支、关键路径是否可行、外部采购周期是否够。
6. 用户逐项确认/修改；确认后才落库：目标、KR、任务、验收标准、个人 OKR、项目（可选）。
7. 执行期：任务完成/工时/订单/回款/服务台事件自动回填 KR；每周 AI 生成进度摘要与偏差建议；季度考核用任务与 KR 证据。

### 4.2 前置条件与校验清单

分解前必须可解析：

| 条件 | 来源 | 缺失时 |
|---|---|---|
| 组织主体 | `OrgScope` | 引导切换/创建主体 |
| 部门 | `OrgDepartment` | 允许先用「未分配」但标黄 |
| 岗位 | `OrgPosition` + `OrgStaff.positions` | 允许拆解，但负责人建议降级为「按部门」 |
| 对应人 | `OrgStaff`（STAFF/AGENT） | 必须至少有一个可承接人，否则阻断提交 |
| 能力说明 | `OrgStaff.capabilities` | 允许拆解，标注「能力信息缺失」 |
| 费率/成本 | `PjCostRate`（新增） | 允许拆解，成本只给区间并标「待补费率」 |
| 日历/工期 | 项目起止 + 组织日历 | 允许拆解，工期标「按自然日估算」 |

原则：**缺信息不阻断分析，但阻断「确认落库」中依赖该信息的动作**（例如没有费率不能生成正式预算）。

### 4.3 领域模型（新增/扩展）

| 模型 | 作用 | 关键字段 |
|---|---|---|
| `OkrGoalBrief` | 目标书：总体目标 + 铁三角 | `businessGoal`、`scopeWhat`、`scopeTarget`、`deliverables` JSON、`startDate/endDate`、`budgetAmount/budgetHours`、`labor` JSON、`materials` JSON、`equipment` JSON、`externalServices` JSON、`constraints`、`status` |
| `OkrDialogTurn` | 互动对话 | `briefId`、`role`、`content`、`structured` JSON、`createdAt` |
| `OkrDecomposition` | AI 拆解候选 | `briefId`、`version`、`mode`（LLM/RULE）、`payload` JSON、`status`（DRAFT/CONFIRMED/REJECTED） |
| `OkrTaskLink` | 目标/KR ↔ 任务 | `objectiveId`、`krId`、`taskId`、`weight`、`targetValue`、`acceptance` JSON、`ownerMemberUserId` |
| `PjCostRate` | 人工/外部费率 | `principalType/principalId`、`hourlyRate/dailyRate`、`currency`、`effectiveFrom` |
| `PjCostItem` | 项目成本归集 | `projectId`、`kind`（LABOR/MATERIAL/EQUIPMENT/EXTERNAL/OTHER）、`qty`、`unitCost`、`amount`、`sourceType/sourceId`、`incurredAt` |
| `BizParty` | 外部主体 | 见 §3.2 |
| `PjEngagement` | 项目外部合作 | `projectId`、`partyId`、`scope`、`contractId`、`amount`、`paymentTerms`、`acceptance`、`status` |

扩展 `PjTask`：`sourceType/sourceId`、`acceptanceCriteria`、`qualityRubric`、`assessmentWeight`、`assigneeType` 增加 `PARTY`。
扩展 `HrmReview`：`okrScore`、`okrEvidence` JSON，把 OKR/任务证据带入绩效，不再另建一套考核表。

### 4.4 对话状态机

```
INTAKE（目标书）
  → CONTEXT（读组织/项目/CRM/供应商/知识库）
  → CLARIFY（最多 5 轮，结构化问题 + 可跳过）
  → PROPOSE（2–3 套方案）
  → SIMULATE（容量/预算/工期/依赖校验）
  → CONFIRM（逐项确认，人工闸门）
  → COMMIT（事务落库 + 发事件）
  → TRACK（执行期回填与复盘）
```

**每轮 AI 输出都必须是结构化 JSON**，包含：

- `questions[]`：还缺什么、为什么问、可选项、默认值
- `assumptions[]`：本次拆解依赖的假设
- `risks[]`：风险、影响、缓解
- `options[]`：方案对比（稳健/平衡/进取）
- `confidence`：低/中/高（低置信必须要求人确认）

**人工闸门（不可跳过）**

- 创建/修改目标与 KR
- 指派负责人
- 创建项目与任务
- 对外发布需求
- 创建外部合作/采购
- 发送对外通知/营销

### 4.5 AI 拆解算法（可解释、可回退）

1. **目标结构化**：把业务目标转成 `{ metric, baseline, target, unit, direction, deadline }`；缺 baseline 时先问，不猜。
2. **目标树**：按公司 → 部门 → 个人三层生成候选；每层目标必须有 2–5 个 KR。
3. **KR 质量检查**：可量化、有基线、有截止、有责任人、有数据源；不合格的 KR 标红并给改写建议。
4. **组织匹配**：按部门/岗位/能力/当前负载匹配负责人；一人多目标时计算容量占用。
5. **任务拆解**：每个 KR 生成 1–6 个任务；任务必须有交付物、验收标准、估时、依赖。
6. **铁三角校验**：
   - 范围：任务是否覆盖 KR，是否有未定义交付物
   - 时间：关键路径 + 外部采购周期是否超过截止
   - 成本：人力工时 × 费率 + 物料 + 设备 + 外部服务是否超预算
7. **外部资源建议**：内部容量不足时，建议供应商/OPC/个人，并给出准入/合同/验收要求。
8. **回退**：无模型/模型失败时，用现有模板 + 规则拆解，输出「规则方案」并明确标注，不伪装成 AI。

**防幻觉**

- 负责人 ID 必须在组织成员白名单内，否则丢弃该建议。
- 金额/工时/费率必须来自用户输入或费率表，不允许模型编造。
- 指标数据源必须是已注册的 `metricSource`，否则标「需人工确认」。
- 所有 AI 产出先落 `OkrDecomposition` 草稿，确认后才写主表。

### 4.6 产物：任务、考核目标、个人 OKR

**具体任务**

- 写入 `PjTask`，带 `sourceType='OKR'`、`sourceId=krId`、`acceptanceCriteria`、`qualityRubric`、`assessmentWeight`、`estimateHours`、`dueDate`、`assigneeType/assigneeId`。
- 同时写 `OkrTaskLink`，建立 KR ↔ 任务关系。

**任务考核目标**

每个任务至少有：

- 交付物清单（必须有）
- 验收标准（可勾选、可附证据）
- 质量档位（如「合格/良好/优秀」及对应口径）
- 权重（对 KR/个人目标的贡献）
- 证据要求（文件/链接/客户确认/工时）

**每个职员的 OKR**

- 生成 `OkrObjective(level='PERSONAL', ownerMemberUserId=...)`
- KR 继承上级 KR 的指标口径，目标值按容量/能力/历史交付拆分，不平均分。
- 个人目标必须能下钻到任务与验收证据，避免「只写目标不落地」。

### 4.7 与项目、HRM、CRM 的联动

| 联动 | 机制 |
|---|---|
| OKR → 项目 | 确认拆解时可一键建项目，预算/工期/里程碑来自目标书；项目 `source='OKR'` |
| OKR → 任务 | `OkrTaskLink` + 任务验收标准 |
| 任务 → KR | `project.task.completed` 事件按 `weight/targetValue` 更新 KR；或生成「待确认更新」 |
| 工时 → 成本 | `PjTimeLog` × `PjCostRate` 写 `PjCostItem`，项目预算 vs 实际 |
| CRM → KR | `crm.order.paid` 等事件更新销售类 KR（已有 `CRM_ORDER` 指标源，扩展为事件驱动） |
| HRM → OKR | `HrmReview` 引用 KR/任务证据，`okrScore` 进入绩效 |
| 外部方 → OKR | `party.delivery.accepted` 计入交付类 KR，评价回写 `BizParty.rating` |

### 4.8 端点与页面（已落地）

**新增契约（`packages/contracts/src/okr.ts`，14 个 operation）**

| 端点 | 作用 |
|---|---|
| `Okr_briefList` / `Okr_briefGet` / `Okr_briefSave` / `Okr_briefRemove` | 目标书台账与铁三角维护 |
| `Okr_dialogList` / `Okr_dialogSend` | 互动澄清：保存用户回合 → AI 结构化回复（问题/假设/风险/是否可拆解）→ 保存助手回合并推进状态 |
| `Okr_decompositionList` / `Okr_decompositionGenerate` / `Okr_decompositionSimulate` / `Okr_decompositionCommit` | 候选方案生成（稳健/平衡/进取）、容量/预算/工期模拟、人工确认后事务落库 |
| `Okr_taskLinkList` / `Okr_taskLinkSave` / `Okr_taskLinkRemove` | 目标/KR ↔ 项目任务关联、权重、验收项、承接人 |
| `Okr_assessmentPreview` | 按 KR 进度与关联任务输出考核预览 |

**实现要点**

- 服务拆分：`OkrBriefService`（目标书/对话/前置检查）、`OkrDecompositionService`（生成/模拟/落库/关联/考核）、`okr-decomposition.rules.ts`（规则兜底与防幻觉归一化）；`OkrController` 只做委托，路由由 `Okr_` 前缀自动映射。
- 对话最多 5 轮结构化追问；`OkrDialogTurn.structured` 存问题/选项/默认值，前端逐项渲染输入。
- 生成三套方案写入 `OkrDecomposition.payload`（草稿），`mode` 区分 `LLM`/`RULE`，规则方案显式标注，不伪装成 AI。
- 归一化白名单：负责人必须是组织成员、指标来源必须属于已注册集合、日期夹在目标书工期内、金额只取用户输入或外部服务预算、覆盖率不足的 KR 自动补「关键任务」。
- 落库为单事务：目标 + KR + 项目（可选新建/归档到已有项目）+ 任务（`sourceType='OKR'`、验收标准、质量档位、考核权重、估时）+ `OkrTaskLink` + 个人 OKR；`confirmed: true` 为人工闸门，缺失即拒绝。
- 模拟校验项：负责人覆盖、KR 可量化、工期可行、人力容量、预算超支、任务覆盖率。
- 目标书删除前检查是否已有 `CONFIRMED` 拆解，避免悬空引用。

**页面（`frontend/src/app/okr`）**

- 新增「目标书」页签：铁三角表单（逐条添加交付物/人力/物料/设备/外部服务）+ 前置检查列；可直接跳「AI 拆解」。
- 新增「AI 拆解」页签：目标书选择 → 互动澄清对话 → 三档方案卡 → 方案详情（目标树/KR/成本/假设/风险）→ 模拟校验 → 确认落库（选新建或已有项目）→ 任务关联与考核预览。
- 目标/计划/汇报页签保留；旧 `draftObjective/decomposeSuggest/planGenerate` 端点不动，旧入口不破坏。

---

## 五、外部资源协作：供应商 / OPC / 个人

### 5.1 统一外部主体与准入

- 所有外部资源统一 `BizParty`，按 `kind` 区分供应商/OPC/个人/合作伙伴。
- 准入清单：主体信息、资质、合同、保密、发票类型、结算账户、能力标签、费率、可用性。
- 准入状态：`DRAFT → REVIEWING → ACTIVE → PAUSED → BLACKLISTED`。
- 外部方可以有轻量门户（后续），但首期由内部人员代为维护。

### 5.2 合作全流程

```
需求/任务识别外部履约
  → 选择/推荐 BizParty（能力、费率、档期、评分）
  → 创建 PjEngagement（范围、金额、工期、验收、付款条件）
  → 合同/采购单（CRM 合同或 ERP 采购）
  → 任务分派（assigneeType='PARTY'）
  → 交付与验收（任务验收清单 + 里程碑 acceptanceNote）
  → 结算（ERP 采购/付款）
  → 评价（质量/响应/配合 → BizParty.rating）
  → 复购/推荐
```

### 5.3 与现有模块的接线

| 模块 | 接线 |
|---|---|
| 项目 | `PjProjectMember.principalType='PARTY'`；任务 `assigneeType='PARTY'` |
| ERP | `ErpVendor.partyId`；采购单关联 `PjEngagement`；采购金额回写 `PjCostItem` |
| CRM | `CrmCustomer.partyId`（可选）；合同关联合作方 |
| 需求发布 | 任务/项目可发布为需求；响应方落 `BizParty(source='DEMAND')` |
| OKR | 外部交付计入 KR；评价进入目标复盘 |
| 服务台/知识库 | 外部方 FAQ/交付文档可挂知识库，按权限隔离 |

### 5.4 OPC 经营模式

- 一个 OPC 主体可以同时是「企业自己」和「外部合作方」；系统不强制拆分。
- 支持「一人多角色」：同一自然人在 A 企业是职员，在 B 项目是外部个人；用 `PrincipalRef` 区分上下文。
- 支持「小团队虚拟组织」：不建正式部门，也能按项目组队、按任务结算。
- 支持「外部资源池」：按能力/区域/费率检索，项目缺人时推荐。

### 5.5 验收

- 一个外部供应商从准入到评价全流程可追溯。
- 外部个人无需 ERP 供应商档案即可参与项目并结算。
- 项目成本能区分内部人力与外部采购/服务。

### 5.6 端点与页面（已落地 2026-11-08）

**新增契约（`packages/contracts/src/project.ts`，11 个 operation）**

| 端点 | 作用 |
|---|---|
| `Pj_listCostRates` / `Pj_saveCostRate` / `Pj_removeCostRate` | 费率台账：内部员工/任务承接/外部主体按生效期维护时薪、日薪 |
| `Pj_listCostItems` / `Pj_saveCostItem` / `Pj_removeCostItem` | 成本台账：物料、设备、外部服务、其他；人工只能由工时×费率归集 |
| `Pj_projectCost` | 项目成本汇总：预算占用、分科目成本、人力工时、未配费率工时、外部合作金额 |
| `Pj_listEngagements` / `Pj_saveEngagement` / `Pj_decideEngagement` / `Pj_removeEngagement` | 外部合作：草稿→履约中→待验收→已结算，可取消；验收自动生成外部成本项 |

**实现要点**

- 服务拆分：`ProjectCostService` 独立承接费率/成本/合作；`ProjectController` 只做委托，路由由 `Pj_` 前缀自动映射。
- 人工成本单一来源：已审批工时 × 当期费率（`effectiveFrom ≤ 工时日期 ≤ effectiveTo`，取最新一条）；只配日薪时按项目设置的标准工时折算；缺失费率计入「未配费率工时」告警，不静默漏算。
- 台账禁止重复记账：手工新增 `LABOR` 成本项直接拒绝；系统归集项（来源非 `MANUAL`）不可编辑/删除。
- 账实一致：合作验收（`accept`）在同一动作内 upsert 一条 `EXTERNAL` 成本项；取消合作删除该成本项；已结算合作不可修改/删除。
- 费率治理：同一主体同一生效日唯一；已参与已审批工时计算的费率不可删除，只能新增新费率覆盖后续期间；费率维护需组织管理员。
- 主体统一：ERP 供应商、CRM 客户按名称自动认领/创建租户内 `BizParty` 并回填 `partyId`；任务承接支持 `STAFF | ASSIGNMENT | PARTY`，外部主体从统一目录选择。
- 事件：`engagement.created/updated/started/accepting/settled/canceled`、`project.cost.updated` 经 mechanisms 分发，供自动化与驾驶舱消费。

**页面（`frontend/src/app/project`）**

- 新增「成本」页签：项目选择 → 预算/已发生/占用率/人力/外部支出/未配费率工时看板；成本明细分页筛选与逐条登记；费率台账维护。
- 新增「外部协作」页签：合作项目（筛选、状态流转、验收说明）与合作方目录（类型/联系人/能力标签/评分/黑名单）两个子视图。
- 任务页签补齐承接类型（员工/任务承接/外部合作方）、验收标准逐条添加、质量档位（合格/良好/优秀）、考核权重与来源标记；项目页 WBS 直接落任务时带默认验收字段。

---

## 六、企业增长联动地图

### 6.1 增长飞轮总图

```
目标（OKR）
  → 获客（营销/获客/SCRM）
  → 转化（CRM 线索/商机/报价/合同/订单/回款）
  → 交付（项目/任务/工时/外部协作/验收）
  → 复购与口碑（服务台/客户 360/评价）
  → 数据回填（KR/增长驾驶舱/复盘）
  → 下一轮目标
```

### 6.2 联动矩阵

| # | 联动 | 现状 | 目标机制 | 关键事件/字段 | 验收 |
|---|---|---|---|---|---|
| 1 | OKR ↔ 任务 ↔ 自动化 | 计划可链日程；任务完成不回写 KR | `OkrTaskLink`；任务完成事件按权重回填 KR；规则可「KR 落后→建任务/通知」 | `project.task.completed`、`okr.kr.updated` | 任务完成后 KR 自动/待确认更新 |
| 2 | 任务 ↔ 需求发布 | 无 | 任务一键生成需求草稿（范围/交付物/预算/工期/验收）；需求响应回到候选外部方/任务 | `demand.published`、`demand.replied`、`task.sourceType='DEMAND'` | 任务能外发并回收响应 |
| 3 | 营销/获客 ↔ CRM | 获客有 `crmLeadId` 映射 | 统一线索入口；来源/活动/内容归因；成交后 ROI 回传活动与 OKR | `acquisition.lead.captured`、`crm.lead.created`、`crm.order.paid` | 每条线索可追到来源与成交 |
| 4 | 销售 ↔ 增长 | 合同/订单/回款独立 | 订单成交自动建项目；回款更新 KR/现金流；增长预测 | `crm.order.created`、`crm.order.paid`、`project.created` | 订单→项目→回款一条链 |
| 5 | SCRM ↔ CRM | 可提升为线索 | 双向同步客户/标签/归属/跟进；客户 360 时间线；群/朋友圈触达回执进 CRM | `scrm.contact.added`、`crm.lead.converted` | 企微客户与 CRM 客户同一视图 |
| 6 | 项目 ↔ ERP/财务 | 采购单独立 | 采购/费用归集到项目成本；预算 vs 实际；超支告警 | `project.cost.overrun`、`erp.po.created` | 项目毛利可算 |
| 7 | 服务台 ↔ CRM/KB | AI 接待可接服务台 | 会话→客户/线索；知识库答问；CSAT 进 KR/复盘 | `service_desk.conversation.created`、`kb.page.published` | 工单可追客户与知识来源 |
| 8 | HRM ↔ OKR | 九宫格独立 | 任务/KR 证据进绩效；个人 OKR 与考核同源 | `hrm.review.submitted`、`okr.assessment` | 考核有证据、不靠印象 |
| 9 | 内容/资产 ↔ 营销 | 资产库与发布割裂 | 资产→内容→多平台分发→线索回流 | `content.published`、`acquisition.lead.captured` | 内容能追到线索 |
| 10 | 数据表/BI ↔ 全模块 | 数据表是孤岛 | 数据表作为轻量业务对象；BI 做统一问数；事件写入表 | `data_table.row.created` | 表能接收业务事件 |

### 6.3 关键链路的「一件事」原则

- **一个线索**：从来源到成交只有一个 `leadId`，SCRM/获客/营销都写它，不各建一套。
- **一个客户**：CRM 客户 360 聚合 SCRM 会话、服务台工单、合同、订单、项目、回款。
- **一个项目**：项目 360 聚合铁三角、任务、工时、成本、外部合作、验收、风险。
- **一个目标**：目标 360 聚合 KR、任务、证据、负责人、成本、外部资源。
- **一个事件**：同一业务变化只发一个标准事件，订阅方各自消费，不互相回调。

---

## 七、全系统 AI 化（在既有 AI 底座上补联动）

> P0 网关/计量/RAG/工具 manifest、P1-A 知识库、P1-B 多维表格已完成；P1-C 数字资产、P1-D 数字分身、P2-A 副驾、P2-B 点状 AI 按《系统AI底座优化升级方案》继续，本节只补「与增长联动相关的增强」。

### 7.1 数字分身：从「语气」到「数字员工」

在既有 P1-D 六项（挂知识库/绑模型/渠道化/独立记忆/会话沉淀/多分身协同）之上，增加经营场景：

| 场景 | 配置 | 用途 |
|---|---|---|
| 销售分身 | CRM 客户/商机/话术库 + CRM 工具 | 客户跟进建议、报价草稿、下一步动作 |
| 交付分身 | 项目/任务/验收/知识库 + 项目工具 | 站会摘要、风险提示、验收清单 |
| 招聘分身 | HRM/岗位/简历库 + 招聘工具 | 简历筛选、面试问题、匹配评分 |
| 客服分身 | 服务台/知识库/订单 + 工单工具 | 答问、建单、升级人工 |
| 经营分身 | OKR/CRM/项目/财务 + 只读分析工具 | 周报、偏差分析、增长建议 |

**关键约束**：分身的工具权限 = 配置者权限 ∩ 当前调用者权限；不能借分身越权。

### 7.2 嵌入式副驾（P2-A）

- 在 CRM 客户详情、项目详情、OKR 目标详情、数据表、资产库、服务台挂 `<AiCopilot module recordId />`。
- 副驾自动带：当前模块、当前记录、调用者 scope、可用工具、相关知识。
- 副驾动作分两级：只读分析直接执行；写操作（建任务/改 KR/发需求）需确认。

### 7.3 知识库 / 多维表格 / 数字资产

- 知识库：作为 OKR 目标书、项目复盘、外部方资料的统一沉淀地；分身/副驾/服务台共用 `KbRetrieve`。
- 多维表格：作为「轻量业务对象」承接 OKR 任务清单、外部资源池、验收台账、增长实验记录；支持 AI 列/问数/建表（已完成）。
- 数字资产：作为内容与证据库；任务验收证据、营销素材、交付物统一引用；自动打标/相似检索（P1-C）。

### 7.4 通用 AI 能力（减少重复 prompt）

| 能力 | 用在哪些模块 |
|---|---|
| 摘要 | CRM 跟进、项目周报、服务台会话、OKR 复盘 |
| 抽取 | 合同/发票/简历/需求书 → 结构化字段 |
| 分类 | 线索分级、工单分类、内容标签 |
| 评分 | 线索评分、简历匹配、供应商评价、KR 质量 |
| 起草 | 报价、邮件、需求书、验收报告 |
| 规划 | OKR 拆解、WBS、排期建议 |

### 7.5 AI 治理

- 所有调用经网关，带 `purpose`、`scope`、`userId`、`capability`，统一计量与审计。
- 缺模型时规则兜底，界面标「规则结果」；不伪造 AI。
- AI 产出可复制/导出/转资产/转任务。
- prompt 版本化，关键能力有回归样例。

---

## 八、自动化与规则升级

### 8.1 从「四种动作」到「经营动作库」

现有动作：webhook / notify / insight / task。新增：

| 动作 | 说明 | 需确认 |
|---|---|---|
| `update_kr` | 按事件更新 KR 当前值/进度 | 否（内部） |
| `create_lead` | 事件建 CRM 线索 | 否（内部） |
| `create_task` | 事件建项目任务（已有，扩展 source） | 否（内部） |
| `create_project` | 成交/目标确认后建项目 | 是 |
| `publish_demand` | 任务外发需求 | 是 |
| `send_marketing` | 触发营销触达 | 是 |
| `start_approval` | 发起 OA 审批 | 是 |
| `notify_party` | 通知外部合作方 | 是 |
| `create_po` | 建 ERP 采购单 | 是 |
| `score_party` | 回写外部方评价 | 否（内部） |

### 8.2 规则执行可靠性

- `RuleExecution` 表：规则、事件、动作、状态、重试次数、错误、耗时。
- 幂等：同一事件同一规则只执行一次；外部动作带幂等键。
- 失败重试：指数退避，超过阈值告警；不阻塞主业务。
- 夜间批任务：重算/回填/评分/预测排在凌晨低谷，不占在线资源。

### 8.3 典型自动化配方

- KR 落后 20% → 建「补救任务」+ 通知负责人。
- 商机赢单 → 建项目 + 建首笔任务 + 通知交付负责人 + 更新销售 KR。
- 项目里程碑验收 → 触发外部方结算 + 评价 + 更新交付 KR。
- 服务台高优工单 → 建 CRM 跟进任务 + 通知客户负责人。
- 外部方评分低于阈值 → 暂停派单 + 通知采购。

---

## 九、UI / IA 统一：让用户更简单

### 9.1 首页升级为「增长驾驶舱」

现在首页是待办/统计卡片；改为目标驱动：

- **第一屏**：公司/部门目标进度、KR 风险、增长漏斗（线索→商机→合同→回款）、交付健康（项目/任务/逾期）、现金/成本。
- **第二屏**：本周增长动作（待跟进线索、待验收任务、待确认 KR、待处理外部合作）。
- **第三屏**：AI 经营摘要（偏差、原因、建议动作）。

保留待办/通知，但作为驾驶舱的一个区块，不再作为首页主体。

### 9.2 三个 360 视图

| 视图 | 聚合内容 |
|---|---|
| 客户 360 | CRM 客户/联系人/商机/合同/订单/回款 + SCRM 会话/标签 + 服务台工单 + 项目交付 + 满意度 |
| 项目 360 | 铁三角 + 任务/里程碑/工时 + 成本（人工/物料/设备/外部） + 外部合作 + 验收 + 风险 |
| 目标 360 | 目标/KR + 任务/验收/证据 + 负责人/容量 + 成本 + 外部资源 + 复盘 |

### 9.3 页签与组件统一

- 13 个 antd `<Tabs>` 全部迁移到 `TabStrip`（或 `PillTabs`，按场景），禁止新引入 antd Tabs 做页签。
- 业务页 `Segmented` 收敛到统一组件。
- 表单/抽屉/空状态/加载/错误统一用 `components/ui`。
- 界面禁裸枚举；中文标签；卡片整卡可点；低频配置进 Drawer。

### 9.4 营销工具重组

现在一页 17+ 个工具视图。按增长环重组为 5 组：

1. **获客**：线索雷达、获客插件、SCRM、活码/欢迎语
2. **转化**：销售管理（SalesBuddy）、线索跟进、报价
3. **内容与分发**：内容创作、多平台分发、SEO/GEO、直播/短视频
4. **客户经营**：企微 SCRM、客户群、朋友圈、SOP
5. **数据与连接**：大数据查询、连接器、问卷、报表

### 9.5 简化用户旅程

- 目标 → 拆解：一个页面完成「目标书 + 对话 + 方案 + 确认」。
- 线索 → 成交：一个客户 360 完成跟进、报价、合同、回款。
- 成交 → 交付：一键建项目，任务/验收自动带出。
- 交付 → 结算：项目 360 直接看成本、外部合作、验收、结算。
- 任何页面：右侧副驾随叫随到，不离开当前上下文。

---

## 十、代码整改（ub-mode）

> 原则：**行为不变的重构与新增功能分开提交**；每步可编译、可测试、可回滚。

### 10.1 `routes.ts` 收敛（最大杠杆）

**现状**：16,186 行、446 个 `createRoute`、443 个空 `request: {}`；契约已定义 method/path/params/query/body/response，但路由又手写一遍。

**做法**

1. 以 `automation-routes.ts` 的 `moduleHandlers(prefix, controller)` 为原型，建统一注册器：
   - 按 `endpoints` 前缀解析 controller 方法名（`Okr_objectiveList` → `okrController.objectiveList`）。
   - 统一注入 `user`、`param`、`query`、`json`，统一 envelope。
   - 特殊路由（上传、SSE、公开回调、无鉴权）保留显式注册表。
2. 按模块拆 `http/routes/*.routes.ts`：crm、okr、project、erp、hrm、oa、kb、data-table、marketing、scrm、admin…
3. 保留 OpenAPI 快照，逐模块对比，确保 operation 数量、路径、schema 不变。

**验收**

- `routes.ts` < 1,000 行；新增端点只改契约 + controller，不改路由。
- `api:docs:check` 快照通过；全量单测通过。

### 10.2 `okr.service.ts` 拆分

拆为：

- `okr-cycle.service.ts`：周期、设置
- `okr-objective.service.ts`：目标、指派、可见性
- `okr-kr.service.ts`：KR、进度、指标
- `okr-plan.service.ts`：计划、日程链接
- `okr-report.service.ts`：汇报、评论
- `okr-ai.service.ts`：目标书、对话、拆解、模拟
- `okr.service.ts`：薄门面，保持 controller 调用不变

**验收**

- 单文件 < 600 行；现有 OKR 测试全绿；行为不变。

> 实际落地：按调用关系收敛为 `okr.base.ts` + `okr-cycle` / `okr-objective` / `okr-execution` / `okr-insight` 四个领域服务，`okr.service.ts` 为 415 行门面（见 Batch 6 交付证据）。

### 10.3 `mechanism.service.ts` 拆分

拆为：

- `mechanism-dispatch.service.ts`：事件匹配
- `mechanism-rule.service.ts`：规则 CRUD/校验
- `mechanism-action.service.ts`：动作执行器（策略表）
- `mechanism-outbox.service.ts`：Webhook 投递/重试

**验收**

- 新增动作只加一个执行器，不改 dispatch 主流程。

> 实际落地：`mechanism.base.ts` + webhook / event / import / export / report / rule / share / oidc / sync 九个服务，`mechanism.service.ts` 为 376 行门面（见 Batch 6 交付证据）。

### 10.4 AI 调用收口

- 架构守卫要求：`ai-gateway.ts`、`geo-llm.client.ts` 之外直接引用 `geoChatMulti` 的文件必须出现 `resolveTarget` / `assertAiAllowed` / `aiGuardDeny`，否则检查失败。
- `kbChatMulti` 静默链路已接入 `aiGuardDeny`（被拒回落规则式）；后续迁移到 `ai-gateway` 能力注册表。
- 网关调用已把 `purpose` 传给上游；`scope` 作为必填参数尚未强制，保留为后续收口项。

**验收**

- 全仓 `geoChatMulti` 直接引用点 = 0（除网关/geo 适配层）。
- 用量页能看到每个模块的调用量/积分。

### 10.5 类型与契约纪律

- 删除业务层的 `as never`、`Row` 兜底；用契约 schema 推导类型。
- 新增字段先改 contracts + Prisma + 迁移，再改服务/前端。
- OpenAPI、MCP 工具、前端 SDK 同源生成。

### 10.6 幂等与并发

- 事件：`idempotencyKey` 唯一。
- 外部动作：发布需求/建采购单/发通知带幂等键。
- 并发：KR 更新用版本号；项目成本汇总用事务/串行；任务同步用 `(source, sourceId, version)`。

### 10.7 测试与质量门禁

| 门禁 | 目标 |
|---|---|
| 后端单测 | 新增/改动服务行为测试；OKR 拆解、外部协作、事件动作必须有 |
| 契约测试 | endpoints 与 controller 方法一一对应；OpenAPI 快照 |
| 前端组件测试 | 至少覆盖目标书、拆解确认、客户 360、项目 360 |
| 架构检查 | 模块边界、AI 调用、租户 scope |
| CRAP | 新增/改动函数 < 10 |
| 重复率 | 新增代码重复 < 0.8（dryer） |
| 变异测试 | 核心域（OKR/项目/外部协作）达到约定阈值 |

### 10.8 小步提交与工作树纪律

- 每批一个主题，提交信息写「为什么」。
- 重构与功能分开；不混入无关格式化。
- 开工前备份；结束清理临时文件；工作树保持干净。

---

## 十一、实施顺序（一次交付，内部排序）

> 对外只报「一期」，内部按批推进；每批结束都保持全量校验绿。

### Batch 0：基线与备份

- 备份工作区（zip + diff + 未跟踪清单）并校验。
- 跑基线：前后端 typecheck、测试、架构检查、OpenAPI 快照、Prisma validate。
- 记录当前指标（文件行数、测试数、operation 数）。

### Batch 1：统一抽象

- `TenantScopeService` + `PrincipalRef`。
- `BizParty` + `PjProjectMember/Task` 扩展。
- `EventLog` + `EventBus.emit` + 事件契约第一批。
- `AiCapability` 注册表骨架。
- CRM/OKR `orgType/orgUserId` 迁移与回填。

**验收**：组织切换后 CRM/OKR 数据归属正确；事件可落库；现有测试全绿。

### Batch 2：OKR 2.0（已完成 2026-11-08）

- 目标书、对话、拆解、模拟、确认落库。
- `OkrTaskLink`、任务验收/考核字段、个人 OKR。
- OKR AI 服务与规则兜底。
- 前端「目标书」「AI 拆解」页签。

**验收**：真实跑通「输入目标+铁三角 → 多轮对话 → 方案 → 确认 → 任务/个人 OKR」；缺组织信息时有引导；无模型时规则方案可用。

**交付证据**：14 个 `Okr_*` operation 已进契约与 OpenAPI 快照；后端 `tsc`、前端 `typecheck`、架构检查（445 路由）、`prisma validate`、OpenAPI 快照一致、规则单测 10 项全绿。

### Batch 3：项目成本与外部协作（已完成 2026-11-08）

- `PjCostRate`、`PjCostItem`、项目成本汇总。
- `BizParty` 准入/费率/评价；`PjEngagement`。
- ERP 供应商/采购单关联；任务分派外部方。
- 项目 360 成本与外部合作视图。

**验收**：项目能算人工/物料/设备/外部服务成本；外部方全流程可追溯。

**交付证据**：11 个 `Pj_*` operation 已进契约与 OpenAPI 快照；后端 `tsc`、前端 `typecheck`、架构检查、`prisma validate`、OpenAPI 快照一致；任务页支持外部方承接与验收/权重，项目页新增「成本」「外部协作」页签，外部合作验收自动生成外部成本项。

### Batch 4：增长联动与自动化（已完成 2026-11-08）

- CRM 订单→项目；任务↔需求发布；SCRM↔CRM 双向；服务台→CRM。
- 事件目录补齐；规则动作库扩展；自动配方。
- OKR 事件回填 KR；增长驾驶舱数据接口。

**验收**：跑通「线索→成交→项目→交付→回款→KR」与「任务→外发需求→响应→合作→验收」。

**交付证据**

- **事件目录**（`packages/contracts/src/mechanisms.ts`）：在原有 `task.*`、`project.*`、`order.paid`、`receivable.overdue` 等基础上补齐 `crm.lead.created`、`crm.lead.converted`、`crm.order.created`、`crm.order.approved`、`crm.payment.received`、`crm.payment.removed`、`demand.published`、`demand.replied`、`demand.accepted`、`demand.closed`、`engagement.created`、`task.reopened`、`project.created`；每项均带中文标签，Webhook 订阅与规则条件可直接选中。
- **销售→交付**：`GrowthLinkageService`（`backend/src/growth/growth-linkage.service.ts`）监听 `crm.order.approved`，按「同组织 + 同订单」幂等自动立项（`source='CRM_ORDER'`、`sourceRef=订单 id`），项目预算取订单金额、负责人入项目成员，并把 `projectId` 回写订单；CRM 订单详情显示「已自动立项 #id / 审批通过后自动立项」。
- **任务→外发需求→合作→验收**：新增 `PjTaskDemand`、`PjDemandResponse` 模型与迁移 `0034_task_demand`；`ProjectDemandService` 承载「保存/发布需求 → 外部方登记响应 → 管理员采纳 → 生成外部合作 → 任务改派合作方」全链路。采纳时在同一事务内把合作单置为履约中、其余响应置未采纳、需求关闭、任务承接方式改为 `PARTY`，并复用已有验收/成本机制。响应方未在目录时按名称自动创建 `BizParty(kind=VENDOR, source=DEMAND)`。
- **SCRM↔CRM**：CRM 线索转客户时回写 `scrmContactId`；获客档案/触达按 `crmLeadId` 反查 CRM 线索并同步阶段，形成双向可追溯。
- **服务台→CRM**：会话面板新增「转 CRM 线索」（`ServiceDesk_convertToCrm`），转换后标题显示 `CRM 线索 #id`，已转换则不渲染按钮。
- **OKR 回填**：`OkrTaskLinkageService` 监听 `task.completed / task.reopened`，按任务考核权重把完成度回写 KR，并写入 `OkrProgressLog(source=AUTO)`；无权重时按 KR 差额均摊，方向反转与边界钳制均已处理。
- **增长驾驶舱接口**：`Growth_cockpit` 汇总当期 OKR / 销售 / 交付 / 回款 / 获客 / 客服快照，供 Batch 5 首页消费。
- **校验**：contracts 构建、`prisma validate` / `generate`、后端 `tsc --noEmit`、前端 `typecheck`、架构边界检查（445 路由）、OpenAPI 快照一致、后端单测 84 套件 / 727 用例全绿。

### Batch 5：UI / IA（已完成 2026-11-08）

- **首页增长驾驶舱**：新增 `GrowthCockpitPanel`（`frontend/src/app/_components/growth-cockpit.tsx`），企业身份进入首页即可看到 5 张卡片（目标进度 / 回款 / 交付中项目 / 获客转化 / 客服转线索）、增长漏斗、回款趋势与风险提醒；卡片整卡可点并跳到对应模块，接口失败时只降级为可重试提示，不影响首页其它内容。
- **页签收口 `PanelTabs`**：在 `@/components/ui/panel` 新增 `PanelTabs`（底层统一用 `TabStrip` 折行胶囊），业务页 antd `<Tabs>` 全部迁移：`crm-ops`、`crm-parties`、`admin`（功能开关 / 积分 / 设置 / Skill 生成）、`bi-panels`、`content`（跨境 / 国内商品页优化）、`points`、`tax`（开票审核用 `TabStrip` 过滤、报表用 `PanelTabs`）。原默认页签改为受控状态，抽屉切换实体时重置。登录页的「账号登录 / 注册」保留 antd Tabs：属于未登录认证模式切换，带禁用态与居中版式，不计入业务页。
- **营销工具按业务链路重组**：按「获客与转化 / 内容与搜索增长 / 数据与线索挖掘 / 触达与客户运营」四组呈现，卡片整卡可点、行为不变，只解决入口难找。
- **项目 360**：项目详情抽屉新增「交付」「成本」页签——交付页签显示任务总数 / 完成 / 进行中 / 逾期、完成度与任务验收权重；成本页签显示合同预算、已发生成本、预算使用率、外部合作金额与结算单数、已记工时，并按成本类型拆分；维护动作仍留在项目页「成本」页签，抽屉只做汇总，避免两处重复入口。
- **目标 360**：每个目标新增「详情」抽屉，含目标进度 / 关键结果 / 关联任务 / 进度记录四个页签；关联任务显示考核权重、回填目标值与验收项数，进度记录标注来源（手工 / 自动 / 计划 / 系统）与前后值，任务完成后 KR 回填的痕迹可直接看到。
- **客户 360 跨模块**：客户详情新增「企微」页签，按 `crmCustomerId` 反查企微联系人（契约新增 `crmCustomerId` 过滤，后端 `scrm-contact.service` 按组织键过滤），显示状态、归属员工、标签与最后互动；未接入企微时只在该页签内提示，不影响其余 360 内容。
- **数字分身与副驾入口核对**：数字分身配置页（`/agent` →「数字分身」）包含人设、知识挂载、渠道与记忆；页面感知副驾已由 `pro-layout` 全站挂载，入口可见，本批次无缺口。
- **校验**：contracts 构建、后端 `tsc --noEmit`、前端 `typecheck`、架构边界检查（445 路由）、OpenAPI 快照生成与一致检查、后端单测 84 套件 / 727 用例全绿。运行态 UI 未实测：本机前后端服务未启动，未做浏览器端点击验证，以上为静态与契约层验证。

### Batch 6：ub-mode 收口（已完成 2026-11-08）

- `routes.ts` 拆分；OKR/mechanism/project 服务拆分。
- AI 调用守卫；类型纪律；幂等。
- 前端测试；质量门禁；全量校验。
- 文档与 README 同步。

**验收**：文件行数目标达成；全量校验绿；文档更新完成。

**交付证据**

- **路由组合根**：`backend/src/http/routes.ts` 由 16,186 行降到 183 行，只保留注册顺序与个人用户办理动作门控；27 个业务域路由迁入 `backend/src/http/route-groups/*.ts`（admin / invoice / tax / services / overseas / flex / supply / contracts / health / geo / aiworkin / connections / asset / capability / external / identity / ip / think-tank / legal / logistics / market-board / marketing / open-api / oss-settings / qxy / smart-service / apps）。架构守卫改为同时扫描组合根与分组文件，445 条业务路由全部覆盖；OpenAPI 快照 1,491 条路径拆分前后逐条对比无差异。
- **服务拆分**（门面保留原有 controller 调用面，方法体逐字保留，基类私有助手改 `protected`）：
  - OKR：`okr.service.ts` 415 行门面；`okr.base.ts` + cycle / objective / execution / insight 四个领域服务（`okr.types.ts` 收敛行类型与状态集合）。
  - 机制：`mechanism.service.ts` 376 行门面；`mechanism.base.ts` + webhook / event / import / export / report / rule / share / oidc / sync 九个服务，`mechanism.shared.ts` 收敛模块助手。
  - 项目：`project.service.ts` 207 行门面；`project.base.ts` + core / planning / task / insight / time / platform 六个服务；成本与需求仍由 `project-cost.service.ts`、`project-demand.service.ts` 承担。
- **AI 调用守卫**：新增 `isAiGateError` 区分「闸门拒绝」与「通道未配置」；`kb-llm` 静默链路在取模型前走 `aiGuardDeny`，被拒即回落规则式；技能生成 / 技能审查的渠道解析不再把「主开关关闭 / 限流」吞掉后回落 AIPDD Key。架构守卫新增规则：除网关与 GEO 适配层外，直接调用 `geoChatMulti` 的文件必须出现 `resolveTarget` / `assertAiAllowed` / `aiGuardDeny`，否则检查失败。
- **幂等**：事件 Outbox `idempotencyKey` 唯一（默认 `event + source + sourceId + version`）；CRM 订单→项目按「同组织 + 同订单」幂等；需求发布复用 AIworkin 幂等键；SCRM→CRM 提升按企微联系人去重；任务同步沿用 `(source, sourceId, version)`。
- **前端组件测试**：新增 Vitest + jsdom + Testing Library（`pnpm --filter aiworkin-enterprise-web test`），覆盖目标书、AI 拆解确认、客户 360、项目 360 四个关键页面；4 个用例全绿。
- **全量校验**：contracts 构建、Prisma validate / generate、后端 `tsc --noEmit`、后端单测 84 套件 / 727 用例（另 1 套件 15 例按环境跳过）、前端 `typecheck` 与组件测试、架构边界检查（445 路由，含 AI 守卫）、OpenAPI 快照一致检查全部通过。
- **文档与 README**：README「构建、测试与 CI」更新为 84 套件 / 727 例，并新增前端组件测试命令；目录结构补充 `routes.ts` 组合根 / `route-groups` 与 OKR / 机制 / 项目服务拆分说明。
- **未纳入本期**：业务层存量 `as never` / `Record<string, unknown>` 兜底 277 处未批量清理（契约推导改造面大且与本期联动目标无直接冲突，保留为后续类型专项）；CRAP / 重复率 / 变异测试门禁尚无工具链，本期以架构守卫、OpenAPI 快照、前后端测试与 typecheck 作为硬门禁。

---

## 十二、验收指标（可量化）

### 12.1 业务验收

- 一条真实业务目标能完成：目标书 → 对话 → 方案 → 确认 → 任务 → 个人 OKR → KR 回填。
- 一个外部供应商/OPC/个人能完成：准入 → 合作 → 任务 → 验收 → 评价。
- 一条线索能追到：来源 → CRM → 合同/订单 → 项目 → 回款 → KR。
- 一个项目能算清：预算、人工、物料、设备、外部服务、实际成本、毛利。
- 一个客户 360 能看到：CRM + SCRM + 服务台 + 项目 + 回款。

### 12.2 技术验收

| 指标 | 目标 |
|---|---|
| `routes.ts` | < 1,000 行 |
| `okr.service.ts` | < 600 行 |
| `mechanism.service.ts` | < 800 行 |
| `project.service.ts` | < 600 行 |
| 直接 `geoChatMulti` 引用 | 无闸门覆盖的引用 = 0（架构检查强制） |
| antd `<Tabs>` 业务页 | 0 |
| 前后端 typecheck | 全绿 |
| 后端测试 | 全绿，新增覆盖核心链路 |
| 前端组件测试 | 覆盖 4 个关键页面 |
| `check-architecture` | 通过 |
| `api:docs:check` | 快照一致 |
| Prisma validate / migrate | 通过 |
| CRAP / 重复率 | 达到门禁 |

### 12.3 体验验收

- 目标拆解不超过 5 轮澄清；每轮都有「为什么问/可跳过」。
- 关键动作有确认闸门；确认前可预览影响。
- 缺信息有明确引导，不出现「填了没用」的字段。
- 所有 AI 结果标注来源/模式（LLM/规则），可复制/导出/转任务。

---

## 十三、风险与边界

| 风险 | 应对 |
|---|---|
| 租户键迁移影响面大 | 先回填 + 双读校验，再切写；保留兼容列；分批灰度；每批有回滚脚本 |
| AI 拆解幻觉/不可执行 | 结构化 schema、ID 白名单、金额/工时只取用户输入或费率表、人工确认闸门、假设清单 |
| 目标拆解过度设计 | 首版只做「目标书 + 对话 + 方案 + 确认 + 任务/个人 OKR」，模拟先做规则校验，不追求完美优化 |
| 外部合作合规 | 准入清单、合同/保密、数据隔离、评价与黑名单；外部方默认最小可见 |
| 自动化误触发 | 外部动作必须确认；幂等；执行日志；限流；可暂停规则 |
| 重构回归 | 行为不变、快照测试、按模块切换、每步可回滚 |
| 成本上升 | 统一计量、预算帽、缓存、夜间批任务、规则兜底 |
| 功能膨胀 | 每个新增必须进入增长飞轮或降低用户操作；否则不做或降级为配置 |

**明确不做**

- 不新建第 N 套 LLM 客户端/向量库/外部主体表。
- 不引入需要服务器安装的重型组件（向量库、渲染服务、转码服务）。
- 不做「AI 自动替人决策」；所有对外/写操作保留人工确认。
- 不为了联动而复制数据；用 `sourceType/sourceId` 与读模型聚合。
- 不在本期重写全部前端；只统一页签/组件与关键页面。

---

## 十四、待拍板决策点（编号回复即可）

1. **租户键统一**：是否同意把 CRM/OKR/服务台补 `(orgType, orgUserId)`，让组织切换覆盖这些模块？（推荐：是）
2. **外部主体**：是否同意新增统一 `BizParty`，ERP 供应商/CRM 客户/项目外部方通过 `partyId` 关联，而不是继续各建一套？（推荐：是）
3. **OKR 落库闸门**：AI 只出候选方案，必须人工确认后才创建目标/KR/任务/个人 OKR——是否按此执行？（推荐：是）
4. **任务考核**：任务验收/质量档位/权重写进 `PjTask`，绩效证据回写 `HrmReview`，不另建平行考核表——是否同意？（推荐：是）
5. **外部动作确认**：发需求、发营销、建采购单、通知外部方等对外动作默认需要人工确认；内部建任务/更新 KR 自动执行——是否同意？（推荐：是）
6. **首页改造**：把现有首页升级为「增长驾驶舱」，待办/通知降为区块，而不是新增一个平行首页——是否同意？（推荐：是）
7. **营销工具重组**：把 17+ 个工具视图按增长环重组为 5 组，保留现有工具能力但改变入口结构——是否同意？（推荐：是）
8. **routes.ts 收敛**：本期做「契约驱动注册器 + 按模块拆路由」，以 OpenAPI 快照保证行为不变——是否纳入本期？（推荐：是）
9. **数字分身范围**：按既有 P1-D 六项全做，并增加销售/交付/招聘/客服/经营五个场景模板——是否同意？（推荐：是）
10. **OPC 模式**：是否需要在首期就支持「一人多角色 + 外部资源池 + 按项目结算」，还是先支持外部个人/供应商？（推荐：首期支持外部个人 + 供应商，OPC 资源池放同一期后半段）

---

## 附录 A：审计证据索引

| 主题 | 证据 |
|---|---|
| OKR 规则模板 | [okr.service.ts:183](file:///E:/wwwroot/oem-enterprise/backend/src/okr/okr.service.ts#L183)、[:894](file:///E:/wwwroot/oem-enterprise/backend/src/okr/okr.service.ts#L894)、[:953](file:///E:/wwwroot/oem-enterprise/backend/src/okr/okr.service.ts#L953) |
| OKR 契约 | [okr.ts:506](file:///E:/wwwroot/oem-enterprise/packages/contracts/src/okr.ts#L506)、[:525](file:///E:/wwwroot/oem-enterprise/packages/contracts/src/okr.ts#L525)、[:541](file:///E:/wwwroot/oem-enterprise/packages/contracts/src/okr.ts#L541) |
| OKR 指标源 | [okr.metrics.service.ts:64](file:///E:/wwwroot/oem-enterprise/backend/src/okr/okr.metrics.service.ts#L64) |
| 项目预算/里程碑/任务 | [schema.prisma:7782](file:///E:/wwwroot/oem-enterprise/backend/prisma/schema.prisma#L7782)、[:7839](file:///E:/wwwroot/oem-enterprise/backend/prisma/schema.prisma#L7839)、[:7865](file:///E:/wwwroot/oem-enterprise/backend/prisma/schema.prisma#L7865) |
| 项目成员主体类型 | [schema.prisma:7794](file:///E:/wwwroot/oem-enterprise/backend/prisma/schema.prisma#L7794)、[project.service.ts:339](file:///E:/wwwroot/oem-enterprise/backend/src/project/project.service.ts#L339) |
| WBS / 风险 | [project.service.ts:871](file:///E:/wwwroot/oem-enterprise/backend/src/project/project.service.ts#L871)、[:955](file:///E:/wwwroot/oem-enterprise/backend/src/project/project.service.ts#L955) |
| 事件与规则动作 | [mechanism.service.ts:1258](file:///E:/wwwroot/oem-enterprise/backend/src/mechanisms/mechanism.service.ts#L1258)、[:1311](file:///E:/wwwroot/oem-enterprise/backend/src/mechanisms/mechanism.service.ts#L1311) |
| 组织/岗位 | [schema.prisma:3329](file:///E:/wwwroot/oem-enterprise/backend/prisma/schema.prisma#L3329)、[:3360](file:///E:/wwwroot/oem-enterprise/backend/prisma/schema.prisma#L3360)、[:3376](file:///E:/wwwroot/oem-enterprise/backend/prisma/schema.prisma#L3376) |
| 租户口径分裂 | [schema.prisma:3946](file:///E:/wwwroot/oem-enterprise/backend/prisma/schema.prisma#L3946)、[:5097](file:///E:/wwwroot/oem-enterprise/backend/prisma/schema.prisma#L5097) |
| 数字分身 | [schema.prisma:2743](file:///E:/wwwroot/oem-enterprise/backend/prisma/schema.prisma#L2743)、[agent.service.ts:341](file:///E:/wwwroot/oem-enterprise/backend/src/content/agent.service.ts#L341) |
| 知识库消费者 | [schema.prisma:7057](file:///E:/wwwroot/oem-enterprise/backend/prisma/schema.prisma#L7057) |
| SCRM→CRM | [scrm-contact.service.ts:491](file:///E:/wwwroot/oem-enterprise/backend/src/wecom-scrm/scrm-contact.service.ts#L491) |
| 需求发布 | [demand-sync.service.ts:40](file:///E:/wwwroot/oem-enterprise/backend/src/aiworkin/demand-sync.service.ts#L40) |
| 路由样板 | [routes.ts](file:///E:/wwwroot/oem-enterprise/backend/src/http/routes.ts)、[automation-routes.ts](file:///E:/wwwroot/oem-enterprise/backend/src/http/automation-routes.ts) |
| 统一 UI | [panel.tsx](file:///E:/wwwroot/oem-enterprise/frontend/src/components/ui/panel.tsx) |
| AI 底座现状 | [系统AI底座优化升级方案.md](file:///E:/wwwroot/oem-enterprise/docs/系统AI底座优化升级方案.md) |

---

## 附录 B：一句话总结

**先把「组织—目标—任务—外部资源—事件」这五件事统一，再用 AI 把目标拆解、把增长链路串起来，最后用 ub-mode 把承载它们的代码收拾干净；功能不追求多，追求每一环都能接到下一环。**
