# Agent 作大脑 · 插件作能力：能力契约与插件能力清单

> 状态：**设计待拍板**（§八 决策点 N12–N18 未确认前不动代码）。
> 定位：本文是 `docs/浏览器代理网页采集落表方案.md` 的**上位设计**。那个方案是"能力面消化一个具体任务"的样例；本文规定三件事：① 插件现在到底会什么（§二 全量能力清单）；② 大脑怎么才能**准确、自动、不漂移**地知道这些能力（§三 能力契约）；③ 能力不够时补什么、怎么提出来（§四 能力补充清单 + §三 5 缺口上报）。
> 一句话主张：**大脑只能编排它看得见、并且被保证做得到的能力。** 当前"插件能力"这件事有三份真相（提示词散文 / 契约目录 / 插件实现），彼此不同源且已经漂移，必须收敛成一份契约 + 运行时协商 + 缺口上报。

---

## 一、角色分工

| 角色 | 负责 | 不负责 |
|---|---|---|
| **Agent（大脑）** | 理解意图、把目标拆成**能力调用序列**、为每一步选一个能力与参数、读回执、判断成功/失败后重规划、缺信息时反问、把不可自动化的部分交人工 | 不碰 DOM、不持有页面细节、不自己写选择器去硬猜一台设备做不到的事 |
| **插件（能力）** | 提供**可声明、可协商、可回执、可确认**的原子能力：页面观测、闭集动作、站点定向能力（分发/采集/触达/读数）、本地执行器与人工确认闸 | 不做决策、不改目标、不替用户判断是否该继续 |
| **能力契约（二者唯一的语言）** | 声明每个能力的参数、限额、确认要求、可能回的错误码、最低版本、站点矩阵 | —— |

四条硬要求（后文全部围绕它们设计）：

1. **可发现**：大脑无需人工在提示词里背清单，能力目录是机器可读的单一真源。
2. **可协商**：派发前就知道"这台设备、这个版本、这个站点，此刻能不能做"，不能做就不派发。
3. **可回执**：每个能力回同一种形状 `{ ok, code, data, evidence, elapsedMs, needsGrant? }`，错误码枚举唯一。
4. **可缺口上报**：做不到时如实结构化上报"缺哪条能力"，让能力补充由数据驱动，不靠推测。

---

## 二、插件能力全量清单（现状盘点，逐条带实现位置）

这张表就是"大脑应该看到的东西"的实底。今天它是散落的，§三 把它变成契约里的一个对象。

### 2.1 通道与身份

| 能力 | 实现位置 | 备注 |
|---|---|---|
| 设备登录（`rc_` 令牌）与 30s 心跳 | `chrome-rpa.js:125-127`（登录上报 `extensionVersion`）、`:158-164`（告警）、`:189-192`（心跳上报 `version` + 打开页 ≤20） | 后端落库 `chrome-device.service.ts:226`/`:334-343` |
| 指令队列拉取 / 回执上报（失败重试 ≤3）/ 远端停止 | `chrome-rpa.js:194-239`、`:407-422` | 401 即清令牌 |
| 敏感动作人工确认 | `chrome-rpa.js:393-405` + `chrome-rpa.ts:90-127`（敏感词表 15 项） | 本人在插件点「允许本次」 |
| 页面控制横幅（含停止按钮） | `rpa-executor.js:328-357`、分发口 `:466-469` | **执行器实现了，但不在闭集里 → 云端派不出来**，见 §四 K16 |
| 任意网页接管（`<all_urls>`）+ 站点授权撤销联动 | `manifest.json:13`、`background.js:100-153`、`:163-230`（按声明站点动态注册 bridge） | 权限被撤销即关相关页签 |

### 2.2 页面观测

| 能力 | 实现位置 | 限额与已知问题 |
|---|---|---|
| `snapshot` 页面地图 + 正文 | `rpa-executor.js:137-151` | 可交互元素上限 **120**（`:9`）；正文 `maxChars` 默认 2000、封顶 6000（`:439`）；**Agent 侧从不传 `maxChars`**（`chrome-agent.js:167`）→ 长列表条目静默丢失 |
| `read` 读单元素（text/attribute/count） | `rpa-executor.js:288-307` | 只取**一个**元素；返回值再截 2000 字；无"批量读一列"形态 |
| `screenshot` 视口截图 | `chrome-rpa.js:318-332`（`captureVisibleTab`） | 无元素/区域截图 |
| 工作页归属（当前活动页自动纳为会话页） | `chrome-rpa.js:524-534` `agentEnsureTab` | 只做当前活动页；**没有"列出/切换到其他已开页签"的动作** |

### 2.3 页面动作（闭集）

