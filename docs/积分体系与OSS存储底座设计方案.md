# 积分体系与 OSS 存储底座设计方案

> 版本：v1.1（2026-11-07，M2/M6 存储底座已落地并校准 §8.4）
> 范围：① 全系统存储底座统一切换为阿里云 OSS（含数字资产管理）；② 站内积分体系（可小数）；③ 积分充值（微信支付的后台配置 + 前台自助）；④ 账号间积分赠送；⑤ 绑定 AIPDD APIKey 后 AWcoin 与站内积分双币展示；⑥ 行为奖励与功能消耗的计费设计（CRM / BI / OA / AI 客服 / 数字资产）。
> 口径声明：本方案推翻《开源版整体设计方案》中「开源版不涉币、awcoin 奖励整段删除」的旧口径——改为 **AWcoin 仍归 AIPDD 上游（只展示不结算），本站自建积分钱包（涉充值与扣费）**。实施后需同步修订旧文档对应段落。

### 实施状态速览（2026-11-07）

| 阶段 | 状态 | 落地位置 |
|---|---|---|
| M1 积分账户/流水/后台调整 | ✅ 已交付 | `backend/src/points/`、`frontend/src/app/points/` |
| M2 OSS 底座（数字资产直传 + 删除联动） | ✅ 已交付（本次） | `backend/src/storage/storage.service.ts`、`backend/src/content/digital-asset.service.ts` |
| M3 微信充值/回调/查单 | ✅ 已交付 | `backend/src/points/recharge.service.ts`、`wechat-pay.client.ts` |
| M4 赠送 + 注册/邀请奖励 | ✅ 已交付 | `points.service.ts`、`points-settings.service.ts` |
| M5 模块定价 + 按天存储出账 + 欠费 | ✅ 已交付 | `pricing.service.ts`、`points-daily.scheduler.ts` |
| M6 存量迁移 + 后台容量台账 | ✅ 已交付（本次） | `backend/src/storage/storage-migration.service.ts`、`frontend/src/app/admin/_components/storage-ledger-panel.tsx` |
| §8.4 AI 科目种子 | ✅ 已对齐（本次） | `backend/src/points/billing-rule.service.ts` |
| 外联流量计费 / 私有读签名 URL | ⏳ 预留未启用 | 单价字段与 `OssService` 签名能力已具备，按方案暂不启用 |

---

## 一、总体架构：三个平面

```
┌─────────────────────────────────────────────────────────┐
│ 字节平面   阿里云 OSS（本站自有桶，唯一存储底座）           │
│            附件 / 数字资产 / AI 产物 / 头像 → 一套 StorageService │
├─────────────────────────────────────────────────────────┤
│ 资金平面   人民币（微信支付，仅"充值入"一条通道）             │
│            ──按管理员配置的汇率──▶ 积分钱包（站内唯一支付手段） │
│            AWcoin（AIPDD 上游币，只读取展示，永不与积分互兑）   │
├─────────────────────────────────────────────────────────┤
│ 行为平面   赚积分：注册赠分 / 邀请奖励 / 管理员调整            │
│            花积分：充值 / 存储计量 / 功能计费（CRM·BI·OA·AI客服）│
│            转积分：账号间赠送（管理员可开关、限额）              │
└─────────────────────────────────────────────────────────┘
```

设计原则：
1. **积分是站内唯一计费货币**：所有"用钱"场景（存储、功能、后续 AI 定价）从同一个钱包扣，流水一本账，可审计、可对账。
2. **双币隔离**：AWcoin 属于 AIPDD 生态，本站积分属于本站；界面并列展示、后端不折算不混扣，避免与上游结算纠缠。
3. **先充后用 + 事后计量**：功能调用类"先扣后用"（余额不足即拒绝）；存储类按天快照出账（欠费宽限后冻结而非删除）。
4. **一切费率皆配置**：汇率、赠分、单价、免费额全部管理员可改，代码里只留"默认建议值"。

---

## 二、存储底座：统一阿里云 OSS

### 2.1 现状与目标

| 事项 | 现状 | 目标 |
|---|---|---|
| 附件存储 | 已走本站 `OssService`（OSS V4 签名 PUT，桶 `aiworkinenterprise`，`asset/` 前缀，公开读直链） | 保持 |
| 数字资产/AI 产物 | 经 AIPDD `/oss/upload` **中转代存**（数据主权在平台、二次传输、依赖上游可用性） | 全部改写为**直传本站 OSS**，一步落库 |
| 记账 | `DigitalAssetEntry` 台账引用 `aipddAssetId` | 台账改为本站主键 + `ossKey`，字节大小、归属、标签本站自控 |
| 与 AIPDD 关系 | 上传口即资产登记口 | 解耦：上传归本站 OSS；用户勾选「同步到 AIPDD 资产库/发布到 AIworkin」时再调上游 `register`（保留 `AipddAssetClient.register`，删掉其 `upload` 用途） |

