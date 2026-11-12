import type { CanvasDoc } from '@enterprise/contracts';
import { BusinessException } from '../common/business.exception';
import { deriveCoverUrl, planNodeRun, readCanvasDoc } from './canvas-plan';

function doc(nodes: CanvasDoc['nodes'], edges: CanvasDoc['edges']): CanvasDoc {
  return { version: 1, nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } };
}

const prompt = (id: string, text: string): CanvasDoc['nodes'][number] => ({
  id,
  type: 'prompt',
  x: 0,
  y: 0,
  width: 240,
  data: { kind: 'prompt', text },
});

const asset = (
  id: string,
  media: 'image' | 'video' | 'audio',
  url: string,
): CanvasDoc['nodes'][number] => ({
  id,
  type: 'asset',
  x: 0,
  y: 0,
  width: 240,
  data: {
    kind: 'asset',
    assetId: 1,
    name: `${media}.bin`,
    media,
    url,
    previewUrl: url,
  },
});

function generate(
  id: string,
  media: 'image' | 'video' | 'music',
  patch: Partial<
    Extract<CanvasDoc['nodes'][number]['data'], { kind: 'generate' }>
  > = {},
): CanvasDoc['nodes'][number] {
  return {
    id,
    type: 'generate',
    x: 0,
    y: 0,
    width: 280,
    data: {
      kind: 'generate',
      media,
      prompt: '',
      channelId: 7,
      channelName: '我的渠道',
      model: 'model-x',
      count: 1,
      refs: [],
      results: [],
      lastRunId: '',
      ...patch,
    },
  };
}

describe('readCanvasDoc', () => {
  it('读不出形状时回落成空文档，不抛错', () => {
    expect(readCanvasDoc(null).nodes).toEqual([]);
    expect(readCanvasDoc({ nodes: 'x', edges: 3 }).edges).toEqual([]);
    expect(readCanvasDoc({}).viewport.zoom).toBe(1);
  });

  it('节点缺字段时补齐默认值（channelId / results / count / 连线角色）', () => {
    const parsed = readCanvasDoc({
      nodes: [
        {
          id: 'g',
          type: 'generate',
          data: { kind: 'generate', media: 'image', model: 'm' },
        },
        { id: 'p', type: 'prompt', data: { kind: 'prompt' } },
        { id: 'bad', type: 'asset', data: { kind: 'prompt', text: 'x' } },
      ],
      edges: [{ from: 'p', to: 'g', role: 'nope' }, { from: 'p' }],
    });
    expect(parsed.nodes.map((node) => node.id)).toEqual(['g', 'p']);
    const generated = parsed.nodes[0].data;
    expect(generated.kind).toBe('generate');
    if (generated.kind === 'generate') {
      expect(generated.channelId).toBe(0);
      expect(generated.count).toBe(1);
      expect(generated.refs).toEqual([]);
      expect(generated.results).toEqual([]);
      expect(generated.lastRunId).toBe('');
    }
    expect(parsed.nodes[1].data).toEqual({ kind: 'prompt', text: '' });
    expect(parsed.edges).toEqual([
      { id: 'p->g', from: 'p', to: 'g', role: 'asset' },
    ]);
  });

  it('素材节点保留负数 assetId（本站 OSS 自建资产就是负数 id）', () => {
    const parsed = readCanvasDoc({
      nodes: [
        {
          id: 'a',
          type: 'asset',
          data: {
            kind: 'asset',
            assetId: -12,
            name: '本地图.png',
            media: 'image',
            url: 'https://oss/x.png',
          },
        },
      ],
      edges: [],
    });
    expect(parsed.nodes[0].data).toMatchObject({ kind: 'asset', assetId: -12 });
  });

  it('生成节点解析提示词 @ 的数字资产：坏数据丢掉、重复记号只留第一条', () => {
    const parsed = readCanvasDoc({
      nodes: [
        {
          id: 'g',
          type: 'generate',
          data: {
            kind: 'generate',
            media: 'image',
            refs: [
              {
                label: '图片1',
                media: 'image',
                assetId: -7,
                name: '人.png',
                url: 'https://oss/a.png',
              },
              {
                label: '图片1',
                media: 'image',
                assetId: -8,
                name: '重复.png',
                url: 'https://oss/b.png',
              },
              {
                label: '图片2',
                media: 'sheet',
                assetId: -9,
                url: 'https://oss/c.png',
              },
              { label: '', media: 'image', url: 'https://oss/d.png' },
            ],
          },
        },
      ],
      edges: [],
    });
    const data = parsed.nodes[0].data;
    expect(data.kind).toBe('generate');
    if (data.kind === 'generate') {
      expect(data.refs).toEqual([
        {
          label: '图片1',
          media: 'image',
          assetId: -7,
          name: '人.png',
          url: 'https://oss/a.png',
        },
      ]);
    }
  });
});

