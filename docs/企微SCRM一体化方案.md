# 企微 SCRM 一体化方案（借鉴 Mochat）

> 版本：v0.1（方案，待评估）
> 日期：2026-11-07
> 参考包：Mochat（`mochat-src/mochat-master`，Hyperf 2.2 + Swoole 后端，Ant Design Vue / Vant 多端前端）
> 要求：只借鉴业务机制与功能边界，不抄代码、不引入 PHP/Hyperf 运行时；全部基于本系统「契约优先 / 组织隔离 / 统一 AI 网关 / 积分计费 / 平台机制底座」重写。
> 结论先行：**不新建第二套 IM、浏览器插件、账号和客户库**。新增一个 `wecom_scrm` 模块，直连企业微信官方「客户联系 / 客户群 / 朋友圈 / 通讯录」能力；客户以企微为源、本地镜像，意向客户再提升 CRM；员工侧是企微工作台里的 H5 侧边栏，不是第二个 Chrome 插件；AI 能力复用统一网关，消息与质检复用服务台和获客质检，分配与公海复用 CRM。

---

## 一、参考对象分析：Mochat 是什么，值得借鉴什么

### 1.1 它的真实形态

Mochat 是一套「企业微信 SCRM 运营后台 + 员工侧边栏 + 客户侧活动页」的三端产品：

| 端 | 技术 | 面向谁 | 作用 |
|---|---|---|---|
| `dashboard` | Ant Design Vue（PC） | 企业管理员 / 运营 | 客户、客户群、活码、欢迎语、群发、分配、标签、统计、权限 |
| `sidebar` | Vant（H5） | 一线员工 | 在企微聊天侧边栏看客户画像、发素材、执行 SOP、做群质检 |
| `operation` | H5 | 客户 | 抽奖、打卡、裂变、门店活码等活动落地页 |
| `workbench` | 空目录 | — | 未实现，不构成参考 |

后端实际是 **Hyperf 2.2 + Swoole**（`api-server/composer.json`），通过 EasyWeChat 5 接企业微信；接口按注解分组，没有传统 Laravel routes。多租户由 `mc_tenant` + `user.tenant_id` 承担，权限到按钮级。

### 1.2 值得借鉴的七个机制

| # | 机制 | Mochat 落点 | 为什么值得学 |
|---|---|---|---|
| 1 | 客户双主键 | `work_contact`（corp + wx_external_userid 去重）、`work_contact_employee`（客户-员工多对多） | 一个外部客户可被多名员工添加，客户主档与跟进关系必须分开 |
| 2 | 标签全量对齐 | `work_contact_tag/group` + `SynContactTagLogic` | 企微是标签源，本地做镜像增删，不反向改企微 |
| 3 | 活码 + 欢迎语 + 自动打标 | `mc_channel_code`、`greeting`、`channel-code` 插件 | 扫码进来即完成「分流员工 + 打标签 + 发欢迎语」三件事 |
| 4 | 客户群运营 | `work_room`、自动拉群、标签建群、入群欢迎语 | 群是企微私域的主阵地；群满换群、按标签邀约是刚需 |
| 5 | 群发任务与结果回写 | `contact_message_batch_send` / `room_message_batch_send` + employee + result | 群发不是「点一下」，而是任务、分片、失败原因、送达统计 |
| 6 | 离职/在职继承 | `work_transfer_log`、`getUnassigned`、客户与群分别分配 | 员工离职客户不能丢，客户和群要一起转 |
| 7 | 员工侧边栏 | `sidebar`：客户画像、素材、SOP、群日历/质检 | 运营配置最终要落到一线员工的聊天现场 |

### 1.3 Mochat 没有开源、不能照搬的部分

- **会话存档**：只有 `wework-finance-sdk` 声明与 `work_message` 表、前端页面；后端实现缺失，官方能力依赖原生 SDK。
- **敏感词监控**：只有前端 API 与零散组件，管理页未开源。
- **SOP 后台**：`dashboard/src/views/contactSop` 只有组件，未进路由，属付费/未实现。
- **雷达、群裂变、群打卡、门店活码、批量加好友**：多为活动页或半成品，不是完整后端能力。
- **群发频控**：Mochat 依赖企微返回，无本地限频；本系统必须补本地冷却与每日上限，避免把平台风控当成唯一闸门。

---

## 二、目标、边界与入口

### 2.1 目标

把企微私域运营做成一条闭环：

**引流（活码/欢迎语/自动打标）→ 客户资产（客户/群/标签/画像）→ 触达（客户群发/群群发/朋友圈）→ 分配（在职转接/离职继承/公海）→ 运营（SOP/素材/侧边栏）→ 洞察（统计/敏感词/质检）。**

### 2.2 明确不做

