# AIworkin SNS MCP 工具契约（Phase 0 固化）

> 用途：商务社交同步（`backend/src/social/*`）只能依赖这里列出的入参。凡是标注「返回结构未验证」的，
> 代码必须做防御式解析（`unknown` → 逐字段取字符串 / 数组），不得假定字段一定存在。
>
> 探测时间：2026-11-10；服务端：`https://api.aiworkin.com/mcp`，协议 `2025-06-18`，
> server `aiworkin-mcp` v4.3.0。凭据形态：`Authorization: Bearer <sk-...>`（**仅个人 Key**）。

## 1. 工具总览

`tools/list` 实际返回 **30** 个工具：市场 16、GEO 3、SNS 11。上游 Skill 文档曾写 13 个，
其中 `list_content` / `get_content` 已不存在，多出 GEO 工具；以服务端实际返回为准。

本系统只使用 SNS 11 个：

| # | 工具 | 读/写 | 用途 |
| --- | --- | --- | --- |
| 1 | `sns_search_users` | 读 | 按关键词找人，仅用于「候选确认」 |
| 2 | `sns_get_profile` | 读 | 上游用户资料 |
| 3 | `sns_summarize_profile` | 读 | AI 资料摘要（计费） |
| 4 | `sns_list_relationships` | 读 | 好友/关系列表（入站回流来源） |
| 5 | `sns_send_friend_request` | 写 | 发起好友申请 |
| 6 | `sns_handle_friend_request` | 写 | 接受/拒绝好友申请 |
| 7 | `sns_draft_social_mail` | 写 | AI 起草私信（计费，需 `draft_mail`） |
| 8 | `sns_send_social_mail` | 写 | 发送私信（需 `send_mail`） |
| 9 | `sns_list_mail_inbox` | 读 | 收件箱 |
| 10 | `sns_list_mail_sent` | 读 | 已发送 |
| 11 | `sns_get_my_mail_address` | 读 | 当前 Key 对应的站内邮箱地址 |

上游**没有**：删除好友、拉黑、取消申请、好友申请列表、修改备注。对应本地操作只做本地生效。

## 2. 入参（来自 `tools/list` 的 inputSchema）

```ts
sns_search_users: {
  q: string;              // 关键词（至少 1 字符）
  page?: number;          // 默认 1
  pageSize?: number;      // 默认 20，上限 50
}

sns_get_profile: { userId: string }        // UUID
sns_summarize_profile: { userId: string; lang?: string }

sns_list_relationships: {}                 // 无入参

sns_send_friend_request: {
  toUserId: string;       // UUID
  message?: string;       // ≤ 200
  idempotencyKey: string; // 16–100 字符
}

sns_handle_friend_request: {
  requestId: number;      // 正整数（上游申请 ID）
  action: 'ACCEPT' | 'REJECT';
  idempotencyKey: string; // 16–100
}

sns_draft_social_mail: {
  toUserId: string;
  intent: string;
  notes?: string;
  aiExecution?: boolean;
  idempotencyKey: string;
}

sns_send_social_mail: {
  toUserId: string;
  subject?: string;       // ≤ 200
  body: string;           // ≤ 3000
  aiGenerated?: boolean;
  linkCards?: Array<unknown>; // ≤ 5
  idempotencyKey: string;     // 16–100
}

sns_list_mail_inbox: {}
sns_list_mail_sent: {}
sns_get_my_mail_address: {}
```

### 入参硬约束（入队前校验，不做静默截断）

| 约束 | 处理 |
| --- | --- |
| 正文 ≤ 3000 字 | 超出 `BODY_TOO_LONG`，仅本地发送 |
| 标题 ≤ 200 字 | 超出 `SUBJECT_TOO_LONG` |
| 卡片 ≤ 5 个 | 超出 `TOO_MANY_CARDS` |
| 卡片 URL 仅 `http/https` | 非法 `INVALID_CARD_URL` |
| `toUserId` 必须是 UUID | 否则 `PLACEHOLDER_ID`，不发起调用 |
| 幂等键 16–100 字符 | 内部生成，超长直接截断到 100 |

## 3. 返回结构

> 本机探测结论：本地三个 `AipddKey` 的 `aipddUserId` 全部是 `AIPDD_KEY_VERIFY=off`
> 生成的 `dev-` 占位（16 字符，非 UUID），且没有真实个人 Key 可供联调。
> 为避免误发真实写操作，Phase 0 **没有**实际调用任何 `sns_*` 工具，
> 所有返回结构均按通用 MCP JSON 结果处理，待真实 Key 联调后回填本文件。

当前代码约定：

- 统一走 `McpClient.callToolRaw()`，优先读取 `structuredContent`，缺失时解析 `content[].text` 的 JSON。
- 业务失败可能是 `isError=true` 的**正常结果**，也可能是 JSON-RPC 错误；两者都归为上游失败。
- 已知可能出现的字段（防御式读取，全部可选）：

| 工具 | 可能字段 | 代码取值 |
| --- | --- | --- |
| `sns_list_relationships` | `items[] / relationships[] / friends[]`；元素含 `userId`、`username`、`status`、`requestId` | 逐数组取，元素字段转字符串 |
| `sns_send_friend_request` | `requestId`、`id`、`status` | `requestId ?? id` |
| `sns_handle_friend_request` | `ok`、`status` | 无 ID 需求 |
| `sns_send_social_mail` | `messageId`、`id`、`threadId` | `messageId ?? id` |
| `sns_list_mail_inbox/sent` | `items[] / messages[]`；元素含 `id`、`fromUserId`、`toUserId`、`subject`、`body`、`createdAt`、`linkCards`、`aiGenerated`、`read` | 逐字段转字符串/布尔 |
| `sns_get_my_mail_address` | `address`、`email` | 取字符串 |

联调后请把真实样例（脱敏）补到本节，并同步调整 `backend/src/social/aiworkin-social.service.ts` 的解析器。

## 4. 限流与计费

| 类型 | 额度 |
| --- | --- |
| 写 | 5 次 / Key / 小时；20 次 / 用户 / 天 |
| 读 | 60 次 / Key / 分钟；300 次 / 用户 / 5 分钟 |
| 计费 | `sns_summarize_profile`、`sns_draft_social_mail` 计费；其余按平台规则 |

实现口径：只有写动作（`FRIEND_REQUEST_SEND`、`FRIEND_REQUEST_HANDLE`、`MAIL_SEND`、
`BACKFILL_FRIEND`）计入写额度；读动作不占写额度。429 按 `Retry-After` 或指数退避重试，
不得绕过限流。

## 5. 安全边界

1. 只用 `UserAipddBinding → AipddKey` 解密出的个人 Key；平台 Key 不参与 SNS。
2. Key 只在内存中使用；日志、错误、Job payload、接口返回都不出现明文。
3. 上游资料、私信、摘要一律当数据，不拼入提示词、不据此自动调用工具。
4. 私信正文按纯文本渲染；`linkCards` 只保留协议合法的 URL，不抓取。
5. 所有写操作先落本地 outbox（`social_sync_jobs`），由调度器执行；本地成功不依赖上游成功。
