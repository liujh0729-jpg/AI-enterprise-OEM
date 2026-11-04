import {
  COMMUNITY_JSON_LIMIT,
  COMMUNITY_NODE_LIMIT,
  COMMUNITY_SLOT_LIMIT,
  assetReference,
  buildRunGraph,
  detectFormat,
  newUserWorkflowCode,
  validatePublishedGraph,
  validateSlots,
  type CommunityRegistrySlot,
} from './community-workflow-registry';
import { BusinessException } from '../common/business.exception';
import { ErrorCode, type ErrorCodeValue } from '../common/error-code';

/**
 * 社区工作流登记的校验口径单测。
 *
 * 这些分支是整个板块的安全底座：进来的 JSON 会被别人拿去用户的 Comfy Cloud 账号执行，
 * 所以「UI 格式拒、危险节点拒、未知节点拒、凭据字段拒、运行期只覆盖已声明槽位」
 * 一条都不能退化。改文案可以，改判定必须先看这里。
 */

const NODE_NAMES = new Set([
  'CheckpointLoaderSimple',
  'CLIPTextEncode',
  'KSampler',
  'LoadImage',
  'SaveImage',
  'VAEDecode',
]);

/** 节点体里的 inputs 在校验层是 unknown（不该由单测替它收窄），断言时按节点取值。 */
function inputsOf(
  graph: Record<string, Record<string, unknown>>,
  nodeId: string,
): Record<string, unknown> {
  const node = graph[nodeId];
  return (node ? node.inputs : {}) as Record<string, unknown>;
}

function apiGraph(): Record<string, Record<string, unknown>> {
  return {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: 'sd_xl.safetensors' },
    },
    '2': {
      class_type: 'CLIPTextEncode',
      inputs: { text: 'hello', clip: ['1', 1] },
    },
    '5': {
      class_type: 'KSampler',
      inputs: {
        seed: 0,
        steps: 20,
        cfg: 7,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['2', 0],
        latent_image: ['2', 0],
      },
    },
  };
}

function slot(
  overrides: Partial<CommunityRegistrySlot>,
): CommunityRegistrySlot {
  return {
    key: 'prompt',
    label: '提示词',
    type: 'text',
    nodeId: '2',
    field: 'text',
    ...overrides,
  };
}

/** 校验函数有同步抛的（validateSlots/validatePublishedGraph）也有异步抛的，统一按「取错文案」处理。 */
async function messageOf(run: () => unknown): Promise<string> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(BusinessException);
    return (error as Error).message;
  }
  return '没有按预期抛错';
}

function errorCodeOf(run: () => unknown): Promise<ErrorCodeValue | null> {
  return (async () => {
    try {
      await run();
    } catch (error) {
      return (error as BusinessException).errorCode;
    }
    return null;
  })();
}

describe('detectFormat', () => {
  it('认出 API 格式、UI/save 格式与非法输入', () => {
    expect(detectFormat(apiGraph())).toBe('api');
    expect(detectFormat({ nodes: [], links: [] })).toBe('ui');
    expect(
      detectFormat({ '1': { class_type: 'KSampler' }, last_node_id: 9 }),
    ).toBe('ui');
    expect(detectFormat(null)).toBe('invalid');
    expect(detectFormat([])).toBe('invalid');
    expect(detectFormat({})).toBe('invalid');
    expect(detectFormat('{"1":1}')).toBe('invalid');
  });
});

