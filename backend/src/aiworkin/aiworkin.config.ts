export function aiworkinBaseUrl() {
  return (process.env.AIWORKIN_BASE_URL || 'https://api.aiworkin.com').replace(
    /\/$/,
    '',
  );
}
/**
 * AIworkin 联动总开关。关闭时业务侧走本地台账兜底（不发起远端调用）。
 */
export function aiworkinEnabled() {
  return process.env.AIWORKIN_ENABLED !== 'false';
}
export function aiworkinTimeoutMs() {
  return Number(process.env.AIWORKIN_REQUEST_TIMEOUT_MS || 5000);
}
export function aiworkinRetryCount() {
  return Number(process.env.AIWORKIN_RETRY_COUNT || 2);
}
/**
 * 严格模式：AIworkin 写操作失败即整体失败（按需求文档 §7.8 关闭写操作）。
 * 默认关闭，便于本地无 AIworkin 运行时仍可完整走通业务流程。
 */
export function aiworkinStrict() {
  return process.env.AIWORKIN_REQUIRED === 'true';
}
export function javaBaseUrl() {
  return (process.env.JAVA_BASE_URL || 'https://api.aipdd.work').replace(
    /\/$/,
    '',
  );
}