### 2.2 方案设计

- **统一出口**：新增 `StorageService` 薄封装（`put/delete/urlOf/stat`），内部即现有 `OssService`；所有业务模块（content 数字资产、AI 客服素材、CRM 附件、头像、导出报表临时文件等）禁止再持有字节落盘或走第三方中转。
- **对象键规范**：`asset/enterprise/{userId}/{yyyymm}/{uuid}.{ext}`（沿用现有 dir 前缀与公开读；`attachment-files.ts` 已有按扩展名定 contentType）。
- **单文件上限**：维持现状 100MB（`AIPDD_MEDIA_MAX_BYTES` 口径迁移为本站 `STORAGE_MAX_BYTES`）；分片上传、直传 STS 凭证列为后续演进，不在本期。
- **删除语义**：删台账即删 OSS 对象（尽力删除 + 孤儿对象巡检任务兜底），保证"存储计量 = 台账和"。
- **访问控制**：本期维持公开读直链（简单、零签名成本），文案与设置页提示"知道链接即可访问"；桶私有读 + V4 预签名 URL 作为可选增强项预留（`OssService.signUrl` 已可后补）。
- **存量迁移**（一次性任务，管理员在后台点「开始迁移」）：
  1. 遍历 `DigitalAssetEntry` 且来源为 AIPDD 的记录，按 `url` 下载 → 上传本站 OSS → 更新台账 `url/ossKey/fileSize`，打 `migratedFrom=aipdd` 标记；
  2. 分批可中断续跑、失败记录原因可重试；迁移期间新旧链接并存可读；
  3. 迁移完成后 AIPDD 侧副本由用户自行决定去留（本站不调上游删除接口，尊重上游归属）。
- **计量口径（供积分扣费）**：
  - 存储量 = 台账 `SUM(fileSize)`，每日 00:30 任务写入 `storage_daily_snapshots`（userId、bytes、快照时间）——按天计费的账单源；
  - 外联流量本期**只观测不计费**（从 OSS 计量/云监控接口拉数展示），单价字段预留，三个月后按成本情况决定是否启用（行业惯例：小流量包进存储费，避免账单噪声）。

### 2.3 落地实现（2026-11-07）

| 能力 | 实现位置 | 落地口径 |
|---|---|---|
| 统一存储出口 | `backend/src/storage/storage.service.ts` | `put / remove / urlOf / stat` 薄封装，业务模块只依赖 `StorageService`，不再各自持有 `OssService` |
| OSS 对象能力 | `backend/src/oss/oss.service.ts` | PUT / DELETE / HEAD 共用 V4 签名；`remove()` 404 视为成功（幂等）；`stat()` 返回存在性、大小与 contentType |
| 可公开对象类型 | `backend/src/oss/attachment-files.ts` | 附件白名单（jpg/jpeg/png/pdf/doc/docx/xls/xlsx）与通用对象类型分离；HTML / SVG / XML / JS 等可执行内容拒绝公开存储 |
| 数字资产直传 | `backend/src/content/digital-asset.service.ts` | 字节直传本站 OSS，对象键 `enterprise/{userId}/library/...` 或 `enterprise/{userId}/agent/...`（OSS 服务统一加配置目录前缀，默认 `asset/`）；台账写 `ossKey`，本地行以负数 `aipddAssetId = -id` 占位 |
| 删除联动 | `digital-asset.service.ts` + `Content_deleteDigitalAsset` | 删台账后尽力删 OSS；OSS 删除失败只写告警日志、不回滚台账；历史 AIPDD 托管行不调上游删除，响应标记 `upstreamRetained` |
| 容量台账 | `Storage_overview` | 总数 / 已在本站 OSS / 历史待迁移 / 已迁移、`SUM(fileSize)`、最近一次按天快照、存储定价 |
| 存量迁移 | `Storage_migrate` | 按台账 `id` 游标分批，`limit` 1–100（默认 20）；失败行**不改写台账**，下次从头重跑会自然重试；每批写审计日志 |
| 后台入口 | `frontend/src/app/admin/_components/storage-ledger-panel.tsx` | 「系统设置 → 文件存储」展示容量、定价、迁移按钮、逐条成功/失败原因 |
| 用户删除入口 | `frontend/src/app/assets/page.tsx` | 资产卡逐条删除（带确认），删除后同步列表与总数 |

存量迁移的安全与健壮性约束：

1. 下载前必须过 `assertOutboundUrl`（拒绝内网 / 回环 / 非 HTTP(S) 地址），`redirect: 'error'` 防跳转绕过；
2. 单文件上限沿用 `AIPDD_MEDIA_MAX_BYTES`，下载超时 300 秒；
3. 新对象键 `enterprise/{userId}/migrated/{timestamp}-{random}-{safeName}.{ext}`，与直传资产同桶同目录；
4. 成功后回填 `ossKey / url / previewUrl / fileSize`，并标记 `migratedFrom = aipdd`；
5. **判定口径**：`ossKey` 非空 = 字节已在本站 OSS；`ossKey` 为空 = 仍托管在 AIPDD（迁移候选）。