1. **不做第二套 IM**：消息通道仍走现有服务台与企业微信应用/客服；本模块只补「客户联系」侧的资产与触达。
2. **不做第二个浏览器插件**：员工侧边栏是企微工作台 H5 页面（`/embed/wecom-scrm`），复用 SSO/一次性票据；采集与私信仍归 AIPDD Enterprise 插件。
3. **不把企微客户直接灌进 CRM**：企微客户先落本地 `ScrmContact` 镜像；需要销售流程时再「提升为 CRM 线索/客户」，与获客模块同一口径。
4. **不在首期安装原生会话存档 SDK**：会话内容先来自服务台企微渠道与企点 CA；官方会话存档作为独立外部依赖单独立项，不混进本期。
5. **不复制企点 SCRM 的代理接口**：企点作为第三方通道保留；新模块直连企业微信官方 API，两者凭据与任务分开，同一组织同一时间只启用一种客户同步源。

### 2.3 入口与命名

- 营销工具新增卡片：**企业微信 SCRM**（`wecom_scrm`），与「AI 获客」「腾讯企点·企微运营」并列；功能目录关闭时不渲染卡片。
- 员工侧边栏：`/embed/wecom-scrm`（响应式 H5），在企微工作台「应用」里配置为自建应用首页/侧边栏。
- 不新建顶栏菜单，不把低频能力拆成独立页面；所有能力收在卡片内的页签里。

---

## 三、与本系统现状的差距

| 能力 | Mochat | 本系统现状 | 本期决策 |
|---|---|---|---|
| 企微通讯录/成员/部门 | ✅ 双向同步 | ✅ `im` 连接器同步飞书/企微通讯录 | 复用 `ImConnector`，不重建组织 |
| 客户主档/客户-员工关系 | ✅ | ❌ 仅有 CRM 客户，无企微外部联系人镜像 | 新建 `ScrmContact` + `ScrmContactStaff` |
| 客户标签 | ✅ 标签组/标签/全量对齐 | ⚠️ 仅企点 CDP 标签代理 | 新建 `ScrmTagGroup/ScrmTag`，与企点标签分开 |
| 渠道活码 | ✅ 员工轮换/上限/欢迎语/打标 | ⚠️ 企点 SCRM 活码 + 通用 `livecode` | 新建企微原生 `ScrmChannelCode`，复用选人/统计壳 |
| 欢迎语 | ✅ 好友/入群欢迎语 | ⚠️ 企点 `scrmWelcome` 代理 | 本地配置 + 调用企微 `send_welcome_msg` |
| 客户群/群成员 | ✅ | ❌ | 新建 `ScrmChat` + `ScrmChatMember` |
| 自动拉群/标签建群 | ✅ | ❌ | 新建群活码与邀约任务；邀约走群发，客户点击入群 |
| 客户群发/群群发 | ✅ 分片/结果 | ⚠️ 企点群发任务代理 | 新建 `ScrmMassTask`，直连企微群发接口 |
| 朋友圈任务 | ❌（Mochat 未开源） | ❌ | 新建 `ScrmMomentTask`，走企微朋友圈接口 |
| 离职继承/在职转接 | ✅ | ❌ | 新建 `ScrmTransfer`，直连企微继承接口 |
| 客户公海/分配 | ❌（只有未分配列表） | ✅ CRM 公海/领取/分配 | 直接复用 CRM 公海，不另造 |
| SOP/任务 | ⚠️ 仅前端半成品 | ⚠️ CRM 跟进计划 + 获客剧本 | 新建规则触发 + 任务分配 + 侧边栏执行 |
| 素材库/侧边栏 | ✅ | ⚠️ 数字资产/内容资产，无企微侧边栏 | 复用数字资产，新建 H5 侧边栏 |
| 敏感词 | ⚠️ 未开源 | ❌ 仅获客质检内置词表 | 新建可配置词库，进出站双向生效 |
| 会话存档 | ⚠️ 依赖原生 SDK | ❌ 仅 retentionDays | 首期用服务台/企点 CA；官方存档单独立项 |
| 质检 | ✅ 群质检/回复超时 | ✅ 获客五维质检（LLM+规则） | 复用 `qc.service`，扩展企微会话来源 |
| 统计 | ✅ 客户/成员/群 | ⚠️ 企点统计代理 | 新建日快照 + 看板，口径与 CRM/服务台对齐 |

---

## 四、总体架构

