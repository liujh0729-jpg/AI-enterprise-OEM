import { EXTENSION_CAPABILITIES } from '@enterprise/contracts';

/**
 * 平台统一浏览器插件（AIPDD Enterprise）的发布信息：顶部插件入口、营销工具分发页与
 * 后续所有浏览器能力共用这一份版本 / 下载地址，避免各业务各写一套。
 * 能力清单不在这里再抄一遍：直接从契约层 EXTENSION_CAPABILITIES 派生（§10.10 统一基准）。
 * 插件打包与版本同步规则见 extensions/aipdd-enterprise/README.md。
 */
export const EXTENSION_RELEASE = {
  name: 'AIPDD Enterprise',
  version: '1.4.0',
  /** 低于该版本的插件不再派发需要新版协议的任务，页面提示升级。 */
  minVersion: '1.4.0',
  /** zip 由前端 public 静态目录分发；留空视为平台尚未发布插件包，入口整体隐藏。 */
  downloadPath: '/downloads/aipdd-enterprise-v1.4.0.zip',
  chromeStoreUrl: '',
  edgeStoreUrl: '',
  /** 发布包 sha256：发布时填入，入口展示供下载后核对；空串不展示。 */
  checksum: '',
  browsers: ['Chrome 109+', 'Edge 109+（Chromium 内核）', '不支持移动端浏览器'],
  homepage: '/marketing-tools/distribution',
  /** 能力清单从契约派生，只保留入口展示需要的字段（完整定义见 EXTENSION_CAPABILITIES）。 */
  capabilities: EXTENSION_CAPABILITIES.map((capability) => ({
    key: capability.key,
    label: capability.label,
    description: capability.description,
    entry: capability.entry,
    minVersion: capability.minVersion,
  })),
  installSteps: [
    '下载 zip 并解压（Windows「全部解压缩」会得到与压缩包同名的文件夹，里面直接就是 manifest.json）。',
    'Chrome / Edge 地址栏打开 chrome://extensions/，右上角开启「开发者模式」。',
    '点「加载已解压的扩展程序」，选中解压出的那个文件夹（不用再往里钻一层）。',
    '在扩展列表把 AIPDD Enterprise 固定到工具栏（拼图图标 → 图钉）；之后点图标即拉开右侧侧边栏。',
    '点工具栏插件图标从右侧拉开侧边栏，在右上角「⋯」里填写本系统域名与账号密码完成登录；分发与获客随即可用。',
  ],
  usage: [
    '插件复用浏览器里各平台已登录的会话，账号凭据不出本机，不读 Cookie、不绕过验证码。',
    '分发：先勾选内容与目标平台再点分发；关闭「自动发布」时只填好内容，回平台页人工确认。',
    '获客：页面会签发 5 分钟有效、只能 pull/report 的令牌给插件，过期自动续期，任务不重启。',
    '执行期间保持工具页打开；关掉页面后任务会按心跳超时记为 PARTIAL，已打开的平台页保留供人工接手。',
    '遇登录墙 / 验证码 / 风控页插件会停下并回报 NEED_LOGIN / CAPTCHA / RISK_CONTROL，就地处理后重试。',
  ],
  changelog: [
    {
      version: '1.4.0',
      date: '2026-11-11',
      notes: [
        '新增本地 Chrome 控制：同一插件登录本系统后成为该账号名下一台本地 Chrome 设备，云端 Agent 逐步决策、插件在本机执行。',
        '新增浏览器代理侧边栏（Alt+A）：一句话目标即在你已登录的站点上自主多步执行，Act / Crawl / Extract 三种能力档，模型与工具都走本系统配置。',
        '新增技能库（个人 / 站点）、「录制 → 工具」（录制一次操作生成可复用动作序列），均本账号私有。',
        '新增计划任务：按每天 / 每周 / 每月 / 每小时 / 按分钟排期，到点只在设备在线时执行，离线当轮跳过、不补跑，账号停用自动暂停。',
        '新增 alarms（心跳保活）与 scripting（把动作执行器动态注入目标页）为插件权限；目标站点访问在首次登录时按提示授权一次。',
        '改为点击工具栏图标**直接拉开右侧侧边栏**（不再弹浮窗），设备登录收进侧边栏右上角「⋯」。',
        '补充深色底插件图标（此前无图标声明，浏览器只能给灰色占位）；zip 摊平打包，解压出的文件夹可直接被「加载已解压的扩展程序」选中。',
        '与分发 / 获客共用同一套页面通信协议，账号凭据仍不出本机。',
      ],
    },
    {
      version: '1.3.0',
      date: '2026-11-07',
      notes: [
        '同一个插件原地升级，新增 AI 获客采集与触达执行，不是第二个扩展。',
        '权限不变（tabs / storage / <all_urls>），新增结果回执本地队列。',
        '分发与获客共用同一套页面通信协议与执行状态。',
      ],
    },
    {
      version: '1.2.0',
      date: '2026-10-28',
      notes: [
        '首个平台统一插件版本：多平台内容分发填充与自动发布。',
        '失败保留标签页、结果未知不自动重试。',
      ],
    },
  ],
} as const;

export type ExtensionRelease = typeof EXTENSION_RELEASE;

/** 平台是否真的发布了可下载的插件包。 */
export function extensionPublished(): boolean {
  return EXTENSION_RELEASE.downloadPath.trim() !== '';
}