| 能力 | 实现位置 | 后端是否放行 | **大脑是否被告知** |
|---|---|---|---|
| `open_tab` / `navigate` | `chrome-rpa.js:277-308` | 是 | 是 |
| `close_tab`（带会话归属校验） | `chrome-rpa.js:309-317` | 是（`RC_ACTIONS` 含它） | ~~否~~ **已收编（2026-11-12）** |
| `act click` / `type` / `select` / `scroll` | `rpa-executor.js:228-286` | 是 | 是 |
| `act check` / `key` / `submit` | 同上 | 是（`RC_ACT_INTERACTIONS` 7 项，`chrome-device.service.ts:719-729` 白名单已放行） | ~~否~~ **已收编（2026-11-12）** |
| `wait ms` | `rpa-executor.js:309-326` | 是 | 是 |
| `wait target=…`（等元素出现，≤30s） | 同上 `:310-322` | 是（字段白名单含 `target`/`timeoutMs`，`:730-741`） | ~~否~~ **已收编（2026-11-12）**，同时把 `timeoutMs` 补进字段白名单（此前会被静默丢弃，恒回落 10s） |
| `finish` | `chrome-rpa.js:272` | 是 | 是 |

> 原结论：真实"手"有 12 种用法，大脑被告知的只有 8 种，且提示词写着"闭集，别的动作一律无效"（`chrome-agent.service.ts:49-61`）。
> **2026-11-12 已改（两处，缺一不可）**：
> ① **告知**：`SYSTEM_PROMPT` 补齐 `close_tab` / `act check` / `key` / `submit` / `wait target`，并让历史行回灌 `tabId`/`count`（插件侧 `chrome-agent.js:173-186`、云端侧 `chrome-agent.service.ts:1142-1160`）——否则模型开完页签不知道 id，`close_tab` 写了也用不了。
> ② **参数形状**：提示词一直教的是**扁平** `elementIndex`/`selector`，而执行器 `runAct/runRead/runWait` 只解析 `action.target`（`rpa-executor.js` 原 `:227/:281/:300`）。也就是说"大脑被告知了，手也知道了，但接不上"——扁平 `elementIndex` 的 click/type 在真机上恒回 `NO_MATCH「没有匹配到目标元素」`。已补 `targetOf(action)`（`rpa-executor.js:169-175`）把扁平写法归一成 `target`，`act`/`read`/`wait` 三处统一走它；顺带把 `act key` 移到空目标判定之前，让提示词承诺的"省略 elementIndex 则作用于当前焦点"真正成立（原来那段 `el || document.activeElement` 兜底永远走不到）。
> **仍缺（同类漂移，尚不在提示词里）**：`read` 的 `mode:"attribute"` 与 `mode:"count"`（执行器支持，`rpa-executor.js:288-307`，但 `normalizeChromeAction` 字段白名单不含 `mode`/`attribute` → 传了也丢），以及 `act type` 的 `clearFirst`。这三项要一起做，就得走 §三 3 的"菜单由目录派生 + 字段白名单由目录派生"，而不是再手写一遍。
> **第三类缺陷（确认闸与目标形状对不上）**：敏感动作闸门 `rcActionNeedsConfirm` 只看 `action.target` 里的 `selector/name/text/role` 文本（`packages/contracts/src/chrome-rpa.ts:109-138`）。提示词教的扁平 `elementIndex` 点"发布/删除"按钮时，服务端拿不到元素名 → 关键词命中不了 → 不弹确认（`submit` 仍无条件弹，插件侧 `chrome-agent.js:361` 只透传服务端 `needsConfirm`，没有本地兜底）。闸门只在服务端算（`chrome-device.service.ts:748-750`），插件只转达用户选择（`chrome-rpa.js:199-203`、`:393-399`）。修法见 §四 K20。

### 2.4 站点定向能力（已按业务写死的那批）

| 能力 | 覆盖面 | 实现位置 |
|---|---|---|
| 内容分发填充/发布 | **13 个平台**（weibo/xhs/dy/zhihu/toutiao/ks/channels/zsxq/mp/baijiahao/bili/jianshu/douban），html/markdown/text 三形态，含图片注入与自动点发布 | `publisher.js:518-841`（每平台一个 `run(task)`）、`background.js:42-56`、`:431-457` |
| 发布后效果读数 | **13 个平台码**，多候选页轮询、全零换页、登录/验证码即停 | `metrics.js:93-172`、`background.js:58-74`、`:312-384` |
| 线索采集（search/account/content 三类） | **只识别 6 站**（`collector.js:18-25`）；`maxItems≤500`、滚动 ≤40 轮、`nextUrls≤10` | `collector.js:595-653` |
| 公开联系方式抽取 | 邮箱/手机/微信号正则 + 可见性标注 | `collector.js:456-551` |
| 触达（评论/私信） | **只实现 2 种**：抖音评论、小红书私信（`outreach.js:278`），manifest 也只在两站注册（`manifest.json:92`）；失败时复制话术到剪贴板转人工 | `outreach.js:151-158`、`:268-289`、`:306-420` |
| 采集任务调度（反风控节奏、目标数 ≤20、硬上限 500） | 6 站有搜索入口，**4 站明确拒绝并给替代方案** | `acquisition.js:30-43`、`:80-85`、`:398` |

