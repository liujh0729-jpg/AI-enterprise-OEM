import {
  computePlazaCost,
  matchTier,
  type PlazaPriceRow,
  type PlazaTier,
} from './model-plaza.pricing';

function row(over: Partial<PlazaPriceRow> = {}): PlazaPriceRow {
  return {
    billingUnit: 'token',
    inputRmbPrice: 0,
    outputRmbPrice: 0,
    callRmbPrice: 0,
    cacheReadRmbPrice: 0,
    cacheWriteRmbPrice: 0,
    minimumRmb: 0,
    tiers: [],
    components: [],
    discountRate: 1,
    ...over,
  };
}

const IMAGE_TIERS: PlazaTier[] = [
  { match: { size: '4096x4096' }, unitRmb: 0.6 },
  { match: { quality: '4K' }, unitRmb: 0.6 },
  { match: { quality: '2K' }, unitRmb: 0.4 },
  { match: { quality: '1K' }, unitRmb: 0.3 },
  { match: { size: '1024x1536' }, unitRmb: 0.3 },
];

const VIDEO_TIERS: PlazaTier[] = [
  { match: { video_resolution: '480p' }, unitRmb: 0.09 },
  { match: { video_resolution: '768p' }, unitRmb: 0.12 },
  { match: { video_resolution: '1080p' }, unitRmb: 0.15 },
  { match: { video_resolution: '2k' }, unitRmb: 0.24 },
  { match: { video_resolution: '4k' }, unitRmb: 0.3 },
];

describe('模型广场计价', () => {
  it('token 按输入/输出/缓存读写分别计价，再乘平台折扣', () => {
    const cost = computePlazaCost(
      row({
        inputRmbPrice: 3,
        outputRmbPrice: 9,
        cacheReadRmbPrice: 0.1,
        cacheWriteRmbPrice: 3,
        discountRate: 0.8,
      }),
      10,
      {
        promptTokens: 1_000_000,
        completionTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
      },
    );
    expect(cost.officialRmb).toBe(15.1);
    expect(cost.rmb).toBe(12.08);
    expect(cost.points).toBe(120.8);
  });

  it('图像按尺寸精确命中分档', () => {
    const cost = computePlazaCost(
      row({ billingUnit: 'image', callRmbPrice: 0.2, tiers: IMAGE_TIERS }),
      10,
      { quantity: 1, tier: { size: '4096x4096' } },
    );
    expect(cost.officialRmb).toBe(0.6);
    expect(cost.points).toBe(6);
  });

  it('图像只传 size 时按短边推断 1K/2K/4K', () => {
    expect(matchTier(IMAGE_TIERS, { size: '2048x2048' })).toBe(0.4);
    expect(matchTier(IMAGE_TIERS, { size: '1536x1024' })).toBe(0.3);
  });

  it('视频按分辨率分档，720p 落到最接近且不低的 768p', () => {
    const cost = computePlazaCost(
      row({ billingUnit: 'second', callRmbPrice: 0.09, tiers: VIDEO_TIERS }),
      10,
      { quantity: 5, tier: { resolution: '720p' } },
    );
    expect(cost.officialRmb).toBe(0.6);
  });

  it('视频分辨率大小写不敏感，1080P 命中 1080p 档', () => {
    const cost = computePlazaCost(
      row({ billingUnit: 'second', callRmbPrice: 0.09, tiers: VIDEO_TIERS }),
      10,
      { quantity: 2, tier: { resolution: '1080P' } },
    );
    expect(cost.officialRmb).toBe(0.3);
  });

  it('折扣作用于分档单价', () => {
    const cost = computePlazaCost(
      row({
        billingUnit: 'image',
        callRmbPrice: 0.2,
        tiers: IMAGE_TIERS,
        discountRate: 0.5,
      }),
      10,
      { quantity: 1, tier: { quality: '4K' } },
    );
    expect(cost.officialRmb).toBe(0.6);
    expect(cost.rmb).toBe(0.3);
    expect(cost.points).toBe(3);
  });

  it('按秒计费套用最低收费（ASR 0.01 元）', () => {
    const cost = computePlazaCost(
      row({ billingUnit: 'second', callRmbPrice: 0.01, minimumRmb: 0.01 }),
      10,
      { quantity: 0.4 },
    );
    expect(cost.officialRmb).toBe(0.01);
    expect(cost.points).toBe(0.1);
  });

  it('按次计费缺省数量为 1', () => {
    const cost = computePlazaCost(
      row({ billingUnit: 'call', callRmbPrice: 0.1 }),
      10,
      {},
    );
    expect(cost.officialRmb).toBe(0.1);
    expect(cost.quantity).toBe(1);
  });

  it('图像参考图超出量按附加组件叠加', () => {
    const cost = computePlazaCost(
      row({
        billingUnit: 'image',
        callRmbPrice: 0.1,
        components: [
          {
            code: 'reference_image_excess',
            freeUnits: 0,
            unit: 'image',
            unitRmb: 0.05,
            tiers: [{ match: { quality: '2K' }, unitRmb: 0.1 }],
          },
        ],
      }),
      10,
      { quantity: 1, referenceImages: 2, tier: { quality: '2K' } },
    );
    expect(cost.officialRmb).toBe(0.3);
    expect(cost.points).toBe(3);
  });
});
