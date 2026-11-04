/**
 * 敏感字段名表（整键匹配）：Comfy Cloud 的密文列 `keyCipher` 与 `comfyApiKey` 也在内——
 * 密文进日志同样是泄漏面（密钥轮换后旧日志就能被解开来）。
 */
const credentialField =
  /^(authorization|cookie|set-cookie|password|passwd|api[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|database_url|credential|key[-_]?cipher|comfy[-_]?api[-_]?key)$/i;
function redactText(value: string) {
  return value
    .replace(/\bBearer\s+[^\s"<>]+/gi, 'Bearer [redacted]')
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"<>]+/gi, '[database]')
    .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/gi, '$1[redacted]@')
    .replace(
      /((?:api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret)=)[^&\s"<>]+/gi,
      '$1[redacted]',
    );
}
export function redactLog(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]';
  if (typeof value === 'string') return redactText(value);
  if (value instanceof Error)
    return { name: value.name, message: redactText(value.message) };
  if (Array.isArray(value))
    return value.slice(0, 100).map((item) => redactLog(item, depth + 1));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        credentialField.test(key) ? '[redacted]' : redactLog(item, depth + 1),
      ]),
    );
  return value;
}
/** Structured metadata only; never pass raw upstream bodies. Redaction is defense in depth. */
export class Logger {
  constructor(private readonly context: string) {}
  log(message: unknown) {
    console.info(
      JSON.stringify({
        level: 'info',
        context: this.context,
        message: redactLog(message),
        at: new Date().toISOString(),
      }),
    );
  }
  warn(message: unknown) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        context: this.context,
        message: redactLog(message),
        at: new Date().toISOString(),
      }),
    );
  }
  error(message: unknown, _stack?: unknown) {
    void _stack;
    console.error(
      JSON.stringify({
        level: 'error',
        context: this.context,
        message: redactLog(message),
        at: new Date().toISOString(),
      }),
    );
  }
  debug(message: unknown) {
    if (process.env.LOG_LEVEL === 'debug') this.log(message);
  }
}