### 2.5 侧边栏 Agent 自身的能力（目前只有本地消息能驱动）

| 能力 | 实现位置 |
|---|---|
| 会话循环（观测→决策→执行，连续失败 3 次即停） | `chrome-agent.js:257-384` |
| 增强提示 / 附件上传（≤10）/ 自动连跑偏好 | `chrome-agent.js:443-456`、`rpa-chrome.public.ts:183-199` |
| 录制→工具、回放（步间 400ms） | `chrome-agent.js:461-566`、`rpa-executor.js:410-426` |
| 技能库 / 计划任务 / 会话台账（走 `RpaChrome_*`，不过 grant 门） | `chrome-agent.js:199-217`、`sidepanel.js:576-1232`、`rpa-chrome.public.ts:235-253` |
| 站点口令登录（申请 `<all_urls>` 权限） | `sidepanel.js:1497` |

### 2.6 能力声明侧（契约与后端）

| 资产 | 位置 | 现状 |
|---|---|---|
| 能力键三族 `distribution/acquisition/chrome` + `minVersion` + `actions[]`（含 `input/output` schema、`requiresConfirmation`） | `extension.ts:19`、`:85-122`、`:125-335` | **形态已经是对的**，chrome 只声明了 act/crawl/extract 三个意图档，没有动作原语，也没被 Agent 侧消费 |
| 派发门 `assertDispatchable`（RETIRED/DEPRECATED/GRAY/版本/强升 五道） | `extension-catalog.service.ts:168-215` | 调用方只有 `plugin-bridge.service.ts:97`（acquisition）与 `browser-task.service.ts:95` —— **`chrome` 一次都没进门** |
| 统一任务信封与 14 个错误码 + "哪些错误即停" | `browser-task.ts:17-26`、`:102-144` | 插件内部另有 6 个私有码，两套词汇并存 |
| 协议版本 | 契约 `browser-task.ts:17` = **2**；`bridge.js:17` = **1** | 网页侧握手落后一个版本，且 `TASK_ROUTES`（`bridge.js:20-27`）没有 chrome 路由 |
| 工具目录自动派生（`list_operations` / read_data / write_data） | `rpa-chrome.public.ts:255-285`、`chrome-agent.service.ts:77-86` | 机制可用，但大脑视野被域白名单 + 120 条上限截断 |

---

## 三、能力契约设计（让大脑"看见"能力）

### 1. 把"动作原语"提升进能力目录（单一真源，不手写第二份）

契约里新增由常量派生的函数，而不是新的清单：

```jsonc
// EXTENSION_CAPABILITIES.chrome 增广（示意）
{
  key: "chrome",
  minVersion: "1.4.0",
  actions: [ /* 现有 act/crawl/extract 意图档，保留 */ ],
  primitives: [                       // ← 新增：动作原语 = 大脑可用的"手"
    { name: "snapshot", label: "读取页面地图", args: { maxChars: "number" }, limit: { elements: 120, textChars: 6000 }, errors: ["EXEC_ERROR"] },
    { name: "act",      label: "操作页面",     subActions: ["click","type","select","check","scroll","key","submit"],
      requiresConfirmation: { submit: true, clickOnSensitive: true } },
    { name: "wait",     label: "等待",         args: { ms: "number≤30000", target: "element", timeoutMs: "number≤30000" } },
    { name: "close_tab", /* … */ }
  ],
  sites: [                            // ← 新增：站点×动作 三态矩阵
    { platform: "DOUYIN",  collect: "READY", comment: "READY",  dm: "NOT_OPEN" },
    { platform: "KUAISHOU",collect: "NOT_OPEN", reason: "快手采集本期未开放" }   // reason 直接沿用 acquisition.js:38-43 的可操作文案
  ],
  evidence: ["SCREENSHOT","TEXT"],
  errors: ["NEED_LOGIN","CAPTCHA","RISK_CONTROL","PAGE_CHANGED","NO_MATCH","WAIT_TIMEOUT","UNKNOWN_ACTION","EXEC_ERROR","NO_TAB","INJECT_FAILED","UNTRUSTED_SITE"]
}
```

