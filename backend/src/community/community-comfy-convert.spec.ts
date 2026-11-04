import {
  collectMedia,
  containsCredentialKey,
  looksLikeVideoWorkflow,
  safeSegment,
  suggestSlots,
  titleOfJob,
  titleOfWorkflowFile,
  uiToApi,
} from './community-comfy-convert';

/**
 * 迁移转换器的口径单测：钉住「宁可不跑、也不猜着转」这条底线。
 * 猜错的图提交到 Comfy Cloud 是 422，用户看到的是「这份工作流跑不起来」，
 * 比给一张只能浏览的卡片更糟。
 */

/** 一份最小的 SD1.5 文生图 UI 图（全核心节点，可机械转换）。 */
function sdWorkflow() {
  return {
    nodes: [
      {
        id: 1,
        type: 'CheckpointLoaderSimple',
        widgets_values: ['sd.safetensors'],
        inputs: [],
      },
      {
        id: 2,
        type: 'CLIPTextEncode',
        widgets_values: ['a cat'],
        inputs: [{ name: 'clip', link: 1 }],
      },
      {
        id: 3,
        type: 'EmptyLatentImage',
        widgets_values: [512, 768, 1],
        inputs: [],
      },
      {
        id: 6,
        type: 'KSampler',
        // seed 后面紧跟 control_after_generate，必须被吃掉，否则后面全部错位
        widgets_values: [42, 'randomize', 20, 7, 'euler', 'normal', 1],
        inputs: [
          { name: 'model', link: 2 },
          { name: 'positive', link: 3 },
          { name: 'negative', link: 4 },
          { name: 'latent_image', link: 5 },
        ],
      },
      {
        id: 7,
        type: 'VAEDecode',
        widgets_values: [],
        inputs: [
          { name: 'samples', link: 6 },
          { name: 'vae', link: 7 },
        ],
      },
      {
        id: 8,
        type: 'SaveImage',
        widgets_values: ['ComfyUI'],
        inputs: [{ name: 'images', link: 8 }],
      },
    ],
    links: [
      [1, 1, 1, 2, 0, 'CLIP'],
      [2, 1, 0, 6, 0, 'MODEL'],
      [3, 2, 0, 6, 1, 'CONDITIONING'],
      [4, 2, 0, 6, 2, 'CONDITIONING'],
      [5, 3, 0, 6, 3, 'LATENT'],
      [6, 6, 0, 7, 0, 'LATENT'],
      [7, 1, 2, 7, 1, 'VAE'],
      [8, 7, 0, 8, 0, 'IMAGE'],
    ],
  };
}