```
企业微信（客户联系 / 客户群 / 朋友圈 / 通讯录）
        │  官方 HTTPS API + 回调（签名/解密）
        ▼
backend/src/wecom-scrm/
  ├─ scrm.client.ts        企微官方客户端：token、限流、错误翻译
  ├─ scrm-callback.ts      回调验签/解密/重放保护 → 事件总线
  ├─ scrm-sync.service.ts  客户/员工/标签/群/流失 全量+增量同步
  ├─ scrm-contact.service.ts 客户 360、标签、资料卡、提升 CRM
  ├─ scrm-chat.service.ts  客户群、群成员、自动拉群、群统计
  ├─ scrm-code.service.ts  活码、欢迎语、自动打标
  ├─ scrm-mass.service.ts  客户群发/群群发/朋友圈任务与回执
  ├─ scrm-transfer.service.ts 在职转接/离职继承/未分配
  ├─ scrm-sop.service.ts   SOP 规则、任务、提醒、侧边栏待办
  ├─ scrm-compliance.ts    敏感词、出站拦截、质检接入
  ├─ scrm-stats.service.ts 日快照与看板
  ├─ scrm.scheduler.ts     同步、任务刷新、日统计
  └─ scrm.controller.ts
packages/contracts/src/wecom-scrm.ts
frontend/src/app/marketing-tools/_components/scrm-*.tsx
frontend/src/app/embed/wecom-scrm/  员工侧边栏 H5
```

复用关系：

- **组织与成员**：`HrmOrg`、`ImConnector`、`hrm.scope.ts`；
- **消息**：`ServiceDeskService`（企微应用/微信客服）与企点 CA（会话分析）；
- **CRM**：`CrmLead/CrmCustomer/CrmLeadPool/CrmCustomerPool`、标签体系之外的业务阶段；
- **机制**：`AcquisitionScheduler` 同款进程内定时器、`ExportJob`、`PublicShare`、`Notification`、`publishReview`；
- **AI**：`ai-gateway`（统一取模型/计量）、`qc.service`（五维质检）、`follow-up`（跟进时间映射与账本）。

---

## 五、功能设计

### 5.1 企微接入与同步

**接入配置**（设置页）：

- `corpId`、通讯录 Secret、客户联系 Secret、应用 AgentId、回调 Token / EncodingAESKey；
- 会话存档 Secret + RSA 私钥（首期只保存，不启用）；
- 凭据加密保存，任何接口不回显；测试连接只调只读探针；
- 回调地址：`/enterprise/wecom-scrm/callback`（验签后处理，不走登录态）。

**同步策略**：

- 通讯录：复用 `im` 连接器的成员/部门同步；本模块只读成员映射，不重复拉人。
- 客户：`externalcontact/list` 分页拉全量，`get` 拿详情（`follow_user`、标签、备注、来源、添加时间），按 `corpId + external_userid` 幂等 upsert；客户-员工关系写 `ScrmContactStaff`。
- 标签：标签组/标签全量对齐，删除用软删；本地不允许直接改企微标签，只能发起变更后回读。
- 客户群：`groupchat/list` + `groupchat/get` 拉群与成员；群主离职后自动进入继承流程。
- 流失：回调 `change_external_contact` 的 del/follow_user_del 事件 + 定时对账，标记 `LOST`，不物理删除。
- 频率：全量同步错峰（凌晨低谷），增量靠回调；单次分页上限与 20 QPS 限流由客户端统一处理。

### 5.2 客户资产

**客户列表**：关键词（昵称/备注/手机号/编号）、添加时间、来源活码、标签、所属员工、所在群、状态（正常/流失）；列展示客户信息、所属员工、来源、标签、添加时间、最近互动。

**客户详情 Drawer**：

- 基本资料：昵称、头像、性别、地区、备注、描述、编号、添加时间、来源活码/员工；
- 资料卡：自定义字段（文本/单选/多选/日期/手机/邮箱/数字/生日/图片），字段定义组织级可配；
- 标签：展示企微标签 + 本地自动标签，支持批量打标（回写企微）；
- 互动轨迹：添加、入群、群发、回复、跟进、分配、流失，统一时间线；
- 客户群：所在群列表与群主；
- 操作：同步、提升 CRM、分配员工、加入 SOP、发消息（跳服务台会话）。

**客户去重**：`corpId + externalUserId` 唯一；同客户被多名员工添加时保留一行主档，员工关系多行。合并只做「补全字段」，不合并聊天记录。

**流失客户**：独立页签，展示流失时间、原因（客户删除/员工删除）、原所属员工；支持「重新添加」任务（通过活码/群发邀请），不伪造已恢复。

### 5.3 标签与自动打标

- 标签组/标签两级，颜色、排序、使用人数；
- 手动打标：单客户、批量、按筛选结果批量；
- 自动打标规则：
  - 关键词：入站/出站消息命中关键词 → 打标/移除；
  - 行为：扫码来源、加入群、点击链接、完成表单 → 打标；
  - 分时段：在指定时间段内互动 → 打标；
- 规则命中留痕（规则、客户、时间、命中词），可回滚；
- 与企微标签同步冲突时以企微为准，本地记录待同步队列。

### 5.4 渠道活码与欢迎语

**活码**：

