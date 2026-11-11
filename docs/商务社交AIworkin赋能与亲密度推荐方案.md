# 商务社交 AIworkin 赋能与亲密度推荐设计方案

> 版本：v1.0（2026-11-10）
> 范围：本站「商务社交」板块（`/social`）
> 目标：在本地社交主库之上，接入 AIworkin MCP 的 11 个 SNS 工具，实现亲密度推荐、好友关系双向同步、站内私信可选同步，并保证本地动作永远不被上游失败拖累。
> 前置结论：商务社交当前**不是** AIworkin API 的代理，而是本地 `sns_*` 表的闭环实现；AIworkin 只作为可选的上游社交网络与触达通道。

---

## 0. 摘要

1. **本地优先**：好友申请、好友关系、私信、动态、小组全部以本地 `sns_*` 表为准；AIworkin 同步是附属动作，失败不回滚本地。
2. **两把钥匙**：只使用当前用户绑定的**个人 API Key**（`AipddKeyService.resolveToken`）。平台 Key 不能用于 SNS 数据操作，也不应被本模块复用。
3. **三类同步**：
   - 好友申请：本地发起后，若对方也可解析出 AIworkin 身份，则调用 `sns_send_friend_request`。
   - 好友处理：本地点同意/拒绝时，若该申请来自 AIworkin 或已映射远端申请 ID，则调用 `sns_handle_friend_request`。
   - 私信：逐条勾选同步，调用 `sns_send_social_mail`；支持从 `sns_list_mail_inbox` / `sns_list_mail_sent` 回流。
4. **推荐引擎**：以本地社交关系 + 业务关系（同组织、上下游合同/订单/项目合作、共同经历）+ 可选上游关系打分，输出「可能认识的人」及可解释理由。
5. **可靠性底座**：事务内写本地 + 写 outbox，后台调度器按幂等键调用 MCP，指数退避、限流预算、失败可见可重试。
6. **能力边界要诚实**：当前 30 个 MCP 工具里只有 11 个 SNS 工具；**没有**「解除好友」「拉黑」「列好友申请」工具。删除好友/拉黑无法同步上游；上游好友申请能否回流，取决于 `sns_list_relationships` 的实际返回结构，必须在 Phase 0 用真实个人 Key 探测后再定。

---

## 1. 现状盘点

### 1.1 本地商务社交模块

| 层 | 位置 | 说明 |
| --- | --- | --- |
| 数据表 | `backend/prisma/schema.prisma` | `SnsProfile`、`FriendRequest`、`Friendship`、`Follow`、`Block`、`MailThread`、`SnsMessage`、`Post`、`Group*`、`Experience`、`Resume*` 等 |
| 服务 | `backend/src/social/social.service.ts` | 好友申请/接受/拒绝、好友列表、拉黑、动态、小组、私信、简历 |
| 路由 | `backend/src/social/social.routes.ts` | `/api/backend/enterprise/social/*`，仅本站会话鉴权 |
| 前端 | `frontend/src/app/social/_components/*` | `friends-tab`、`mail-tab`、`profile-tab` 等 |
| API 封装 | `frontend/src/api/social.ts` | 手写 `http()` 调用，未纳入统一 contracts |

现有好友关系的关键实现：

- `Friendship` 以 `friendKey(a,b)` 归一化顺序后唯一，避免 (A,B)/(B,A) 双存。
- `requestFriend` 已处理：不能加自己、双向拉黑、已是好友、反向待处理申请自动接受、重复申请复用。
- `acceptFriend` 幂等：已非 `PENDING` 直接返回成功。
- `incomingRequests` 只返回 `status='PENDING'` 的收到申请。
- 本地私信 `sendMail` 写入 `MailThread` + `SnsMessage`，`linkCards` 目前只支持 `RESUME`。

### 1.2 已存在的两条上游通道

| 通道 | 代码 | 凭据 | 用途 | 本方案定位 |
| --- | --- | --- | --- | --- |
| Legacy SNS REST | `backend/src/sns/sns.client.ts` | 共享 `JWT_SECRET` 临时签 5 分钟令牌，`SNS_BASE_URL` | 组织内私信、SNS 通知 | 保留兼容；有个人 Key 时优先 MCP |
| AIworkin MCP | `backend/src/content/agent-mcp.client.ts`、`backend/src/aiworkin/market-mcp.service.ts` | Bearer 个人/平台 Key | 供需市场写操作、GEO | 本方案新增 SNS 调用复用 `McpClient`，但**只取个人 Key** |

必须注意：`MarketMcpService.connect()` 的逻辑是「平台 Key 优先，回落用户 Key」。**SNS 不能照抄这个逻辑**。SNS 工具要求「enabled personal Java API key + explicit SNS grant」，平台 Key 调用会失败或越权。

### 1.3 AIworkin MCP 真实能力（30 个工具）

已实际连接 `https://api.aiworkin.com/mcp`（协议 `2025-06-18`，server `aiworkin-mcp@4.3.0`）核对：

- 供需市场：16 个（`search_suppliers`、`create_demand_draft`、`start_match`、`list_conversations`、`reply_conversation` 等）
- GEO 站点：3 个（`list_geo_sites`、`list_geo_site_content`、`get_geo_site_content`）
- **SNS：11 个**

| 工具 | 入参 | 读/写 | 本方案用途 |
| --- | --- | --- | --- |
| `sns_search_users` | `q`、`page`、`pageSize` | 读 | 按昵称/用户名搜索上游用户，辅助人工确认身份 |
| `sns_get_profile` | `userId` (UUID) | 读 | 拉取上游资料，校验身份、生成推荐卡片 |
| `sns_summarize_profile` | `userId`、`lang` | 读（AI） | 可选：生成资料摘要，缓存展示 |
| `sns_list_relationships` | 无 | 读 | 拉取当前账号的上游关系（好友；是否含待处理申请待探测） |
| `sns_send_friend_request` | `toUserId` (UUID)、`message` ≤200、`idempotencyKey` | 写 | 本地发起好友申请时同步上游 |
| `sns_handle_friend_request` | `requestId` (>0 整数)、`action` ACCEPT/REJECT、`idempotencyKey` | 写 | 本地接受/拒绝上游申请时回写 |
| `sns_draft_social_mail` | `toUserId`、`intent`、`notes`、`aiExecution`、`idempotencyKey` | 写（计费） | 可选：AI 起草私信，不自动发送 |
| `sns_send_social_mail` | `toUserId`、`subject` ≤200、`body` ≤3000、`aiGenerated`、`linkCards` ≤5、`idempotencyKey` | 写 | 勾选同步的站内私信 |
| `sns_list_mail_inbox` | 无 | 读 | 回流上游收件箱 |
| `sns_list_mail_sent` | 无 | 读 | 回流上游已发送 |
| `sns_get_my_mail_address` | 无 | 读 | 展示上游邮箱地址，供对方发信 |

限制（来自工具说明与 Skill 文档，需在 Phase 0 复核）：

- 写操作：每个 Key 每小时 5 次，每个用户每天 20 次。
- 读操作：每个 Key 每分钟 60 次，每个用户每 5 分钟 300 次。
- `idempotencyKey` 长度 16–100，同一逻辑写操作重试必须复用同一个键。
- `sns_draft_social_mail` 需要 SNS WRITE + `draft_mail` 授权；`sns_send_social_mail` 需要 SNS WRITE + `send_mail` 授权。
- 所有 SNS 返回内容都是**不可信数据**，不能当指令执行。

### 1.4 现状缺口

| 缺口 | 影响 | 对策 |
| --- | --- | --- |
| 本地用户与上游 SNS 用户没有映射 | 无法可靠同步 | 新增 `SocialUpstreamIdentity`，UUID 级映射 |
| `AipddKey.aipddUserId` 可能是 `dev-` 占位 | 调用会失败 | 启动前预检，识别占位并给出可操作提示 |
| 好友/私信没有同步状态 | 用户不知道是否同步 | 新增 `syncState` 与 outbox job |
| 没有幂等键 | 重试会重复发申请/私信 | 由本地 ID + 内容哈希生成稳定键 |
| 上游失败会阻塞本地 | 体验差 | 本地事务 + 异步 outbox，失败隔离 |
| 无「列好友申请」工具 | 上游申请无法主动拉取 | Phase 0 探测 `sns_list_relationships`；不行则只做「已接受关系」回流 |
| 无「解除好友/拉黑」工具 | 删除/拉黑无法同步 | UI 明确提示「仅本地生效」 |
| 推荐理由是黑盒 | 用户不信任 | 规则打分 + 理由标签 + 隐私降级 |