describe('uiToApi', () => {
  it('核心节点图能机械转换成 API 格式，seed 的 control 值不占位', () => {
    const result = uiToApi(sdWorkflow());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nodes).toBe(6);
    expect(result.graph['1'].class_type).toBe('CheckpointLoaderSimple');
    expect(result.graph['6'].inputs).toMatchObject({
      seed: 42,
      steps: 20,
      cfg: 7,
      sampler_name: 'euler',
      scheduler: 'normal',
      denoise: 1,
    });
    // 连线变成 ["节点 id", 槽位]
    expect(
      (result.graph['8'].inputs as Record<string, unknown>).images,
    ).toEqual(['7', 0]);
  });

  it('核心表外的节点一律判失败（不猜 widget 顺序）', () => {
    const workflow = sdWorkflow();
    workflow.nodes[1] = {
      id: 2,
      type: 'SomeCustomNode',
      widgets_values: ['x'],
    } as never;
    const result = uiToApi(workflow);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('核心节点表');
  });

  it('含 subgraph 的工作流直接判失败', () => {
    const workflow = sdWorkflow();
    const result = uiToApi({
      ...workflow,
      definitions: { subgraphs: [{ id: 'x' }] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('子图');
  });

  it('被静音的节点不提交；被它喂输入的图整图放弃', () => {
    const workflow = sdWorkflow();
    workflow.nodes[0] = {
      ...workflow.nodes[0],
      mode: 2,
    } as never;
    const result = uiToApi(workflow);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('静音');
  });

  it('widget 数量对不上时判失败，不产出缺字段的图', () => {
    const workflow = sdWorkflow();
    workflow.nodes[0] = {
      id: 1,
      type: 'CheckpointLoaderSimple',
      widgets_values: ['a', 'b'],
    } as never;
    const result = uiToApi(workflow);
    expect(result.ok).toBe(false);
  });
});

describe('suggestSlots', () => {
  it('从 API 图里挑出提示词、种子与采样参数', () => {
    const converted = uiToApi(sdWorkflow());
    if (!converted.ok) throw new Error(converted.reason);
    const slots = suggestSlots(converted.graph);
    expect(slots.map((slot) => slot.key).sort()).toEqual(
      ['cfg', 'denoise', 'height', 'prompt', 'seed', 'steps', 'width'].sort(),
    );
    const seed = slots.find((slot) => slot.key === 'seed');
    expect(seed).toMatchObject({ nodeId: '6', field: 'seed', type: 'seed' });
    const prompt = slots.find((slot) => slot.key === 'prompt');
    expect(prompt).toMatchObject({
      nodeId: '2',
      field: 'text',
      type: 'longtext',
    });
  });
});

describe('collectMedia', () => {
  it('把 ComfyUI outputs 与预览图拉平，封面排最前且去重', () => {
    const outputs = {
      '9': {
        images: [
          { filename: 'a.png', subfolder: '', type: 'output' },
          { filename: 'b.png', subfolder: '', type: 'output' },
        ],
      },
      '11': { text: ['not-media'] },
      '13': { gifs: [{ filename: 'c.webp', subfolder: '', type: 'output' }] },
    };
    const preview = { filename: 'p.png', subfolder: '', type: 'output' };
    const media = collectMedia(outputs, preview);
    expect(media.map((item) => item.filename)).toEqual([
      'p.png',
      'a.png',
      'b.png',
      'c.webp',
    ]);
    expect(media.every((item) => item.kind === 'image')).toBe(true);
  });

  it('视频按扩展名归类，文本输出不进媒体清单', () => {
    const media = collectMedia(
      { '5': { videos: [{ filename: 'clip.mp4', type: 'output' }] } },
      null,
    );
    expect(media).toHaveLength(1);
    expect(media[0]).toMatchObject({ kind: 'video', filename: 'clip.mp4' });
  });
});

describe('标题与文件名', () => {
  it('任务标题优先用产物文件名', () => {
    const title = titleOfJob({
      id: 'abcdef12-3456',
      outputs: {
        '9': { images: [{ filename: 'ComfyUI_00004_.png', subfolder: '' }] },
      },
      previewOutput: null,
      workflow: {
        '1': { class_type: 'SaveImage', _meta: { title: 'Save Image' } },
      },
    });
    expect(title).toBe('ComfyUI_00004_');
  });

  it('没有产物时退回可读的节点标题，再退回 job id', () => {
    expect(
      titleOfJob({
        id: 'abcdef12-3456',
        outputs: null,
        previewOutput: null,
        workflow: { '1': { _meta: { title: '赛博少女' } } },
      }),
    ).toBe('赛博少女');
    expect(
      titleOfJob({
        id: 'abcdef12-3456',
        outputs: null,
        previewOutput: null,
        workflow: { '1': { _meta: { title: 'Save Image' } } },
      }),
    ).toBe('Comfy Cloud 任务 abcdef12');
  });

  it('已保存工作流用文件名去后缀当标题', () => {
    expect(titleOfWorkflowFile('sub/海报生成.json')).toBe('海报生成');
  });
});

describe('安全与命名', () => {
  it('含凭据键的工作流要被认出来', () => {
    expect(
      containsCredentialKey({ nodes: [{ widgets_values: { api_key: 'x' } }] }),
    ).toBe(true);
    expect(containsCredentialKey({ nodes: [{ widgets_values: ['ok'] }] })).toBe(
      false,
    );
  });

  it('视频类节点能识别，用于归到「视频」页签', () => {
    expect(
      looksLikeVideoWorkflow({ '1': { class_type: 'VHS_VideoCombine' } }),
    ).toBe(true);
    expect(looksLikeVideoWorkflow({ '1': { class_type: 'SaveImage' } })).toBe(
      false,
    );
  });

  it('对象键片段保留中文、压掉路径分隔符', () => {
    expect(safeSegment('海报/封面 01.png')).toBe('海报_封面_01.png');
    expect(safeSegment('')).toBe('file');
  });
});