要点：
- `primitives` **从 `RC_ACTIONS` / `RC_ACT_INTERACTIONS` / 执行器实现派生**（写一个 `extensionActionPrimitives()`，与 `chrome-rpa.ts:53-86` 同源），目录不可能再漏 close_tab/check/key/submit；
- `sites` 用三态 `READY / NOT_OPEN / WONT_DO + reason`，把"声明得比实现宽"的口子堵住（现状：目录 10 站、插件只认 6 站且明确拒 4 站）；`reason` 就是给用户看的下一步建议，符合"阻断必须给可操作出口"；
- 每个原语带 `limit`，让大脑按限额排产（如 `harvest.limit≤200`、`maxItems≤500`），而不是跑爆再失败。

### 2. 运行时协商：心跳带能力指纹

```
登录/心跳上报 { version, protocol, capabilities: ["distribution","acquisition","chrome"],
                primitives: [...], siteMatrixHash, contentScriptsReady: [...] }
后端：与目录 minVersion/状态比对 → 落设备行 caps + capsAt → 派发前查
```

- 现在只报 `version` + 打开页（`chrome-rpa.js:189-192`），平台知道"1.4.0"却不知道"这台机器的插件是否真带 harvest / 该站内容脚本是否被禁"；
- 派发门补 `assertDispatchable('chrome', …)`（今天 chrome 完全不过门），不匹配时**不派发**，回 `CAPABILITY_MISSING`（新错误码）+ 该能力所需最低版本 + 下载/更新入口；
- 旧插件的回落策略是**决策时就只给它支持的动作菜单**，而不是跑到一半 `UNKNOWN_ACTION`（`rpa-executor.js:478`）——用户看到的是"Agent 很笨"，实际是设备版本不够，这是今天最难排查的一类问题。

### 3. 大脑侧：能力菜单由契约生成（消灭硬编码）

`SYSTEM_PROMPT` 拆成两半：

- **固定纪律**（意图判断、reply/question/confirm 出口、禁止绕过登录与验证码、行数据不经模型复述）——留在代码里；
- **能力菜单**——改由 `capabilityDigest(primitives, deviceCaps)` 每步动态生成，输出格式与平台工具摘要一致（`原语名｜参数｜是否需确认｜失败会回什么码`）。

同时把"平台工具"从一次性灌 120 条改成**两级发现**：默认只注入与本目标相关的域摘要（现状 `PLATFORM_TOOL_DOMAINS` 四个域，`chrome-agent.service.ts:77-86`），模型需要更多时自己调 `list_operations(keyword)`（`rpa-chrome.public.ts` 已透传，`chrome-agent.service.ts:68` 已提示这条用法）。**多维表格、CRM 等按 operationId 精准登记**，而不是整域放开——这条细节见 `docs/浏览器代理网页采集落表方案.md` §五 D。

再加一道校验：模型若返回了设备能力集里没有的原语/站点，**不当作"动作失败"重试**，而是判为无效决策并回灌一句"该设备不支持 X，请改用 Y 或交人工"（复用现有 `MAX_INVALID_DECISIONS=2` 的重问机制，`:42`/`:513`）。

### 4. 任务组织：能力调用序列，且允许"规划一次、连跑多步"

```
目标 → plan: [ {seq, kind: page|tool|human, capability, args, expect, needsConfirm, onFailure} ]
      → 插件按队列连跑 → 每步回 {ok, code, evidence} → 偏离预期才回到大脑重新决策
```

- 今天的循环是**每步一问模型**（`chrome-agent.js:145-152` 每步 POST `/decide`），25 步 = 25 次模型调用，又贵又慢，还让模型有机会在中途"改主意"；
- 改成"意图队列连跑、偏离即回脑"（N14），一次规划给 3–8 步，只在 `needsConfirm`、`code != OK`、或 `expect` 不满足时回到决策；成本降一个量级，同时"插件消化任务"这句要求才成立——插件吃的是一串能力调用，不是一串问答题；
- **三条编排入口共用同一份能力契约**：① 侧边栏即时目标（插件循环）；② 云端会话引擎（`chrome-agent.service.ts:798-1014`）；③ 工作流/统一任务中心。第三条**不需要新节点类型**：工作流的 `action` 节点就是任意契约 operationId（`workflow-catalog.ts:291`），`chrome_*` 七个语义工具（`chrome-rpa.ts:653-661`）直接可编排，预算已有 `maxBrowserActions` 且引擎真的在拦（`workflow.ts:95`、`workflow-engine.ts:1265-1266`）——**这是"预留位已就绪"，不是缺口**，只需把能力声明补齐。

### 5. 缺口上报：把"能力不够"变成数据