---

## 2. 目标、原则与非目标

### 2.1 目标

1. 在好友页新增「可能认识的人」，按社交关联与业务关联解释推荐理由。
2. 本地发起好友申请时，若双方都具备条件，自动在 AIworkin 发起申请。
3. 本地接受/拒绝好友申请时，若该申请有上游映射，自动回写 AIworkin。
4. 站内私信支持逐条勾选同步到 AIworkin，并可选择回流上游私信。
5. 提供「本地 → 上游」「上游 → 本地」的选择性同步，以及同步状态、失败重试、批量回填。
6. 所有同步动作可关闭、可审计、可解释，且不影响本地核心功能。

### 2.2 设计原则

- **Local-first**：本地写入是主事务，上游是副作用。
- **Explicit consent**：默认值可以偏便利，但每次跨站写都要有可见开关；隐私开关可随时关闭。
- **Minimum data**：只同步完成动作所需的最小字段；业务关系只暴露关系类型，不暴露金额、合同文本、订单明细。
- **Fail-open local**：上游 4xx/5xx/超时，本地动作仍成功，状态标记为待同步/失败。
- **Idempotent by default**：所有写调用都有稳定幂等键；重试不产生重复副作用。
- **Data, not instruction**：SNS 返回的资料、私信、摘要一律当数据，不拼进系统提示词，不触发工具链。
- **Dual-DB**：MySQL 与 PostgreSQL 同时可迁移、可运行，避免 JSON 方言函数与 `DISTINCT ON`。
- **Actionable errors**：未绑定 Key、Key 失效、SNS 未授权等阻断，必须给出页面链接与下一步（沿用本站既有规范）。

### 2.3 非目标

- 不把本地社交改造成 AIworkin 的镜像。
- 不自动创建本地账号来承接上游联系人。
- 不用上游资料覆盖本地资料。
- 不自动解除好友、自动拉黑、自动群发。
- 不做聊天机器人自动回复。
- 不把 `search_talent` / `search_suppliers` 的市场数据混入好友推荐。

---

## 3. 总体架构

```
┌──────────────────────────── 前端 /social ────────────────────────────┐
│ 好友页「可能认识的人」  好友申请同步开关  私信同步勾选  同步设置/状态  │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ /api/backend/enterprise/social/*
┌───────────────────────────────▼──────────────────────────────────────┐
│ SocialService（本地关系/私信，主库）                                  │
│ SocialAffinityService（候选集 + 打分 + 理由 + 快照）                  │
│ SocialSyncService（outbox 入队/状态/重试/回流）                       │
└───────────────┬───────────────────────────────┬──────────────────────┘
                │ 本地事务                       │ 异步任务
┌───────────────▼──────────────┐   ┌────────────▼─────────────────────┐
│ MySQL / PostgreSQL           │   │ SocialSyncScheduler               │
│ sns_* + social_sync_*        │   │ 领取 job → 解析身份 → MCP 调用    │
└──────────────────────────────┘   └────────────┬─────────────────────┘
                                                │ Bearer 个人 Key
                                   ┌────────────▼─────────────────────┐
                                   │ McpClient (Streamable HTTP)       │
                                   │ https://api.aiworkin.com/mcp      │
                                   └────────────┬─────────────────────┘
                                                │ 11 个 sns_* 工具
                                   ┌────────────▼─────────────────────┐
                                   │ AIworkin SNS                      │
                                   └──────────────────────────────────┘
```

### 3.1 出站好友申请时序

```
A 前端          SocialService            SocialSyncJob           Scheduler              AIworkin MCP
  │ 发起申请         │                         │                     │                       │
  ├───────────────►│ 事务：                  │                     │                       │
  │                │ 1) 校验/创建 FriendRequest                     │                       │
  │                │ 2) 解析 A/B 身份        │                     │                       │
  │                │ 3) 满足条件则入队 ─────►│ PENDING             │                       │
  │◄───────────────┤ 返回本地成功 + sync=PENDING                   │                       │
  │                │                         ├────────────────────►│ 领取 job              │
  │                │                         │                     ├──────────────────────►│ sns_send_friend_request
  │                │                         │                     │◄──────────────────────┤ {requestId,...}
  │                │                         │◄────────────────────┤ 更新 link/job SUCCEEDED
  │                │                         │                     │                       │
```

### 3.2 入站回流时序

```
Scheduler（每 N 分钟，按用户 opt-in）
  → sns_list_relationships / sns_list_mail_inbox / sns_list_mail_sent
  → 用 SocialUpstreamIdentity 反查本地用户
  → 已映射：幂等写入本地关系/私信
  → 未映射：只记录统计，不建号
  → 冲突：本地删除/拉黑优先，不反向覆盖
```

---

## 4. 数据模型设计

新增迁移：`0063_social_aiworkin_sync`（MySQL 正向 SQL + `schema.postgres.prisma` 由脚本生成；本地 MySQL 用 `prisma:migrate:deploy`，不要用 `db push`）。

### 4.1 新增模型

```prisma
/// 本地用户 ↔ AIworkin SNS 身份映射。
/// 只信 UUID；不用昵称/手机号自动匹配，避免错绑。
model SocialUpstreamIdentity {
  id               Int       @id @default(autoincrement())
  userId           String    @unique @map("user_id") @db.VarChar(64)
  keyId            Int       @map("key_id")
  upstreamUserId   String    @default("") @map("upstream_user_id") @db.VarChar(64)
  upstreamUsername String    @default("") @map("upstream_username") @db.VarChar(120)
  /// UNBOUND | KEY_INACTIVE | PLACEHOLDER_ID | SNS_GRANT_MISSING | READY | REVOKED
  state            String    @default("UNBOUND") @db.VarChar(24)
  profileSnapshot  Json      @default("{}") @map("profile_snapshot")
  verifiedAt       DateTime? @map("verified_at")
  lastSyncedAt     DateTime? @map("last_synced_at")
  lastError        String    @default("") @map("last_error") @db.VarChar(500)
  createdAt        DateTime  @default(now()) @map("created_at")
  updatedAt        DateTime  @updatedAt @map("updated_at")

  @@index([upstreamUserId])
  @@map("social_upstream_identities")
}
```

```prisma
/// 每个用户的跨站同步偏好。关闭后立即停止新的 outbox 入队。
model SocialSyncPreference {
  id                     Int      @id @default(autoincrement())
  userId                 String   @unique @map("user_id") @db.VarChar(64)
  discoverable           Boolean  @default(true)
  recommendEnabled       Boolean  @default(true) @map("recommend_enabled")
  businessReasonVisible  Boolean  @default(true) @map("business_reason_visible")
  friendRequestOutbound  Boolean  @default(true) @map("friend_request_outbound")
  friendRelationOutbound Boolean  @default(true) @map("friend_relation_outbound")
  friendRelationInbound  Boolean  @default(false) @map("friend_relation_inbound")
  mailOutboundDefault    Boolean  @default(false) @map("mail_outbound_default")
  mailInbound            Boolean  @default(false) @map("mail_inbound")
  /// AUTO | MCP | LEGACY
  channel                String   @default("AUTO") @db.VarChar(16)
  createdAt              DateTime @default(now()) @map("created_at")
  updatedAt              DateTime @updatedAt @map("updated_at")

  @@map("social_sync_preferences")
}
```

```prisma
/// 事务性 outbox。所有跨站写都先入队，再由调度器执行。
model SocialSyncJob {
  id             Int       @id @default(autoincrement())
  userId         String    @map("user_id") @db.VarChar(64)
  keyId          Int       @map("key_id")
  /// OUTBOUND | INBOUND
  direction      String    @default("OUTBOUND") @db.VarChar(16)
  /// FRIEND_REQUEST_SEND | FRIEND_REQUEST_HANDLE | MAIL_SEND | RELATION_PULL | MAIL_PULL | BACKFILL_FRIEND
  action         String    @db.VarChar(32)
  localType      String    @default("") @map("local_type") @db.VarChar(32)
  localId        String    @default("") @map("local_id") @db.VarChar(64)
  payload        Json      @default("{}")
  idempotencyKey String    @unique @map("idempotency_key") @db.VarChar(100)
  /// PENDING | RUNNING | SUCCEEDED | FAILED | DEAD
  status         String    @default("PENDING") @db.VarChar(16)
  attempts       Int       @default(0)
  nextAttemptAt  DateTime  @default(now()) @map("next_attempt_at")
  lockedAt       DateTime? @map("locked_at")
  lastError      String    @default("") @map("last_error") @db.VarChar(1000)
  remoteId       String    @default("") @map("remote_id") @db.VarChar(120)
  createdAt      DateTime  @default(now()) @map("created_at")
  updatedAt      DateTime  @updatedAt @map("updated_at")
  completedAt    DateTime? @map("completed_at")

  @@index([status, nextAttemptAt])
  @@index([userId, createdAt])
  @@index([keyId, createdAt])
  @@map("social_sync_jobs")
}
```