验证证据（本次）：

- `backend/src/oss/oss.service.spec.ts`：DELETE 签名与 404 幂等、HEAD 存在/不存在；
- `backend/src/oss/attachment-files.spec.ts`：通用对象类型与危险扩展名拒绝；
- `backend/src/storage/storage-migration.service.spec.ts`：容量汇总、成功迁移回填、失败行不动可重试；
- `backend/src/points/billing-rule.service.spec.ts`：§8.4 全部科目种子值与旧科目清理。

---

## 三、积分体系：账户与流水

### 3.1 积分定义

- 名称：**积分**（英文 Credits），站内预付费虚拟计量单位，非货币、不可兑换人民币、不可交易（仅可赠送，见 §5）。
- **精度**：支持小数，存储与计算一律 `Decimal(18,4)`（严禁 Float——现有 `DigitalAssetEntry.fileSize` 是 Float，仅用于展示计量，换算积分前须经快照表转 Decimal）。
- 展示规则：余额最多 4 位小数、去尾零展示；列表/账单最多 2 位；扣费提示保留实际精度。
- **汇率**：管理员配置 `points_rate`（1 元人民币 = N 积分），**默认建议 1 元 = 10 积分**（1 积分 = 0.1 元）。取 10 的理由：单价换算后数字落在 0.1–100 区间，感知细腻又不出现在 0.00x 的过碎账单（行业参照：游戏/云服务积分面额普遍 1 元 = 10~100）。
- 汇率修改只影响**新订单**（订单落 `rateSnapshot` 快照），永不追溯已充值积分。

### 3.2 数据模型（新表，字段命名遵循项目 xxxAmount DECIMAL 规范）

| 表 | 关键字段 | 说明 |
|---|---|---|
| `point_accounts` | `userId`(唯一)、`balanceAmount`、`totalRechargeAmount`、`totalEarnAmount`、`totalSpendAmount`、`status`(ACTIVE/ARREARS)、`updatedAt` | 与 Account 一对一；注册时懒建（余额 0 + 赠送入账） |
| `point_transactions` | `userId`、`type`(RECHARGE/RECHARGE_BONUS/EARN/SPEND/TRANSFER_OUT/TRANSFER_IN/ADMIN_ADJUST)、`scene`(invite/register/asset_storage/crm/bi/oa/ai_service/gift/…)、`amount`(**有符号** Decimal)、`balanceAmount`(事后余额)、`refType/refId`、`operator`、`remark`、`createdAt` | **只追加不可改删**的总账；每条消费一行一账单 |
| `recharge_orders` | `orderNo`(复用单据号体系 recharge 前缀 RP)、`userId`、`amountCents`(微信整数分)、`rateAmount`(成交汇率)、`pointsAmount`、`bonusPointsAmount`、`channel`(WECHAT)、`status`(CREATED/PAID/CLOSED/FAILED)、`transactionId`(微信回调，**唯一索引=幂等键**)、`codeUrl`、`paidAt`、`notifyPayload` | 建单锁定汇率与赠送 |
| `point_settings` | `key/value` 键值（`points_rate`、`recharge_min_cents`、`recharge_tiers`(JSON 档位+赠送)、`signup_bonus`、`invite_reward_signup`、`invite_reward_recharge_rate`、`transfer_enabled`、`transfer_min`、`transfer_daily_limit`、`arrears_grace_days`、微信配置等） | 敏感键（商户私钥/APIv3 key）AES-256-GCM 密文入库，复用 `AliyunMailCrypto` 同款派生密钥模式，接口永不回显 |
| `module_pricing` | `code`(asset_storage/crm/bi/oa/ai_service/…)、`mode`(FREE/METERED)、`unit`(如 gb_day/query/session/seat_month)、`unitPriceAmount` Decimal、`freeQuotaMonthly`、`minChargeAmount`(最低起扣)、`enabled` | 单价=0 即该模块免费；管理员随时改。一体化模块 AI 科目（insight_report/kb_ingest/kb_query/kb_lint/mkt_skill_run/mkt_skill_eval/recruit_job_eval/recruit_resume_tailor/skill_review/hrm_resume_score/jd_generate）见 §8.4 |
| `usage_events` | `userId`、`code`、`quantityAmount`、`occurredAt`、`billed`、`billTxId` | 实时扣费类可跳过此表直记流水；此表主要服务按天聚合出账 |
| `storage_daily_snapshots` | `userId`、`bytesAmount`(BigInt→Decimal 计费)、`snapshotAt` | 存储按天计费源 |