大脑判定"没有可用能力能完成这一步"时，不许用现有动作硬凑，而是输出结构化缺口：

```jsonc
{ "gap": { "need": "wait.networkIdle", "why": "页面结果由 XHR 异步渲染，等元素与等秒数都不稳",
            "site": "map.baidu.com", "attempted": ["wait.target","wait.ms=8000"], "want": "等到网络空闲 ≤3s" } }
```

落 `RpaChromeMessage.kind='gap'` 或新表（N18），管理后台按 `站点 × 需求` 聚合排行 → 变成插件版本迭代待办。缺口天然分三类，处理方式不同：

| 类 | 例子 | 谁来补 |
|---|---|---|
| 需要新动作原语 | harvest、wait_for、fill_form | 插件（§四） |
| 需要站点适配 | 某站选择器规则失效 | 站点技能配方（沉淀闭环，见采集落表方案 §五 G-c） |
| 需要平台工具 | 表格/CRM 工具不在大脑视野 | **只改后端白名单，不动插件**（§三 3） |

---

## 四、插件能力补充清单（需要补的就在这里，含来源与优先级）

### P0 · 不补则"采集/结构化/新设备"这类任务必然跑偏

| # | 要补的能力 | 从哪来（证据） | 大脑拿它做什么 | 批次 |
|---|---|---|---|---|
| K1 | **`harvest` 收割动作**（含 `mode:"discover"` 结构分组、字段三取法：选择器候选 / `afterLabel` / 内置 `pattern`） | 现在 `read` 只取单元素（`rpa-executor.js:288-307`），列表只能靠截断正文猜 | 一次指令把「重复条目 × 字段」收成行数组，行数据不经模型复述 | 采集落表方案 D2/D2b |
| K2 | **`read mode:"all"`**（批量读整列/整组元素） | 同上，逐元素读会把步数吃光 | 详情页多字段一次拿全 | D2 |
| K3 | **`snapshot.maxChars` 由决策侧传入** | 插件从不传（`chrome-agent.js:167`），执行器默认 2000/封顶 6000（`rpa-executor.js:439`） | 长页面不再静默丢条目 | D2 |
| K4 | **动作菜单由契约生成**（收编已实现的 `close_tab`/`act check`/`key`/`submit`/`wait target`） | `RC_ACTIONS`/`RC_ACT_INTERACTIONS` 与后端白名单都已放行（`chrome-rpa.ts:53-86`、`chrome-device.service.ts:717-742`），只有提示词不知道（`:49-61`） | **零新增实现**，纯接线即让大脑会勾选、会按键、会提交、会等元素出现。~~未开始~~ **2026-11-12 已手工补齐 5 项动作 + `timeoutMs` 白名单 + `tabId` 回灌 + 执行器接受扁平 `elementIndex`（`targetOf`）；剩余项是「改为由目录派生 + 漂移守卫」，见 C1** | 本文 C1 |
| K5 | **`chrome` 能力派发门 + 心跳能力指纹** | `assertDispatchable` 无 chrome 调用方（backend 全量 grep）；心跳只报 version（`chrome-rpa.js:189-192`） | 旧插件不再被派新任务；不满足时给"请更新到 x.y.z"的可操作出口 | 本文 C2 |
| K6 | **`CAPABILITY_MISSING` 错误码 + 回落菜单** | 现失败表现为 `UNKNOWN_ACTION`×3 后停（`rpa-executor.js:478`、`chrome-agent.js:14`） | 区分"插件做不到"与"这次没做好"，避免把版本问题当智能问题 | 本文 C2 |

### P1 · 明显拓宽适用面（多数是"把已有原语提升成公共能力"）

| # | 要补的能力 | 从哪来 | 大脑拿它做什么 |
|---|---|---|---|
| K7 | **`wait_for`**：等文本出现/消失、等 URL 变化、（可选）等网络空闲 | 现仅 `wait ms` 与 `wait target`（`rpa-executor.js:309-326`） | SPA 结果异步渲染是采集类目标最常见的翻车点；`networkIdle` 需 N17 拍板 |
| K8 | **`fill_form`**：一次动作填多字段并回报未命中项 | 单字段 `act type` 已有（`:235-245`） | 20 步表单 → 2–3 步，直接缓解 25 步预算 |
| K9 | **`list_tabs` + `tab_select`**（页签枚举与切换工作页） | 工作页只绑当前活动页（`chrome-rpa.js:524-534`）；心跳其实已上报打开页 ≤20 却从未进大脑视野（`chrome-device.service.ts:334-343`） | 多页签对照、跨已开页面操作（"右边已经开着的百度地图"要能被直接接管，而不是新开一个） |
| K10 | **`upload_file`**：把文件注入页面 `input[type=file]` | 分发侧已有成熟原语（`publisher.js:471-494` dataURL→File→隐藏 input），只是没暴露成 Agent 闭集动作 | 上传类目标（简历投递、素材上传） |
| K11 | **元素/区域截图** | 现只有视口截图（`chrome-rpa.js:318-332`） | 证据更准，人工核对成本更低 |
| K12 | **`allFrames` 注入与跨框架聚合** | 注入只打顶层（`chrome-rpa.js:352-354`） | 结果区在 iframe 里的站点（地图、后台）不再返回 0 条（N13 与采集方案 N7 同一件事） |
| K13 | **平台工具白名单精准扩充**：`DataTable_landRows`、`DataTable_aiPlanTable`、`Crm_createLead` 等按 operationId 登记 | `PLATFORM_TOOL_DOMAINS` 四域 + 排除正则 + 120 上限（`chrome-agent.service.ts:77-86`） | 大脑看得见"落库/写业务对象"的能力，才可能自动完成"采集 → 落表"闭环 |