```prisma
/// 本地对象 ↔ 上游对象映射，兼做去重表。
model SocialSyncLink {
  id             Int       @id @default(autoincrement())
  userId         String    @map("user_id") @db.VarChar(64)
  /// FRIEND_REQUEST | FRIENDSHIP | MAIL_THREAD | MAIL_MESSAGE
  kind           String    @db.VarChar(24)
  localId        String    @map("local_id") @db.VarChar(64)
  remoteId       String    @default("") @map("remote_id") @db.VarChar(120)
  remoteParentId String    @default("") @map("remote_parent_id") @db.VarChar(120)
  /// OUTBOUND | INBOUND
  direction      String    @default("OUTBOUND") @db.VarChar(16)
  /// ACTIVE | CONFLICT | STALE
  state          String    @default("ACTIVE") @db.VarChar(16)
  contentHash    String    @default("") @map("content_hash") @db.VarChar(64)
  lastSyncedAt   DateTime? @map("last_synced_at")
  createdAt      DateTime  @default(now()) @map("created_at")
  updatedAt      DateTime  @updatedAt @map("updated_at")

  @@unique([userId, kind, localId])
  @@index([userId, kind, remoteId])
  @@map("social_sync_links")
}
```

```prisma
/// 推荐快照：懒计算 + TTL，避免每次请求都全量聚合。
model SocialAffinitySnapshot {
  id           Int      @id @default(autoincrement())
  userId       String   @map("user_id") @db.VarChar(64)
  targetUserId String   @map("target_user_id") @db.VarChar(64)
  score        Int      @default(0)
  reasons      Json     @default("[]")
  signals      Json     @default("{}")
  computedAt   DateTime @default(now()) @map("computed_at")
  expiresAt    DateTime @map("expires_at")

  @@unique([userId, targetUserId])
  @@index([userId, score])
  @@map("social_affinity_snapshots")
}
```

```prisma
/// 「不再推荐」等负反馈；到期后自动失效。
model SocialRecommendationFeedback {
  id           Int       @id @default(autoincrement())
  userId       String    @map("user_id") @db.VarChar(64)
  targetUserId String    @map("target_user_id") @db.VarChar(64)
  /// DISMISS | INVITED | ADDED
  action       String    @db.VarChar(16)
  expiresAt    DateTime? @map("expires_at")
  createdAt    DateTime  @default(now()) @map("created_at")

  @@unique([userId, targetUserId])
  @@map("social_recommendation_feedback")
}
```

### 4.2 现有模型增补

```prisma
model FriendRequest {
  // ...existing fields
  /// LOCAL | AIWORKIN
  source             String  @default("LOCAL") @db.VarChar(16)
  /// 上游申请 ID；只有 AIWORKIN 来源或已成功出站同步时才有值
  upstreamRequestId  String  @default("") @map("upstream_request_id") @db.VarChar(64)
  /// NONE | PENDING | SYNCED | FAILED | SKIPPED
  syncState          String  @default("NONE") @map("sync_state") @db.VarChar(16)
}

model Friendship {
  // ...existing fields
  /// LOCAL | AIWORKIN | BOTH
  source     String  @default("LOCAL") @db.VarChar(16)
  syncState  String  @default("NONE") @map("sync_state") @db.VarChar(16)
}

model SnsMessage {
  // ...existing fields
  /// LOCAL | AIWORKIN
  source              String  @default("LOCAL") @db.VarChar(16)
  upstreamMessageId   String  @default("") @map("upstream_message_id") @db.VarChar(120)
  /// NONE | PENDING | SYNCED | FAILED | SKIPPED
  syncState           String  @default("NONE") @map("sync_state") @db.VarChar(16)
}
```

> 说明：域表上的 `syncState` 用于列表直接展示，避免每个列表都 join `social_sync_jobs`；`SocialSyncJob` 负责可靠投递与重试，二者职责分离。

### 4.3 索引与保留策略

- `social_sync_jobs(status, next_attempt_at)`：调度器领取。
- `social_sync_jobs(userId, createdAt)` / `(keyId, createdAt)`：限流窗口计数。
- `social_sync_links(userId, kind, remoteId)`：回流去重。
- `social_affinity_snapshots(userId, score)`：推荐读取。
- 清理任务：`SUCCEEDED` 保留 30 天、`DEAD` 保留 90 天、快照保留 30 天、反馈到期删除。

### 4.4 双库注意事项

- 不使用 MySQL `JSON_TABLE`、PG `jsonb_path_query` 等方言函数；理由与信号用 `Json` 存取，读取后在 TypeScript 聚合。
- 不使用 `SELECT ... FOR UPDATE SKIP LOCKED`；用「`updateMany` 条件更新 + `lockedAt` 租约」实现跨库领取。
- 迁移同时生成 MySQL 与 PG schema；CI 跑 `prisma:migrate:deploy` 与 `api:docs:check`。

---

## 5. 身份映射与凭据

### 5.1 身份链

```
本地 userId（Account.id 字符串）
  → UserAipddBinding.userId
  → AipddKey.id / status / aipddUserId
  → SocialUpstreamIdentity.upstreamUserId（SNS UUID）
  → sns_* 工具入参
```

### 5.2 身份解析算法

```ts
type IdentityState =
  | 'UNBOUND'
  | 'KEY_INACTIVE'
  | 'PLACEHOLDER_ID'
  | 'SNS_GRANT_MISSING'
  | 'READY'
  | 'REVOKED';

async function ensureIdentity(userId: string): Promise<IdentityResult> {
  const binding = await prisma.userAipddBinding.findUnique({ where: { userId } });
  if (!binding) return { state: 'UNBOUND' };

  const key = await prisma.aipddKey.findUnique({ where: { id: binding.keyId } });
  if (!key || key.status !== 'ACTIVE') return { state: 'KEY_INACTIVE' };

  const upstreamUserId = String(key.aipddUserId || '').trim();
  if (!isUuid(upstreamUserId)) return { state: 'PLACEHOLDER_ID' };

  // 缓存 24h；过期后用读工具验证 SNS grant
  const cached = await prisma.socialUpstreamIdentity.findUnique({ where: { userId } });
  if (cached?.state === 'READY' && cached.verifiedAt &&
      Date.now() - cached.verifiedAt.getTime() < 24 * 3600_000) {
    return { state: 'READY', upstreamUserId: cached.upstreamUserId, keyId: key.id };
  }

  try {
    const token = await keys.resolveToken(userId);
    const client = mcpFor(token);
    await client.callTool('sns_list_relationships', {});
    // 验证通过后落库
  } catch (error) {
    if (isSnsGrantError(error)) return { state: 'SNS_GRANT_MISSING' };
    throw error;
  }
}
```

关键规则：

1. **只认 UUID**：`aipddUserId` 不是 UUID（例如本地 `AIPDD_KEY_VERIFY=off` 产生的 `dev-` 占位）时，状态为 `PLACEHOLDER_ID`，不发起任何 SNS 调用。
2. **不按昵称自动匹配**：`sns_search_users` 只用于「候选确认」，必须由用户点选确认后才写入 `SocialUpstreamIdentity`。
3. **Key 只解密到内存**：每次调用前 `resolveToken`，不缓存明文、不写日志、不回显。
4. **平台 Key 禁用**：`AiworkinSocialService` 不注入 `resolvePlatformToken`，从代码层面避免误用。
5. **解绑即暂停**：`UserAipddBinding` 删除或 `AipddKey.status !== ACTIVE` 时，把身份状态改为 `REVOKED`，并把该用户 `PENDING` job 标为 `DEAD`。

### 5.3 对方是否「也有 Key」

判断对方能否接收同步：

```
peerReady =
  SocialUpstreamIdentity(peer).state === 'READY'
  或 (UserAipddBinding(peer) 存在
      && AipddKey.status === 'ACTIVE'
      && isUuid(AipddKey.aipddUserId))
```

不满足时不入队，前端显示「对方未绑定 AIworkin，本次仅本地生效」，并提供「去邀请对方绑定」的说明链接。

### 5.4 身份状态对应的用户提示