### 3.3 一致性规则（关键实现约束）

- **扣费原子化**：`UPDATE point_accounts SET balance = balance - :x WHERE user_id = :u AND balance >= :x`，影响行数 0 = 余额不足；成功才在同一 `$transaction` 内写 `point_transactions`。加量方向同理对称处理。
- 赠送（transfer）双向原子：先扣后加在同一事务内，两条流水共用同一 `refId` 配对；任一行失败整体回滚。
- 所有余额变更必过流水，`balanceAmount` 事后余额可全量对账（Σamount == 当前余额）。
- 金额计算后端全部 `Prisma.Decimal`，前端仅展示。

---

## 四、充值链路（微信支付）

### 4.1 管理员工具 —「微信支付配置」

后台（管理设置 → 积分与充值 → 支付配置）字段：
- 公众号/开放平台 `AppID`、商户号 `MCHID`、APIv3 密钥、商户证书序列号、商户私钥（PEM，密文存储）、支付回调域名；
- 提供「测试连接」按钮：验证下载平台证书 + 签名链路，不产生真实交易；
- 配置保存/变更写 `AuditLog`（沿用站内审计）。
- 前置提示文案：需微信支付商户号（企业/个体户）、回调域名 ICP 备案且 HTTPS。

### 4.2 用户自助充值流程

1. 积分中心选择档位或自定金额（≥ `recharge_min_cents`，默认 1 元起）；
2. 后端创建 `recharge_orders`（锁定汇率快照 + 档位赠送），调微信 **Native 扫码**（PC）/ **H5 支付**（移动端）下单，返回二维码链接；JSAPI（公众号内）作为配置了 AppID 后的增量方式；
3. 用户支付 → 微信异步回调 `POST /api/pay/wechat/notify`（公开路由、不带 /api/backend 前缀，与 `/api/auth/*` 同类）：验签（APIv3 AES-GCM 解密）→ 校验金额与订单一致 → 按 `transactionId` **幂等**入账：`pointsAmount + bonusPointsAmount` 入余额，写 RECHARGE / RECHARGE_BONUS 两条流水，订单置 PAID；
4. 前端轮询订单状态到账；「刷新支付状态」按钮走主动查单接口兜底（回调丢失场景）；
5. 超时未支付订单 30 分钟自动 CLOSED（定时任务查单确认终态，防止关单竞态：查得已支付则照常入账）。

档位默认建议（可配）：10 / 50 / 100 / 300 / 500 元，100 元档赠 5%、300 元档赠 10%（行业惯例：充值赠送阶梯促大额）。

### 4.3 对账

后台「充值订单」列表：本地状态、微信单号、一键查单纠正；预留导出 CSV 与微信账单文件人工比对（开源版不做自动拉单对账）。

---

## 五、积分赠送（一个账号给另一个账号）

- 入口：积分中心 →「赠送积分」。
- 收款方识别：填**邀请码**（6 位大写去混淆字符，现有体系）或用户名 →「预览」显示脱敏昵称（`张*三`）与账号状态，防转错。
- 规则（均可后台配置）：`transfer_enabled` 总开关（默认开）、单笔下限（默认 1 积分）、单用户每日转出笔数/总额上限（默认 20 笔 / 1000 积分）、手续费率默认 0（预留配置防套利）。
- 约束：不能赠自己；对方账户须 ACTIVE；余额不足走原子扣费同款校验。
- 双方各收一条流水 + 站内通知（沿用 `Notification` 机制）；账单文案注明"赠送"，赠送积分不产生发票口径。

---

## 六、AIPDD AWcoin 与站内积分的双币展示

- 用户绑定 APIKey（现有 `AipddKey`/`UserAipddBinding`）后，积分中心顶部余额卡并列两枚：
  - **本站积分**：来自 `point_accounts.balanceAmount`，可充值/赠送/消耗；
  - **AWcoin**：通过绑定的 Key 调 AIPDD 开放接口余额端点获取；缓存 60 秒；未绑定显示「绑定后查看」入口（跳现有 API Key 管理），接口失败显示 `--` 且不影响站内积分功能。
- 设计红线：AWcoin 只读展示。站内任何消费**永不**扣 AWcoin，积分也永不兑回 AWcoin/人民币——两本账彻底隔离（避免上游结算依赖与合规纠缠）。
- 若上游暂无开放余额端点，第一阶段用 `AipddKey.aipddProfile` 快照字段兜底显示，并在方案评审时与上游确认端点路径。

---

## 七、赚积分：行为奖励（管理员可配）

