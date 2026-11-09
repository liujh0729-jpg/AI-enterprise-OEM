import {
  HomepageSettingsService,
  type HomepageSettingsInput,
} from './homepage-settings.service';
import { stub } from '../../test/doubles';
import type { PrismaService } from '../prisma/prisma.service';

/** 内存版 system_settings：只实现本服务用到的 findUnique / upsert。 */
function service() {
  const store = new Map<string, string>();
  const prisma = stub<PrismaService>({
    systemSetting: {
      findUnique: async ({ where }: { where: { key: string } }) =>
        store.has(where.key)
          ? { key: where.key, value: store.get(where.key) }
          : null,
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { key: string };
        create: { value: string };
        update: { value: string };
      }) => {
        store.set(where.key, create?.value ?? update.value);
        return { key: where.key, value: store.get(where.key) };
      },
    },
  });
  return { homepage: new HomepageSettingsService(prisma), store };
}

describe('HomepageSettingsService', () => {
  it('未保存过时返回内置默认内容（登录 / 注册入口不依赖后台配置）', async () => {
    const { homepage } = service();
    const view = await homepage.view();
    expect(view.hero.title).toContain('企业');
    expect(view.hero.primaryLabel).toBe('免费注册');
    expect(view.faq.items.length).toBeGreaterThan(0);
    expect(view.sections.scenes).toBe(true);
  });

  it('保存后按字段归一化，并可从库中读回', async () => {
    const { homepage, store } = service();
    const saved = await homepage.save({
      hero: {
        title: '  新标题  ',
        highlight: '新',
        stats: [{ value: '1', label: '项' }],
      },
      services: {
        items: [{ name: '新板块', desc: '说明' }, { name: '' }],
      },
      sections: { faq: false },
    });
    expect(saved.hero.title).toBe('新标题');
    expect(saved.hero.stats).toEqual([{ value: '1', label: '项' }]);
    // 列表字段按「整组替换」处理，空名称的项丢弃
    expect(saved.services.items).toEqual([{ name: '新板块', desc: '说明' }]);
    expect(saved.sections.faq).toBe(false);
    expect(saved.sections.scenes).toBe(true);
    expect(store.has(HomepageSettingsService.KEY)).toBe(true);

    const view = await homepage.view();
    expect(view.hero.title).toBe('新标题');
    expect(view.sections.faq).toBe(false);
  });

  it('脏值回落默认：非数组列表、空文案、非法开关都不写入脏数据', async () => {
    const { homepage } = service();
    // 管理端提交来自 JSON：先走一次真实的序列化边界再造脏值，不在类型层伪造。
    const dirty = JSON.parse(
      '{"hero":{"title":"   ","badge":123},"scenes":{"items":"not-array"},' +
        '"integration":{"points":["ok",42,"  "]},' +
        '"sections":{"steps":"yes"}}',
    ) as HomepageSettingsInput;
    const saved = await homepage.save(dirty);
    expect(saved.hero.title).toContain('企业');
    expect(saved.hero.badge.length).toBeGreaterThan(0);
    expect(saved.scenes.items.length).toBeGreaterThan(0);
    expect(saved.integration.points).toEqual(['ok']);
    expect(saved.sections.steps).toBe(true);
  });

  it('库中 JSON 损坏时回落到默认，不让首页白屏', async () => {
    const { homepage, store } = service();
    store.set(HomepageSettingsService.KEY, '{broken');
    const view = await homepage.view();
    expect(view.hero.title).toContain('企业');
  });
});