| 状态 | 提示 | 可操作入口 |
| --- | --- | --- |
| UNBOUND | 尚未绑定 API Key，无法同步到 AIworkin | 「模型服务 → API Key 管理」链接 |
| KEY_INACTIVE | 绑定的 Key 已失效 | 重新绑定 |
| PLACEHOLDER_ID | 当前 Key 未返回真实 AIworkin 用户编号，无法用于社交同步 | 重新验证 Key / 联系管理员 |
| SNS_GRANT_MISSING | Key 未开通 SNS 权限 | 在 AIworkin 授权 SNS 读写后重试 |
| READY | 已连接 | 显示上游昵称与最后同步时间 |

---

## 6. 亲密度推荐引擎

### 6.1 候选集来源

| 来源 | 数据 | 说明 |
| --- | --- | --- |
| 六度人脉 | `Friendship` 逐层扩展（1–6 度最短路径） | 六度之内的人都进入候选，度数越小越亲近 |
| 二度好友 | `Friendship` + 好友的好友 | 最高价值信号 |
| 同组织 | `OrgStaff`（`orgType` + `orgUserId`） | 同企业/同服务商 |
| 同部门 | `OrgStaff.department` / `ProviderStaff.department` | 同组织内再加分 |
| 服务商指派 | `ProviderAssignment` | 服务商与企业对接人 |
| 生效合同 | `Contract`（`status` 活跃、`endDate` 未过期） | 上下游合作关系 |
| 供销订单 | `SupplyOrder`（`status` 活跃） | 企业采购与服务商承办 |
| 项目合作 | `PjEngagement`（`status` 活跃） | 外部合作方 |
| 商务往来 | `BizParty`（`status='ACTIVE'`） | 供应商/合作伙伴/客户 |
| 共同经历 | `Experience`（`hideFromPeers=false`，同 `kind+orgKey`） | 前同事/同校 |
| 同小组 | `GroupMember`（`status='ACTIVE'`） | 共同社群 |
| 互动 | `Post`、`GroupTopic`、`GroupReply`、`TopicLike`、`ReplyLike`、`SnsMessage` | 近期互动加权 |
| 同城/行业 | `SnsProfile.city`、`EnterpriseProfile` 行业字段 | 弱信号 |
| 全站注册用户 | `Account`（`status='ACTIVE'`） | 六度内无路径的兜底候选，排在最后 |
| 上游关系 | `sns_list_relationships`（opt-in） | 上游已是好友但本地不是 |

候选集控制：

- 每种来源先取最近/最强的 N 条（例如二度好友 200、同组织 100、业务关系 100）。
- 六度人脉按最短度数由近到远补入，先取 2 倍候选量（600）再统一截断。
- 合并去重后上限 300 人，避免大组织下全量打分。
- 候选查询全部走索引；禁止在请求路径做全表扫描。

### 6.2 排除规则（硬过滤）

必须排除：

1. 自己。
2. 已是好友（`Friendship` 任一方向）。
3. 存在待处理好友申请（我发给他/他发给我）。
4. 任一方向拉黑（`Block`）。
5. 对方关闭了 `discoverable` 或 `recommendEnabled`。
6. 账号被平台封禁/停用。
7. `SocialRecommendationFeedback.action='DISMISS'` 且未过期。
8. 90 天内被对方拒绝过好友申请（避免反复打扰）。

偏好表按需创建：读取时若无 `SocialSyncPreference` 记录，返回默认值（`discoverable=true`、`recommendEnabled=true`、出站开、入站关），首次保存时再 upsert。不能要求用户先保存设置才能看到推荐。

### 6.3 打分模型

总分 100，按信号强度归一化：

| 信号 | 权重 | 归一化上限 | 说明 |
| --- | ---: | ---: | --- |
| 六度人脉 | 36/30/22/15/10/6 | 1 | 1–6 度最短关系链，度数越小越亲近；六度之外不加分 |
| 共同好友 | 24 | 5 人 | `min(1, mutual / 5)` |
| 同组织 | 18 | 1 | 同 `orgType+orgUserId`；同部门再 ×1.2（封顶 18） |
| 上下游业务关系 | 20 | 3 条 | 合同/订单/项目合作分别计入，去重后封顶 |
| 共同小组与互动 | 12 | 5 次 | 同组 + 近 90 天点赞/回复/私信 |
| 共同经历机构 | 8 | 2 段 | 同 `kind+orgKey` |
| 同城/同行业 | 6 | 1 | 城市相同优先 |
| 上游 SNS 关系 | 6 | 1 | 上游已是好友/有关注 |
| 资料完整度与活跃度 | 6 | 1 | 有头像、简介、近期动态 |

公式：

```
raw = Σ(weight_i × min(1, signal_i / cap_i))
recency = 0.85 ~ 1.0        // 近 30 天互动取 1.0，90 天前取 0.85
penalty = 被拒绝历史 ? 15 : 0
degreeBonus = { 1: 36, 2: 30, 3: 22, 4: 15, 5: 10, 6: 6 }[degree] || 0
score = round(max(0, raw × recency - penalty)) + degreeBonus
```

展示规则：

- 不设硬门槛：平台注册用户都可出现，按分数倒序；同分时关系更近（度数更小）优先，六度之外的用户排在最后。
- `>= 70` 标记「高匹配」；推荐理由优先展示六度度数（二度显示「好友的好友」，三度起显示「N 度人脉」）。
- 每人最多展示 12 条；同一组织/同一小组最多 3 条，保证多样性。
- 分数只用于排序，前端展示「匹配度」分档，不展示可被反推的原始分值。

### 6.4 理由标签

| 信号 | 标签 | 隐私处理 |
| --- | --- | --- |
| 共同好友 | 「你们有 3 位共同好友」 | 只给数量，不给共同好友名单（点开才展示已公开好友） |
| 同组织 | 「同属 XX 公司」 | 组织名可见性由组织资料决定 |
| 同部门 | 「都在 XX 部门」 | 部门名可脱敏为「同一部门」 |
| 合同 | 「有生效中的服务合作」 | 不显示合同号、金额、服务内容 |
| 订单 | 「有进行中的供销合作」 | 不显示订单号、金额 |
| 项目 | 「在同一个项目上合作过」 | 不显示项目金额/客户名 |
| 共同经历 | 「都曾在 XX 任职」 | 对方 `hideFromPeers=true` 时不展示 |
| 同小组 | 「同在「XX」小组」 | 仅展示公开小组 |
| 同城 | 「都在深圳」 | 对方关闭城市展示时不展示 |
| 上游好友 | 「AIworkin 上已是好友」 | 仅双方都开启上游同步时展示 |

当 `businessReasonVisible=false` 时，所有业务类标签统一降级为「有业务往来」，不暴露具体关系类型。

### 6.5 计算与缓存

- 读路径：`GET /social/recommendations` 先读未过期快照；没有则同步计算并写快照（TTL 6 小时）。
- 写路径：好友接受/删除、资料保存、组织变更、合同/订单状态变化后，删除该用户快照，下次读取自动重算。
- 后台：每天凌晨对近 90 天活跃用户预热快照（可选，Phase 3）。
- 计算量控制：候选上限 300；批量查询用 `findMany` + `in`，禁止 N+1。

### 6.6 接口返回示例

```json
{
  "items": [
    {
      "person": {
        "userId": "1024",
        "username": "zhangsan",
        "displayName": "张三",
        "avatar": "https://..."
      },
      "matchBand": "HIGH",
      "reasons": [
        { "kind": "MUTUAL_FRIEND", "label": "你们有 3 位共同好友" },
        { "kind": "SAME_ORG", "label": "同属 XX 科技" },
        { "kind": "BUSINESS", "label": "有生效中的服务合作" }
      ],
      "upstream": { "state": "READY", "isFriend": false },
      "actions": ["ADD", "DISMISS"]
    }
  ],
  "computedAt": "2026-11-10T08:00:00.000Z",
  "stale": false
}
```

---

## 7. 好友申请与好友关系同步

### 7.1 本地发起好友申请

接口：`POST /enterprise/social/friends/requests`

新增入参：

```json
{
  "toUserId": "1024",
  "message": "在 XX 项目上见过",
  "syncUpstream": true
}
```

`syncUpstream` 缺省取 `SocialSyncPreference.friendRequestOutbound`，默认 `true`。

后端流程：

1. 执行现有校验（非自己、非拉黑、已是好友、反向待处理自动接受）。
   - 反向待处理自动接受时，复用 7.3 的处理：若反向申请已带 `upstreamRequestId`，则按接受逻辑回写上游；本次不再重复发起新申请。