- 基础：名称、分组、扫码自动加好友、欢迎语、标签、备注前缀；
- 引流成员：轮流/固定时段、每人每日上限、备用员工、超限自动切换；
- 客户标签：扫码即打标；来源记录到客户来源字段；
- 统计：扫码数、添加数、添加率、按日新增/流失/净增；
- 实现：调用企微 `add_contact_way` 生成活码，本地保存 `config_id` 与员工轮换策略；扫码事件回调后补记来源。

**欢迎语**：

- 好友欢迎语：全员默认 + 指定员工覆盖；内容支持文本/图片/图文/小程序，可引用素材库；
- 入群欢迎语：群模板，调用企微入群欢迎语接口；
- 发送失败进入重试队列，超过次数标记失败并提示；不承诺「必达」。

### 5.5 客户群运营

- 群列表：群名、群主、分组、状态、成员数、退群数、创建时间；筛选群主/分组/状态；
- 群详情：成员列表、入退群趋势、群公告、群主变更；
- 群分组：本地分组，支持批量移动；
- 自动拉群：群活码绑定多个群，按群人数上限自动换群；客户扫码进群，群满切换下一个；
- 标签建群：选标签筛客户 → 生成群活码 → 通过企微群发发送入群邀请 → 统计邀约/入群/未触达；
- 群欢迎语：入群自动发送，支持素材；
- 群质检：回复超时、长时间未回复、群活跃度，生成提醒给群主/管理员。

### 5.6 触达：客户群发、群群发、朋友圈

统一任务模型 `ScrmMassTask`：

- 类型：`CONTACT`（客户群发）、`CHAT`（客户群群发）、`MOMENT`（朋友圈）；
- 目标：按标签/来源/所属员工/群/添加时间筛选，或导入名单；
- 内容：文本 + 附件（图片/链接/小程序/文件），按企微限制校验；
- 审核：内容安全（复用 `publishReview`）+ 人工确认 + 预估触达人数；
- 执行：调用企微 `add_msg_template` / 群发接口 / 朋友圈任务接口，按 1 万人分片提交；
- 频控：本地每日/每周上限、同客户冷却天数、同内容指纹去重；企微返回的限额错误如实记录；
- 回执：提交/送达/失败/未知；未知进入待对账，不自动重发；
- 统计：发送数、送达数、失败原因 TOP、按员工/标签/群维度。

### 5.7 分配、在职转接与离职继承

- **在职转接**：把客户/群从 A 员工转给 B 员工，调用企微 `transfer_customer` / `transfer_groupchat`，本地记录转接日志；
- **离职继承**：定时拉 `get_unassigned_list`（离职/在职未分配），列表展示客户与群；勾选后分配，支持批量；
- **状态刷新**：继承任务异步，5 分钟轮询结果；失败原因回写，不重复提交；
- **公海**：内部再分配复用 CRM `CrmLeadPool/CrmCustomerPool`；企微客户先提升 CRM 才进入公海规则，避免两套池子；
- **权限**：部门数据范围决定可见客户/群；跨部门转接需管理员。

### 5.8 SOP 与员工侧边栏

**SOP 规则**：

- 触发：加好友后 N 小时/天、标签变化、入群、关键词、定时（每日/每周）、手动加入；
- 动作：发欢迎语、发素材、发群发、建跟进任务、提醒员工、打标签；
- 频控：同一客户同一 SOP 不重复触发；员工每日任务上限；
- 任务：生成 `ScrmSopTask` 分配给员工，到期未完成提醒；完成后记录结果。

**员工侧边栏 H5**（`/embed/wecom-scrm`）：

- 客户画像：备注、标签、来源、所在群、最近互动、AI 摘要；
- 素材库：按类型 Tab，一键复制/发送（发送走企微会话）；
- SOP 待办：今日任务、完成/跳过、填写结果；
- 群工具：群成员、群公告、群质检提醒、群日历；
- 登录：企微工作台免登或一次性票据；只展示当前员工可见客户，越权 404。

### 5.9 敏感词与质检

- 敏感词库：组织级分组、启用/停用、动作（告警/拦截/替换）、适用方向（入站/出站/群）；
- 出站：群发/欢迎语/侧边栏发送前命中即拦截或转人工；
- 入站：命中告警给负责人，进入风险队列；
- 质检：四维评分（资料完整 / 互动深度 / 风险合规 / 跟进及时），有模型走模型、无模型走可解释规则，输入来自侧边栏会话、服务台企微会话与企点 CA；另计「回复超时」「敏感词命中」「群活跃度」三项运营指标；
- 会话存档：首期不接官方原生 SDK；已有服务台消息与 CA 消息做质检样本，界面明确标注数据来源与覆盖范围。

### 5.10 数据统计

