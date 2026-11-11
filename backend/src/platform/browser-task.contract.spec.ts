import {
  BROWSER_RECEIPT_STATUSES,
  BROWSER_RESULT_STATUSES,
  BROWSER_TASK_ERROR_CODES,
  BROWSER_TASK_PROTOCOL_VERSION,
  aggregateBrowserReceiptStatus,
  browserCapabilityActions,
  browserErrorStopsTask,
  browserReceipt,
  browserReceiptSchema,
  browserResultSucceeded,
  browserTaskSchema,
  isBrowserCapabilityAction,
  validateBrowserActionPayload,
} from '@enterprise/contracts';

/**
 * 统一浏览器任务通信协议（§10.7 / §10.10）：任务只携带「能力 + 动作 + 参数」，
 * 回执统一带状态/结果/证据/错误码/版本；逐条结果严格区分「已填充 / 已提交 / 已核实」。
 */
describe('统一浏览器任务协议契约', () => {
  it('任务信封校验必填项并补默认 payload', () => {
    const parsed = browserTaskSchema.parse({
      protocolVersion: BROWSER_TASK_PROTOCOL_VERSION,
      capability: 'distribution',
      action: 'publish',
      jobId: 'job-1',
    });
    expect(parsed.payload).toEqual({});
    expect(parsed.platforms).toBeUndefined();

    const bad = browserTaskSchema.safeParse({
      protocolVersion: 1,
      capability: 'unknown-capability',
      action: 'publish',
      jobId: 'job-2',
    });
    expect(bad.success).toBe(false);
  });

  it('回执信封拒绝非法状态并补默认字段', () => {
    const receipt = browserReceiptSchema.parse({
      protocolVersion: 1,
      capability: 'acquisition',
      action: 'collect',
      jobId: 'job-3',
      status: 'SUCCESS',
    });
    expect(receipt.results).toEqual([]);
    expect(receipt.evidence).toEqual([]);
    expect(receipt.code).toBe('');
    expect(receipt.pluginVersion).toBe('');

    expect(
      browserReceiptSchema.safeParse({
        protocolVersion: 1,
        capability: 'acquisition',
        action: 'collect',
        jobId: 'job-4',
        status: 'NOT_A_STATUS',
      }).success,
    ).toBe(false);
  });

  it('能力+动作校验只放行已登记组合', () => {
    const actions = browserCapabilityActions('distribution');
    expect(actions.length).toBeGreaterThan(0);
    expect(isBrowserCapabilityAction('distribution', actions[0])).toBe(true);
    expect(isBrowserCapabilityAction('distribution', 'not-registered')).toBe(
      false,
    );
    expect(isBrowserCapabilityAction('nope', actions[0])).toBe(false);
  });

  it('风控类错误码停止任务且不自动重试', () => {
    const stopping = [
      'NEED_LOGIN',
      'CAPTCHA',
      'RISK_CONTROL',
      'UNTRUSTED_SITE',
    ];
    for (const code of stopping) {
      expect(browserErrorStopsTask(code)).toBe(true);
    }
    for (const code of ['TIMEOUT', 'UNKNOWN_RESULT', 'INTERNAL', ''])
      expect(browserErrorStopsTask(code)).toBe(false);
    // 错误码清单与枚举同源，避免各处自行拼字符串
    expect(BROWSER_TASK_ERROR_CODES).toContain('PLATFORM_CHANGED');
    expect(BROWSER_TASK_ERROR_CODES).toContain('TASK_REJECTED');
  });

  it('逐条结果口径严格区分已填充/已提交/已核实', () => {
    expect(BROWSER_RESULT_STATUSES).toEqual([
      'FILLED',
      'SUBMITTED',
      'VERIFIED',
      'FAILED',
      'SKIPPED',
    ]);
    // 仅填充待确认不算成功；已提交与已核实才算
    expect(browserResultSucceeded('FILLED')).toBe(false);
    expect(browserResultSucceeded('SUBMITTED')).toBe(true);
    expect(browserResultSucceeded('VERIFIED')).toBe(true);
  });

  it('信封状态由逐条结果汇总：空/全成功/全失败/混合', () => {
    expect(aggregateBrowserReceiptStatus([])).toBe('ACCEPTED');
    expect(
      aggregateBrowserReceiptStatus([
        { status: 'SUBMITTED' },
        { status: 'VERIFIED' },
      ]),
    ).toBe('SUCCESS');
    expect(
      aggregateBrowserReceiptStatus([
        { status: 'FAILED' },
        { status: 'FAILED' },
      ]),
    ).toBe('FAILED');
    expect(
      aggregateBrowserReceiptStatus([
        { status: 'SUBMITTED' },
        { status: 'FAILED' },
      ]),
    ).toBe('PARTIAL');
    // 只有已填充（未提交）同样按部分完成，避免误报成功
    expect(aggregateBrowserReceiptStatus([{ status: 'FILLED' }])).toBe(
      'PARTIAL',
    );
  });

  it('回执构造器在省略状态时按结果推导，且状态取值合法', () => {
    const derived = browserReceipt({
      capability: 'distribution',
      action: 'publish',
      jobId: 'job-5',
      results: [{ platformCode: 'weibo', status: 'VERIFIED' }],
    });
    expect(derived.status).toBe('SUCCESS');
    expect(derived.protocolVersion).toBe(BROWSER_TASK_PROTOCOL_VERSION);
    expect(BROWSER_RECEIPT_STATUSES).toContain(derived.status);

    const explicit = browserReceipt({
      capability: 'distribution',
      action: 'publish',
      jobId: 'job-6',
      status: 'UNKNOWN',
      code: 'UNKNOWN_RESULT',
    });
    expect(explicit.status).toBe('UNKNOWN');
    expect(explicit.code).toBe('UNKNOWN_RESULT');
  });

  it('能力目录声明动作输入/输出结构，派发前按声明校验入参', () => {
    // 输入结构已登记：页面组包与服务端校验读同一份，不再各自拼字段。
    expect(
      validateBrowserActionPayload('distribution', 'publish', {
        contentId: 12,
        title: '标题',
        content: '正文',
      }),
    ).toBeNull();
    expect(validateBrowserActionPayload('distribution', 'publish', {})).toMatch(
      /缺少必填参数/,
    );
    expect(
      validateBrowserActionPayload('distribution', 'publish', {
        contentId: '12',
        title: '标题',
        content: '正文',
      }),
    ).toMatch(/参数类型不正确/);
    // 未登记动作一律拒绝，插件与服务端同一口径。
    expect(validateBrowserActionPayload('distribution', 'delete-all', {})).toBe(
      '未登记的插件能力动作',
    );
  });

  it('回执信封携带能力回执数据（获客任务终态口径）且默认空对象', () => {
    const receipt = browserReceipt({
      capability: 'acquisition',
      action: 'collect',
      jobId: 'job-acq-1',
      status: 'SUCCESS',
      data: { runId: 9, newLeads: 3 },
    });
    expect(receipt.data).toEqual({ runId: 9, newLeads: 3 });
    expect(
      browserReceiptSchema.parse({
        protocolVersion: 1,
        capability: 'acquisition',
        action: 'collect',
        jobId: 'job-acq-2',
        status: 'SUCCESS',
      }).data,
    ).toEqual({});
  });
});