describe('deriveCoverUrl', () => {
  it('最近一次成功产物优先，没有产物才用素材图', () => {
    const withProduct = doc(
      [
        asset('a', 'image', 'https://x/ref.png'),
        generate('g', 'image', {
          results: [
            { jobId: 1, url: 'https://x/old.png', assetId: '', media: 'image' },
            { jobId: 2, url: 'https://x/new.png', assetId: '', media: 'image' },
          ],
        }),
      ],
      [],
    );
    expect(deriveCoverUrl(withProduct)).toBe('https://x/new.png');

    const noProduct = doc([asset('a', 'image', 'https://x/ref.png')], []);
    expect(deriveCoverUrl(noProduct)).toBe('https://x/ref.png');
    expect(deriveCoverUrl(doc([], []))).toBe('');
  });
});

describe('planNodeRun', () => {
  it('生图：无素材走 image，带尺寸与渠道模型', () => {
    const plan = planNodeRun(
      doc(
        [prompt('p', '一只猫'), generate('g', 'image', { size: '1024x1024' })],
        [{ id: 'e', from: 'p', to: 'g', role: 'prompt' }],
      ),
      'g',
    );
    expect(plan.tool).toBe('image');
    expect(plan.input).toMatchObject({ prompt: '一只猫', size: '1024x1024' });
    expect(plan.models).toEqual({ image: { channelId: 7, model: 'model-x' } });
    expect(plan.count).toBe(1);
  });

  it('生图：有参考图走 image-edit，并按 count 批量', () => {
    const plan = planNodeRun(
      doc(
        [
          prompt('p', '换背景'),
          asset('a1', 'image', 'https://x/1.png'),
          asset('a2', 'image', 'https://x/2.png'),
          generate('g', 'image', { count: 4 }),
        ],
        [
          { id: 'e1', from: 'p', to: 'g', role: 'prompt' },
          { id: 'e2', from: 'a1', to: 'g', role: 'asset' },
          { id: 'e3', from: 'a2', to: 'g', role: 'asset' },
        ],
      ),
      'g',
    );
    expect(plan.tool).toBe('image-edit');
    expect(plan.input.imageUrls).toEqual([
      'https://x/1.png',
      'https://x/2.png',
    ]);
    expect(plan.count).toBe(4);
  });

  it('生图张数上限 4、下限 1', () => {
    const base = doc(
      [prompt('p', '猫'), generate('g', 'image')],
      [{ id: 'e', from: 'p', to: 'g', role: 'prompt' }],
    );
    expect(planNodeRun(base, 'g', { count: 9 }).count).toBe(4);
    expect(planNodeRun(base, 'g', { count: 0 }).count).toBe(1);
  });

  it('视频：首尾帧走 video，参考图走 video-ref', () => {
    const frames = planNodeRun(
      doc(
        [
          prompt('p', '走路'),
          asset('f', 'image', 'https://x/first.png'),
          generate('g', 'video', { duration: 5 }),
        ],
        [
          { id: 'e1', from: 'p', to: 'g', role: 'prompt' },
          { id: 'e2', from: 'f', to: 'g', role: 'first-frame' },
        ],
      ),
      'g',
    );
    expect(frames.tool).toBe('video');
    expect(frames.input.firstFrame).toBe('https://x/first.png');

    const refs = planNodeRun(
      doc(
        [
          prompt('p', '走路'),
          asset('r', 'image', 'https://x/ref.png'),
          generate('g', 'video', { duration: 5 }),
        ],
        [
          { id: 'e1', from: 'p', to: 'g', role: 'prompt' },
          { id: 'e2', from: 'r', to: 'g', role: 'asset' },
        ],
      ),
      'g',
    );
    expect(refs.tool).toBe('video-ref');
    expect(refs.input.references).toEqual(['https://x/ref.png']);
  });

  it('视频：未填时长时如实报错（不给默认值）', () => {
    expect(() =>
      planNodeRun(
        doc(
          [prompt('p', '走路'), generate('g', 'video')],
          [{ id: 'e1', from: 'p', to: 'g', role: 'prompt' }],
        ),
        'g',
      ),
    ).toThrow(BusinessException);
  });

  it('视频：只有音频没有底板时如实报错', () => {
    expect(() =>
      planNodeRun(
        doc(
          [
            prompt('p', '对口型'),
            asset('a', 'audio', 'https://x/a.mp3'),
            generate('g', 'video'),
          ],
          [
            { id: 'e1', from: 'p', to: 'g', role: 'prompt' },
            { id: 'e2', from: 'a', to: 'g', role: 'asset' },
          ],
        ),
        'g',
      ),
    ).toThrow(BusinessException);
  });

  it('视频 + 音频 + 底板走 lip-sync', () => {
    const plan = planNodeRun(
      doc(
        [
          asset('v', 'video', 'https://x/v.mp4'),
          asset('a', 'audio', 'https://x/a.mp3'),
          generate('g', 'video'),
        ],
        [
          { id: 'e1', from: 'v', to: 'g', role: 'asset' },
          { id: 'e2', from: 'a', to: 'g', role: 'asset' },
        ],
      ),
      'g',
    );
    expect(plan.tool).toBe('lip-sync');
    expect(plan.input).toMatchObject({
      base: 'https://x/v.mp4',
      audio: 'https://x/a.mp3',
    });
  });

  it('音乐：带歌词与时长', () => {
    const plan = planNodeRun(
      doc(
        [
          prompt('p', '轻快流行'),
          generate('g', 'music', { lyrics: '啦啦啦', duration: 60 }),
        ],
        [{ id: 'e', from: 'p', to: 'g', role: 'prompt' }],
      ),
      'g',
    );
    expect(plan.tool).toBe('music');
    expect(plan.input).toMatchObject({
      prompt: '轻快流行',
      lyrics: '啦啦啦',
      duration: 60,
    });
  });

  it('提示词节点优先于节点内提示词，多条用空行合并', () => {
    const plan = planNodeRun(
      doc(
        [
          prompt('p1', '第一段'),
          prompt('p2', '第二段'),
          generate('g', 'image', { prompt: '节点内提示词' }),
        ],
        [
          { id: 'e1', from: 'p1', to: 'g', role: 'prompt' },
          { id: 'e2', from: 'p2', to: 'g', role: 'prompt' },
        ],
      ),
      'g',
    );
    expect(plan.input.prompt).toBe('第一段\n\n第二段');
  });

  it('面板改写提示词优先于连线', () => {
    const plan = planNodeRun(
      doc(
        [prompt('p', '旧提示词'), generate('g', 'image')],
        [{ id: 'e', from: 'p', to: 'g', role: 'prompt' }],
      ),
      'g',
      { prompt: '新提示词' },
    );
    expect(plan.input.prompt).toBe('新提示词');
  });

  it('配置节点优先于生成节点直选的渠道与模型', () => {
    const plan = planNodeRun(
      doc(
        [
          prompt('p', '猫'),
          {
            id: 'c',
            type: 'config',
            x: 0,
            y: 0,
            width: 240,
            data: {
              kind: 'config',
              channelId: 12,
              channelName: '共享配置',
              model: 'model-y',
            },
          },
          generate('g', 'image'),
        ],
        [
          { id: 'e1', from: 'p', to: 'g', role: 'prompt' },
          { id: 'e2', from: 'c', to: 'g', role: 'config' },
        ],
      ),
      'g',
    );
    expect(plan.models).toEqual({ image: { channelId: 12, model: 'model-y' } });
  });

  it('没选模型时 models 为空，交给「模型设置」的默认槽位', () => {
    const plan = planNodeRun(
      doc(
        [
          prompt('p', '猫'),
          generate('g', 'image', { channelId: 0, model: '' }),
        ],
        [{ id: 'e', from: 'p', to: 'g', role: 'prompt' }],
      ),
      'g',
    );
    expect(plan.models).toEqual({});
  });

  it('面板这一轮选的渠道与模型优先于节点与配置节点里存的', () => {
    const withConfig = doc(
      [
        prompt('p', '猫'),
        {
          id: 'c',
          type: 'config',
          x: 0,
          y: 0,
          width: 220,
          data: {
            kind: 'config',
            channelId: 12,
            channelName: '共享',
            model: 'model-y',
          },
        },
        generate('g', 'image'),
      ],
      [
        { id: 'e1', from: 'p', to: 'g', role: 'prompt' },
        { id: 'e2', from: 'c', to: 'g', role: 'config' },
      ],
    );
    const plan = planNodeRun(withConfig, 'g', {
      channelId: 0,
      model: 'ap-image-2.0',
    });
    expect(plan.models).toEqual({
      image: { channelId: 0, model: 'ap-image-2.0' },
    });
  });

  it('渠道 0（AIPDD）是合法选择；渠道为负才报没选渠道', () => {
    const builtin = planNodeRun(
      doc(
        [
          prompt('p', '猫'),
          generate('g', 'image', { channelId: 0, model: 'ap-image-2.0' }),
        ],
        [{ id: 'e', from: 'p', to: 'g', role: 'prompt' }],
      ),
      'g',
    );
    expect(builtin.models).toEqual({
      image: { channelId: 0, model: 'ap-image-2.0' },
    });
    expect(() =>
      planNodeRun(
        doc(
          [
            prompt('p', '猫'),
            generate('g', 'image', { channelId: -1, model: 'ap-image-2.0' }),
          ],
          [{ id: 'e', from: 'p', to: 'g', role: 'prompt' }],
        ),
        'g',
      ),
    ).toThrow(/还没有选渠道/);
  });

  it('提示词里 @ 的数字资产当参考图，与连线素材同权且按地址去重', () => {
    const plan = planNodeRun(
      doc(
        [
          generate('g', 'image', {
            prompt: '把 @图片1 放到海边',
            refs: [
              {
                label: '图片1',
                media: 'image',
                assetId: -7,
                name: '人.png',
                url: 'https://oss/ref.png',
              },
              {
                label: '图片2',
                media: 'image',
                assetId: -8,
                name: '景.png',
                url: 'https://oss/scene.png',
              },
            ],
          }),
        ],
        [],
      ),
      'g',
    );
    expect(plan.tool).toBe('image-edit');
    expect(plan.input.imageUrls).toEqual([
      'https://oss/ref.png',
      'https://oss/scene.png',
    ]);

    // 连进来的素材与 @ 的是同一份地址时只喂一次
    const dedup = planNodeRun(
      doc(
        [
          asset('a', 'image', 'https://oss/dup.png'),
          generate('g', 'image', {
            prompt: '猫',
            refs: [
              {
                label: '图片1',
                media: 'image',
                assetId: -8,
                name: '同图.png',
                url: 'https://oss/dup.png',
              },
              {
                label: '图片2',
                media: 'image',
                assetId: -9,
                name: '新图.png',
                url: 'https://oss/new.png',
              },
            ],
          }),
        ],
        [{ id: 'e', from: 'a', to: 'g', role: 'asset' }],
      ),
      'g',
    );
    expect(dedup.input.imageUrls).toEqual([
      'https://oss/dup.png',
      'https://oss/new.png',
    ]);
  });

  it('@ 的视频连到生图节点：按素材规则报错，不静默丢素材', () => {
    expect(() =>
      planNodeRun(
        doc(
          [
            generate('g', 'image', {
              prompt: '猫',
              refs: [
                {
                  label: '视频1',
                  media: 'video',
                  assetId: -3,
                  name: 'v.mp4',
                  url: 'https://oss/v.mp4',
                },
              ],
            }),
          ],
          [],
        ),
        'g',
      ),
    ).toThrow(/生图只接收图片素材/);
  });

  it('缺提示词 / 节点不是生成节点 / 节点不存在都抛业务错误', () => {
    expect(() => planNodeRun(doc([generate('g', 'image')], []), 'g')).toThrow(
      BusinessException,
    );
    expect(() => planNodeRun(doc([prompt('p', '猫')], []), 'p')).toThrow(
      BusinessException,
    );
    expect(() => planNodeRun(doc([], []), 'nope')).toThrow(BusinessException);
  });
});