2. 在同一个 `$transaction` 内创建/更新 `FriendRequest`，`source='LOCAL'`。
3. 解析双方身份；满足 `sender READY && peerReady && syncUpstream` 时插入 `SocialSyncJob`：
   - `action='FRIEND_REQUEST_SEND'`
   - `localType='FRIEND_REQUEST'`，`localId=request.id`
   - `payload={ toUpstreamUserId, message }`
   - `idempotencyKey = 'sns-fr-' + request.id + '-' + sha256(message).slice(0,16)`
4. 返回：

```json
{
  "accepted": false,
  "requestId": 123,
  "sync": {
    "state": "PENDING",
    "peerHasKey": true,
    "reason": ""
  }
}
```

未满足条件时：

```json
{
  "accepted": false,
  "requestId": 123,
  "sync": {
    "state": "SKIPPED",
    "peerHasKey": false,
    "reason": "PEER_NO_KEY"
  }
}
```

### 7.2 调度器执行出站申请

```ts
const result = await client.callTool('sns_send_friend_request', {
  toUserId: payload.toUpstreamUserId,
  message: payload.message.slice(0, 200),
  idempotencyKey: job.idempotencyKey,
});

const remoteId = String(result?.requestId ?? result?.id ?? '');
await prisma.$transaction([
  prisma.friendRequest.update({
    where: { id: Number(job.localId) },
    data: { upstreamRequestId: remoteId, syncState: 'SYNCED' },
  }),
  prisma.socialSyncLink.upsert({
    where: { userId_kind_localId: { userId: job.userId, kind: 'FRIEND_REQUEST', localId: job.localId } },
    create: { userId: job.userId, kind: 'FRIEND_REQUEST', localId: job.localId, remoteId, direction: 'OUTBOUND' },
    update: { remoteId, state: 'ACTIVE', lastSyncedAt: new Date() },
  }),
  prisma.socialSyncJob.update({
    where: { id: job.id },
    data: { status: 'SUCCEEDED', remoteId, completedAt: new Date() },
  }),
]);
```

特殊返回处理：

- 上游返回「已是好友」：标记 `SYNCED`，`link.state='ACTIVE'`，不自动创建本地好友关系；本地仍走自己的接受流程。
- 上游返回「已有待处理申请」：复用返回的 `requestId`，标记 `SYNCED`。
- 上游 4xx（参数/权限）：`DEAD`，`syncState='FAILED'`，记录可读原因。
- 上游 429/5xx/超时：`FAILED` + 退避重试。

### 7.3 本地接受/拒绝

接口：

- `POST /enterprise/social/friends/requests/:id/accept`
- `POST /enterprise/social/friends/requests/:id/reject`

新增入参：`{ "syncUpstream": true }`，缺省取 `friendRelationOutbound`。

接受流程：

1. 事务内 upsert `Friendship`（使用现有 `friendKey` 归一化），更新 `FriendRequest.status='ACCEPTED'`。
2. 若 `request.upstreamRequestId` 非空且双方满足条件，插入 `SocialSyncJob`：
   - `action='FRIEND_REQUEST_HANDLE'`
   - `payload={ remoteRequestId, action: 'ACCEPT' }`
   - `idempotencyKey='sns-frh-'+request.id+'-ACCEPT'`
3. 返回本地成功 + `sync.state='PENDING'`。

拒绝流程同理，`action='REJECT'`，幂等键后缀 `-REJECT`。

> 如果申请是本地发起但出站尚未成功（没有 `upstreamRequestId`），则不执行 `sns_handle_friend_request`，状态标为 `SKIPPED`，原因 `NO_REMOTE_REQUEST`。不要为了补同步而临时再发一次申请，避免重复打扰。

### 7.4 入站关系回流

数据来源：`sns_list_relationships`（Phase 0 需确认返回结构）。

处理规则：

1. 只处理已能通过 `SocialUpstreamIdentity` 反查到本地用户的条目。
2. 已存在的 `Friendship`：更新 `syncState='SYNCED'`，不改 `createdAt`。
3. 不存在：创建 `Friendship`，`source='AIWORKIN'`，`syncState='SYNCED'`；同时写 `SocialSyncLink(kind='FRIENDSHIP', localId=friendKey, remoteId=peerUpstreamId)`。
4. 不创建 `FriendRequest` 历史，避免污染「收到申请」列表；如需告知用户，发一条聚合通知「已从 AIworkin 同步 N 位好友」。
5. 未映射的上游关系：只计数并写入 `SocialUpstreamIdentity.lastError` 或同步统计，不创建本地账号。
6. 冲突：本地已删除或拉黑 → 不重新添加，`link.state='CONFLICT'`，并在同步状态页提示「AIworkin 仍保留该关系，如需解除请到 AIworkin 操作」。

入站好友申请：

- 如果 `sns_list_relationships` 不返回待处理申请，则**不做**入站申请导入；只做已接受关系回流。
- 如果返回待处理申请且包含 `requestId`，则写入 `FriendRequest`：
  - `source='AIWORKIN'`
  - `upstreamRequestId=requestId`
  - `syncState='SYNCED'`
  - `fromUserId` 必须是已映射的本地用户；未映射则不导入。
- 用户接受/拒绝时走 7.3，回写 `sns_handle_friend_request`。

### 7.5 不支持的上游操作

| 本地操作 | 上游支持 | 处理 |
| --- | --- | --- |
| 删除好友 | 无工具 | 仅本地删除；UI 提示「AIworkin 侧关系需在 AIworkin 解除」 |
| 拉黑 | 无工具 | 仅本地拉黑；推荐与私信立即停止；上游关系保留 |
| 取消已发申请 | 无工具 | 仅本地删除/标记；上游申请可能仍存在，提示用户 |
| 修改备注 | 无工具 | 仅本地 |

### 7.6 批量回填（本地 → 上游）

场景：用户先用本地社交很久，之后才绑定 Key。

接口：`POST /enterprise/social/sync/backfill/friends`

规则：

- 仅同步 `Friendship` 中对方 `peerReady` 且尚未有 `link` 的好友。
- 先返回预估：`total`、`syncable`、`estimatedDays`（按每日 20 次写上限计算）。
- 用户确认后，按优先级（最近互动 > 最近添加）分批入队，每批不超过当日剩余额度。
- 支持暂停/继续；每批完成后更新进度。
- 不自动执行，避免刚绑定 Key 就触发大量外部写。

---

## 8. 站内私信同步

### 8.1 出站：本地私信 → AIworkin

接口：`POST /enterprise/social/mail`

新增入参：

```json
{
  "toUserId": "1024",
  "subject": "合作跟进",
  "body": "您好，关于上次的项目……",
  "syncUpstream": true
}
```

前端在发送弹窗增加复选框「同时发送到 AIworkin 私信」，默认值取 `mailOutboundDefault`（默认关闭，避免误发）。

后端流程：

1. 执行现有校验（非自己、非拉黑、正文非空）。
2. 事务内创建/复用 `MailThread` + `SnsMessage`，`source='LOCAL'`。
3. 若 `syncUpstream && peerReady`，插入 `SocialSyncJob`：
   - `action='MAIL_SEND'`
   - `localType='MAIL_MESSAGE'`，`localId=message.id`
   - `payload={ toUpstreamUserId, subject, body, linkCards }`
   - `idempotencyKey='sns-mail-'+message.id+'-'+sha256(body).slice(0,16)`
4. 返回本地消息 + `sync.state`。

同步前硬校验（不满足则禁用勾选并说明原因）：

| 条件 | 原因 |
| --- | --- |
| 对方 `peerReady` | `PEER_NO_KEY` |
| 正文 ≤ 3000 字 | `BODY_TOO_LONG` |
| 标题 ≤ 200 字 | `SUBJECT_TOO_LONG` |
| 卡片 ≤ 5 个 | `TOO_MANY_CARDS` |
| 卡片 URL 为 http/https 且为站点公开域名 | `INVALID_CARD_URL` |
| 当前用户 SNS 写权限可用 | `SNS_GRANT_MISSING` |

> 不做静默截断。超长时提示用户「仅本地发送」或自行缩短。

### 8.2 调度器执行发信

```ts
await client.callTool('sns_send_social_mail', {
  toUserId: payload.toUpstreamUserId,
  subject: payload.subject || '',
  body: payload.body,
  aiGenerated: false,
  linkCards: payload.linkCards,
  idempotencyKey: job.idempotencyKey,
});
```

成功后：

