import {
  ResponsesSseTranslator,
  toChatPayload,
  toResponseObject,
} from './model-plaza.responses';

/** 把 `event: x\ndata: {...}` 流式文本还原成 [事件名, 数据] 序列，便于断言。 */
function parseEvents(
  text: string,
): { event: string; data: Record<string, unknown> }[] {
  const out: { event: string; data: Record<string, unknown> }[] = [];
  let event = '';
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
      continue;
    }
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    out.push({ event, data: JSON.parse(data) as Record<string, unknown> });
    event = '';
  }
  return out;
}

function chunkOf(payload: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

describe('Responses 协议适配层', () => {
  it('把 input 摊平成 messages，并保留对话参数', () => {
    const chat = toChatPayload({
      model: 'deepseek-v3',
      instructions: '你是一个助手',
      input: [
        { role: 'user', content: [{ type: 'input_text', text: '你好' }] },
        {
          role: 'assistant',
          content: [{ type: 'output_text', text: '你好呀' }],
        },
        { role: 'user', content: '今天天气如何' },
      ],
      temperature: 0.3,
      max_output_tokens: 512,
      store: false,
      reasoning: { effort: 'medium' },
    });
    expect(chat.model).toBe('deepseek-v3');
    expect(chat.messages).toEqual([
      { role: 'system', content: '你是一个助手' },
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好呀' },
      { role: 'user', content: '今天天气如何' },
    ]);
    expect(chat.temperature).toBe(0.3);
    expect(chat.max_tokens).toBe(512);
    // Responses 独有的字段不能带给上游，严格校验的通道会直接报错
    expect(chat.store).toBeUndefined();
    expect(chat.reasoning).toBeUndefined();
    expect(chat.instructions).toBeUndefined();
  });

  it('还原工具往返：function_call 进 tool_calls，output 回 role=tool', () => {
    const chat = toChatPayload({
      model: 'gpt-5',
      input: [
        {
          type: 'function_call',
          name: 'shell',
          arguments: '{"cmd":"ls"}',
          call_id: 'call_1',
        },
        { type: 'function_call_output', call_id: 'call_1', output: 'ok' },
        { role: 'user', content: '继续' },
      ],
      tools: [
        { type: 'function', name: 'shell', parameters: { type: 'object' } },
      ],
      tool_choice: 'auto',
    });
    const messages = chat.messages as Record<string, unknown>[];
    expect(messages[0]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'shell', arguments: '{"cmd":"ls"}' },
        },
      ],
    });
    expect(messages[1]).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      content: 'ok',
    });
    expect(messages[2]).toEqual({ role: 'user', content: '继续' });
    expect(chat.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'shell',
          description: '',
          parameters: { type: 'object' },
        },
      },
    ]);
    expect(chat.tool_choice).toBe('auto');
  });

  it('非流式：chat 响应包成 Responses 外壳，usage 字段换名', () => {
    const response = toResponseObject(
      {
        choices: [
          {
            message: { role: 'assistant', content: '答案是 42' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 11, completion_tokens: 7 },
      },
      { model: 'deepseek-v3', id: 'resp_1' },
    );
    expect(response.object).toBe('response');
    expect(response.status).toBe('completed');
    expect(response.output_text).toBe('答案是 42');
    expect((response.output as Record<string, unknown>[])[0]).toMatchObject({
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: '答案是 42', annotations: [] }],
    });
    expect(response.usage).toMatchObject({
      input_tokens: 11,
      output_tokens: 7,
      total_tokens: 18,
    });
  });

  it('截断的响应标记为 incomplete', () => {
    const response = toResponseObject(
      { choices: [{ message: { content: '半句' }, finish_reason: 'length' }] },
      { model: 'm' },
    );
    expect(response.status).toBe('incomplete');
    expect(response.incomplete_details).toEqual({
      reason: 'max_output_tokens',
    });
  });

  it('流式：chat 增量改写成 response.* 事件，[DONE] 前补 completed', () => {
    const translator = new ResponsesSseTranslator('deepseek-v3', 'resp_9');
    const head = parseEvents(translator.start());
    expect(head[0]?.event).toBe('response.created');

    const body = parseEvents(
      translator.feed(chunkOf({ choices: [{ delta: { content: '你好' } }] })) +
        translator.feed(
          chunkOf({ choices: [{ delta: { content: '，世界' } }] }),
        ),
    );
    const deltas = body.filter(
      (item) => item.event === 'response.output_text.delta',
    );
    expect(deltas.map((item) => item.data.delta)).toEqual(['你好', '，世界']);
    expect(body.map((item) => item.event)).toEqual([
      'response.output_item.added',
      'response.content_part.added',
      'response.output_text.delta',
      'response.output_text.delta',
    ]);

    const tail = parseEvents(
      translator.feed(
        chunkOf({
          choices: [],
          usage: { prompt_tokens: 9, completion_tokens: 4 },
        }),
      ) + translator.end({ usage: { prompt_tokens: 9, completion_tokens: 4 } }),
    );
    const done = tail.find((item) => item.event === 'response.completed');
    expect(done?.event).toBe('response.completed');
    expect(done?.data.response).toMatchObject({
      id: 'resp_9',
      status: 'completed',
      usage: { input_tokens: 9, output_tokens: 4, total_tokens: 13 },
    });
    expect((done?.data.response as Record<string, unknown>).output).toEqual([
      {
        id: expect.any(String),
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: '你好，世界', annotations: [] }],
      },
    ]);
  });

  it('流式工具调用：参数增量拼回 arguments 并闭合条目', () => {
    const translator = new ResponsesSseTranslator('gpt-5', 'resp_8');
    translator.start();
    const out = parseEvents(
      translator.feed(
        chunkOf({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_2',
                    function: { name: 'shell', arguments: '{"cm' },
                  },
                ],
              },
            },
          ],
        }),
      ) +
        translator.feed(
          chunkOf({
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, function: { arguments: 'd":"ls"}' } },
                  ],
                },
              },
            ],
          }),
        ) +
        translator.end({ usage: { prompt_tokens: 3, completion_tokens: 2 } }),
    );
    const argsDone = out.find(
      (item) => item.event === 'response.function_call_arguments.done',
    );
    expect(argsDone?.data).toMatchObject({
      item_id: 'call_2',
      arguments: '{"cmd":"ls"}',
    });
    const completed = out.find((item) => item.event === 'response.completed');
    expect(
      (completed?.data.response as Record<string, unknown>).output,
    ).toEqual([
      {
        id: 'call_2',
        type: 'function_call',
        call_id: 'call_2',
        name: 'shell',
        arguments: '{"cmd":"ls"}',
        status: 'completed',
      },
    ]);
  });

  it('无事件的上游分片也要回心跳，否则 Node 不再 pump 导致流卡死', () => {
    const translator = new ResponsesSseTranslator('m', 'resp_5');
    const heartbeat = translator.feed(
      chunkOf({ choices: [{ delta: { reasoning_content: '思考中' } }] }),
    );
    expect(heartbeat).toBe(': ping\n\n');
    expect(parseEvents(heartbeat)).toEqual([]);
    // 半行（还没收到换行）同样只出心跳，缓冲区留给下一帧
    const partial = translator.feed(
      new TextEncoder().encode('data: {"choices"'),
    );
    expect(partial).toBe(': ping\n\n');
  });

  it('忽略注释与空行等非 data 帧，不卡住解析', () => {
    const translator = new ResponsesSseTranslator('m', 'resp_6');
    translator.start();
    const raw =
      ': openai-stream\n' +
      '\n' +
      'event: response\n' +
      'data: {"choices":[{"delta":{"content":"好"}}]}\n' +
      '\n\n';
    const out = parseEvents(translator.feed(new TextEncoder().encode(raw)));
    const deltas = out.filter(
      (item) => item.event === 'response.output_text.delta',
    );
    expect(deltas).toHaveLength(1);
    expect(deltas[0]?.data.delta).toBe('好');
  });

  it('上游失败时发 response.failed，且重复收尾只出一次', () => {
    const translator = new ResponsesSseTranslator('m', 'resp_7');
    translator.start();
    const failed = parseEvents(translator.end({ failed: '上游返回 HTTP 500' }));
    expect(failed[0]?.event).toBe('response.failed');
    expect(failed[0]?.data.response).toMatchObject({
      status: 'failed',
      error: { message: '上游返回 HTTP 500' },
    });
    expect(translator.end({})).toBe('');
  });
});