### P2 · 补强项（需单独评估成本与合规，先登记不承诺）

| # | 要补的能力 | 场景 | 顾虑 |
|---|---|---|---|
| K14 | **`network` 观测**（同源 XHR 的 URL/状态/耗时，不含 Cookie、不回响应体） | 结构混淆站点直接找到数据接口，比 DOM 稳 | 只读元数据可接受；读响应体属另一档（N17） |
| K15 | **`session_probe`**：站点登录态自检（通用化） | collector 的 `loginPrompt()` 是站点私有实现（`collector.js:142-149`） | 通用探针需与黑名单/敏感词表同纪律 |
| K16 | **`banner` / `record` 纳入闭集**（云端可控的横幅与录制） | 执行器已实现（`rpa-executor.js:466-472`），只能由本地消息驱动（`chrome-agent.js:461-566`） | 加进 `RC_ACTIONS` 即解锁"录制→工具"的云端发起 |
| K17 | **`download` 捕获**：页面触发的下载取回成数字资产 | 报表导出类目标 | 需 `chrome.downloads` 权限，扩权限要走说明与审核 |
| K18 | **`dialog` 处理**：原生 `alert/confirm/prompt` 的接受/取消 | 提交类流程常弹原生确认框 | 默认不自动接受，须逐次人工或显式授权 |
| K19 | **口令一次性代理**（`RpaAccount` 密文 → 本人设备登录） | 无人值守登录 | 与既有 D3-A 口径冲突，需产品重新拍板 |
| K20 | **敏感闸门前置到目标解析**：`rcActionNeedsConfirm` 现在只读 `action.target` 的 `selector/name/text/role`（`chrome-rpa.ts:109-138`），扁平 `elementIndex` 点"发布/删除"命中不了关键词 → 不弹确认。修法：决策侧要求模型把 `snapshot` 地图元素的 `name` 随动作回传并纳入关键词判定，或在插件执行前用已解析元素文本本地判一次（`rpa-executor.js:228`） | 勾选/按键/提交类动作收编后，elementIndex 形态成为主用法，漏确认风险随之放大 | 本地判要在注入后、动作生效前；`submit` 仍保持无条件确认不动 |

### 明确不做（写进目录的 `WONT_DO`）

任意 JS 求值（`eval_script`）、读取 Cookie / 本地口令库、验证码绕过与打码、静默发布或静默支付（沿用 `RC_SENSITIVE_KEYWORDS` 确认闸）、跨账号取数据。

### 声明修正（不是新能力，但不修则大脑继续被误导）

| # | 修正 | 现状证据 |
|---|---|---|
| S1 | acquisition 站点矩阵改三态，`reason` 沿用插件文案 | 目录 10 站（`extension.ts:70-81`、`acquisition.ts:11-22`）vs 插件只认 6 站（`collector.js:18-25`）且拒 4 站（`acquisition.js:38-43`） |
| S2 | outreach 标注为「抖音评论 / 小红书私信 READY，其余 NOT_OPEN」 | 只有 2 条实现（`outreach.js:278`），manifest 只注册 2 站（`manifest.json:92`） |
| S3 | `bridge.js` 协议版本对齐 2，`TASK_ROUTES` 补 chrome 路由 | `bridge.js:17` =1 vs `browser-task.ts:17` =2 |
| S4 | 错误码收敛到 `BROWSER_TASK_ERROR_CODES` 单一真源（插件私有 6 码并入或映射） | `browser-task.ts:102-118` vs `rpa-executor.js:449-489`、`chrome-rpa.js:539/546` |
| S5 | 新增一致性守卫：目录里每个 action/原语必须能在插件找到实现，`sites` 每项必须在 manifest matches 与站点规则表里存在 | 今天没有任何脚本卡这条，漂移只在事故后被发现 |