- 概览：客户总数、今日新增、流失、客户群数、群成员数、今日群发/送达；
- 客户趋势：新增/流失/净增按日；
- 员工统计：添加客户数、聊天数、回复率、平均回复时长、SOP 完成率；
- 群统计：群数、群成员、活跃群、退群率；
- 触达统计：任务数、送达率、失败原因、按标签/来源；
- 导出与只读分享：复用 `ExportJob` 与 `PublicShare`，分享不含编辑入口。

### 5.11 AI 增强（全部可选，规则兜底）

| 能力 | 输入 | 输出 | 兜底 |
|---|---|---|---|
| 客户画像摘要 | 标签、资料卡、最近会话 | 一句话画像 + 关注点 + 风险 | 规则拼接标签 |
| 跟进建议 | 客户阶段、最近互动、SOP | 下一步动作与话术 | 固定话术模板 |
| SOP 生成 | 行业、目标、历史 SOP | 触发条件 + 动作草稿 | 内置模板 |
| 敏感词/风险提示 | 文本 + 词库 | 命中词、风险级别、改写建议 | 纯规则 |
| 会话质检 | 会话记录 | 四维评分 + 亮点 + 建议 | `scrm-compliance.ruleQc` |

AI 调用统一走 `ai-gateway`，按 `scrm_*` 科目计量；未配 Key 时明确标注「规则模式」。

---

## 六、数据模型（Prisma 新增）

所有表带组织键 `orgType + orgUserId`（与 `HrmOrg` 一致），并按组织键建复合索引。

| 模型 | 关键字段 | 说明 |
|---|---|---|
| `ScrmCorp` | corpId、agentId、secretCipher、callbackToken、aesKeyCipher、archiveSecretCipher、status、lastSyncAt | 企微接入凭据，一组织一条 |
| `ScrmContact` | corpId、externalUserId、name、avatar、gender、region、remark、description、sourceCodeId、status、addedAt、lostAt、crmLeadId | 客户主档，`corpId+externalUserId` 唯一 |
| `ScrmContactStaff` | contactId、staffUserId、externalStaffId、relation、addedAt、deletedAt | 客户-员工多对多 |
| `ScrmContactField` | key、label、type、options、required、sort | 资料卡字段定义 |
| `ScrmContactFieldValue` | contactId、fieldKey、value | 资料卡值 |
| `ScrmTagGroup` / `ScrmTag` | externalId、name、sort、usageCount | 企微标签镜像 |
| `ScrmContactTag` | contactId、tagId、source（WECOM/AUTO/MANUAL）、ruleId | 客户标签关系 |
| `ScrmAutoTagRule` | name、type（KEYWORD/JOIN/PERIOD）、config、action、enabled | 自动打标规则 |
| `ScrmChannelCode` | name、groupId、configId、qrUrl、scene、tags、welcomeId、staffStrategy、dailyLimit、status | 渠道活码 |
| `ScrmChannelCodeStaff` | codeId、staffUserId、weight、dailyLimit、usedToday | 活码引流成员 |
| `ScrmWelcome` | name、scope（ALL/STAFF/CHAT）、staffUserId、content、materialIds、enabled | 好友/入群欢迎语 |
| `ScrmChat` | chatId、name、ownerStaffId、groupId、memberCount、maxMembers、status、createdAt | 客户群 |
| `ScrmChatMember` | chatId、contactId、externalUserId、joinAt、leaveAt、role | 群成员 |
| `ScrmChatGroup` | name、sort | 本地群分组 |
| `ScrmRoomPull` | name、chatIds、welcomeId、tags、status | 自动拉群/标签建群任务 |
| `ScrmMassTask` | type、name、targetFilter、content、status、scheduledAt、submittedAt、stats | 群发/朋友圈任务 |
| `ScrmMassTarget` | taskId、contactId/chatId、staffUserId、status、error、msgId | 任务明细与回执 |
| `ScrmTransfer` | type（RESIGN/ACTIVE）、contactId/chatId、fromStaffId、toStaffId、status、failReason、externalJobId | 转接/继承日志 |
| `ScrmSop` | name、trigger、actions、enabled、version | SOP 定义 |
| `ScrmSopTask` | sopId、contactId、staffUserId、dueAt、status、result、completedAt | SOP 待办 |
| `ScrmSensitiveWord` | group、word、action、direction、enabled | 敏感词 |
| `ScrmSensitiveHit` | wordId、contactId、conversationId、direction、text、createdAt | 命中留痕 |
| `ScrmStatDaily` | day、metrics（JSON） | 日快照，避免实时聚合大表 |
| `ScrmMaterial` | type、title、content、assetId、link、miniProgram | 可复用的企微素材（与数字资产关联） |

> 命名说明：模型统一 `Scrm` 前缀，避免与 `Crm*`、`Acq*`、`ServiceDesk*` 混淆；表名与契约字段同名，前端不需要两套术语。

