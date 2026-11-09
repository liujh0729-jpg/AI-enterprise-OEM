import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';

/**
 * Agent 运行时护栏（测试问题 2.1~2.5 的平台侧补充）：
 * - 行为基线：单轮工具调用次数 / 重复调用 / 输出体量超限即熔断；
 * - 输出兜底：高危指令、凭据泄露、越狱/系统提示泄露、明确违法内容命中即中止本轮；
 * - 网络/文件系统：本站技能包只当文本阅读、不执行包内代码，出站继续由 outbound-guard
 *   与 AccessPolicy 统一拦截；没有进程/容器可挂沙箱，故不在这里伪造 syscall 级限制。
 *
 * 规则只做确定性判断，不依赖模型，避免被技能正文里的提示注入绕过。
 */

export interface RuntimeFinding {
  rule: string;
  detail: string;
  excerpt: string;
}

export const RUNTIME_SAFE_REPLY =
  '本次回复已被平台安全护栏拦截：内容命中高危指令或凭据泄露规则，已中止输出。请调整问题后重试。';

const DANGEROUS_COMMAND =
  /(\brm\s+(?:-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b|\b(?:curl|wget)\b[^\n]{0,160}\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b|\b(?:nc|ncat|netcat|socat)\b[^\n]{0,80}\s(?:-e|exec[:=])|\/dev\/tcp\/|\bbase64\s+(?:-d|--decode)\b[^\n]{0,60}\|\s*(?:ba|z|da)?sh\b|\bmkfs(?:\.|\s)|\bdd\s+if=|\bpowershell(?:\.exe)?\s+(?:-enc|-encodedcommand)\b|:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:)/i;
const EXECUTION_CUE =
  /(运行|执行|在终端|命令行|复制(?:并)?(?:执行|运行)|粘贴(?:到|进)|输入以下|敲(?:入|下)|直接跑)/i;
const NEGATION = /(不要|勿|禁止|切勿|别|不可|不能|严禁)[^。\n]{0,12}$/;

const OUTPUT_SECRET_PATTERNS: Array<{
  rule: string;
  re: RegExp;
  detail: string;
}> = [
  {
    rule: 'output-private-key',
    re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
    detail: '输出包含私钥块',
  },
  {
    rule: 'output-aws-key',
    re: /\bAKIA[0-9A-Z]{16}\b/,
    detail: '输出包含 AWS AccessKeyId',
  },
  {
    rule: 'output-github-token',
    re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
    detail: '输出包含 GitHub Token',
  },
  {
    rule: 'output-slack-token',
    re: /xox[baprs]-[0-9A-Za-z-]{10,}\b/,
    detail: '输出包含 Slack Token',
  },
  {
    rule: 'output-db-password',
    re: /\b(?:mysql|postgresql|postgres|redis|mongodb)(?:\+\w+)?:\/\/[^\s'"]*:[^\s'"]+@[^\s'"]+/i,
    detail: '输出包含带口令的连接串',
  },
  {
    rule: 'output-password-literal',
    re: /\b(?:password|passwd|secret|api_key|apikey|access_key)\s*[:=]\s*["'`][^"'`]{8,}["'`]/i,
    detail: '输出包含明文口令/密钥赋值',
  },
];

const ILLEGAL_CONTENT = [
  {
    rule: 'output-illegal-weapon',
    re: /(?:制作|合成|配制)(?:炸药|炸弹|爆炸物)|(?:枪支|武器)(?:制造|改装|图纸)/,
    detail: '输出包含武器/爆炸物制作指引',
  },
  {
    rule: 'output-illegal-drug',
    re: /(?:制作|合成|提炼)(?:冰毒|毒品|海洛因|可卡因)[^\n]{0,10}(?:步骤|方法|教程|配方)/,
    detail: '输出包含毒品制作指引',
  },
  {
    rule: 'output-illegal-abuse',
    re: /儿童色情|洗钱(?:教程|方法|渠道)|盗刷(?:教程|方法)|银行卡(?:盗刷|洗钱)/,
    detail: '输出包含明确违法内容',
  },
];

const ROLE_OVERRIDE = [
  {
    rule: 'output-role-override',
    re: /(我已|现在已|已经)(?:忽略|绕过|解除)(?:所有|以上|之前的)?(?:规则|限制|指令|约束)/,
    detail: '输出出现越狱/角色覆盖成功标志',
  },
  {
    rule: 'output-system-prompt-leak',
    re: /(?:system prompt|系统提示)(?:的)?(?:内容|原文|如下|是)[:：]/i,
    detail: '输出疑似泄露系统提示',
  },
];

function lineOf(text: string, index: number) {
  const start = text.lastIndexOf('\n', index - 1) + 1;
  const end = text.indexOf('\n', index);
  return text.slice(start, end < 0 ? text.length : end);
}

function clip(value: string, max = 160) {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** 输出兜底审核：只拦高置信内容，避免把正常技术讨论（讲解漏洞原理）全部误杀。 */
export function moderateAgentOutput(text: string): RuntimeFinding[] {
  const findings: RuntimeFinding[] = [];
  const content = String(text || '');
  if (!content.trim()) return findings;

  for (const line of content.split(/\r?\n/)) {
    const command = DANGEROUS_COMMAND.exec(line);
    if (!command) continue;
    const cue = EXECUTION_CUE.exec(line);
    if (!cue) continue;
    const beforeCue = line.slice(0, cue.index);
    if (NEGATION.test(beforeCue)) continue;
    findings.push({
      rule: 'output-dangerous-command',
      detail: '回复诱导用户执行高危命令',
      excerpt: clip(line),
    });
  }

  for (const item of OUTPUT_SECRET_PATTERNS) {
    const match = item.re.exec(content);
    if (!match) continue;
    // 明显占位符不拦（示例文档里常见）
    if (
      /REPLACE_|CHANGE[-_]|change-me|your-|placeholder|example\.com|xxx{3,}|<[^>]+>|\$\{|\bTODO\b/i.test(
        match[0],
      )
    ) {
      continue;
    }
    findings.push({
      rule: item.rule,
      detail: item.detail,
      excerpt: clip(lineOf(content, match.index)),
    });
  }

  for (const item of [...ILLEGAL_CONTENT, ...ROLE_OVERRIDE]) {
    const match = item.re.exec(content);
    if (!match) continue;
    findings.push({
      rule: item.rule,
      detail: item.detail,
      excerpt: clip(lineOf(content, match.index)),
    });
    if (findings.length >= 8) break;
  }

  const seen = new Set<string>();
  return findings.filter((item) => {
    const key = `${item.rule}|${item.excerpt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface RunGuardOptions {
  userId: string;
  audit?: (action: string, detail: string) => Promise<void> | void;
  maxToolCalls?: number;
  maxSameCall?: number;
  maxOutputChars?: number;
}

const DEFAULT_MAX_TOOL_CALLS = 24;
const DEFAULT_MAX_SAME_CALL = 3;
const DEFAULT_MAX_OUTPUT_CHARS = 200_000;

/**
 * 单轮运行护栏：行为基线告警在 80% 阈值时记一次审计，超过 100% 立即熔断。
 * 阈值是平台固化值，技能包正文无权调大（对应 2.1 的「技能代码无权修改」）。
 */
export class AgentRunGuard {
  private toolCalls = 0;
  private outputChars = 0;
  private readonly sameCalls = new Map<string, number>();
  private readonly maxToolCalls: number;
  private readonly maxSameCall: number;
  private readonly maxOutputChars: number;
  private warned = false;

  constructor(private readonly options: RunGuardOptions) {
    this.maxToolCalls = options.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
    this.maxSameCall = options.maxSameCall ?? DEFAULT_MAX_SAME_CALL;
    this.maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
  }

  private async audit(action: string, detail: string) {
    try {
      await this.options.audit?.(action, detail);
    } catch {
      // 审计失败不能反过来阻断或放行主链路
    }
  }

  /** 每次工具执行前调用；超限直接熔断本轮（2.1）。 */
  async beforeTool(name: string, argsJson: string) {
    this.toolCalls += 1;
    const key = `${name}|${String(argsJson || '').slice(0, 500)}`;
    const same = (this.sameCalls.get(key) || 0) + 1;
    this.sameCalls.set(key, same);

    if (!this.warned && this.toolCalls >= Math.ceil(this.maxToolCalls * 0.8)) {
      this.warned = true;
      await this.audit(
        'Agent运行行为告警',
        `本轮工具调用已达 ${this.toolCalls} 次（阈值 ${this.maxToolCalls}）`,
      );
    }
    if (this.toolCalls > this.maxToolCalls) {
      await this.audit(
        'Agent运行熔断',
        `工具调用 ${this.toolCalls} 次超过阈值 ${this.maxToolCalls}`,
      );
      throw new BusinessException(
        ErrorCode.AGENT_SECURITY_BLOCKED,
        `本次运行已被安全护栏中止：工具调用次数超过 ${this.maxToolCalls}（行为基线熔断）`,
      );
    }
    if (same > this.maxSameCall) {
      await this.audit('Agent运行熔断', `重复调用 ${name} 同一参数 ${same} 次`);
      throw new BusinessException(
        ErrorCode.AGENT_SECURITY_BLOCKED,
        `本次运行已被安全护栏中止：重复调用工具「${name}」超过 ${this.maxSameCall} 次`,
      );
    }
  }

  /**
   * 输出累计体量超限也熔断；正常问答远达不到 20 万字符，
   * 主要是防「把整站/整库内容循环吐出来」这类异常行为。
   */
  async inspectOutput(text: string) {
    this.outputChars += String(text || '').length;
    if (this.outputChars <= this.maxOutputChars) return;
    await this.audit(
      'Agent运行熔断',
      `本轮输出累计 ${this.outputChars} 字，超过阈值 ${this.maxOutputChars}`,
    );
    throw new BusinessException(
      ErrorCode.AGENT_SECURITY_BLOCKED,
      '本次运行已被安全护栏中止：输出体量超过单轮上限（行为基线熔断）',
    );
  }

  /** 2.2 / 2.5：输出命中高危内容时中止本轮，并把命中项写审计。 */
  async blockIfUnsafe(text: string) {
    const findings = moderateAgentOutput(text);
    if (!findings.length) return;
    await this.audit(
      'Agent输出安全拦截',
      findings
        .slice(0, 6)
        .map((item) => `${item.rule}:${item.excerpt}`)
        .join(' | ')
        .slice(0, 1200),
    );
    throw new BusinessException(
      ErrorCode.AGENT_SECURITY_BLOCKED,
      `本次运行已被安全护栏中止：${findings[0].detail}`,
    );
  }
}