---

## 五、契约 / 后端 / 插件改动清单（文件级）

**契约**
- `extension.ts`：`ExtensionCapabilityDef` 增 `primitives?`、`sites?`（三态）、`evidence`、`errors`；新增 `extensionActionPrimitives()`（由 `RC_ACTIONS`/`RC_ACT_INTERACTIONS` 派生）与 `siteMatrixOf(capability)`；`chrome.actions` 保留意图档不动，避免打断现有页面入口。
- `browser-task.ts`：错误码枚举新增 `CAPABILITY_MISSING`、`UNSUPPORTED_SITE`，并加入 `browserErrorStopsTask`（属"换设备/升级"类，重试无意义）。
- `chrome-rpa.ts`：心跳体增 `protocol/capabilities/primitives/siteMatrixHash`；决策体增 `deviceCaps`（后端注入，不给插件伪造）；若做 K16/K7 则同步扩 `RC_ACTIONS`/`RC_WAIT_MODES`/`RC_READ_MODES`。

**后端**
- `extension-catalog.service.ts`：新增 `effectivePrimitives(capability, caps)` 与 `assertPrimitiveDispatchable(...)`；把 `chrome` 纳入同一道门（N12/N13）。
- `chrome-device.service.ts`：落 `caps`/`capsAt`（**MySQL 走 `migrate deploy`，新迁移从 `0091_*` 顺延**；Postgres 侧由 `scripts/gen-prisma-schema.mjs` 派生）；`normalizeChromeAction` 字段白名单改为从目录派生（今天 `timeoutMs`、未来的 `harvest` 参数会**被静默丢弃**：`:730-742`）。
- `chrome-agent.service.ts`：`SYSTEM_PROMPT` 去动作枚举化 + `capabilityDigest()` + 能力外动作判无效并回灌 + `gap` 出口与落库 +（N14）意图队列的校验与连跑指令。
- `rpa-chrome.public.ts`：`/decide` 前查能力门；`/tool` 白名单从四域扩为"四域 + 精准 operationId 列表"（K13）。

**插件**
- `chrome-rpa.js`：心跳上报能力指纹；动作分发按目录裁剪。
- `rpa-executor.js`：新增 `harvest`/`fill_form`/`wait_for`/`upload`/`list_tabs` 等原语实现（P0→P1 顺序）。
- `chrome-agent.js`：意图队列（连跑 + 偏离回脑）、`observe` 按 mode 传 `maxChars`。
- `bridge.js`：协议版本与路由对齐（S3）。
- `sidepanel.js`：能力面板（本设备此刻可用能力清单 + 版本提示）、缺口反馈入口、结果卡"打开表格"。

**治理**
- 新脚本 `scripts/verify-extension-caps.mjs`（S5）+ 纳入 `check:architecture`；目录三态在平台后台可维护（沿用 `PUT /enterprise/extension/capabilities/:key`，`extension.ts:437-456`）。

---

## 六、批次

| 批次 | 内容 | 验收判定 |
|---|---|---|
| C1 | K4 动作菜单契约化生成 + S4 错误码归一 + `normalizeChromeAction` 白名单派生 | 模型能在真机上完成"勾选协议 + 回车提交 + 等元素出现"三件事，且不再出现"插件会但大脑不知道会"的动作。**2026-11-12 已手工完成其中的"接线 + 扁平参数收口"子集（真机验收还差插件重打包，见风险 6），本批次剩余的是"由目录派生 + 漂移守卫"** |
| C2 | K5/K6 心跳能力指纹 + `chrome` 派发门 + `CAPABILITY_MISSING` 与回落菜单 | 人为把设备版本改成 1.3.0 后，Agent 会话仍开、菜单里没有新原语、提示"请更新到 1.4.0"并给下载入口；不出现 UNKNOWN_ACTION 三连失败 |
| C3 | S1/S2/S3 声明修正 + `verify-extension-caps.mjs` 守卫 | 守卫在 CI 里能复现今天这三处漂移（先红后绿）；目录与插件实现零差异 |
| C4 | K1/K2/K3 收割原语（与采集落表方案 D2/D2b 同批） | 3 个不同列表页各收 ≥20 行；混淆 class 陌生页 2 步探测选对分组 |
| C5 | K7/K8/K9（wait_for / fill_form / 页签枚举切换） | 表单类目标 ≤5 步；"接管我右边已开着的页面"成为默认行为 |
| C6 | K10/K11/K12（upload / 元素截图 / allFrames） | 上传与 iframe 站点各一例真机通过 |
| C7 | K13 工具白名单 + 三级发现（`list_operations` 兜底） | 采集 → 落表一句话跑通；提示词工具条数不升反降 |
| C8 | §三 5 缺口上报 + 后台排行页 | 人为造一个做不到的目标，缺口落库且能在后台按站点聚合看到 |
| C9 | （N14）意图队列连跑 | 同一目标模型调用次数下降到步数的 1/3 以内，结果不劣化 |
| C10 | 全量校验（typecheck/lint/test、双 Prisma schema、`api:docs:check`、`check:architecture`）+ 帮助中心 + README 8 语言 | 全绿；无新增 `as never`/`eslint-disable` |

