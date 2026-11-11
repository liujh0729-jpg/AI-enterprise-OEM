import {
  cardMultiplierOf,
  cardUnitLabel,
  cardUnitsNeeded,
  formatQuota,
  isCardBillingUnit,
  multiplierNote,
} from './card.pricing';

/**
 * 时长卡计量的口径测试：D5=A（token 卡量＝入＋出，缓存不计）、
 * D7=A（视频按秒×规格倍率，未配档或未命中一律回落 1 倍，命中来源要能在明细里说清）、
 * 以及「1 张恒扣 1 额度」和额度/倍率的中文读法。
 * 纯函数无 IO，与卡片服务、模型广场共用同一份实现。
 */

describe('cardUnitsNeeded：token 卡（D5=A）', () => {
  it('卡量只算输入＋输出 tokens，倍率恒为基准', () => {
    const need = cardUnitsNeeded({
      billingUnit: 'token',
      promptTokens: 1000,
      completionTokens: 500,
      specMultipliers: [
        { match: { video_resolution: '1080p' }, multiplier: 3 },
      ],
      tier: { video_resolution: '1080p' },
    });
    expect(need).toEqual({
      billingUnit: 'token',
      units: 1500,
      multiplier: 1,
      hit: 'BASE',
    });
  });

  it('缺失与负数用量按 0 处理，不会扣成负额度', () => {
    expect(
      cardUnitsNeeded({
        billingUnit: 'token',
        promptTokens: -50,
        completionTokens: undefined,
      }).units,
    ).toBe(0);
  });
});

describe('cardUnitsNeeded：image 卡', () => {
  it('1 张恒扣 1 额度，分辨率与倍率表都不参与', () => {
    const need = cardUnitsNeeded({
      billingUnit: 'image',
      quantity: 3,
      tier: { size: '4096x4096' },
      specMultipliers: [{ match: { size: '4096x4096' }, multiplier: 4 }],
    });
    expect(need.units).toBe(3);
    expect(need.hit).toBe('BASE');
  });

  it('张数缺失或非法时按 1 张起扣', () => {
    expect(cardUnitsNeeded({ billingUnit: 'image' }).units).toBe(1);
    expect(cardUnitsNeeded({ billingUnit: 'image', quantity: 0 }).units).toBe(
      1,
    );
  });
});

describe('cardUnitsNeeded：second 卡与规格倍率（D7=A）', () => {
  const specs = [
    { match: { video_resolution: '720p' }, multiplier: 2 },
    { match: { video_resolution: '2k' }, multiplier: 4 },
  ];

  it('精确命中档位时秒数×倍率，并标注精确档位', () => {
    expect(
      cardUnitsNeeded({
        billingUnit: 'second',
        quantity: 5,
        tier: { video_resolution: '720P' },
        specMultipliers: specs,
      }),
    ).toEqual({
      billingUnit: 'second',
      units: 10,
      multiplier: 2,
      hit: 'EXACT',
    });
  });

  it('未配档位时一律按 1 倍，绝不猜更高档', () => {
    expect(cardMultiplierOf([], { video_resolution: '1080p' })).toEqual({
      multiplier: 1,
      hit: 'BASE',
    });
    expect(cardMultiplierOf(specs, { video_resolution: '4k' })).toEqual({
      multiplier: 1,
      hit: 'BASE',
    });
  });

  it('没有等档时取「不低于请求值的最接近档位」，命中来源记为就近档位', () => {
    const need = cardUnitsNeeded({
      billingUnit: 'second',
      quantity: 6,
      tier: { video_resolution: '1080p' },
      specMultipliers: specs,
    });
    expect(need).toEqual({
      billingUnit: 'second',
      units: 24,
      multiplier: 4,
      hit: 'NEAREST',
    });
  });

  it('resolution 与 video_resolution 互为别名，倍率表用哪个键都能命中', () => {
    expect(
      cardMultiplierOf([{ match: { resolution: '1080p' }, multiplier: 1.5 }], {
        video_resolution: '1080p',
      }),
    ).toEqual({ multiplier: 1.5, hit: 'EXACT' });
  });

  it('脏数据（非法倍率、空 match、非数组）一律回落基准 1 倍', () => {
    const dirty = [
      { match: { video_resolution: '720p' }, multiplier: 0 },
      { match: {}, multiplier: 3 },
      { multiplier: 2 },
      'not-json',
    ];
    expect(cardMultiplierOf(dirty, { video_resolution: '720p' })).toEqual({
      multiplier: 1,
      hit: 'BASE',
    });
  });
});

describe('单位与额度读法', () => {
  it('call（按次）没有「量」可表达，不允许建卡也不折算', () => {
    expect(isCardBillingUnit('call')).toBe(false);
    expect(cardUnitsNeeded({ billingUnit: 'call', quantity: 2 })).toEqual({
      billingUnit: null,
      units: 0,
      multiplier: 1,
      hit: 'BASE',
    });
    expect(cardUnitLabel('call')).toBe('次');
  });

  it('额度按量纲折算成中文读法，界面与提示同一口径', () => {
    expect(formatQuota('token', 120000)).toBe('12 万 tokens');
    expect(formatQuota('token', 300_000_000)).toBe('3 亿 tokens');
    expect(formatQuota('token', 800)).toBe('800 tokens');
    expect(formatQuota('second', 2.5)).toBe('2.5 秒');
    expect(formatQuota('image', 3)).toBe('3 张');
  });
});

describe('multiplierNote：扣量明细的说明（D4=A + D7=A）', () => {
  it('token 调用整额扣满时不留说明，避免每条日志刷噪音', () => {
    expect(multiplierNote(1500, 1500, { multiplier: 1, hit: 'BASE' })).toBe('');
  });

  it('命中倍率时写清倍率与来源', () => {
    expect(multiplierNote(24, 24, { multiplier: 4, hit: 'NEAREST' })).toBe(
      '卡倍率 4 × 就近档位',
    );
  });

  it('卡额度不够、差额转积分时必须在明细里说明', () => {
    expect(multiplierNote(10, 3, { multiplier: 2, hit: 'EXACT' })).toBe(
      '卡倍率 2 × 精确档位，卡额度不足，差额转积分',
    );
    expect(multiplierNote(1500, 200, { multiplier: 1, hit: 'BASE' })).toBe(
      '卡额度不足，差额转积分',
    );
  });
});