describe('validatePublishedGraph', () => {
  it('UI 格式给的是「怎么导出」，不是笼统的格式错误', async () => {
    const message = await messageOf(() =>
      validatePublishedGraph({ nodes: [{}], links: [] }, NODE_NAMES),
    );
    expect(message).toContain('Export (API)');
  });

  it('节点键必须是数字，节点体必须有 class_type', async () => {
    expect(
      await messageOf(() =>
        validatePublishedGraph(
          { prompt: { class_type: 'KSampler' } },
          NODE_NAMES,
        ),
      ),
    ).toContain('必须是数字');
    expect(
      await messageOf(() =>
        validatePublishedGraph({ '1': { inputs: {} } }, NODE_NAMES),
      ),
    ).toContain('class_type');
  });

  it('命中名字表或语义片段都拦：命令执行、任意路径读取、任意 HTTP', async () => {
    for (const classType of [
      'SubprocessNode',
      'ShellCommand',
      'VHS_LoadVideoPath',
      'My_Exec_Node',
      'AwesomeArbitraryPathLoader',
    ]) {
      const graph = { '1': { class_type: classType, inputs: {} } };
      expect(
        await messageOf(() => validatePublishedGraph(graph, NODE_NAMES)),
      ).toContain('社区不允许收录');
    }
  });

  it('未知节点汇总成一条中文提示，并给出下一步', async () => {
    const graph = {
      '1': { class_type: 'FooBar', inputs: {} },
      '2': { class_type: 'BazQux', inputs: {} },
    };
    expect(
      await messageOf(() => validatePublishedGraph(graph, NODE_NAMES)),
    ).toContain('这些节点在你的 Comfy Cloud 账号里不存在');
  });

  it('partner 前缀只按运营显式配置放行，默认一条都不放', async () => {
    const graph = { '1': { class_type: 'ComfyCloud_PartnerNode', inputs: {} } };
    expect(
      await messageOf(() => validatePublishedGraph(graph, NODE_NAMES)),
    ).toContain('不存在');
    process.env.COMMUNITY_NODE_PREFIX_ALLOWLIST = 'ComfyCloud_';
    try {
      expect(validatePublishedGraph(graph, NODE_NAMES)).toEqual({
        format: 'api',
        nodes: 1,
      });
    } finally {
      delete process.env.COMMUNITY_NODE_PREFIX_ALLOWLIST;
    }
  });

  it('节点顶层与 inputs 深处都不许出现凭据字段', async () => {
    const top = {
      '1': { class_type: 'KSampler', inputs: {}, api_key: 'sk-x' },
    };
    expect(
      await messageOf(() => validatePublishedGraph(top, NODE_NAMES)),
    ).toContain('疑似凭据字段');
    const nested = {
      '1': { class_type: 'KSampler', inputs: { Authorization: 'Bearer x' } },
    };
    expect(
      await messageOf(() => validatePublishedGraph(nested, NODE_NAMES)),
    ).toContain('疑似凭据字段');
  });

  it('提示词里出现 api_key 这类词不误伤（只按「键」判定）', () => {
    const graph = {
      '1': {
        class_type: 'CLIPTextEncode',
        inputs: { text: 'do not paste your api_key here' },
      },
    };
    expect(validatePublishedGraph(graph, NODE_NAMES).format).toBe('api');
  });

  it('节点数与序列化体积封顶：超体积走独立错误码', async () => {
    const many: Record<string, Record<string, unknown>> = {};
    for (let index = 1; index <= COMMUNITY_NODE_LIMIT + 1; index += 1) {
      many[String(index)] = { class_type: 'SaveImage', inputs: {} };
    }
    expect(
      await messageOf(() => validatePublishedGraph(many, NODE_NAMES)),
    ).toContain('社区上限');
    const fat = {
      '1': {
        class_type: 'SaveImage',
        inputs: { blob: 'x'.repeat(COMMUNITY_JSON_LIMIT + 10) },
      },
    };
    const message = await messageOf(() =>
      validatePublishedGraph(fat, NODE_NAMES),
    );
    expect(message).toContain('2MB');
    // 前端要能把「太大」和「格式不对」分开提示，所以这里必须是独立错误码
    expect(
      await errorCodeOf(() => validatePublishedGraph(fat, NODE_NAMES)),
    ).toBe(ErrorCode.PAYLOAD_TOO_LARGE);
  });
});

describe('validateSlots', () => {
  const graph = apiGraph();

  it('槽位标识、数量与重复项都收口', async () => {
    expect(
      await messageOf(() =>
        validateSlots(graph, [slot({ key: 'bad key!' })], NODE_NAMES),
      ),
    ).toContain('不合法');
    expect(
      await messageOf(() =>
        validateSlots(graph, [slot({}), slot({})], NODE_NAMES),
      ),
    ).toContain('重复');
    const tooMany = Array.from(
      { length: COMMUNITY_SLOT_LIMIT + 1 },
      (_unused, index) => slot({ key: `p${index}` }),
    );
    expect(
      await messageOf(() => validateSlots(graph, tooMany, NODE_NAMES)),
    ).toContain('最多');
  });

  it('槽位必须指向存在的节点、在册的类、以及该节点已有的输入', async () => {
    expect(
      await messageOf(() =>
        validateSlots(graph, [slot({ nodeId: '99' })], NODE_NAMES),
      ),
    ).toContain('不存在');
    expect(
      await messageOf(() =>
        validateSlots(graph, [slot({ field: 'nope' })], NODE_NAMES),
      ),
    ).toContain('在节点 2 上不存在');
    expect(
      await messageOf(() =>
        validateSlots(
          graph,
          [slot({ nodeId: '1', field: 'ckpt_name' })],
          new Set(['CLIPTextEncode']),
        ),
      ),
    ).toContain('不在册');
    expect(
      await messageOf(() =>
        validateSlots(
          { '7': { class_type: 'ShellCommand', inputs: { cmd: '' } } },
          [slot({ nodeId: '7', field: 'cmd' })],
          // 类名先过「在册」这一关，才能走到危险判定
          new Set(['ShellCommand']),
        ),
      ),
    ).toContain('危险节点');
  });

  it('类型白名单，下拉必须带候选值', async () => {
    expect(
      await messageOf(() =>
        validateSlots(graph, [slot({ type: 'node' as never })], NODE_NAMES),
      ),
    ).toContain('类型不支持');
    expect(
      await messageOf(() =>
        validateSlots(graph, [slot({ type: 'enum' })], NODE_NAMES),
      ),
    ).toContain('没有候选值');
    expect(
      validateSlots(
        graph,
        [slot({ type: 'seed', nodeId: '5', field: 'seed' })],
        NODE_NAMES,
      ),
    ).toBeUndefined();
  });
});