---

## 七、工作量与风险

- **量级**：C1–C3 是纯接线与治理（不做任何新执行能力），却直接决定"大脑看不见能力"这类最隐蔽的失败，**建议第一批就做**；C4 起才是真功能。
- **风险 1｜能力目录再次失真**。没有 S5 守卫，两个版本内必然重演今天的漂移（目录 10 站 / 插件 6 站就是先例）。缓解：守卫脚本进 CI + 每次插件加动作必须同批改目录常量。
- **风险 2｜菜单变长导致成本与跑偏**。动态菜单容易把提示词撑大。缓解：菜单只给"原语名 + 关键参数 + 错误码语义"，限额与 schema 不进正文；工具走两级发现，默认条数不升。
- **风险 3｜连跑降低可控性**。意图队列减少回脑次数，也减少纠偏机会。缓解：`needsConfirm` 与所有非 OK 码一律回脑；连跑窗口硬上限 8 步（N14）。
- **风险 4｜指纹可被伪造**。`primitives` 由插件上报。缓解：以 `version + protocol + siteMatrixHash` 与目录比对为准，缺项只走"降级菜单"而不放大权限；敏感动作确认闸不看上报值。
- **风险 5｜与并行会话冲突**。`docs/*`、`frontend/src/app/rpa/*`、迁移号常被其他会话同时写，动手前先看 mtime。
- **风险 6｜源码改了，用户手上的包没改**。`frontend/public/downloads/aipdd-enterprise-v{version}.zip` 是随仓库分发的产物，而 `scripts/verify-distribution.mjs:113-132` 只校验"文件名版本 == manifest 版本"，不校验内容。所以插件侧改动（如 2026-11-12 的 `rpa-executor.js`/`chrome-agent.js`）在**升版本并 `node scripts/pack-extension.mjs` 重打包之前，对已装用户等于没发生**，且旧包与新提示词组合会出现"大脑给了动作、老执行器不认"的形状错配。缓解：任何 `extensions/aipdd-enterprise/**` 改动必须与 manifest 版本号 + 重打包 + K5 派发门（"请更新到 x.y.z"）同批落地。

---

## 八、决策点（请按编号回复，N1–N11 见 `docs/浏览器代理网页采集落表方案.md` §十二）

| # | 决策 | 选项 | 推荐 |
|---|---|---|---|
| **N12** | 能力菜单来源 | A 由 `RC_ACTIONS`/目录常量派生、每步动态生成（C1）/ B 继续手写 + 加一致性测试 | **A**（B 只是把漂移发现得晚一点） |
| **N13** | 派发门粒度 | A 只按 `capability.minVersion` / B 动作原语级 `minVersion` + 心跳能力指纹 / C 再叠站点三态矩阵 | **B**（C 一并做也不贵，但站点判定以服务端目录为准，避免插件自报） |
| **N14** | 意图队列连跑 | A 做（一次规划 3–8 步，偏离即回脑）/ B 保持每步一问 | **A**，连跑窗口上限 8 步 |
| **N15** | 工作流里的浏览器步骤 | A 复用 `action` 节点调 `chrome_*` 语义工具（零新节点）/ B 新增 `browser` 节点 kind | **A**（`maxBrowserActions` 预算与引擎拦截已就绪） |
| **N16** | 声明与实现不一致 | A 目录改三态并补 `verify-extension-caps.mjs` 守卫 / B 只在文档写"实际支持范围" | **A**（这是本清单里最便宜、最高杠杆的一项） |
| **N17** | 网络观测档位 | A 只读同源请求的 URL/状态/耗时 / B 不做 / C 连响应体一起可读 | **A**（C 等价于绕开 DOM 抓数据，合规与站点条款要单独评估） |
| **N18** | 缺口台账 | A 新表 `rpa_chrome_gaps` + 后台排行页 / B 先复用 `RpaChromeMessage.kind='gap'` | **B 起步、下版本升 A**（先攒数据再建表） |

---

**待你回复 §八 N12–N18 与采集落表方案 N1–N11，我再按 §六 C1–C10 开工；确认前不动代码。**