---

## 七、契约、路由与前端

### 7.1 契约

- 新文件 `packages/contracts/src/wecom-scrm.ts`：枚举、列表/详情/表单 schema、`Scrm_*` endpoints；
- feature 目录新增 `wecom_scrm`（名称「企业微信 SCRM」），关闭时接口拒绝、卡片不渲染；
- 计费科目：`scrm_ai_profile`、`scrm_sop_generate`、`scrm_qc`（仅 AI 动作计量；同步与群发不扣 AI 积分）。

### 7.2 路由

- `backend/src/http/automation-routes.ts`：`moduleHandlers('Scrm_', controller)`，特殊回调单独注册；
- 公开回调：`POST /enterprise/wecom-scrm/callback`（验签 + 解密 + 重放保护），加入 `isPublicRequest`；
- H5 侧边栏：`/api/public/wecom-scrm/sidebar/*` 使用一次性票据，不暴露登录态；
- 所有管理接口走当前用户 + 组织键，跨组织一律 404。

### 7.3 前端

营销工具卡片「企业微信 SCRM」内 8 个页签：

1. 概览（客户/群/触达/员工四组指标）
2. 客户（列表 + 详情 Drawer + 资料卡 + 标签 + 提升 CRM）
3. 客户群（列表 + 详情 + 分组 + 自动拉群/标签建群）
4. 活码与欢迎语（活码编辑 + 员工轮换 + 欢迎语素材）
5. 群发（客户/群/朋友圈任务 + 结果明细）
6. 分配与继承（在职转接 + 离职继承 + 未分配）
7. SOP（规则 + 任务 + 完成率）
8. 统计与合规（趋势 + 员工榜 + 敏感词 + 质检）

员工侧边栏 `/embed/wecom-scrm`：客户画像与资料卡、SOP 待办、素材库、所在客户群四个区块，移动端优先；待办可填写结果后完成/跳过。

---

## 八、与现有模块的边界

| 现有模块 | 复用方式 | 不做什么 |
|---|---|---|
| `im` 连接器 | 成员/部门同步、通知推送 | 不重复建组织树 |
| 服务台 | 企微应用/客服消息收发、会话与访客 | 不把 SCRM 客户强行塞成服务台访客 |
| CRM | 提升客户/线索、公海、分配、商机 | 不让 CRM 成为企微客户主档 |
| AI 获客 | 意向客户、跟进、剧本、质检 | 不重复采集社媒线索 |
| 企点 SCRM | 作为第三方通道并存 | 不与原生 SCRM 同时同步同一组织客户 |
| 数字资产 | 素材文件与公网直链 | 不新建第二套文件存储 |
| 发布审核 | 群发/欢迎语内容安全 | 不在本模块另写一套审核 |
| 导出/分享 | 客户、群、触达、统计 | 不在分享页暴露编辑入口 |

---

## 九、失败与合规口径

- **未配置企微**：卡片可进，功能页显示「未接入企业微信」与配置步骤，不产生假数据。
- **权限不足**：企微返回无客户联系权限时，明确提示到企微后台开通并重新授权，不静默重试。
- **回调验签失败**：直接拒绝并记录来源 IP/时间；不处理未验签事件。
- **群发超限**：以企微返回为准，本地同时执行每日上限与冷却；失败原因原样展示。
- **转接失败**：保留原归属，进入失败队列；不把「已提交」显示成「已完成」。
- **同步冲突**：企微为客户/标签/群唯一源；本地只读镜像，冲突以企微为准。
- **会话存档**：未接官方存档前，质检只覆盖服务台/CA 可见消息，界面标注覆盖范围，不宣称全量合规。
- **隐私**：手机号/邮箱/会话内容按权限脱敏展示；导出与分享走审批与只读链接。

---

## 十、任务拆解（一次交付，内部有序）