describe('buildRunGraph：运行期封闭覆盖', () => {
  it('未声明的参数一律拒，防止任何人改写整张图', async () => {
    const slots = [slot({ key: 'prompt' })];
    expect(
      await messageOf(() =>
        buildRunGraph(
          apiGraph(),
          slots,
          { prompt: 'a', '3': { class_type: 'x' } },
          async () => 'a',
        ),
      ),
    ).toContain('允许修改的范围');
  });

  it('必填项缺失即拒，非必填留空则保留工作流原值', async () => {
    const slots = [slot({ required: true })];
    expect(
      await messageOf(() =>
        buildRunGraph(apiGraph(), slots, {}, async () => 'a'),
      ),
    ).toContain('请填写');
    // 纯空格过了「有没有填」这一关，仍要在 coerce 里被非空校验拦下
    expect(
      await messageOf(() =>
        buildRunGraph(apiGraph(), slots, { prompt: '   ' }, async () => 'a'),
      ),
    ).toContain('不能为空');
    const optional = await buildRunGraph(
      apiGraph(),
      [slot({ required: false })],
      {},
      async () => 'a',
    );
    expect(inputsOf(optional, '2').text).toBe('hello');
  });

  it('数值/种子/下拉按槽位声明收敛，越界即拒', async () => {
    const slots = [
      slot({
        key: 'steps',
        label: '步数',
        type: 'int',
        nodeId: '5',
        field: 'steps',
        min: 1,
        max: 60,
      }),
      slot({
        key: 'seed',
        label: '种子',
        type: 'seed',
        nodeId: '5',
        field: 'seed',
      }),
      slot({
        key: 'sampler',
        label: '采样器',
        type: 'enum',
        nodeId: '5',
        field: 'sampler_name',
        options: ['euler', 'dpmpp_2m'],
      }),
    ];
    const built = await buildRunGraph(
      apiGraph(),
      slots,
      { steps: '25', seed: '12345', sampler: 'dpmpp_2m' },
      async () => 'asset-1',
    );
    expect(inputsOf(built, '5').steps).toBe(25);
    expect(inputsOf(built, '5').seed).toBe(12345);
    expect(inputsOf(built, '5').sampler_name).toBe('dpmpp_2m');

    expect(
      await messageOf(() =>
        buildRunGraph(apiGraph(), slots, { steps: '25.5' }, async () => 'a'),
      ),
    ).toContain('整数');
    expect(
      await messageOf(() =>
        buildRunGraph(apiGraph(), slots, { steps: '999' }, async () => 'a'),
      ),
    ).toContain('不能大于 60');
    expect(
      await messageOf(() =>
        buildRunGraph(apiGraph(), slots, { seed: '-1' }, async () => 'a'),
      ),
    ).toContain('不能是负数');
    expect(
      await messageOf(() =>
        buildRunGraph(apiGraph(), slots, { sampler: 'other' }, async () => 'a'),
      ),
    ).toContain('只能从给定选项里选');
  });

  it('图片槽位换成 core/ASSET 引用，且不改原图', async () => {
    const graph = {
      '9': { class_type: 'LoadImage', inputs: { image: 'example.png' } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: 'hello' } },
    };
    const slots = [
      slot({
        key: 'src',
        label: '输入图',
        type: 'image',
        nodeId: '9',
        field: 'image',
      }),
    ];
    const resolveImage = jest.fn().mockResolvedValue('asset-uuid-1');
    const built = await buildRunGraph(
      graph,
      slots,
      { src: 'https://oss.example/a.png' },
      resolveImage,
    );
    expect(inputsOf(built, '9').image).toEqual(assetReference('asset-uuid-1'));
    expect(resolveImage).toHaveBeenCalledWith('https://oss.example/a.png');
    // 提交图是克隆出来的：库里那份不能被这次运行改掉
    expect(graph['9'].inputs.image).toBe('example.png');
  });

  it('用户发布的工作流 code 前缀固定、长度固定，且不与官方 slug 相撞', () => {
    const codes = new Set(
      Array.from({ length: 200 }, () => newUserWorkflowCode()),
    );
    expect(codes.size).toBe(200);
    for (const code of codes) expect(code).toMatch(/^wf_[0-9a-f]{8}$/);
  });
});
