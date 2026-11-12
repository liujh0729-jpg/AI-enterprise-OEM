# AI 画布与创作工作台设计方案（口径已确认 · 实现基准）

> 目标：在「工作台 → 内容创作」板块下新增 **AI 画布** 能力。侧栏只是**一个入口**「AI 画布」，
> 进入后页内 4 个 Tab 切换：**我的画布 / 生图工作台 / 视频创作台 / 音乐创作台**。
>
> 用户可以在画布上引用**数字资产管理**里的图片 / 视频 / 音频作为参考素材，选择**模型渠道 → 该渠道下的模型 → 基于该模型声明的规格档位**（尺寸 / 比例 / 分辨率 / 时长），提交异步生成；
> 画布与三个工作台都带**任务管理**（排队 / 进行中 / 成功 / 失败 / 取消 / 重试 / 进度）；
> 生成产物自动落**数字资产管理**。
>
> 参考项目：`infinite-canvas`（v0.8.4，Go + Next.js）。**只借鉴交互与数据形态，不复制代码**（该项目 AGPL-3.0，复制会传染本仓库授权）。
> 参考项目里的「我的素材」「提示词库」不搬——本项目已有「数字资产管理」与提示词输入能力。
> 参考项目导航里有 `music` 但没有音乐创作台页面，**音乐创作台按本项目口径新建设计**。
>
> 状态：**已确认，2026-11-12 起为实现基准**。口径见第十三节（原文的 4 个待拍板项已全部有结论）。

---

## 一、现有底座盘点（方案的地基）