- `SnsMessage.syncState='SYNCED'`，`upstreamMessageId=remoteId`
- `SocialSyncLink(kind='MAIL_MESSAGE', localId=message.id, remoteId)`
- `MailThread` 不重复创建；用 `SocialSyncLink(kind='MAIL_THREAD', localId=thread.id, remoteId=remoteThreadId)` 关联上游会话（若返回）。

### 8.3 入站：AIworkin 私信 → 本地

来源：`sns_list_mail_inbox`、`sns_list_mail_sent`。

规则：

1. 按上游消息 ID 去重：`SocialSyncLink(kind='MAIL_MESSAGE', remoteId)` 已存在则跳过。
2. 反查 `fromUserId` / `toUserId` 的本地用户；任一侧未映射则跳过并计数。
3. 复用本地 `MailThread` 的 `friendKey` 逻辑，找到/创建会话。
4. 写入 `SnsMessage`：
   - `source='AIWORKIN'`
   - `upstreamMessageId`
   - `syncState='SYNCED'`
   - `aiGenerated` 取上游值
   - `readUserIds`：若上游返回已读状态则据此设置，否则视为未读。
5. **防回环**：`source='AIWORKIN'` 的消息绝不重新入队 `MAIL_SEND`。
6. 附件/简历卡片：上游 `linkCards` 只保留 `{type,title,url}`，渲染前做 URL 协议与域名校验；不下载、不抓取。

拉取节奏：

- 用户开启 `mailInbound` 后，每 10 分钟拉一次（读限流远高于写限流）。
- 用 `SocialUpstreamIdentity.lastSyncedAt` 做增量水位；如果上游不返回时间戳，则全量拉取 + 本地去重。
- 首次开启时只导入最近 30 天，避免历史洪水。

### 8.4 简历卡片

现有 `linkCards` 只有 `RESUME`：

```json
{
  "kind": "RESUME",
  "userId": "1024",
  "name": "张三",
  "headline": "供应链顾问",
  "updatedAt": "2026-11-01T..."
}
```

同步到上游时转换为：

```json
{
  "type": "RESUME",
  "title": "张三的简历",
  "url": "https://站点域名/resume/1024"
}
```

要求：

- 站点域名必须来自系统配置，禁止 `localhost`/内网地址。
- URL 必须公网可访问；否则不勾选同步，提示「简历链接需公网可访问」。
- 最多 5 张卡片。

### 8.5 AI 起草（可选，Phase 4）

`sns_draft_social_mail` 是计费能力，且需要额外 `draft_mail` 授权。设计约束：

- 只在用户点击「AI 帮我写」时调用，显示预计消耗。
- 生成结果填入编辑框，用户必须手动确认后才会发送。
- 不把生成结果自动发往 `sns_send_social_mail`。
- 失败/超时不影响手动写信。

### 8.6 私信同步开关矩阵

| 场景 | 默认 | 可关闭 | 说明 |
| --- | --- | --- | --- |
| 本地发信同步上游 | 关 | 是 | 每次弹窗可单独勾选 |
| 上游私信回流 | 关 | 是 | 设置页开启，首次只导 30 天 |
| 回复上游线程时同步 | 跟随该会话来源 | 是 | 若会话来自 AIWORKIN，默认勾选 |
| AI 起草 | 关 | 是 | 计费能力，单独确认 |

---

## 9. 同步方向矩阵与冲突策略

| 数据 | 本地 → 上游 | 上游 → 本地 | 默认 | 冲突策略 |
| --- | --- | --- | --- | --- |
| 好友申请 | `sns_send_friend_request` | 视 `sns_list_relationships` 能力 | 出站开、入站关 | 本地待处理优先；不重复发 |
| 好友接受/拒绝 | `sns_handle_friend_request` | 已接受关系回流 | 开 | 本地状态优先 |
| 好友关系 | 仅通过申请/接受间接建立 | 已接受关系导入 | 出站开、入站关 | 本地删除/拉黑优先，不复活 |
| 站内私信 | `sns_send_social_mail` | inbox/sent 回流 | 逐条勾选、入站关 | 上游 ID 去重；本地消息不覆盖 |
| 资料 | 不同步 | 只读展示/摘要 | 关 | 不覆盖本地资料 |
| 动态/小组 | 不同步 | 不同步 | — | 非目标 |
| 拉黑/删除好友 | 不支持 | 不支持 | — | UI 明确提示仅本地 |

通用规则：

1. **Additive only**：入站只做「新增」，不删除本地数据、不改本地隐私设置。
2. **Local wins**：本地删除、拉黑、拒绝、关闭开关，永远优先。
3. **No resurrection**：被本地拒绝/拉黑的对象，不因上游关系回流而重新出现。
4. **One-way fields**：资料、简历、隐私设置只从本地流向展示层，不被上游覆盖。
5. **Time watermark**：入站只处理 `lastSyncedAt` 之后的新数据；无时间戳时靠 `remoteId` 去重。

---

## 10. 接口设计

### 10.1 新增/调整接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/enterprise/social/recommendations?limit=12` | 可能认识的人 |
| POST | `/enterprise/social/recommendations/:userId/dismiss` | 不再推荐（90 天） |
| GET | `/enterprise/social/sync/preferences` | 读取同步偏好与身份状态 |
| PUT | `/enterprise/social/sync/preferences` | 更新偏好 |
| GET | `/enterprise/social/sync/overview` | Key 状态、配额、最近同步、失败数 |
| GET | `/enterprise/social/sync/jobs?status=FAILED&take=20` | 我的同步任务 |
| POST | `/enterprise/social/sync/jobs/:id/retry` | 手动重试 |
| POST | `/enterprise/social/sync/pull` | 立即从 AIworkin 拉取（关系/私信，按开关） |
| POST | `/enterprise/social/sync/backfill/friends` | 预估/启动好友批量回填 |
| GET | `/enterprise/social/sync/backfill/friends/:jobId` | 回填进度 |
| POST | `/enterprise/social/friends/requests` | 增加 `syncUpstream` |
| POST | `/enterprise/social/friends/requests/:id/accept` | 增加 `syncUpstream` |
| POST | `/enterprise/social/friends/requests/:id/reject` | 增加 `syncUpstream` |
| POST | `/enterprise/social/mail` | 增加 `syncUpstream` |

> 当前 social 路由是手写 Hono 路由，未纳入 `packages/contracts`。本方案保持同一风格，前端类型补在 `frontend/src/api/social.ts`；如后续要纳入 OpenAPI，再统一迁移并重新生成 `docs/api/openapi.json`。

### 10.2 同步状态词汇

统一使用：

```
NONE       未涉及同步
PENDING    已入队，等待执行
RUNNING    执行中
SYNCED     已同步
FAILED     失败，可重试
SKIPPED    条件不满足，未同步
DEAD       永久失败，需人工处理
```

前端不要根据 HTTP 状态码猜同步结果，一律读 `sync.state` 与 `sync.reason`。

### 10.3 同步概览返回示例

```json
{
  "identity": {
    "state": "READY",
    "upstreamUserId": "3f0c...",
    "upstreamUsername": "zhangsan",
    "mailAddress": "zhangsan@mail.aiworkin.com",
    "verifiedAt": "2026-11-10T07:00:00.000Z"
  },
  "quota": {
    "writesUsedThisHour": 1,
    "writesLimitPerHour": 5,
    "writesUsedToday": 3,
    "writesLimitPerDay": 20
  },
  "counts": {
    "pending": 0,
    "failed": 1,
    "dead": 0
  },
  "lastPullAt": "2026-11-10T07:30:00.000Z",
  "preferences": {
    "friendRequestOutbound": true,
    "friendRelationOutbound": true,
    "friendRelationInbound": false,
    "mailOutboundDefault": false,
    "mailInbound": false,
    "businessReasonVisible": true
  }
}
```

---

## 11. 可靠性、限流与安全

### 11.1 Outbox 状态机

```
PENDING ──claim──► RUNNING ──success──► SUCCEEDED
   ▲                  │
   │                  ├─ 429/5xx/timeout ─► FAILED ──backoff──► PENDING
   │                  ├─ 4xx 参数/权限 ───► DEAD
   │                  └─ RUNNING > 5min ──► PENDING（租约回收）
   └──────────────────────────────────────┘
```

领取实现（跨 MySQL/PG）：

```ts
const candidates = await prisma.socialSyncJob.findMany({
  where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
  orderBy: { id: 'asc' },
  take: 20,
});

for (const job of candidates) {
  const claimed = await prisma.socialSyncJob.updateMany({
    where: { id: job.id, status: 'PENDING' },
    data: { status: 'RUNNING', lockedAt: new Date(), attempts: { increment: 1 } },
  });
  if (claimed.count === 0) continue; // 被其他实例抢走
  await execute(job);
}
```

