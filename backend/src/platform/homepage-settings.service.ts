import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_HOMEPAGE, type HomepageSettings } from '@enterprise/contracts';

export type { HomepageSettings } from '@enterprise/contracts';

/** 管理端提交的是「想覆盖的字段」：嵌套对象与列表项都允许只传一部分。 */
type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (infer U)[]
    ? DeepPartial<U>[]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};
export type HomepageSettingsInput = DeepPartial<HomepageSettings>;

const text = (value: unknown, fallback: string, max: number): string => {
  if (typeof value !== 'string') return fallback;
  const next = value.trim().slice(0, max);
  return next || fallback;
};

const flag = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

/** 数组字段归一化：非数组回落到默认，逐项由 mapper 清洗，空项丢弃并按上限截断。 */
function list<T>(
  value: unknown,
  fallback: T[],
  max: number,
  mapper: (item: Record<string, unknown>, index: number) => T | null,
): T[] {
  if (!Array.isArray(value)) return fallback;
  const rows = value
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === 'object' && !Array.isArray(item),
    )
    .map(mapper)
    .filter((item): item is T => item !== null)
    .slice(0, max);
  return rows.length ? rows : fallback;
}

/**
 * 官网首页设置（system_settings 单键 JSON）。
 * 默认内容由后端内置，管理员只覆盖想改的字段；保存时按字段归一化，脏值回落到默认。
 */
export class HomepageSettingsService {
  static readonly KEY = 'homepage_settings';

  constructor(private readonly prisma: PrismaService) {}

  async view(): Promise<HomepageSettings> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: HomepageSettingsService.KEY },
    });
    if (!row?.value) return DEFAULT_HOMEPAGE;
    try {
      return this.normalize(JSON.parse(row.value) as HomepageSettingsInput);
    } catch {
      return DEFAULT_HOMEPAGE;
    }
  }

  async save(body: HomepageSettingsInput): Promise<HomepageSettings> {
    const next = this.normalize(body);
    await this.prisma.systemSetting.upsert({
      where: { key: HomepageSettingsService.KEY },
      create: {
        key: HomepageSettingsService.KEY,
        value: JSON.stringify(next),
      },
      update: { value: JSON.stringify(next) },
    });
    return next;
  }

  private normalize(input: HomepageSettingsInput): HomepageSettings {
    const d = DEFAULT_HOMEPAGE;
    const hero: DeepPartial<HomepageSettings['hero']> = input.hero ?? {};
    const scenes: DeepPartial<HomepageSettings['scenes']> = input.scenes ?? {};
    const services: DeepPartial<HomepageSettings['services']> =
      input.services ?? {};
    const integration: DeepPartial<HomepageSettings['integration']> =
      input.integration ?? {};
    const steps: DeepPartial<HomepageSettings['steps']> = input.steps ?? {};
    const faq: DeepPartial<HomepageSettings['faq']> = input.faq ?? {};
    const cta: DeepPartial<HomepageSettings['cta']> = input.cta ?? {};
    const footer: DeepPartial<HomepageSettings['footer']> = input.footer ?? {};
    const sections: DeepPartial<HomepageSettings['sections']> =
      input.sections ?? {};
    return {
      hero: {
        badge: text(hero.badge, d.hero.badge, 80),
        title: text(hero.title, d.hero.title, 80),
        highlight: text(hero.highlight, d.hero.highlight, 40),
        subtitle: text(hero.subtitle, d.hero.subtitle, 300),
        primaryLabel: text(hero.primaryLabel, d.hero.primaryLabel, 16),
        secondaryLabel: text(hero.secondaryLabel, d.hero.secondaryLabel, 16),
        image: text(hero.image, d.hero.image, 512),
        stats: list(hero.stats, d.hero.stats, 4, (item) => {
          const value =
            typeof item.value === 'string'
              ? item.value.trim().slice(0, 20)
              : '';
          const label =
            typeof item.label === 'string'
              ? item.label.trim().slice(0, 30)
              : '';
          return value && label ? { value, label } : null;
        }),
      },
      scenes: {
        title: text(scenes.title, d.scenes.title, 80),
        subtitle: text(scenes.subtitle, d.scenes.subtitle, 160),
        items: list(scenes.items, d.scenes.items, 6, (item) => {
          const title =
            typeof item.title === 'string'
              ? item.title.trim().slice(0, 60)
              : '';
          const desc =
            typeof item.desc === 'string' ? item.desc.trim().slice(0, 200) : '';
          if (!title && !desc) return null;
          return {
            tag: text(item.tag, '场景', 24),
            title: title || d.scenes.items[0].title,
            desc,
            image: text(item.image, d.hero.image, 512),
          };
        }),
      },
      services: {
        title: text(services.title, d.services.title, 80),
        subtitle: text(services.subtitle, d.services.subtitle, 160),
        items: list(services.items, d.services.items, 20, (item) => {
          const name =
            typeof item.name === 'string' ? item.name.trim().slice(0, 30) : '';
          const desc =
            typeof item.desc === 'string' ? item.desc.trim().slice(0, 80) : '';
          return name ? { name, desc } : null;
        }),
      },
      integration: {
        title: text(integration.title, d.integration.title, 80),
        subtitle: text(integration.subtitle, d.integration.subtitle, 160),
        points: Array.isArray(integration.points)
          ? integration.points
              .filter((point): point is string => typeof point === 'string')
              .map((point) => point.trim().slice(0, 160))
              .filter(Boolean)
              .slice(0, 6)
          : d.integration.points,
      },
      steps: {
        title: text(steps.title, d.steps.title, 80),
        subtitle: text(steps.subtitle, d.steps.subtitle, 160),
        items: list(steps.items, d.steps.items, 6, (item) => {
          const title =
            typeof item.title === 'string'
              ? item.title.trim().slice(0, 40)
              : '';
          const desc =
            typeof item.desc === 'string' ? item.desc.trim().slice(0, 160) : '';
          return title ? { title, desc } : null;
        }),
      },
      faq: {
        title: text(faq.title, d.faq.title, 80),
        items: list(faq.items, d.faq.items, 12, (item) => {
          const q =
            typeof item.q === 'string' ? item.q.trim().slice(0, 120) : '';
          const a =
            typeof item.a === 'string' ? item.a.trim().slice(0, 600) : '';
          return q && a ? { q, a } : null;
        }),
      },
      cta: {
        title: text(cta.title, d.cta.title, 80),
        subtitle: text(cta.subtitle, d.cta.subtitle, 160),
        primaryLabel: text(cta.primaryLabel, d.cta.primaryLabel, 16),
        secondaryLabel: text(cta.secondaryLabel, d.cta.secondaryLabel, 16),
      },
      footer: {
        slogan: text(footer.slogan, d.footer.slogan, 120),
        copyright: text(footer.copyright, d.footer.copyright, 160),
      },
      sections: {
        scenes: flag(sections.scenes, d.sections.scenes),
        services: flag(sections.services, d.sections.services),
        integration: flag(sections.integration, d.sections.integration),
        steps: flag(sections.steps, d.sections.steps),
        faq: flag(sections.faq, d.sections.faq),
        cta: flag(sections.cta, d.sections.cta),
      },
    };
  }
}