| 场景 | 默认建议值 | 触发与防刷 |
|---|---|---|
| 新用户注册赠分 | 50 积分（=5 元体验金） | 完成注册即入账；**手机或邮箱验证后**才发（配置二选一），未验证账号积分冻结展示 |
| 邀请奖励·被邀注册 | 邀请人得 100 积分/人 | 被邀人须完成注册+验证；同 IP 短窗口/同设备指纹限次；邀请关系沿用现有 `invitedBy` |
| 邀请奖励·被邀首充 | 被邀人首充金额的 5%（单笔上限 500 积分） | 二级分成是行业通行做法（ Dropbox/瑞幸式），只算首充防刷穿 |
| 每日预算帽 | 奖励类日发放上限（默认 5 万积分） | 超限暂停发放并告警管理员 |
| 任务赠分（可选开关） | 完善资料 20、首次创建资产 30 | 一次性，配置化 |

- 管理员也可在后台对任意账号「手动调整积分」（必填事由，ADMIN_ADJUST 流水 + AuditLog）。
- 所有赠送流水 scene 明确，报表可按 scene 汇总营销成本。

---

## 八、花积分：功能消耗计费设计（行业惯例）

### 8.1 计费模式选型

三种行业主流模式在本系统合并为两档（每个模块在 `module_pricing` 独立选择）：

1. **计量制（Metered）**：按真实用量 × 单价，适合波动型消费（AI 调用、查询、存储）。参照：OpenAI/云厂商。
2. **席位制（Seat-Monthly）**：按启用人数×月扣，适合 CRM 这类高频低额协作工具。参照：纷享销客/销售易按人月报价。
3. **包月订阅**：本系统 `EnterpriseCapability` 已是开关制，不再引入第三套钱的形态——订阅诉求用"席位制 + 月免费额"表达。

统一规则：**先预检余额 → 成功即用 → 按单位扣 → 流水一单一结**；每模块带 `freeQuotaMonthly` 免费额（行业 Freetier 惯例，也是"部分行为得积分"之外的留存钩子）；`minChargeAmount` 最低起扣（默认 0.01 积分，防止微账单噪声）；账单说明页公开展示当前价目表。

### 8.2 默认价目建议表（汇率 1 元 = 10 积分；全部可后台修改，单价设 0 即免费）

| 模块 | 计费单元 | 默认单价 | 折合人民币 | 月免费额 | 定价依据 |
|---|---|---|---|---|---|
| 数字资产存储 | **每 GB·每天**（满足"每天每 M 多少积分"：1GB=1024MB，折 0.0001 积分/MB/天） | 0.1 积分/GB/天（≈3 积分/GB/月） | ≈0.03 元/GB/天 | 1 GB 免费 | OSS 标准存储成本约 0.12 元/GB/月，约 2.5 倍加成，与云厂商转售惯例一致 |
| 数字资产外联流量 | 每 GB 下行 | **暂不计费**（单价字段预留 2 积分/GB） | — | — | 成本大头（OSS 流出 0.5 元/GB），先观测三个月再启用，避免小客户账单倒挂 |
| AI 客服·机器人会话 | 每次会话（含 50 轮消息） | 2 积分/次 | 0.2 元 | 100 次/月 | 参照智齿/Udesk 按会话计价；一轮成本远低于此，含模型毛利 |
| AI 客服·人工商户工单 | 坐席·月 | 300 积分/坐席/月 | 30 元 | 1 坐席免费 | 行业坐席价 30–100 元/人/月的下沿 |
| CRM | 席位·月 | 100 积分/席/月 | 10 元 | 3 席免费 | 市场 30–100 元/人/月；开源版取下沿做获客钩子；管理员可切换为"按线索导入 0.5 积分/条"计量制 |
| BI 自然语言查询 | 每次查询 | 0.5 积分/次 | 0.05 元 | 200 次/月 | ChatBI 类普遍按次/按 token 计价；免费额覆盖轻度用户 |
| BI 仪表盘存储 | 每个·月 | 1 积分/个/月 | 0.1 元 | 10 个免费 | 占位轻计费，防无限堆积 |
| OA 审批 | 每流程实例 | 0.2 积分/实例 | 0.02 元 | 100 实例/月 | 钉钉宜搭高级连接器按次惯例；默认也可整模块设 FREE |
| AI 内容生成（图像/视频等） | 并入现有 AI 服务定价体系 | 走「成本加成」三层定价 | — | — | **与已有站点设置定价打通，同一点积分钱包扣**，不另建一套 |
| 短信/邮件验证码 | 按平台成本加成 | 并入成本加成配置 | — | — | 同上，费用源真实成本 |

> 数字校验（存储示例）：企业存 50GB 资产 → 每天 5 积分（5 毛钱）、每月约 150 积分（15 元）——账单量级符合 B2B 心理预期，不碎不吓。

### 8.3 欠费与风控