| 组 | 内容 | 主要文件 | 完成判定 |
|---|---|---|---|
| S1 | 契约 + Prisma + 迁移 + feature 前缀 | `packages/contracts/src/wecom-scrm.ts`、`endpoints.ts`、`schema.prisma`、`feature-catalog.data.ts` | contracts build、prisma generate、tsc 通过 |
| S2 | 企微客户端 + 回调 + 凭据设置 | `wecom-scrm/scrm.client.ts`、`scrm-callback.ts`、`scrm.controller.ts` | 验签/解密/重放单测；只读探针可用 |
| S3 | 客户/标签/群同步 + 客户 360 + 流失 | `scrm-sync.service.ts`、`scrm-contact.service.ts` | 幂等 upsert、去重、多员工关系、软删可恢复 |
| S4 | 客户群 + 自动拉群 + 标签建群 | `scrm-chat.service.ts` | 群满换群、邀约统计、群成员对账 |
| S5 | 活码 + 欢迎语 + 自动打标 | `scrm-code.service.ts` | 员工轮换/上限、扫码打标、欢迎语失败重试 |
| S6 | 客户群发/群群发/朋友圈 | `scrm-mass.service.ts`、`scrm.scheduler.ts` | 分片、频控、回执、unknown 不重发 |
| S7 | 在职转接/离职继承/公海 | `scrm-transfer.service.ts` | 客户与群分别转接、状态轮询、失败回写 |
| S8 | SOP + 侧边栏 H5 | `scrm-sop.service.ts`、`frontend/src/app/embed/wecom-scrm` | 触发/任务/提醒/完成率；越权 404 |
| S9 | 统计 + 导出/分享 | `scrm-stats.service.ts` | 日快照口径与明细一致；分享只读 |
| S10 | 敏感词 + 质检 + AI 增强 | `scrm-compliance.ts`、`qc.service` 复用 | 出站拦截、入站告警、规则兜底 |
| S11 | 前端 8 视图 + 卡片入口 + 单测/文档 | `frontend/src/app/marketing-tools/_components/scrm-*` | 类型检查、空态/错误态、文档同步 |

**横切复用**：`publishReview`（内容安全）、`storage`（素材/导出）、`exportJob`、`publicShare`、`notification`、`ruleDefinition`、`aiEval`（计量）、`kb`（SOP/素材知识）。

---

## 十一、验收标准

### 11.1 功能主线

1. 接入企业微信 → 同步成员/客户/标签/群 → 客户列表出现带来源与所属员工的客户。
2. 新建渠道活码（员工轮换 + 标签 + 欢迎语）→ 扫码添加 → 自动打标、发欢迎语、来源可追溯。
3. 按标签筛客户 → 创建客户群发 → 审核 → 分片提交 → 回执回写 → 失败原因可查。
4. 创建自动拉群 → 群满自动换群 → 客户入群 → 入群欢迎语发送 → 群成员与统计一致。
5. 员工离职 → 未分配客户/群出现 → 批量分配 → 状态刷新为完成 → 原员工数据保留可查。
6. 创建 SOP（加好友后 1 小时发素材）→ 员工侧边栏出现待办 → 完成/跳过 → 完成率进入统计。
7. 群发内容命中敏感词 → 出站拦截 → 审计留痕；正常内容可发。
8. 选客户或粘贴会话做质检 → 四维评分 + 亮点 + 建议，标明「模型质检 / 规则质检」来源。

### 11.2 边界与失败

- 未接企微 / 无客户联系权限：明确提示，不产生假成功。
- 回调验签失败：拒绝并记录，不处理未验签事件。
- 群发超限 / 转接失败 / 欢迎语失败：如实记录，进入待处理，不自动重发。
- 跨组织访问：404；导出未授权：403；功能关闭：接口拒绝且卡片不渲染。
- 会话存档未启用时：质检标注「仅覆盖服务台/CA 可见消息」。

### 11.3 静态验证

- `pnpm --filter @enterprise/contracts build`
- `cd backend && npx tsc --noEmit`
- `cd frontend && NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit`
- `cd backend && npx jest --config ./test/jest-unit.json`（新增 spec）
- `node scripts/check-architecture.mjs`
- `npm run api:docs:check`

### 11.4 交付状态（2026-11-07）

S1–S11 已全部实现：契约与迁移、企微客户端与回调、客户/标签/群同步、客户群与拉群、活码/欢迎语/自动打标、群发与回执、转接与继承、SOP 与侧边栏 H5、统计与导出、敏感词与四维质检，营销工具页新增「企微 SCRM」卡片（8 个页签），侧边栏 `/embed/wecom-scrm` 走 2 小时票据公开通道。

实现中补齐的两处流程缺口：

- 群发契约新增 `Scrm_requestMassReview`（草稿 → 待审核）；没有它，人工确认闸无法开启。
- 未分配清单新增本地 `id`；企微侧有而本地尚未镜像的记录 `id = 0`，界面禁止直接发起转接，避免拿外部 ID 误操作。

单测覆盖：回调签名/解密/XML 解析、凭据加解密与篡改失败、敏感词出站拦截/改写与入站只告警语义（`backend/src/wecom-scrm/scrm.spec.ts`）。

交付前静态审计又补了三处：

- 资料卡字段改为「空即删除」：前端不再过滤空值，后端遇空值删行，避免用户清空字段后旧值残留。
- 侧边栏公开通道的请求收口到 `frontend/src/api/scrm.ts`，页面不再直连 HTTP 客户端（架构检查要求）；字段值随详情返回中文名与类型。
- 质检面板标注样本覆盖范围：只含客户时间线与粘贴内容，官方会话存档未接入时不等同全量合规。

---

## 十二、待确认问题与建议默认