退避：30s → 2min → 10min → 1h → 6h，最多 8 次；超过转 `DEAD`。调度间隔 15s，单批 20 条，并发 2。

### 11.2 幂等

| 动作 | 幂等键 |
| --- | --- |
| 好友申请 | `sns-fr-{localRequestId}-{hash16}` |
| 接受/拒绝 | `sns-frh-{localRequestId}-{ACCEPT|REJECT}` |
| 私信 | `sns-mail-{localMessageId}-{hash16}` |
| 回填好友 | `sns-bf-{userId}-{friendUserId}` |

规则：

- 同一逻辑写操作重试必须复用原键。
- 内容变化（改私信正文）视为新操作，生成新键。
- 上游返回幂等冲突时视为成功，读取已有结果。

### 11.3 限流预算

Skill 标注的额度很紧：写 5/Key/小时、20/用户/天。实现要点：

- 入队前检查滚动窗口计数（`social_sync_jobs` 按 `userId`/`keyId` + `createdAt`，只统计写动作 `FRIEND_REQUEST_SEND`、`FRIEND_REQUEST_HANDLE`、`MAIL_SEND`、`BACKFILL_FRIEND`，读动作不计入写额度）。
- 超出用户日额度：`PENDING` + `nextAttemptAt=次日 00:05`，前端显示「已排队，预计明日发送」。
- 超出 Key 小时额度：顺延到下一小时窗口。
- 收到 429：读取 `Retry-After`（若有），否则指数退避；**不得**绕过限流。
- 批量回填按额度分批，显示预计完成天数。
- 额度规则集中在 `SocialSyncQuota` 常量与配置项，Phase 0 用真实响应校准。

### 11.4 可观测性

- 结构化日志：`jobId`、`userId`（脱敏/哈希）、`action`、`attempt`、`durationMs`、`result`、`errorCode`。
- 指标：入队数、成功数、失败数、`DEAD` 数、429 次数、平均延迟、回填进度。
- 同步失败进入站内通知（复用通知中心），文案给出「查看原因 / 重试」入口。
- 管理员可选看板：全局同步健康度、按动作失败率（不展示消息正文）。

### 11.5 安全清单

1. **个人 Key only**：`AiworkinSocialService` 不读取平台 Key；代码评审加断言。
2. **不落明文**：Key 只在内存中解密使用；日志、错误信息、job payload 都不含 Key。
3. **不信任上游内容**：SNS 资料/私信/摘要视为数据；不拼入系统提示词，不据此自动调用工具。
4. **XSS**：私信正文按纯文本渲染；`linkCards` 的 URL 只允许 `http/https`，域名白名单校验；不渲染上游 HTML。
5. **SSRF**：不抓取上游返回的任何 URL；简历链接只做字符串展示与跳转。
6. **越权**：所有 job 按 `userId + keyId` 隔离；调度器执行前再次校验 binding 仍属于该用户。
7. **解绑即停**：解绑/失效后，`PENDING` job 转 `DEAD`，不执行。
8. **敏感业务数据**：推荐理由只输出关系类型；合同金额、订单金额、客户名不出现在理由、日志、上游 payload 中。
9. **审计**：所有跨站写记录 `IdentityService.audit`（动作、对象、结果），便于追溯。
10. **开关默认保守**：入站回流、邮件同步默认关闭；写失败不影响本地。

### 11.6 隐私与同意

- 用户可在「同步设置」逐项开关；关闭后立即停止新入队，已入队未执行的 `PENDING` 取消。
- `discoverable=false` 的用户不出现在任何人的推荐候选里。
- `businessReasonVisible=false` 时业务理由降级为「有业务往来」。
- 组织名称展示沿用组织资料可见性；部门名可脱敏。
- 提供「导出我的同步记录」与「删除同步记录」（Phase 4，可选）。

---

## 12. 前端改造

| 位置 | 改造 |
| --- | --- |
| `social/_components/friends-tab.tsx` | 右侧栏新增「可能认识的人」卡片列表；每张卡展示头像、姓名、职位/城市、理由标签、匹配度分档；操作「加好友」「不再推荐」 |
| 好友申请卡片 | 增加上游状态徽标：`已同步` / `待同步` / `仅本地`；接受/拒绝按钮旁增加「同步到 AIworkin」复选框（默认按偏好） |
| 添加好友弹窗 | 显示对方是否已绑定 AIworkin；未绑定则提示「本次仅本地生效」；绑定则显示同步复选框 |
| `social/_components/mail-tab.tsx` | 写信弹窗增加「同时发送到 AIworkin 私信」复选框；消息气泡显示同步状态；失败可重试 |
| `social/_components/profile-tab.tsx` | 新增「AIworkin 同步」面板：身份状态、Key 入口、上游邮箱地址、同步偏好、配额、失败任务、立即拉取、批量回填 |
| `social/page.tsx` | 页面描述从「本地闭环」改为「本地为主，可选同步 AIworkin」 |
| `frontend/src/api/social.ts` | 新增 `recommendations`、`dismissRecommendation`、`getSyncPreferences`、`saveSyncPreferences`、`getSyncOverview`、`retrySyncJob`、`pullUpstream`、`backfillFriends`；好友/私信入参增加 `syncUpstream` |
| 通知中心 | 增加「同步失败」类别，点击跳到同步面板 |

交互约束：

- 页面进入即加载，不提供手动刷新按钮；同步状态用 `useBusinessQuery` 失效/轮询更新。
- 「立即从 AIworkin 拉取」「开始批量回填」是明确的用户动作，放在同步设置里，不作为列表刷新按钮。
- 所有阻断提示必须给出可点击入口（API Key 管理、AIworkin 授权页、重试按钮）。

---

## 13. 分阶段实施

### Phase 0：能力探测与契约固化（1–2 天）

- 用真实个人 Key 调用只读工具，记录返回结构：
  - `sns_list_relationships`
  - `sns_list_mail_inbox` / `sns_list_mail_sent`
  - `sns_get_my_mail_address`
  - `sns_search_users` / `sns_get_profile`
- 确认：
  - 是否返回待处理好友申请及 `requestId`
  - 私信是否返回消息 ID、时间、已读状态、对方用户 ID
  - `sns_send_friend_request` 成功响应字段
  - 429/错误码结构
- 产出：`docs/api/aiworkin-sns-tool-contract.md`（脱敏示例）。
- 若入站申请不可得，锁定「只做已接受关系回流」。

### Phase 1：推荐引擎（4–6 天）

- 迁移 `0063`，新增身份/偏好/快照/反馈表。
- `SocialAffinityService`：候选集、排除规则、打分、理由、快照。
- `GET /recommendations` + dismiss。
- 好友页「可能认识的人」UI。
- 单元测试：打分、排除、隐私降级、双库查询。

### Phase 2：出站好友同步（5–7 天）

- `SocialSyncService` + outbox + scheduler。
- `AiworkinSocialService`（只取个人 Key）。
- 好友申请/接受/拒绝的入参与状态。
- 同步状态徽标、失败重试、错误提示。
- 集成测试：mock MCP 成功/409/429/500/超时；本地动作不受影响。

### Phase 3：入站回流与私信（6–8 天）

- `sns_list_relationships` 回流（按 Phase 0 结论）。
- 私信逐条同步、inbox/sent 回流、去重、防回环。
- 同步设置面板、配额显示、批量回填。
- 端到端：双账号绑定/未绑定、接受/拒绝、私信勾选、冲突。

### Phase 4：增强（可选，3–5 天）

- `sns_summarize_profile` 资料摘要卡片（缓存）。
- `sns_draft_social_mail` AI 起草（计费确认）。
- 上游用户搜索「在 AIworkin 发现同行」。
- 同步记录导出/删除。
- 将 `listing`/`hiring` 的旧同步逻辑迁移到统一 outbox（技术债清理）。

---

## 14. 测试与验收

### 14.1 单元测试

- 推荐打分：固定信号 → 固定分数；时间衰减；封顶；多样性限制。
- 排除规则：自己、好友、待处理、拉黑、关闭发现、拒绝冷却。
- 隐私降级：`businessReasonVisible=false` 不出业务细节。
- 幂等键：同内容稳定、不同内容变化、长度 16–100。
- Outbox：状态迁移、退避、租约回收、DEAD。
- 身份状态：未绑定、失效、占位 ID、无 SNS 授权、READY、REVOKED。

### 14.2 集成测试（mock MCP）

