# AI 画布与创作工作台设计方案（待确认 · 仅方案，未改代码）

> 目标：在「工作台 → 内容创作」板块下新增 **AI 画布** 能力，包含四个入口：
> **我的画布 / 生图工作台 / 视频创作台 / 音乐创作台**。
>
> 用户可以在画布上引用**数字资产管理**里的图片 / 视频 / 音频作为参考素材，选择**模型渠道 → 该渠道下的模型 → 基于该模型声明的规格档位**（尺寸 / 比例 / 分辨率 / 时长），提交异步生成；
> 画布与三个工作台都带**任务管理**（排队 / 进行中 / 成功 / 失败 / 取消 / 重试 / 进度）；
> 生成产物自动落**数字资产管理**。
>
> 参考项目：`infinite-canvas`（v0.8.4，Go + Next.js）。**只借鉴交互与数据形态，不复制代码**（该项目 AGPL-3.0，复制会传染本仓库授权）。
> 参考项目里的「我的素材」「提示词库」不搬——本项目已有「数字资产管理」与提示词输入能力。
> 参考项目导航里有 `music` 但没有音乐创作台页面，**音乐创作台按本项目口径新建设计**。
>
> 状态：**方案待用户确认**（确认前零代码、零迁移）。

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
    { path: "/content/canvas",           name: "我的画布",     icon: "workflow" },
    { path: "/content/image-studio",     name: "生图工作台",   icon: "picture" },   // 新增图标
    { path: "/content/video-studio",     name: "视频创作台",   icon: "video" },     // 新增图标
    { path: "/content/music-studio",     name: "音乐创作台",   icon: "sound" },     // 新增图标
    { path: "/community",                name: "创意社区",     icon: "apps" },
    { path: "/content/video-templates",  name: "视频模版",     icon: "play" },
] }
```

`ROUTE_ICONS`（[pro-layout.tsx:73](file:///E:/wwwroot/oem-enterprise/frontend/src/components/pro/pro-layout.tsx#L73)）补 `picture: PictureOutlined`、`video: VideoCameraOutlined`、`sound: SoundOutlined`；画布复用已有 `workflow`。

### 3.2 功能开关

```ts
// feature-catalog.data.ts
menu('content-canvas', 'content-creation', '我的画布',   '/content/canvas',       15),
menu('content-image',  'content-creation', '生图工作台', '/content/image-studio', 16),
menu('content-video',  'content-creation', '视频创作台', '/content/video-studio', 17),
menu('content-music',  'content-creation', '音乐创作台', '/content/music-studio', 18),

FEATURE_API_PREFIXES 追加（全部**长于** `/enterprise/content`，靠最长前缀优先）：
  'content-canvas': ['/enterprise/content/canvas'],
  'content-image':  ['/enterprise/content/studio/image'],
  'content-video':  ['/enterprise/content/studio/video'],
  'content-music':  ['/enterprise/content/studio/music'],