| 能力 | 现有实现 | 位置 |
| --- | --- | --- |
| 流式画布渲染 | `@xyflow/react` 12.12.1 已装，工作流编辑器已在用（`ReactFlow` + `Background` + `Controls` + `Handle`） | [workflow-editor.tsx](file:///E:/wwwroot/oem-enterprise/frontend/src/app/workflow/_components/workflow-editor.tsx) |
| 内容工具注册表 | `CONTENT_TOOLS`：工具 → `slots`（模型槽位）/`produces`/`fields`/`async` | [content.ts](file:///E:/wwwroot/oem-enterprise/packages/contracts/src/content.ts) |
| 渠道 → 模型 → 规格 | 前端 `imageSizeOptions / videoRatioOptions / videoResolutionOptions / videoDurationRange` 全部读 `model.capabilities`，越界自动纠偏 | [content/page.tsx:73](file:///E:/wwwroot/oem-enterprise/frontend/src/app/content/page.tsx#L73) |
| 模型能力元数据 | 上游 `/models` 的 `aipdd.capabilities` → `sizes / qualities / aspectRatios / resolutions / min-maxDurationSeconds` | [model-catalog.service.ts](file:///E:/wwwroot/oem-enterprise/backend/src/content/model-catalog.service.ts) |
| 数字资产引用选择器 | `AssetReferencePicker`（只列图片/视频/音频、按 URL 去重）+ `referencesFromAssets()` 自动编号 | [asset-reference-picker.tsx](file:///E:/wwwroot/oem-enterprise/frontend/src/components/content/asset-reference-picker.tsx) |
| 异步任务表 | `content_generation_jobs`（tool/status/input/models/output/assetUrl/error/时间戳）+ 前端 3 秒轮询 | [content-job.service.ts](file:///E:/wwwroot/oem-enterprise/backend/src/content/content-job.service.ts) |
| 任务超时收口 | `healStale()`：RUNNING 超 30 分钟置 FAILED | 同上 |
| 媒体生成执行器 | `generateImage / generateVideo / generateVideoWithReferences / music / speech / editImage / upscaleVideo`，内部 `post()` + `poll()` | [content-media.service.ts:207](file:///E:/wwwroot/oem-enterprise/backend/src/content/content-media.service.ts#L207) |
| HTTP 可取消 | `httpRequest()` 支持 `signal`，并与 `currentRequest()?.signal` 合并；`poll()` 已把 `TransportError kind='cancelled'` 转成「生成已中断」 | [transport.ts:138](file:///E:/wwwroot/oem-enterprise/backend/src/http/transport.ts#L138) |
| 数字资产新底座 | 字节存自有 OSS（`ossKey` 非空，`aipddAssetId = -行id`）；`registerDeliverable()` 尽力而为不阻断 | [digital-asset.service.ts:824](file:///E:/wwwroot/oem-enterprise/backend/src/content/digital-asset.service.ts#L824) |
| 远端字节下载 | `AipddAssetClient.download(url)` → `Uint8Array` | [aipdd-asset.client.ts:322](file:///E:/wwwroot/oem-enterprise/backend/src/content/aipdd-asset.client.ts#L322) |
| 进程内调度器范式 | `setInterval` + `onModuleInit/onModuleDestroy` + `busy` 去重（Agent 定时任务、内容巡检同款） | [agent-schedule.scheduler.ts](file:///E:/wwwroot/oem-enterprise/backend/src/content/agent-schedule.scheduler.ts) |
| 契约驱动路由 | `packages/contracts` 出端点 → `automation-routes.ts` 按 operationId 挂 handler；读用户上游 Key 的端点须登记 `UPSTREAM_TOKEN_OPERATIONS` | [automation-routes.ts:99](file:///E:/wwwroot/oem-enterprise/backend/src/http/automation-routes.ts#L99) |
| 菜单与开关 | 前端 `routes.ts` 内容创作分组 + 后端 `FEATURE_SEED` / `FEATURE_API_PREFIXES`（**最长前缀命中**） | [routes.ts:282](file:///E:/wwwroot/oem-enterprise/frontend/src/config/routes.ts#L282)、[feature-catalog.data.ts:67](file:///E:/wwwroot/oem-enterprise/backend/src/feature/feature-catalog.data.ts#L67) |

---

## 二、需求 → 设计映射（逐条）

| # | 需求 | 设计落点 |
| --- | --- | --- |
| 1 | 内容创作里增加 AI 画布 | 内容创作分组下新增 4 个菜单：`/content/canvas`（我的画布）、`/content/canvas/[id]`（画布编辑）、`/content/image-studio`、`/content/video-studio`、`/content/music-studio`；后端统一挂 `/enterprise/content/canvas*` |
| 2 | 引用数字资产里的图片/视频/音频 | 画布节点与三个工作台共用 `AssetReferencePicker`；选中的资产变成**素材节点**并在画布上连线到生成节点；提交时把参考素材展开成 `references: [{type,url}]` 或首尾帧字段 |
| 3 | 选渠道 → 选模型 → 按模型规格提交 | 抽出共享组件 `GenerationConfig`（渠道 Select → 模型 Select → 规格控件），规格只读 `model.capabilities`，**不写死档位**；三个工作台与画布节点面板共用这一份 |
| 4 | 生成是异步的，画布要有任务管理 | 任务表扩展画布维度字段（`canvasId / nodeId / runId / source / media / progress`）；新增**队列调度器**（每 5 秒取 PENDING 起跑）+ **超时收口**；界面统一 `TaskDock`：排队 / 进行中（进度）/ 成功 / 失败（可重试）/ 已取消 |
| 5 | 生成好的内容存进数字资产管理 | 生成成功 → 下载上游直链字节（`client.download`）→ `digitalAssets.registerDeliverable(...)` 存自有 OSS + 台账；失败只告警不阻断出片（沿用 `tryRegister` 降级口径） |
| 6 | 画布要能保存、再打开 | `content_canvas_projects` 整包 JSON（节点 + 连线 + 视口），前端 2 秒防抖自动保存，切换画布前落盘 |

---

## 三、菜单 / 路由 / 功能开关

### 3.1 前端路由（`frontend/src/config/routes.ts` 内容创作分组内追加）

```
{ type: "group", name: "内容创作", routes: [
    { path: "/content",                  name: "内容创作小工具", icon: "play" },
    { path: "/content/canvas",           name: "AI 画布",       icon: "workflow" },  // 唯一入口，页内 4 Tab
    { path: "/community",                name: "创意社区",     icon: "apps" },
    { path: "/content/video-templates",  name: "视频模版",     icon: "play" },
] }
```

页内 Tab（`TabStrip` 折行胶囊，不用 antd Segmented）：

| Tab | 内容 | 路由（`?tab=` 记忆） |
| --- | --- | --- |
| 我的画布 | 画布库列表 + 新建 / 打开 | `/content/canvas` |
| 生图工作台 | 单图批量出图 | `/content/canvas?tab=image` |
| 视频创作台 | 首尾帧 / 参考素材出片 | `/content/canvas?tab=video` |
| 音乐创作台 | 提示词 + 歌词出曲 | `/content/canvas?tab=music` |

画布编辑器是独立全屏页 `/content/canvas/[id]`（不进 Tab，从「我的画布」卡片进入）。`ROUTE_ICONS` 复用已有 `workflow`。

### 3.2 功能开关

```ts
// feature-catalog.data.ts
menu('content-canvas', 'content-creation', 'AI 画布', '/content/canvas', 15),

FEATURE_API_PREFIXES 追加（**长于** `/enterprise/content`，靠最长前缀优先）：
  'content-canvas': ['/enterprise/content/canvas', '/enterprise/content/studio'],
```

> 画布与三个工作台同属一个开关：关掉后菜单消失、上述前缀全部拦截；画布任务仍走 `/enterprise/content/jobs`（归 `content-tools`），不影响既有小工具。

---

## 四、数据模型（新增 1 张表 + 扩展 1 张表）

### 4.1 新表 `content_canvas_projects`

> 口径：**主表存完整画布 JSON 快照**；高频查询 / 筛选字段（版本、作者、状态、模板 ID、资源引用摘要）
> **拆成独立列并建索引**；不做细粒度画布节点分表。

```prisma
/// AI 画布：整包 JSON 存节点/连线/视口；高频字段拆列索引，不做节点分表
model ContentCanvasProject {
  id           Int      @id @default(autoincrement())
  userId       String   @map("user_id") @db.VarChar(64)   // 作者
  title        String   @default("未命名画布") @db.VarChar(80)
  /// 整包快照：{ version, nodes[], edges[], viewport:{x,y,zoom} }
  doc          Json     @default("{}")
  /// 文档自增版本：保存时校验，冲突返回版本冲突（前端提示「画布已在别处更新」）
  version      Int      @default(0)
  /// 画布状态：DRAFT | ACTIVE | ARCHIVED（列表筛选）
  status       String   @default("ACTIVE") @db.VarChar(16)
  /// 来源模板（0＝空白新建）
  templateId   Int      @default(0) @map("template_id")
  /// 资源引用摘要：[{ assetId, type, name, url }]——按数字资产查「被哪些画布引用」
  assetRefs    Json     @default("[]") @map("asset_refs")
  nodeCount    Int      @default(0) @map("node_count")
  /// 缩略图（最近一次成功生成或素材节点封面；空串＝无）
  coverUrl     String   @default("") @map("cover_url") @db.Text
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@index([userId, updatedAt])
  @@index([userId, status])
  @@index([templateId])
  @@map("content_canvas_projects")
}
```

**为什么整包 JSON 而不是 nodes/edges 分表**：画布的读写永远是「整张图一起加载、一起保存」，分表只会把一次保存拆成几十条 SQL 还要维护级联删除；但列表页的排序 / 筛选 / 搜索不能扫 JSON，所以 `version / userId / status / templateId / assetRefs / nodeCount / coverUrl` 一律落成真实列并建索引。

### 4.2 扩展 `content_generation_jobs`（增量列，全部带默认值，老行不受影响）

```prisma
  /// 发起端：tool（内容创作小工具，老值）| canvas（画布）| studio（三个工作台）
  source    String @default("tool")  @db.VarChar(12)
  /// 画布任务归属（source=canvas 时非 0）
  canvasId  Int    @default(0)       @map("canvas_id")
  /// 画布节点 id（crypto.randomUUID，空串＝非画布任务）
  nodeId    String @default("")      @map("node_id")  @db.VarChar(64)
  /// 同一节点一次提交的批次 id：批量出图 N 张共享，节点按 runId 聚合结果
  runId     String @default("")      @map("run_id")   @db.VarChar(64)
  /// 生成类型：image | video | music | text（列表分组与图标用）
  media     String @default("")      @db.VarChar(12)
  /// 0-100 进度（PENDING=0，提交成功起跑 5，产物落库 95，SUCCESS=100）
  progress  Int    @default(0)
  /// 取消/失败原因（CANCELED 时写「用户取消」；上游计费不退回，界面原样展示）
  cancelReason String @default("") @map("cancel_reason") @db.VarChar(200)

  @@index([userId, status, id])
  @@index([canvasId])
  /// 调度池取活：status + id 走索引，按 PENDING 最老优先
  @@index([status, id])
```

### 4.3 文档结构（`doc` 列的 TypeScript 形态，写进 `packages/contracts`）

```ts
export type CanvasDoc = {
  version: 1;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: { x: number; y: number; zoom: number };
};

export type CanvasNodeType =
  | "prompt"   // 提示词 / 台词 / 歌词文本块
  | "asset"    // 数字资产引用（图片 / 视频 / 音频）
  | "config"   // 渠道 + 模型 + 规格（可被多个生成节点连线复用）
  | "generate";// 生成节点：媒体类型 + 提示词 + 规格 + 上次任务

export type CanvasNode = {
  id: string;
  type: CanvasNodeType;
  x: number; y: number;
  /** 生成节点与素材节点的展示宽度（缩放由 viewport 管） */
  width: number;
  data: CanvasNodeData;
};

type CanvasNodeData =
  | { kind: "prompt"; text: string }
  | { kind: "asset"; assetId: number; name: string; media: "image"|"video"|"audio"; url: string; previewUrl: string }
  | { kind: "config"; channelId: number; channelName: string; model: string; size?: string; ratio?: string; resolution?: string; duration?: number; count?: number }
  | {
      kind: "generate";
      media: "image" | "video" | "music";
      prompt: string;
      channelId: number; model: string;          // 画布上直选（不连线 config 时）
      size?: string; ratio?: string; resolution?: string; duration?: number; count: number;
      /** 最近一批结果：同一 runId 的产物 */
      results: { jobId: number; url: string; assetId: number; media: string }[];
      lastRunId: string;
    };

export type CanvasEdge = {
  id: string;
  from: string; to: string;
  /** prompt | asset | config：连到生成节点时的语义 */
  role: "prompt" | "asset" | "config" | "first-frame" | "last-frame";
};
```

> 连线语义在**提交时由纯函数 `planNodeRun()` 解算**（见 6.2），不引入自定义节点插件。

---

## 五、画布交互（我的画布）

### 5.1 画布库页 `/content/canvas`

- `PageHero` 标题「我的画布」+ 一句说明；`Panel` 标题「画布」+ 右上角「新建画布」。
- 卡片网格：封面（`coverUrl`，无图用渐变占位）、标题（点击改名，行内编辑）、节点数、更新时间、操作「打开 / 复制 / 删除」。
- **整卡可点**进入编辑（不用「进入画布」按钮）；操作只留图标按钮。
- 空状态：一行引导「新建一块画布，把素材和提示词连起来就能出图/出片」。

### 5.2 编辑页 `/content/canvas/[id]`

布局：顶部工具条（返回 / 标题 / 保存状态「已保存 · 12 秒前」/ 放大缩小适配）+ 左图右任务？不——**画布全屏，任务收在底部抽屉**。

工具条按钮：`+ 提示词`、`+ 素材`（打开 `AssetReferencePicker`，选中的建成 `asset` 节点）、`+ 生成`、`+ 配置`、`自动排布`（elkjs）、`适配视图`。

节点：

| 节点 | 展示 | 交互 |
| --- | --- | --- |
| prompt | 文本块，双击编辑 | 可连线到生成节点（role=prompt） |
| asset | 缩略图 + 名称 + 类型标 | 可连线（role=asset / first-frame / last-frame）；点击在右侧面板「替换素材 / 下载 / 存为参考」 |
| config | 渠道 + 模型 + 规格摘要 | 连线到多个生成节点共用一套配置 |
| generate | 媒体类型标签、提示词摘要、上次结果缩略图、状态徽标 | 选中后右侧面板出 `GenerationConfig` + 提交；结果缩略图可直接拖成新的 asset 节点 |

生成节点面板（右侧抽屉，宽 360）：

1. `GenerationConfig`（渠道 → 模型 → 规格，规格随模型变化，越界自动纠偏）；
2. 参考素材清单：列出连进来的 asset 节点（图片1 / 视频1 / 音频1 自动编号），可移除；
3. 提示词：默认取连进来的 prompt 节点文本，可在面板里改写（改写即写回面板草稿，不覆盖 prompt 节点）；
4. 张数（生图 1–4，视频/音乐固定 1）；
5. 「生成」按钮 → 提交任务 → 节点进入 PENDING/RUNNING，卡片上显示进度环；
6. 失败时卡片上出现「重试」（同参数新建一条任务）。

### 5.3 任务管理（画布内 + 全站）

**画布内的 `TaskDock`（底部抽屉，默认收起）**：

- 页签：全部 / 排队 / 进行中 / 已完成 / 失败；
- 行：缩略图 / 媒体类型 / 节点名 / 渠道·模型 / 状态 + 进度条 / 耗时 / 操作（取消 / 重试 / 定位节点 / 存入资产状态）；
- 顶部一行汇总：`进行中 2 · 排队 1 · 今日成功 14`。

三个工作台共用同一个 `TaskDock`（只是不带「定位节点」）。

轮询：前端对「本画布有非终态任务」时 3 秒轮询 `Content_jobs?canvasId=`；全部终态后降为 15 秒（防漏）；页面切走时停。

---

## 六、后端设计

### 6.1 新增文件

| 文件 | 职责 |
| --- | --- |
| `backend/src/content/canvas.service.ts` | 画布 CRUD、版本冲突（409）、`nodeCount/coverUrl` 冗余列维护 |
| `backend/src/content/canvas-plan.ts` | **纯函数**：`planNodeRun(doc, nodeId)` → `{ tool, input, models, media }`；异常抛业务错误（缺模型/缺提示词/素材类型不匹配） |
| `backend/src/content/content-job.scheduler.ts` | 队列调度：每 5 秒取一批 PENDING → 起跑；`healStale()` 一并迁移到这里 |
| `backend/src/content/content-job.service.ts`（改） | 任务字段扩展、`enqueue` 统一入口、进度回写、`cancel` 支持 RUNNING、`retry` |
| `backend/src/content/content-media.service.ts`（改） | 各生成方法接收 `signal` 与 `onProgress`，透传到 `post()`/`poll()` |
| `backend/src/content/content.controller.ts`（改） | 画布 CRUD、`retryJob` |
| `backend/src/http/automation-routes.ts`（改） | 新端点 handler；`Content_saveCanvas` 不需上游 token |
| `backend/src/http/services.ts` / `main.ts`（改） | DI 与调度器注册 |

### 6.2 提交链路（画布节点 → 任务）

```ts
// canvas-plan.ts（纯函数，可单测）
export function planNodeRun(doc: CanvasDoc, nodeId: string): PlannedRun {
  const node = doc.nodes.find((n) => n.id === nodeId);
  // 1. 收集入边：prompt 文本合并；asset 按 role 分组（first/last-frame 只允许 video，最多各 1）
  // 2. config 节点优先于节点内直选的渠道/模型（有 config 边就用它的）
  // 3. 按 media + 素材形态选 CONTENT_TOOLS 的 key：
  //      image   + 无图        → 'image'
  //      image   + 有参考图    → 'image-edit'
  //      video   + 首/尾帧     → 'video'
  //      video   + 参考图/视频 → 'video-ref'
  //      video   + 仅音频      → 'lip-sync'（音频须同时有视频）
  //      music                 → 'music'
  // 4. input 字段按工具的 fields 组装；models 只带该工具声明的 slots
  return { tool, input, models, media };
}
```

> 复用既有 `ContentJobService.create()` 的 `validateInput / parseModels / assertReady`，画布只是**多一层「图 → 表单」的翻译**，不新写一套执行器。

### 6.3 任务状态机与进度

```
PENDING(0) --调度器取到--> RUNNING(5) --提交成功--> RUNNING(20) --轮询中--> RUNNING(20→90)
   |                         |                          |
   |--用户取消--> CANCELED    |--用户取消(abort)--> CANCELED
                             |--执行异常--> FAILED     |--产物落库--> RUNNING(95) --> SUCCESS(100)
RUNNING 超 30 分钟无更新 --> FAILED（任务中断，请重新提交）
```

进度口径（**轮询次数归一，不是真进度**，须在任务行上明说「已等待 1 分 20 秒」而不是伪造百分比）：

- `poll()` 改成回传「第 N 次 / 共 M 次」，`onProgress(5 + 85 * N / M)`；
- 拿到直链后置 95，OSS 落库完置 100。

### 6.4 取消（口径已确认）

- **取消 = 把任务状态标记为 `CANCELED`**：PENDING 直接置取消，调度池不再取它；
- RUNNING 时**先置 `CANCELED` 落库**（DB 是唯一真值，任何 worker 都不会再把这条当活任务），再 `abort()` 中断本站等待与后续子任务（批量里未开跑的条目一并取消）；
- **已消耗的上游算力计费不退回**，`cancelReason` 写明「已停止本站等待；上游已产生的算力费用不退回」；
- 前端**强提示**：取消按钮二次确认弹窗用 `Modal.confirm` 警示样式列出两条后果，取消后任务行常驻「已取消 · 上游可能仍在生成并计费」。

### 6.5 调度池（口径已确认：不引入 MQ、不裸跑纯内存队列）

```ts
// content-job.worker-pool.ts
// 每个进程 = 一个 worker；DB 表是唯一真值，进程内只有一个「调度池 + 并发槽」
class ContentJobWorkerPool {
  private readonly inflight = new Set<number>();          // 本 worker 正在跑的 jobId
  private readonly limit = Number(process.env.CONTENT_JOB_CONCURRENCY || 4);
  // tick（CONTENT_JOB_TICK_MS，默认 3000ms）：
  //   1. healStale()：RUNNING 超 30 分钟无更新的置 FAILED
  //   2. 剩余槽位 = limit - inflight.size，>0 时 SELECT PENDING ORDER BY id ASC LIMIT n
  //   3. 逐条 UPDATE ... WHERE id=? AND status='PENDING' 成功后置 RUNNING 并起跑
  //      （条件更新保证多 worker 同时捞到同一条时只有一个能真正起跑）
}
```

- **不引入 MQ、不在内存里攒队列**：待办永远只从 `content_generation_jobs` 的 `PENDING` 读；
- 进程内只有「并发槽 + 在跑 jobId 集合」，进程重启只是把在跑的置为中断（`healStale` 收口），排队任务照常在下一轮被捞起来；
- 环境变量：`CONTENT_JOB_SCHEDULER_DISABLED=1` 关闭；`CONTENT_JOB_TICK_MS` 调间隔；`CONTENT_JOB_CONCURRENCY` 调每 worker 并发。
- 现状 `create()` 里的 `void this.run()` 立即执行改为**只落库排队**，起跑统一由调度池负责，因此「排队」成为真实状态。

### 6.6 产物入数字资产（新口径）

```ts
// content-job.service.ts 成功分支
const bytes = await this.client.download(url);          // 上游直链
const filename = `canvas-${media}-${Date.now()}.${extOf(media)}`;
const asset = await this.digitalAssets.registerDeliverable(user.userId, {
  bytes, filename, dir: 'canvas', source: 'canvas', labels: ['ai-generated', media],
});
// 台账 aipddAssetId = -行id，数字资产管理页立即可见；失败只告警，不阻断任务成功
```

三个工作台同一条路径（`dir: 'studio'`）。老工具继续走 `tryRegister`（AIPDD 平台登记），**两条路并存到统一为 OSS 基底为止**，本次只把「画布 + 三个工作台」接到新底座。

### 6.7 契约与端点

```ts
// packages/contracts/src/content.ts
Content_canvases:     GET    /enterprise/content/canvas             → { list, total }
Content_createCanvas: POST   /enterprise/content/canvas             → CanvasProject（body: { title? })
Content_canvas:       GET    /enterprise/content/canvas/:id         → CanvasProject（含 doc）
Content_saveCanvas:   POST   /enterprise/content/canvas/:id         → CanvasProject（body: { title?, doc, version }）
Content_deleteCanvas: DELETE /enterprise/content/canvas/:id         → { ok }
Content_renameCanvas: PATCH  /enterprise/content/canvas/:id         → CanvasProject（body: { title }）
Content_runCanvasNode:POST   /enterprise/content/canvas/:id/nodes/:nodeId/run
                              → ContentJob[]（生图批量可能多条；body: { channelId?, model?, spec?, count? })
Content_retryJob:     POST   /enterprise/content/jobs/:id/retry     → ContentJob
```

`Content_jobs` 查询参数追加 `canvasId? / source? / media? / status?`；
`Content_jobSchema` 追加 `source / canvasId / nodeId / runId / media / progress / assetStatus / elapsedSeconds`。

---

## 七、三个工作台

三者共用 `StudioWorkbench`（左：参数区；右：结果区 + 任务列表），差异只在参数字段与默认媒体。

| | 生图工作台 | 视频创作台 | 音乐创作台 |
| --- | --- | --- | --- |
| 核心输入 | 提示词 + 参考图（最多 6） | 提示词 + 首帧 / 尾帧 + 参考图 / 参考视频 / 参考音频 | 提示词 + 歌词（可选） |
| 规格 | 尺寸（随模型 `sizes`）、张数 1–4 | 比例（`aspectRatios`）、分辨率（`resolutions`）、时长（`min–maxDurationSeconds`）、首/尾帧 | 时长（`min–maxDurationSeconds`，无声明用 15–120 秒） |
| 工具映射 | 无参考 → `image`；有参考 → `image-edit` | 首尾帧 → `video`；参考素材 → `video-ref`；音频+视频 → `lip-sync` | `music` |
| 结果区 | 4 列缩略图，点击大图/下载/存资产 | 播放器 + 首帧截取（截帧存为素材） | 音频播放器 + 歌词对照 |
| 任务 | `TaskDock` 同款 | 同款 | 同款 |

素材选择：三个工作台各有一个「从数字资产选择」入口，直接复用 `AssetReferencePicker`；选中后以「图片1 / 视频1 / 音频1」编号展示，提交时转 `references: [{type,url}]`。

额外能力（与需求强相关、不另起页）：

- 生图工作台：结果「发送到画布」→ 建一条 asset 节点（用 `canvasId` 最近打开的画布，或弹窗选画布）。
- 视频创作台：「从视频模版带参进入」——模版页「使用模版生成」跳这里并预填提示词与参考图（打通既有链路）。
- 音乐创作台：歌词支持「AI 补全」按钮（文本模型），产物直接进资产 `audio`。

---

## 八、前端结构

```
frontend/src/app/content/
  canvas/
    page.tsx                     画布库（列表/新建/删除/改名）
    [id]/page.tsx                画布编辑器（ReactFlow）
    _components/
      canvas-editor.tsx          ReactFlow 容器、连线路由、自动保存
      flow-nodes.tsx             prompt / asset / config / generate 四类节点视图
      node-panel.tsx             选中节点右侧抽屉（配置 + 参考清单 + 生成）
      canvas-toolbar.tsx
  image-studio/page.tsx
  video-studio/page.tsx
  music-studio/page.tsx

frontend/src/components/content/
  generation-config.tsx         渠道→模型→规格（从 content/page.tsx 抽出，三处共用）
  task-dock.tsx                 任务抽屉（画布与三工作台共用）
  studio-workbench.tsx          工作台通用骨架
  asset-reference-picker.tsx    既有，直接复用
```

`content/page.tsx` 里的 `imageSizeOptions / videoRatioOptions / videoResolutionOptions / videoDurationRange / filterBySlot` 抽到 `generation-config.tsx` 并保留导出，**小工具页改为引用，不改交互**（避免同一套规格逻辑两处维护）。

---

## 九、后端文件清单（新增/改动）

| 类型 | 文件 |
| --- | --- |
| 新增 | `backend/src/content/canvas.service.ts`、`canvas-plan.ts`、`content-job.worker-pool.ts` 及其单测 `canvas-plan.spec.ts` / `content-job.worker-pool.spec.ts` |
| 改动 | `content-job.service.ts`、`content-media.service.ts`、`content.controller.ts`、`http/automation-routes.ts`、`http/services.ts`、`main.ts`、`feature/feature-catalog.data.ts` |
| 迁移 | `backend/prisma/migrations/0089_content_canvas/`（建表 + 5 个增量列）、`node scripts/gen-prisma-schema.mjs` |
| 契约 | `packages/contracts/src/content.ts`（schema + 端点） |
| 前端 | `config/routes.ts`、`api/content.ts`、`app/content/canvas/page.tsx`、`app/content/canvas/[id]/page.tsx`、`app/content/canvas/_components/{flow-nodes,node-panel,canvas-editor}.tsx`、`components/content/{generation-config,task-dock,studio-workbench,image-studio,video-studio,music-studio}.tsx`、`content/page.tsx`（抽公共组件）、`globals.css`（`.cv-*` / `.studio-grid`） |

---

## 十、验收口径（做到什么算完成）

1. 新建画布 → 加「提示词 + 数字资产图片 + 生成节点」→ 连线 → 选渠道/模型/尺寸 → 生成 → 节点出现进度 → 成功后缩略图可预览；
2. 任务抽屉里能看到这条任务的全生命周期；RUNNING 时可取消，PENDING 时可取消；失败可重试；刷新页面任务仍在；
3. 关闭后端进程 1 分钟再起，排队任务继续执行，RUNNING 超 30 分钟的收口为失败；
4. 生成的图片/视频/音乐在**数字资产管理**页刷新即可见（`labels` 含 `ai-generated`），可共享、可删除；
5. 生图工作台批量 4 张、视频创作台首尾帧出片、音乐创作台带歌词出曲，三条链路各跑通一次；
6. 换模型时规格档位跟着变（如某模型只有 `1024x1024/1536x1024`，界面不出现 `512x512`）；
7. 后台关闭「生图工作台」开关，菜单消失且 `/enterprise/content/studio/image/*` 被拦截，画布与其它功能不受影响；
8. `pnpm -w typecheck`、`lint`、后端单测（`--config ./test/jest-unit.json`）、前端 build 全绿。

---

## 十一、风险与口径提示

| 项 | 说明 | 处理 |
| --- | --- | --- |
| License | 参考项目 AGPL-3.0 | 只借鉴交互与数据形态，**不复制任何源码/组件**；本方案的前端组件全部基于仓库已有 `@xyflow/react` 与 antd 自写 |
| 取消 ≠ 退款 | 上游已受理的任务取消后仍可能出片计费 | 取消确认弹窗明写；任务行标注「已取消（上游可能仍在生成）」 |
| 进度非真进度 | 上游多数网关不提供百分比 | 用轮询次数归一 + 「已等待 X 秒」并列展示，不伪造精确度 |
| 多进程 | 调度池在进程内，但取活靠 DB 条件更新 | 多 worker 同时捞到同一条时，`UPDATE ... WHERE status='PENDING'` 只有一个成功，天然互斥；不依赖单实例 |
| 旧任务口径 | 老工具的产物走 AIPDD 平台登记 | 本次不迁移老工具，仅画布/工作台走 OSS 新底座；两套并存期间资产页都能看到 |
| 画布文档膨胀 | 整包 JSON 随节点增多变大 | 节点内只存 URL 与少量元数据，图片字节不入 doc；单画布建议 ≤ 200 节点（保存时超限提示） |

---

## 十三、已确认口径（2026-11-12，实现基准）

| # | 决策 | 落地 |
| --- | --- | --- |
| 1 | **不引入 MQ，也不裸跑纯内存队列**；DB 是唯一真值，每个 worker 自带简单调度池，定时捞自己该干的活 | 6.5：`ContentJobWorkerPool` 定时 `SELECT PENDING` + 条件更新置 RUNNING + 进程内并发槽 |
| 2 | **取消 = 标记任务状态为已取消**，停止后续调度 / 子任务；**已消耗的上游算力计费不退回**；前端强提示 | 6.4：先落库 `CANCELED` 再 abort；`cancelReason` 记录后果；前端二次确认警示 + 任务行常驻标注 |
| 3 | **主表存完整画布 JSON 快照**；高频字段（版本、作者、状态、模板 ID、资源引用摘要）拆独立列并建索引；**不做节点分表** | 4.1：`doc` + `version / userId / status / templateId / assetRefs / nodeCount / coverUrl` + 4 个索引 |
| 4 | **一级菜单「AI 画布」一个入口**，页内 4 个 Tab 切换 | 3.1：`/content/canvas` + `TabStrip`（我的画布 / 生图工作台 / 视频创作台 / 音乐创作台）；编辑器为独立页 `/content/canvas/[id]` |

> 按「一次交付、不分期」推进：迁移 + 契约 + 后端（含单测）+ 前端「AI 画布」四 Tab + 文档同步，收尾给 typecheck/lint/单测/openapi/build 证据。

### 13.1 交付状态（2026-11-12）

- 迁移 `0089_content_canvas` 已 deploy；契约 `packages/contracts/src/content.ts` 已出画布 6 个端点 + `Content_runCanvasNode`（登记进 `UPSTREAM_TOKEN_OPERATIONS`）。
- 后端：`CanvasProjectService`（整包 JSON + 乐观锁 + 派生列）、`planNodeRun` 纯函数、`ContentJobWorkerPool`（定时捞 PENDING + 条件更新抢坑 + 并发槽）。
- 前端：`/content/canvas` 四 Tab（我的画布 / 生图工作台 / 视频创作台 / 音乐创作台）+ `/content/canvas/[id]` 编辑器；任务统一走 `TaskDock`（进度 / 取消二次确认 / 失败重试）。
- 运行态实测（独立 1699 实例，未动用户 1690）：画布节点提交 `channelId=0` 生成 → `PENDING → RUNNING(20%) → SUCCESS(100%)`，产物直链落**数字资产**（`aipddAssetId=1041`）；同批取消 1 条不影响另 1 条完成；失败任务重试重新入队。
- 本轮回手的两处实现修正：① 面板这一轮选的渠道 / 模型会写进 `CanvasRunSpec`，优先级 = 面板 > 配置节点 > 生成节点（原先会回落默认槽位）；② 渠道 0（AIPDD）在后台无请求上下文时按任务所属账号解析本人绑定的上游 Key（入队校验、执行、重试三处同口径），不再误报「未绑定 API Key」。

### 13.2 Code Review 结论（2026-11-12）

- 已直接修复 10 项（保存并退出、连线角色切换、节点双击、结果回写与乐观锁同步、视频台首帧、读接口误收口、老文档字段清洗、节点任务过滤、任务行渠道模型、类型错误），清单见 [AI画布代码评审待决策问题.md](file:///E:/wwwroot/oem-enterprise/docs/AI%E7%94%BB%E5%B8%83%E4%BB%A3%E7%A0%81%E8%AF%84%E5%AE%A1%E5%BE%85%E5%86%B3%E7%AD%96%E9%97%AE%E9%A2%98.md) 第十一节。
- 需产品 / 架构拍板的 10 项（取消计费归属、画布额度闸门、单人私有 vs 协作、产物副本策略、素材引用方式、保存冲突交互、多图与批量语义、渠道优先级呈现、节点上限、封面取图）在该文档里逐条给了现状、风险与可选方案，**未改动代码**。
- 复验：前端 tsc / eslint / build、后端 tsc / 单测（154 套件 1313 例）、`api:docs` 契约检查、`escape-audit --check` 全绿。

### 13.3 待决策 10 项按确认口径落地（2026-11-12）

10 项已全部拍板（第 4 项＝「放到数字资产管理」，即产物全量落本站 OSS），代码已落地：

| # | 项 | 落地 |
| --- | --- | --- |
| 1 | 取消计费归属 | 新增 `upstream_task_id` / `upstream_accepted_at` 两列（迁移 `0090_content_job_upstream`）；`JobControl.onAccepted` 在上游受理（轮询启动 / 同步返回）时一次性回写；`cancelReason` 由 `receiptOf(row)` 生成，写明「上游已受理 / 尚未受理」与受理时间、子任务号 |
| 2 | 画布额度闸门 | 不做额度闸门；仅保留单画布节点上限 `NODE_LIMIT=200`，超限提示引导「新建画布 + 复制节点」 |
| 3 | 单人私有 vs 协作 | 明确**仅本人可见**：所有画布端点按 `userId` 收口，列表页 `Panel` 标注「仅本人可见」，页头说明产物按数字资产共享规则处理 |
| 4 | 产物副本策略 | 产物全量落**本站 OSS / 数字资产管理**（不再走 AIPDD 平台登记）；台账 `aipddAssetId` 为负数自建位，`readAssetId` 不再把负数当非法值抹掉。媒体层是共享链路，画布 / 工作台仍会顺带触发一次平台登记尝试；`store()` 在本站入库成功后把该次登记的提示抹为空（`output.assetNote = ''`），界面不出现平台口径（2026-11-12 端到端实测：video / image 两条产物均落 `digitalAssetEntry` 负 id + `ossKey`，`assetNote` 为空） |
| 5 | 素材引用方式 | 引用按 `assetId` 实时解析（本人台账优先、其次共享资料），每次运行前 `refreshAssetUrls` 把 url / previewUrl / name 刷到节点临时副本上；解析不到即报「素材已删除或无权访问」 |
| 6 | 保存冲突交互 | 乐观锁冲突时停手不合并，前端提示「画布已在别处更新：请刷新页面后重新编辑（不会自动合并）」 |
| 7 | 多图与批量语义 | 多张参考图＝同一次请求（参考图），张数 N＝分 N 次独立提交（各自计费与追踪）；生成面板两行灰字写明 |
| 8 | 渠道优先级呈现 | 接了「模型配置」节点时，生成面板的渠道 / 模型控件置为只读并标注「由接进来的模型配置节点决定（要改请改那个节点）」；提交时把该配置值作为本轮 override 下发，展示值＝生效值，后端优先级不变 |
| 9 | 节点上限 | 见第 2 项；另新增 `Content_copyCanvasNode`（`POST /enterprise/content/canvas/:id/nodes/:nodeId/copy`，不需上游 token）作为撞限过渡能力，面板按钮「复制这个节点到另一张画布」 |
| 10 | 封面取图 | 抽 `deriveCoverUrl(doc)`：优先取最近一次生成产物（`results` 末条），无产物回落素材图首张；`derive()` 与 `rememberCanvasResult` 同口径调用，生成后封面即时更新 |

- 新增端点：`Content_copyCanvasNode`（契约 `packages/contracts/src/content.ts` + `automation-routes.ts`）。
- 新增迁移：`0090_content_job_upstream`（`upstream_task_id VARCHAR(128) NOT NULL DEFAULT ''`、`upstream_accepted_at DATETIME(3) NULL`）——**文件已生成，需在部署环境执行 `prisma:migrate:deploy`**。
- 复验：后端 tsc 通过、单测 154 套件 **1315 例**全绿（含 `canvas-plan.spec.ts` 18 例）、前端 tsc / eslint / build 通过、`api:docs` 契约检查通过、`escape-audit --check` 6 ≤ 6。

### 13.4 画布编辑器对齐参考界面（2026-11-12）

对照 `infinite-canvas`（v0.8.4，本地解压于 `E:\tmp\infinite-canvas-ref`）的界面重做编辑器交互，**只借交互形态、不复制任何源码**（该项目 AGPL-3.0）：

| 参考做法 | 本次落地 |
| --- | --- |
| 画布整屏沉浸：隐藏应用 chrome、控件全部 `absolute` 浮在画布上 | 编辑页吃掉内容区内边距与滚动（`.ant-pro-layout-content:has(.cv-immersive)`），画布 `inset: 0` 铺满；返回 / 标题 / 保存 / 未保存标记收进**悬浮顶栏** |
| 底部居中悬浮 dock 放「添加节点」，弹出菜单先列产出类型 | 画布底部悬浮 dock：`添加节点` 菜单为 **图片 / 视频 / 音乐生成节点** + 分隔线 + 提示词 / 素材 / 模型配置节点；右上角那排按钮式「添加节点」已移除 |
| 生成节点的提示词框与提交按钮就在节点上，对着框直接生成 | 生成节点卡片加宽到 300px，内嵌 `textarea`（`nodrag nowheel`，输入不触发拖拽）+ 右下角「生成」按钮；提交把框里的文本作为本轮提示词下发（空则回落连进来的提示词节点），未写且没接提示词节点时按钮置灰并提示 |
| 任务/面板不挤占画布 | 任务区改为**右下悬浮可折叠面板**（dock 上「任务」按钮 + 未完成数角标），右侧节点面板仍是浮层抽屉 |

- 派生改动：`refreshDoc()` 不再因本地有未保存改动而跳过合并（只并 `results` / `lastRunId` 与行版本），否则卡片内生成后拿不到本批任务态、下一次保存还会误报版本冲突。
- 复验：前端 tsc / eslint 通过、`pnpm --filter aiworkin-enterprise-web build` 通过；构建产物含 `ant-pro-layout-content:has(.cv-immersive){padding:0;overflow:hidden}`。
- 未做：双击画布空白处就地建节点（参考里有，本次未要求，未实现）。

### 13.5 提示词 `@` 引用资源（2026-11-12）

画布提示词框支持敲 `@` 打开资源菜单，两组候选：

| 分组 | 来源 | 选中后的行为 |
| --- | --- | --- |
| 上游连进来的素材 | 该生成节点的**入边**素材节点（含首帧 / 尾帧，按类型过滤：生图只列图片、视频列图片/视频/音频） | 素材本来就已按连线喂给生成，只把 `@图片N` 记号插进提示词 |
| 数字资产 | 数字资产管理里已上传的图片 / 视频 / 音频（可搜索） | 记号 + **把引用随节点存进画布 doc**（`CanvasGenerateData.refs`），提交时由后端并进参考素材 |

- 编号口径：入边先按角色排序（与后端 `planNodeRun` 同一顺序：提示词 → 素材 → 配置 → 首帧 → 尾帧），再按类型从 1 连续编号（图片1 / 视频1 / 音频1），同一地址只算一份——所以提示词里的 `@图片2` 与后端实际送入的第 2 张参考图一致；`refs` 里的记号与 `results` 一样随画布保存，重开画布仍在。
- 引用与文本同步：提示词里删掉 `@图片1` 记号即解除该引用（`@图片11` 不会误命中 `@图片1`）。
- 后端：`cleanNodeData` 解析 `refs`（记号重复只留第一条、形状不对整条丢弃）；`planNodeRun` 把 `refs` 与连线素材同权并入参考素材并按地址去重（生图节点 `@` 了视频照旧按「生图只接收图片素材」报错，不静默丢素材）；`refreshAssetUrls` 提交前按 `assetId` 复权 `refs`（断链当场报错），`derive()` 把 `refs` 一并计入按资源查引用。
- 未做：提示词节点（`prompt` 节点）的正文不开放 `@`——它的文本会被合并进下游提示词，但引用没有对应的喂入通道，开了就是断点；生成节点的卡片内框与右侧面板同一字段，两处行为一致。
- 复验：后端 tsc / 154 套件 **1318 例**全绿（`canvas-plan.spec.ts` 21 例）；前端 tsc / eslint 通过、vitest 6 套件 12 例通过（含 `mention-field.spec.ts` 4 例）、`build` 通过；`api:docs` 契约检查通过、`escape-audit --check` 6 ≤ 6。

### 13.6 修：显式选「AIPDD」渠道的任务被误判为未绑定 Key（2026-11-12）

现象：画布（以及三个工作台 / 小工具）选「AIPDD」渠道 + 具体模型提交，任务必然失败，报「请先在『模型服务 → API Key 管理』绑定 AIPDD API Key，再使用模型能力」——即使已绑定。

根因：**AIPDD 渠道（channelId 0）的凭据不是渠道行里的 Key，而是本人绑定的 AIPDD API Key**——取凭据层 `loadChannelCredentials` 对渠道 0 走 `requireKey(token)`（token = 本次请求已解析的上游令牌）。于是**任何没有请求上下文的链路**（后台执行、任务重试、定时任务、静默链路）拿不到 token 就一律 403；`ContentJobService.execute()/retry()` 当初还额外按「槽位有没有选模型」判断，把「选了模型」当成「渠道自带凭据、不必给 token」，进一步漏掉内置渠道。

修法（收口在取凭据层，一次覆盖全部调用方）：`loadChannelCredentials` 的渠道 0 分支改为「**请求令牌优先，否则按 userId 现取本人绑定的 AIPDD Key**」（与既有的 `aipddApiKey()` 同口径）；未绑定时由 `resolveToken` 抛出可执行的绑定引导，不会静默拿空 Key。`ContentJobService.execute()/retry()` 随之删掉本地 `needsUserKey` 补丁，后台一律不传 token，交给取凭据层判定——同一规则只留一个实现。

- 复验：后端 tsc / eslint 通过；单测全绿（155 套件中 154 通过、1 skipped；1336 例中 1321 通过、15 skipped；`ai-channels.spec.ts` 新增渠道 0 三例）；实探后台任务（渠道 0 + 假模型）报的是上游 400「媒体模型尚未配置价格」而非「请先绑定」。

### 13.7 同类审计：还有哪些「已绑定却报未绑定」的入口（2026-11-12）

同一根因（无请求令牌 → `requireKey` 误报）在取凭据层的其它调用方也存在，本次一并收口（都靠 13.6 的取凭据层修复覆盖，无需各自打补丁）：

| 调用方 | 触发场景 |
| --- | --- |
| `ContentJobService.execute()` / `retry()` | 后台执行 / 重试，无请求上下文 |
| `bi/bi.chat.service.ts` `target()` | BI 取模型时显式传 `undefined`，选内置渠道即误报 |
| `crm/crm.ai.service.ts` `ask()` | CRM AI 分析，同上 |
| `question-hall` 结案总结 | 同上 |
| `service-desk` AI 代答（`ownerTarget`） | 按设置属主取模型，同上 |
| `upgrade/upgrade-analysis.service.ts` `advise()` | 升级分析取模型，同上 |
| `content/agent-assistant.service.ts`（IM 助理） | 第三方消息通道触发的一轮对话，无请求上下文（原先还额外限死「只能选自建渠道」） |

已经正确、无需改动的：`ai-gateway.ts` 的 `tryChannelCredentials` 路径本就带渠道 0 → `aipddApiKey()` 回落；`feature/skill-review.runner.ts`、`content/skill-generator.service.ts` 在调用前已自行 `resolveToken`。

沿根因一并收口的**界面口径**：`frontend/.../agent/_components/schedules-tab.tsx` 原有「AIPDD 渠道的定时任务到点必然失败、请改选自定义渠道」的告警——该结论正是本 bug 造成的，修复后已删除/改写为口径准确的说明（到点执行凭本人绑定的 Key，未绑定才会失败）。定时任务执行链确实无登录态（`agent-schedule.service.ts` 到点触发传 `undefined` token），但取凭据层现在能自行取到本人 Key。

**IM 助理的渠道规则同步放开（2026-11-12，确认后执行）**：`agent-assistant.service.ts` 原先按同一假设限死「无人值守只能绑自建渠道（channelId>0）」，技术依据正是「取不到账号 Key」——修复后依据不再成立，已放开：

- 后端 `readExecution` 改为「**渠道 0（AIPDD）可直接选**，自建渠道（>0）仍校验归属与启用状态」，`execute()` 把 `channelId` 原样透传（0 ＝ 内置，不再塌成 `undefined` 落到默认槽位）。
- 前端 `agent/_components/assistant-tab.tsx`：渠道清单纳入 AIPDD 渠道（标注「AIPDD」）、保存校验与列表展示同步；原先「不能用内置渠道，请先到模型设置加渠道」的告警改为口径准确的说明（到点执行凭本人绑定的 Key，未绑定才会失败，原因落消息记录）。
- 复验：后端 tsc / eslint 通过；`agent-assistant.service.spec.ts` 覆盖上述边界（0 不查归属、>0 校验、负数拒绝、模型必填）。

**未纳入本次**：路由层 `UPSTREAM_TOKEN_OPERATIONS` 白名单仍会为未绑定账号把白名单端点整体 403（按端点粒度、与渠道选择无关），属既有设计取舍，不在本次范围。

### 13.8 视频时长必填 + 规格「显示值＝提交值」（2026-11-12）

**时长必填、不给默认值**：视频生成节点的时长字段**初始为空**，由用户自己填，未填不能生成。

| 层 | 行为 |
| --- | --- |
| 节点数据 | 新建视频节点不写入 `duration`；提交时为空即不带该字段（不再悄悄补 1 秒） |
| 面板 | 字段显示为空（带 `warning` 态），占位文案「请填写（min–max）」；空值点生成就地提示「请先填写视频时长（秒），再生成」，不提交 |
| 卡片 | 未填时长时生成按钮置灰，悬停提示「先在右侧面板填写视频时长（秒）」 |
| 后端 | `planNodeRun` 入口守卫：无有效时长（非有限数或 ≤ 0）直接抛 `400 请先填写视频时长（秒），再生成视频`——前端漏拦也不会把时长塌成 1 秒计费 |

> 与上游能力声明一致：可填范围取模型 `capabilities.minDurationSeconds / maxDurationSeconds`（如 `ap-minimax-h3` 为 1–30），界面提示与后端守卫同口径。

**规格「显示值＝提交值」**：原先换模型后，下拉框会把越界值显示为兜底档（如模型不认 720p 时显示 480p），但节点里存的还是旧值（720p），提交时下发的是旧值，上游以「分辨率无效」拒单——「明明选着对的档位却报错」。

修法：节点面板加一处**回写规整** effect——换模型后按新模型的 `capabilities` 校验节点里的 `size / ratio / resolution`，越界就回写到该模型的默认档（与下拉框显示值一致）。这样面板显示什么、提交就发什么，不再有「显示一个、提交另一个」的错位；同样口径覆盖生图尺寸、视频比例 / 分辨率（时长由上面的必填守卫兜底，不参与回写默认）。

- 复验：实测「720p → 480p」换模型后节点值与显示值同步规整；空时长点生成，前端就地拦截、后端补 400 守卫；填 5 秒后按钮恢复可点并正常出片。