- 实时调用类：余额不足直接拒绝 + 引导充值弹窗（错误码走现有 BusinessException 体系新增 `POINTS_INSUFFICIENT`）。
- 按日出账类（存储）：余额不足当日仍出账但账户置 ARREARS，进**宽限期（默认 7 天）**——期间资产只读不可新增；宽限期后按后台策略处理（默认"继续保留并每日催缴"，可配"超 30 天冻结下载"；**永不自动删除用户数据**，避免客诉与法律风险）。
- 单日单用户消费熔断阈值（默认 1000 积分，超出暂停计费并通知），防盗刷/脚本失控。

### 8.4 一体化模块 AI 科目定价（HRM / 知识库 / 营销 / 招聘 / 技能审查 / 洞察）

> 承接《借鉴Gauzy一体化升级方案》全部新增 AI 能力，统一走 `ai-eval` 链路与「成本加成」三层定价，全部计量制（METERED），逐科目独立开关 + 受组织级 AI 主开关（§5.7）约束。**审查/评估类 fail-closed：调用失败或未产出结果不扣费**（只在成功出结果时计费）。默认单价如下（1 元=10 积分，管理员可改，设 0 即免费）：

| 科目 code | 场景（章节） | 计费单元 | 默认单价 | 折合 RMB | 月免费额 |
|---|---|---|---|---|---|
| `insight_report` | AI 洞察报告/九宫格/离职风险/赢率/现金流（§5.7） | 每次生成 | 2 积分 | 0.2 元 | 100 次 |
| `hrm_resume_score` | 简历/JD 智能评分（§5.1） | 每次评分 | 1 积分 | 0.1 元 | 200 次 |
| `jd_generate` | AI 生成招聘 JD（§6/§2） | 每次生成 | 1 积分 | 0.1 元 | 50 次 |
| `kb_ingest` | 知识库投料生成实体/概念页（§10） | 每源页 | 0.5 积分 | 0.05 元 | 500 页 |
| `kb_query` | 知识库带引用问答（§10） | 每次问答 | 1 积分 | 0.1 元 | 200 次 |
| `kb_lint` | 知识图谱体检（§10） | 每次体检 | 2 积分 | 0.2 元 | 50 次 |
| `mkt_skill_run` | 营销技能执行（§11，重数据聚合按 3 倍计） | 每次执行 | 3 积分 | 0.3 元 | 100 次 |
| `mkt_skill_eval` | 营销技能回归评测（§11） | 每次评测 | 1 积分 | 0.1 元 | 50 次 |
| `recruit_job_eval` | 职位评估（§12）：triage / match / deep | 每次 | 0.2 / 1 / 3 积分 | 0.02/0.1/0.3 元 | 200 次 |
| `recruit_resume_tailor` | 简历定制（§12） | 每份 | 2 积分 | 0.2 元 | 100 份 |
| `skill_review` | 技能包/插件 LLM 安全审查（§5.9） | 每包 | 1 积分 | 0.1 元 | 20 包 |

- **落地对齐（2026-11-07）**：`billing-rule.service.ts` 的 `AI_SUBJECT_SEEDS` 已按本表写入 12 个科目（另含内部科目 `kb_consolidate`），默认值与本表一致；`hrm_resume_score`、`jd_generate` 已分别接入人才评分与 JD 生成链路，其余科目在对应模块落地时按同一 `chargeByUsage(code, …)` 口径接入。
- 与 §8.2 现有 `ai_service`/`bi` 口径一致，均为成本加成；token 实际消耗大的科目（kb_ingest / deep 评估 / mkt_skill_run）按上游真实 token 成本加成、上限封顶，避免账单倒挂。
- 计费埋点：各模块经 `ai-eval` 出结果后写 `usage_events`（或直记 `point_transactions` SPEND，scene=对应科目 code），复用 `minChargeAmount` 0.01 起扣与 §8.3 消费熔断；未配 APIKey/LLM 超时的 fail-closed 路径**不产生扣费**。
- 存储联动：`skill_review`/`recruit_*`/`kb_*`/`insight_report` 的成功产物落数字资产时按 §8.2 存储口径另计（按天、与调用费分道）。

### 8.5 Agent 调用按用量计费规则（BillingRule，平台管理员后台可配）

> 承接《借鉴Gauzy一体化升级方案》§5.12：将 §3.2 `module_pricing`（静态单价行）升级为**可配、多维度、可分层覆盖**的 `BillingRule`，使 Agent/AI 调用能按**实际用量**（尤其 token）动态扣分，参数由平台管理员在后台调整、**不改代码即可调价**。

- **计费公式**：`扣分 = baseFee（科目基础费） + Σ(用量维度 × unitPrice × multiplier)`，受 `minCharge`/`maxCharge` 与 `budgetCap` 约束；沿用 §8.1「先预检余额→成功即用→按单位扣→流水一单一结」。
- **数据模型 `billing_rule`**（字段命名遵项目 xxxAmount DECIMAL 规范）：

