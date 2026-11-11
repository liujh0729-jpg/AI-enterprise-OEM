import { resolve } from 'node:path';
import { installDir, updateDir } from '../upgrade/upgrade.config';

/**
 * AI 编程（后台自助改码）配置：全部来自环境变量，默认值与设计方案 §十二 对齐，
 * 只有「总开关」和「在线应用」按可用性优先改成默认开启，可显式置 false 收窄。
 */

function flag(value: string | undefined, fallback: boolean) {
  const text = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!text) return fallback;
  return text === '1' || text === 'true' || text === 'yes' || text === 'on';
}

function positive(value: string | undefined, fallback: number) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : fallback;
}

/** 总开关：默认开；显式 AI_CODE_ENABLED=false 时页面只读并提示。 */
export function aiCodeEnabled() {
  return flag(process.env.AI_CODE_ENABLED, true);
}

/** 是否允许「备份并执行」在线应用；关闭后只能导出补丁包。 */
export function aiCodeAllowApply() {
  return flag(process.env.AI_CODE_ALLOW_APPLY, true);
}

/** 解锁票据有效期（分钟）。 */
export function aiCodeUnlockTtlMs() {
  return positive(process.env.AI_CODE_UNLOCK_TTL_MIN, 15) * 60_000;
}

/** 单会话累计变更文件数上限。 */
export function aiCodeMaxFiles() {
  return positive(process.env.AI_CODE_MAX_FILES, 200);
}

/** 单文件读 / 写上限（字节）。 */
export function aiCodeMaxFileBytes() {
  return positive(process.env.AI_CODE_MAX_FILE_BYTES, 1_048_576);
}

/** 单轮对话历史条数上限，避免把整段会话反复塞给模型。 */
export function aiCodeHistoryLimit() {
  return positive(process.env.AI_CODE_HISTORY_LIMIT, 24);
}

export function aiCodeWorkspaceRoot() {
  return installDir();
}

/** 每个会话一份暂存目录：update/ai-code/<sessionId>/。 */
export function aiCodeRoot() {
  return resolve(updateDir(), 'ai-code');
}

export function aiCodeSessionDir(sessionId: number) {
  return resolve(aiCodeRoot(), String(sessionId));
}

export function aiCodeExportsDir() {
  return resolve(aiCodeRoot(), 'exports');
}