| 场景 | 期望 |
| --- | --- |
| `sns_send_friend_request` 成功 | 本地申请成功；job SUCCEEDED；link 写入；只调用一次 |
| 上游 500 | 本地申请成功；job FAILED；重试后成功；上游只产生一次申请 |
| 上游 429 | 本地成功；顺延窗口；不绕过限流 |
| 上游 400 | 本地成功；job DEAD；状态可读 |
| 接受时上游超时 | 本地好友已建立；job 重试；最终回写 |
| 私信成功 | 本地消息 + 上游一条；重复重试不重复发 |
| 私信正文 3001 字 | 本地可发；同步禁用并给原因 |
| 入站回流 | 只新增；不重复；不触发再出站 |
| 本地拉黑后上游仍是好友 | 不复活；link CONFLICT；提示用户 |

### 14.3 端到端验收

1. A、B 都绑定有效 Key：
   - A 加 B → 本地待处理；15 秒内上游申请成功；B 的 AIworkin 收到申请。
   - B 在本地点接受 → 本地好友建立；上游关系建立；双方状态 `SYNCED`。
2. B 未绑定 Key：
   - A 加 B → 本地成功；显示「对方未绑定，仅本地」；不产生写调用。
3. 上游故障：
   - 本地动作全部成功；同步面板显示失败数与原因；重试后成功；无重复副作用。
4. 私信：
   - 勾选同步 → 本地 + 上游各一条；取消勾选 → 仅本地；回流 → 不重复、不回环。
5. 推荐：
   - 共同好友/同组织/合同关系能出现在理由中；拉黑/好友/待处理不出现；「不再推荐」90 天内消失。
6. 安全：
   - 日志无 Key；平台 Key 未被用于 SNS；上游 HTML 不被执行；跨用户 job 不可见。
7. 双库：
   - MySQL 与 PostgreSQL 迁移均成功；推荐查询结果一致。

### 14.4 验收指标

- 推荐接口 p95 < 300ms（有快照）/ < 800ms（首次计算，1 万用户规模）。
- 同步任务 15 秒内开始执行；失败可见率 100%。
- 本地接口不因上游故障产生 5xx。
- 同步产生的重复外部副作用 = 0。

---

## 15. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| `sns_list_relationships` 不返回待处理申请 | 入站申请无法导入 | Phase 0 探测；退化为只回流已接受关系；用 Legacy 通知补充提醒 |
| `aipddUserId` 为 `dev-` 占位 | 全部 SNS 调用失败 | 身份预检 + `PLACEHOLDER_ID` 状态 + 明确入口 |
| 个人 Key 未开通 SNS 授权 | 调用 403 | `SNS_GRANT_MISSING` 状态与授权说明 |
| 写额度极低（5/小时、20/天） | 批量回填极慢 | 明示额度、分批、暂停/继续、优先最近联系人 |
| 身份错绑 | 发错人/泄露关系 | 只认 UUID，人工确认，不按昵称自动匹配 |
| 上游资料含恶意内容 | XSS/提示注入 | 纯文本渲染、URL 白名单、内容当数据 |
| 同步导致重复私信 | 打扰用户 | 稳定幂等键 + remoteId 去重 + 防回环 |
| 删除/拉黑无法同步 | 用户误解 | UI 明确「仅本地生效」，给 AIworkin 操作入口 |
| Legacy 与 MCP 双通道并存 | 重复发送/状态混乱 | `channel` 偏好；有个人 Key 优先 MCP；按 remoteId 去重 |
| 双库差异 | 迁移/查询失败 | Prisma 聚合、避免方言函数、CI 双库回归 |
| 推荐泄露业务敏感信息 | 合规风险 | 只输出关系类型；金额/合同/订单明细永不出现在推荐理由 |

---

## 16. 待确认问题

1. 「双方都有 Key 时默认同步好友关系」是否作为默认开启？本方案默认开启，但每次接受/拒绝仍有可见复选框。
2. 业务理由是否允许展示组织名称？本方案默认展示（沿用组织资料可见性），关闭后降级。
3. 入站好友申请默认关闭是否符合预期？本方案默认关闭，避免上游关系突然涌入。
4. 私信同步默认关闭是否可接受？本方案默认关闭，逐条勾选。
5. 批量回填是否需要管理员代操作能力？本方案仅用户自助。
6. Legacy SNS 通道（共享 JWT）是否在个人 Key 普及后下线？本方案先双通道并存，Phase 4 再评估。

---

## 附录 A：SNS 工具调用封装示例

```ts
// backend/src/social/aiworkin-social.service.ts
export class AiworkinSocialService {
  constructor(
    private readonly keys: AipddKeyService,
    private readonly prisma: PrismaService,
  ) {}

  private async client(userId: string) {
    const token = await this.keys.resolveToken(userId); // 仅个人 Key
    // 注意：McpClient 当前固定 CALL_TIMEOUT=90s，没有 timeoutMs 构造项；
    // 如需更短超时，先在 agent-mcp.client.ts 增加可配置项，不要在此伪造参数。
    return new McpClient({
      transport: 'http',
      url: `${aiworkinBaseUrl()}/mcp`,
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  async sendFriendRequest(userId: string, toUpstreamUserId: string, message: string, idempotencyKey: string) {
    const client = await this.client(userId);
    return client.callToolRaw('sns_send_friend_request', {
      toUserId: toUpstreamUserId,
      message: message.slice(0, 200),
      idempotencyKey,
    });
  }

  async handleFriendRequest(userId: string, requestId: number, action: 'ACCEPT' | 'REJECT', idempotencyKey: string) {
    const client = await this.client(userId);
    return client.callToolRaw('sns_handle_friend_request', { requestId, action, idempotencyKey });
  }

  async sendMail(userId: string, input: {
    toUpstreamUserId: string;
    subject: string;
    body: string;
    linkCards?: Array<{ type: string; title: string; url: string }>;
    idempotencyKey: string;
  }) {
    const client = await this.client(userId);
    return client.callToolRaw('sns_send_social_mail', {
      toUserId: input.toUpstreamUserId,
      subject: input.subject.slice(0, 200),
      body: input.body.slice(0, 3000),
      aiGenerated: false,
      linkCards: input.linkCards?.slice(0, 5),
      idempotencyKey: input.idempotencyKey,
    });
  }
}
```

## 附录 B：推荐打分伪代码

```ts
function score(candidate: Candidate, viewer: Viewer): Recommendation | null {
  if (isExcluded(candidate, viewer)) return null;

  const signals = {
    mutualFriends: Math.min(1, candidate.mutualFriends / 5),
    sameOrg: candidate.sameOrg ? 1 : 0,
    business: Math.min(1, candidate.businessLinks / 3),
    groups: Math.min(1, candidate.sharedGroupsAndInteractions / 5),
    experience: Math.min(1, candidate.sharedOrgs / 2),
    city: candidate.sameCity ? 1 : 0,
    upstream: candidate.upstreamFriend ? 1 : 0,
    activity: candidate.profileScore,
  };

  const raw =
    signals.mutualFriends * 24 +
    signals.sameOrg * 18 +
    signals.business * 20 +
    signals.groups * 12 +
    signals.experience * 8 +
    signals.city * 6 +
    signals.upstream * 6 +
    signals.activity * 6;

  const value = Math.round(Math.max(0, raw * candidate.recency - candidate.penalty));
  if (value < 40) return null;

  return {
    targetUserId: candidate.userId,
    score: value,
    reasons: buildReasons(candidate, viewer),
  };
}
```

## 附录 C：本方案涉及的核心文件

| 文件 | 作用 |
| --- | --- |
| `backend/src/social/social.service.ts` | 本地好友/私信主逻辑 |
| `backend/src/social/social.routes.ts` | 社交路由注册 |
| `backend/src/account/aipdd-key.service.ts` | 个人 Key 解析、状态校验 |
| `backend/src/account/account-crypto.ts` | Key 加解密 |
| `backend/src/content/agent-mcp.client.ts` | MCP Streamable HTTP 客户端 |
| `backend/src/aiworkin/aiworkin.config.ts` | AIworkin 地址/超时配置 |
| `backend/src/sns/sns.client.ts` | Legacy SNS 通道（兼容） |
| `backend/prisma/schema.prisma` | 数据模型与迁移源 |
| `frontend/src/api/social.ts` | 前端社交 API 封装 |
| `frontend/src/app/social/_components/friends-tab.tsx` | 好友页 |
| `frontend/src/app/social/_components/mail-tab.tsx` | 私信页 |
| `frontend/src/app/social/_components/profile-tab.tsx` | 资料/同步设置 |