| 字段 | 含义 |
|---|---|
| `code` | 科目（与 §8.4 对齐：insight_report/kb_query/mkt_skill_run/skill_review/…） |
| `scope` | PLATFORM（默认）/ ORG / PLAN；行优先级 PLAN>ORG>PLATFORM，支持局部覆盖 |
| `metric` | 计费维度：`token_in`/`token_out`/`token_total`/`call`/`byte`/`page`（一个科目可多行复合，如 input/output 分别单价） |
| `unitPriceAmount` | 每单位积分单价（ Decimal；0 即免费/仅过上游成本校验） |
| `baseFeeAmount` | 每次调用固定基础费（与用量叠加） |
| `multiplier` | 倍率（如重数据聚合技能×3） |
| `minChargeAmount` / `maxChargeAmount` | 单次最低/最高扣分（默认为 0.01 起扣，防微账单与异常天价） |
| `budgetCapMonthly` | 月预算帽（按 org/科目；超出熔断暂停并通知，接 §8.3） |
| `freeQuotaMonthly` | 月免费额（Freetier 留存钩子） |
| `enabled` / `version` / `updatedBy` / `updatedAt` | 开关与审计；改价留版本可回滚 |

- **计量来源**：LLM 返回的 `usage`（input/output token）、工具/连接器调用计数、附件字节——统一由 ai-eval 链路出结果后写 `usage_events`（或直记 `point_transactions` SPEND，scene=科目 code，detail 存 `token×unitPrice` 明细），与 §8.4 埋点同链路。
- **管理员后台**（§九 平台管理新 tab「计费规则」）：按科目选 metric、填单价/倍率/预算帽/最低最高扣；支持 PLAN/ORG 级覆盖行；改价即时生效、留审计、可回滚。
- **计费口径**：失败不计费（429/5xx 只记流水不扣分）、只计实际 usage、预算帽熔断；**fail-closed**：无活动额度/上游成本不达标→402/502 不执行不计费（与 §8.4、方案 §5.12 一致）。租户自担上游费科目（translate/image/embedding）`unitPriceAmount=0`，只走上游成本校验。
- **用户侧透明**：调用前按公式**预估**“约 X 分”、调用后按实际 usage **多退少补**（基于 §8.1 先预检后扣）；账单明细逐行展示 `token × 单价`。
- **防滥用**：按用户/org 的 Agent 调用速率与 `budgetCapMonthly`（方案 §5.11.2 限流）、异常用量告警。
- **与现有价目表关系**：§8.2/§8.4 的静态单价作为 BillingRule 的 **PLATFORM 默认行种子**；BillingRule 是在其上叠加“token 维度 + 分层覆盖 + 可调”的可配底座，二者不重复计费。

---

## 九、后台与前端界面改动

### 9.1 管理后台（管理设置分组内新增菜单「积分与充值」）

五个页签：
1. **基础配置**：汇率、充值下限/档位/赠送、注册赠分、邀请奖励、赠送(transfer)开关与限额、欠费宽限、消费熔断；
2. **支付配置**：微信支付五项 + 测试连接（密文字段保存后显示 `••••`，不回显明文）；
3. **模块定价**：§8.2 价目矩阵（每模块：模式/单价/免费额/起扣/启停），改动即时生效并留痕；
4. **充值订单**：列表 + 查单纠正 + 导出；
5. **流水与调整**：全用户 `point_transactions` 检索（按用户/类型/场景/日期）、手动调整积分（事由必填）。

公开透出：`/api/site-config` 增加积分汇率与价目表摘要（遵循站点设置同步规范，前端价目说明页消费）。

### 9.2 用户端

- 顶栏：余额胶囊（积分 + 已绑定时 AWcoin），点击进积分中心；
- **积分中心**新页面（工作台分组）：双币余额卡、充值（档位/自定义 → 扫码 → 到账轮询）、赠送（预览→确认→双向流水）、账单（类型筛选 + 按日汇总）、价目说明；
- 注册协议勾选机制已存在，充值页新增《积分服务条款》勾选（充值不可退、禁转售、虚拟商品口径）；
- 七语词典同步（键命名遵循站内翻译规范）。

---

## 十、接口草案

```
# 用户侧（/api/backend/enterprise/points/*，business 前缀同款鉴权）
GET  /summary                      双币余额（积分 + AWcoin 缓存读取）
GET  /transactions?type=&from=&to=&page=
POST /recharge  {amountCents|tierId}   → 建单并返回 codeUrl/二维码
GET  /recharge/:orderNo            状态轮询（服务端主动查单兜底）
POST /transfer/preview  {toCode}   收款人脱敏信息
POST /transfer  {toCode, points, confirmToken}
# 公开
POST /api/pay/wechat/notify        微信回调（验签+幂等，无鉴权前缀）
GET  /api/site-config              扩展 points 段（汇率、价目摘要）
# 管理侧（/api/backend/enterprise/admin/points/*）
GET/PUT /settings                  基础配置（敏感键脱敏回显）
PUT  /wechat-config   | POST /wechat-test
GET/PUT /pricing                   模块定价矩阵
GET  /orders  | POST /orders/:orderNo/sync
GET  /transactions | POST /adjust  手动调整
# AIPDD
GET  /api/backend/enterprise/aipdd/balance   AWcoin 实时/缓存余额
```