> 2026-11-07 已拍板：下列口径为最终口径，按此实现，不再保留开关。

| # | 问题 | 最终口径 | 理由 |
|---|---|---|---|
| 1 | 同一组织同时使用「腾讯企点·企微运营」与「企业微信 SCRM」时，客户同步源怎么定？ | **原生 SCRM 为唯一客户同步源**：启用原生 SCRM 时暂停企点客户同步；切换前提示影响范围 | 两套同时写会把客户/标签/群写成双份，后续无法对账 |
| 2 | 客户资料卡字段是否按行业预设模板？ | **全部做好**：九类字段（文本/单选/多选/日期/手机/邮箱/数字/生日/图片）组织级可配，并内置 3 套示例模板可一键复制 | 字段定义先保证可配，模板降低首次配置成本 |
| 3 | 群发审核是否允许关闭人工确认？ | **不允许**：内容安全 + 人工确认双闸固定开启 | 群发面向真实客户，误发成本高；与获客触达口径一致 |
| 4 | 离职继承分配人怎么定？ | **由企业管理员设定**：离职继承仅管理员可发起与指定接收人；部门负责人只作为默认建议值 | 继承涉及客户资产归属，不自动替管理员做决定 |
| 5 | 敏感词覆盖范围？ | 出站（群发/欢迎语/侧边栏）**拦截**；入站只**告警**不拦截 | 入站拦截会吞客户消息；出站拦截可避免承诺与违规内容 |

---

## 附录 A：Mochat 源码证据索引

| 文件 | 证明了什么 |
|---|---|
| `api-server/composer.json` | 后端为 Hyperf 2.2 + Swoole，EasyWeChat 5 接企微 |
| `api-server/storage/install/mochat.sql` | `work_contact`、`work_contact_employee`、`work_room`、`greeting`、`channel_code`、`contact_message_batch_send`、`work_transfer_log` 等核心表 |
| `api-server/app/core/work-contact/src/Logic/SyncContactByEmployeeLogic.php` | 客户按 corp + external_userid 去重、员工关系与欢迎语触发 |
| `api-server/app/core/work-contact/src/Logic/Tag/SynContactTagLogic.php` | 企微标签全量对齐增删 |
| `api-server/app/core/corp/src/Utils/WeWorkFactory.php` | 按 corp 构建 user/contact/agent 应用 |
| `api-server/app/core/corp/src/QueueService/WeWorkCallback.php` | 回调 → 异步队列 → 事件/监听器 |
| `api-server/plugin/mochat/channel-code/src/Task/ChannelCode.php` | 活码定时刷新与员工分配 |
| `api-server/plugin/mochat/greeting/src/Listener/SendWelcomeListener.php` | 好友欢迎语触发与发送 |
| `api-server/plugin/mochat/room-auto-pull/src/Logic/IndexLogic.php` | 群满自动换群 |
| `api-server/plugin/mochat/contact-message-batch-send/src/Job/SendJob.php` | 群发按 1 万人分片提交 |
| `api-server/plugin/mochat/contact-transfer/src/Logic/IndexLogic.php` | 离职/在职转接与状态刷新 |
| `dashboard/src/router/router.config.js` | 管理端菜单与页面结构 |
| `dashboard/src/views/workContact/index.vue` | 客户列表字段、筛选与详情入口 |
| `dashboard/src/views/channelCode/store.vue` | 活码员工轮换、标签、欢迎语配置 |
| `dashboard/src/views/contactMessageBatchSend/store.vue` | 客户群发目标筛选与内容配置 |
| `dashboard/src/views/contactTransfer/resignIndex.vue` | 离职继承客户/群分配 |
| `sidebar/src/router/routes.js` | 员工侧边栏的画像/素材/SOP/群工具 |
| `sidebar/src/views/contactSop/contactSop.vue` | SOP 待办与完成操作 |

## 附录 B：术语对照（Mochat → 本系统）

| Mochat | 本系统 |
|---|---|
| corp / tenant | `HrmOrg` + `ScrmCorp` |
| `work_contact` | `ScrmContact` |
| `work_contact_employee` | `ScrmContactStaff` |
| `work_contact_tag` | `ScrmTag` + `ScrmContactTag` |
| `channel_code` | `ScrmChannelCode` |
| `greeting` | `ScrmWelcome` |
| `work_room` | `ScrmChat` |
| `contact_message_batch_send` | `ScrmMassTask` + `ScrmMassTarget` |
| `work_transfer_log` | `ScrmTransfer` |
| 侧边栏 sidebar | `/embed/wecom-scrm` H5 |
| EasyWeChat 回调 | `scrm.client.ts` + `scrm-callback.ts`（官方 HTTPS API） |
| Mochat 插件（活码/群发/转接等） | 本系统进程内服务 + `scrm.scheduler.ts` |