```

> 工作台接口按 `studio/{media}` 分前缀，是为了让后台能单独关掉某一台而不影响画布与其它工具；画布任务统一走 `/enterprise/content/jobs`，仍归 `content-tools`（画布开不了时后台也只剩任务端点，不影响已有功能）。

---

## 四、数据模型（新增 1 张表 + 扩展 1 张表）

### 4.1 新表 `content_canvas_projects`

```prisma
/// AI 画布：整包 JSON 存节点/连线/视口，用户级私有
model ContentCanvasProject {
  id        Int      @id @default(autoincrement())
  userId    String   @map("user_id") @db.VarChar(64)
  title     String   @default("未命名画布") @db.VarChar(80)
  /// 整包文档：{ version, nodes[], edges[], viewport:{x,y,zoom} }
  doc       Json     @default("{}")
  /// 文档自增版本：每次保存 +1，前端带版本号保存，冲突返回 409 提示
  version   Int      @default(0)
  nodeCount Int      @default(0) @map("node_count")
  /// 缩略图（最近一次成功生成的首帧或素材节点封面；空串＝无）
  coverUrl  String   @default("") @map("cover_url") @db.Text
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([userId, updatedAt])
  @@map("content_canvas_projects")
}
```

**为什么整包 JSON 而不是 nodes/edges 分表**：画布的读写永远是「整张图一起加载、一起保存」，分表只会把一次保存拆成几十条 SQL 还要维护级联删除；画布不参与跨画布查询，`nodeCount/coverUrl` 只是列表页用的冗余列。

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

  @@index([userId, status, id])
  @@index([canvasId])
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

### 6.4 取消

- `ContentJobService` 持有 `Map<number, AbortController>`；
- `cancel()`：PENDING → 直接 CANCELED；RUNNING → `controller.abort()`，`poll()` 的 `TransportError(kind='cancelled')` 走异常分支 → 状态置 CANCELED、`error='已取消'`；
- **如实告知**：上游已受理的任务取消后仍可能出片并计费，界面在取消确认里写一句「取消只停止本站等待，上游可能继续完成并计费」。

### 6.5 调度器（新）

```ts
// 每 5 秒：healStale() → 取全局 PENDING 最老 N 条 → 每用户并发 ≤ 3 → 起跑
// 环境变量：CONTENT_JOB_SCHEDULER_DISABLED=1 关闭；CONTENT_JOB_TICK_MS 调间隔
```

> 现状是 `create()` 里 `void this.run()` 立即跑，重启即丢；改成**落库即排队、调度器统一起跑**后，重启/多进程都不会丢任务，也天然有了「排队」状态。

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
| 新增 | `backend/src/content/canvas.service.ts`、`canvas-plan.ts`、`content-job.scheduler.ts`、`test/unit/content/canvas-plan.spec.ts` |
| 改动 | `content-job.service.ts`、`content-media.service.ts`、`content.controller.ts`、`http/automation-routes.ts`、`http/services.ts`、`main.ts`、`feature/feature-catalog.data.ts` |
| 迁移 | `backend/prisma/migrations/0089_content_canvas/`（建表 + 5 个增量列）、`node scripts/gen-prisma-schema.mjs` |
| 契约 | `packages/contracts/src/content.ts`（schema + 端点） |
| 前端 | `config/routes.ts`、`components/pro/pro-layout.tsx`、`api/content.ts`、上述 8 个新组件/页面、`content/page.tsx`（抽公共组件） |

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
| 多进程 | 调度器是进程内定时器 | 与既有 Agent 定时任务同款；若将来多实例，需加 `SELECT ... FOR UPDATE SKIP LOCKED` 抢占（本次不做，单实例部署） |
| 旧任务口径 | 老工具的产物走 AIPDD 平台登记 | 本次不迁移老工具，仅画布/工作台走 OSS 新底座；两套并存期间资产页都能看到 |
| 画布文档膨胀 | 整包 JSON 随节点增多变大 | 节点内只存 URL 与少量元数据，图片字节不入 doc；单画布建议 ≤ 200 节点（保存时超限提示） |

---

## 十二、待你拍板（4 项）

1. **任务队列的真实程度**：本方案是「进程内调度器 + 数据库状态」（重启不丢、有排队），不上 MQ。是否够用？
2. **取消语义**：接受「停止本站等待，上游可能继续出片计费」这一口径吗（弹窗会如实提示）？
3. **画布保存形态**：整包 JSON（本方案，简单、一次读写）+ 版本号防覆盖；还是要拆成 nodes/edges 表（便于按节点查询，但实现量翻倍）？
4. **工作台是否要独立菜单**：本方案按你给的四模块做**四个平级菜单**；也可以收成「AI 画布」一个菜单 + 页内四个页签（更省侧栏空间）。你倾向哪种？

> 确认后我按「一次交付、不分期」推进：迁移 + 契约 + 后端（含单测）+ 前端四个入口 + 文档同步，收尾给 typecheck/lint/单测/build 证据。