---

## 十一、数据库变更与实施约束（双库兼容）

- 新迁移 `0007_points_oss`：§3.2 七张新表 + `DigitalAssetEntry` 加 `ossKey/migratedFrom` 列（迁移已入库，MySQL 主 schema 与 PostgreSQL 派生 schema 同步包含两列）。
- 遵循站内既定规范：
  - MySQL 为准，`prisma migrate deploy` 应用（**不用 db push**），新增列先 NULL→回填→MODIFY 收敛；
  - `node scripts/gen-prisma-schema.mjs` 派生 PG schema，双库冒烟；
  - 凡金额/积分/费率字段命名与类型走 `Decimal(18,4)`（积分精度高于现有金额 14,4 口径，单独立约），微信侧金额一律整数分 `amountCents Int`，**禁止用 Float 参与积分运算**；
  - 单据号复用 `DocumentCounter`（recharge 前缀沿用现有 RP），双库自增方言按既定原子化方案。

---

## 十二、安全与合规清单

1. 微信商户私钥/APIv3 密钥密文落库（AES-256-GCM，派生密钥模式复用现有 ExternalCredential 加密设施），任何接口不回显；
2. 回调三防：验签、金额比对、`transactionId` 唯一索引幂等；入账失败必须返回非 200 让微信重试；
3. 赠送限额 + 消费熔断 + 奖励日预算帽三道闸，防盗刷与营销刷量；
4. 积分不可提现/不可交易条款写进充值勾选协议；发票口径：消费后按实际消费开具，充值环节不即时开票（管理端已有 InvoiceRequest 体系可衔接）；
5. 手动调整、定价变更、支付配置变更全部进 `AuditLog`；
6. 存储桶保持公开读的现状风险在后台设置页明示；对隐私敏感租户提供"迁移桶私有读+签名 URL"路线图（预留不承诺工期）。

---

## 十三、实施路线（一次排完，验收各段独立可发布）

| 阶段 | 内容 | 验收要点 |
|---|---|---|
| M1 | 积分账户/流水/后台手动调整 + 积分中心（余额与账单页） | 原子扣加并发测试；Σ流水=余额 |
| M2 | OSS 底座切换：数字资产上传改写直传本站 + 目录规范 + 删除联动 | 上传→台账→访问→删除全链路；不再产生 AIPDD 存储依赖 |
| M3 | 微信支付配置 + 充值下单/回调/幂等/查单兜底 + 档位赠送 | 模拟回调重放仅入账一次；金额不符拒入账 |
| M4 | 赠送 transfer + 注册/邀请奖励 + 防刷 | 双向流水配对；同设备限领 |
| M5 | 模块定价 + usage_events + 每日存储出账 + 欠费宽限 | 50GB 快照出账=5 积分/天；宽限期状态机正确 |
| M6 | AWcoin 展示 + 价目说明页 + 存量迁移任务 + 七语 | 迁移可断点续跑；AWcoin 失败不阻塞 |

> 截至 2026-11-07：M1–M6 均已交付。M2/M6 本次补齐「数字资产直传自有 OSS + 台账删除联动 + 后台容量台账 + 分批断点迁移」；外联流量计费与桶私有读签名 URL 仍按原方案保持预留、未启用。

---

## 十四、默认决策一览（如需推翻请在评审时指出，未指出即按此实施）

| 决策点 | 默认结论 | 理由 |
|---|---|---|
| 积分精度 | 4 位小数 Decimal(18,4) | 单价可以做到"0.0001 积分/MB/天"粒度 |
| 汇率 | 1 元 = 10 积分，可配 | 账单数字落在舒适区间 |
| 计费形态 | 预充值钱包 + 计量/席位两制 | 不建第三套订阅体系 |
| 存储计费口径 | 按 GB·天出账（含每 M 折算率） | 满足需求原文，账单平滑 |
| 流量 | 先观测不计费 | 避免早期账单倒挂 |
| AWcoin | 只展示，永不互兑 | 隔离上游结算 |
| 赠送手续费 | 默认 0，预留费率 | 先顺畅后防套利 |
| 充值可退 | 不可退（协议明示） | 虚拟商品行业惯例 + 合规最简 |
| 欠费删数据 | 永不自动删除，只冻结新增 | 用户资产红线 |
| 存量 AIPDD 资产 | 后台一键迁移（可续跑），迁移后保留上游副本 | 数据主权归本站，删除权留用户 |
