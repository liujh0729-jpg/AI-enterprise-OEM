import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';

/**
 * Workbuddy 企业云（腾讯云 WorkBuddy Managed Agents）的口径常量与归一化助手。
 * 产品 / 版本 / 错误码取值对齐 cloud.tencent.com/document/api/1831 一线文档。
 */

/**
 * 资源地域：接口文档写「本接口不需要传递 Region」，但简介的快速入门要求按资源所在地域选
 * （示例里出现过 ap-beijing / ap-nanjing），所以凭据上要存一个，签名后随 X-TC-Region 发出。
 */
export const WB_REGIONS = [
  'ap-guangzhou',
  'ap-shanghai',
  'ap-beijing',
  'ap-nanjing',
  'ap-shenzhen',
  'ap-chengdu',
] as const;

export const WB_REGION_LABELS: Record<string, string> = {
  'ap-guangzhou': '华南地区（广州）',
  'ap-shanghai': '华东地区（上海）',
  'ap-beijing': '华北地区（北京）',
  'ap-nanjing': '华东地区（南京）',
  'ap-shenzhen': '华南地区（深圳）',
  'ap-chengdu': '西南地区（成都）',
};

/** 腾讯云凭据状态：disabled 的账号不参与派发，但历史任务与消息保留。 */
export const ACCOUNT_STATUSES = ['active', 'disabled'] as const;

/**
 * 新建计划的三种分类（计划和它下面的任务都带同一个 kind，列表按它筛选）：
 * ai＝和 AI 沟通分析并确定任务；direct＝直接按字段明确生成任务；scheduled＝定时任务。
 */
export const PLAN_KINDS = ['ai', 'direct', 'scheduled'] as const;

export const PLAN_KIND_LABELS: Record<string, string> = {
  ai: 'AI 沟通确定任务',
  direct: '明确生成任务',
  scheduled: '定时任务',
};

/** 计划状态：draft 起草 → clarifying 对话澄清中 → ready 任务书已定 → running 派发了 → 终态。 */
export const PLAN_STATUSES = [
  'draft',
  'clarifying',
  'ready',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const;

export const PLAN_STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  clarifying: '澄清中',
  ready: '待派发',
  running: '执行中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

/** 任务状态：pending 未派发 → running 会话已建 → 终态。 */
export const TASK_STATUSES = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const;

export const TASK_STATUS_LABELS: Record<string, string> = {
  pending: '待执行',
  running: '执行中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

/** 派发方式：single＝一条任务只交给一个 Workbuddy 账号；fan_out＝同一指令并行铺给多个账号。 */
export const PLAN_STRATEGIES = ['single', 'fan_out'] as const;

export const PLAN_STRATEGY_LABELS: Record<string, string> = {
  single: '单账号执行',
  fan_out: '多账号并行加速',
};

/** 消息事件类型（对齐 DescribeMessageEventList 的 EventType）。 */
export const EVENT_TYPES = ['user', 'tool', 'assistant'] as const;

export const EVENT_TYPE_LABELS: Record<string, string> = {
  user: '我的输入',
  tool: '工具调用',
  assistant: 'Agent 回复',
};

/** 单个版本的 Manifest 上限：文档写「单个版本的 Manifest 大小不超过 256 KiB」。 */
export const MAX_MANIFEST_BYTES = 256 * 1024;

/** 一次派发最多铺几条任务（防界面把整个计划拆成上百段把 20 次/秒的限频打满）。 */
export const MAX_TASKS_PER_PLAN = 50;

export function normalizeChoice(
  value: unknown,
  allowed: readonly string[],
  label: string,
  fallback: string,
) {
  const raw = text(value).trim().toLowerCase();
  if (!raw) return fallback;
  if (!allowed.includes(raw)) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      `${label}只能是：${allowed.join(' / ')}`,
    );
  }
  return raw;
}

export function normalizeRegion(value: unknown) {
  const region = text(value).trim().toLowerCase();
  if (!region) return 'ap-guangzhou';
  if (!(WB_REGIONS as readonly string[]).includes(region)) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      `地域暂不支持：${region}（可选 ${WB_REGIONS.join(' / ')}）`,
    );
  }
  return region;
}

/** JSON 数组列（存 accountIds 之类）→ 正整数数组。 */
export function idList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0);
}

export type PlanStep = { title: string; instruction: string };

export type PlanSpec = {
  goal: string;
  deliverable: string;
  acceptance: string;
  steps: PlanStep[];
};

/**
 * 任务书归一：AI 澄清产出的 JSON 形状不可控，这里只认四个字段，
 * 步骤必须每条都有正文，缺正文的丢掉（不静默补占位文字）。
 */
export function normalizePlanSpec(value: unknown): PlanSpec {
  const source =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const rawSteps = Array.isArray(source.steps) ? source.steps : [];
  const steps: PlanStep[] = rawSteps
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const row = item as Record<string, unknown>;
      return {
        title: text(row.title).trim().slice(0, 200),
        instruction: text(row.instruction).trim().slice(0, 8000),
      };
    })
    .filter((item) => item.instruction)
    .slice(0, MAX_TASKS_PER_PLAN)
    .map((item, index) => ({
      title: item.title || `第 ${index + 1} 步`,
      instruction: item.instruction,
    }));
  return {
    goal: text(source.goal).trim().slice(0, 2000),
    deliverable: text(source.deliverable).trim().slice(0, 2000),
    acceptance: text(source.acceptance).trim().slice(0, 2000),
    steps,
  };
}

/** 任务书是否已经能拿去派发（有目标且有至少一条可执行步骤）。 */
export function specIsReady(spec: PlanSpec) {
  return Boolean(spec.goal) && spec.steps.length > 0;
}

export function shorten(value: string) {
  const cleaned = String(value || '')
    .replace(
      /(?:key|token|secret|password|apikey|api_key)[=:]\s*[^\s,;"'<>]+/gi,
      '[$1]=***',
    )
    .replace(/https?:\/\/[^\s,;"'<>]+/g, '[url]')
    .replace(/\b[A-Za-z0-9_-]{20,}\b/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 300);
}
