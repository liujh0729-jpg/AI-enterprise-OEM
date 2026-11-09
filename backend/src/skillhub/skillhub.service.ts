import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { ContentAgentPluginService } from '../content/agent-plugins.service';
import { ContentAgentSkillService } from '../content/agent-skills.service';
import {
  SkillHubClient,
  type SkillHubRawPlugin,
  type SkillHubRawSkill,
} from './skillhub.client';

const CATEGORY_LABELS: Record<string, string> = {
  'dev-programming': '开发编程',
  'knowledge-management': '知识管理',
  'life-service': '生活服务',
  professional: '专业服务',
  'office-efficiency': '办公效率',
  education: '教育学习',
  'design-media': '设计多媒体',
  'content-creation': '内容创作',
};

const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,99}$/i;

/** 插件目录的分类 key（上游 /api/v1/plugins/categories）对应的中文标签。 */
const PLUGIN_CATEGORY_LABELS: Record<string, string> = {
  'fun-dressup': '趣味换装',
  'web-tools': '联网工具',
  memory: '记忆',
  'agent-workflow': '工作流',
  'model-inference': '模型推理',
  client: '客户端',
  'admin-security': '安全管理',
};

const PLUGIN_SEGMENT_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

function label(category: string) {
  return CATEGORY_LABELS[category] || (category ? '其他' : '');
}

function iso(value: unknown) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return '';
  return new Date(number).toISOString();
}

function categoryOf(raw: SkillHubRawSkill) {
  return text(raw.category).trim();
}

function publisherOf(raw: SkillHubRawSkill) {
  const publisher = (raw.publisher || {}) as Record<string, unknown>;
  return {
    publisherName: text(publisher.name).trim(),
    publisherVerified: publisher.verified === true,
  };
}

function namespaceOf(raw: SkillHubRawSkill) {
  const namespace = (raw.namespace || {}) as Record<string, unknown>;
  return text(namespace.handle).trim();
}

/**
 * SkillHub 技能中心：只读搜索/详情 + 站内安装。
 * 安装包只来自 SkillHub 的官方下载地址，解包与技能入库复用既有的 zip 技能包逻辑。
 */
export class SkillHubService {
  constructor(
    private readonly client: SkillHubClient,
    private readonly skills: ContentAgentSkillService,
    private readonly plugins: ContentAgentPluginService,
  ) {}

  private slug(raw: unknown) {
    const slug = text(raw).trim();
    if (!SLUG_RE.test(slug)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '技能编号无效');
    }
    return slug;
  }

  private item(raw: SkillHubRawSkill) {
    const version = text(raw.version).trim();
    const category = categoryOf(raw);
    return {
      slug: text(raw.slug).trim(),
      name: text(raw.name || raw.displayName).trim(),
      summary: text(raw.description_zh || raw.description).trim(),
      category,
      categoryLabel: label(category),
      downloads: Number(raw.downloads || 0),
      stars: Number(raw.stars || 0),
      version,
      iconUrl: text(raw.iconUrl).trim(),
      ...publisherOf(raw),
      namespaceHandle: namespaceOf(raw),
      updatedAt: iso(raw.updated_at),
    };
  }

  async list(query: { keyword?: string; page?: number; pageSize?: number }) {
    const keyword = text(query.keyword).trim().slice(0, 120);
    // 空关键词上游会回整库（二十万条），站内没有「浏览全部技能」的入口，直接挡掉。
    if (!keyword) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请输入技能关键词');
    }
    const page = Math.max(1, Math.floor(Number(query.page || 1)) || 1);
    const pageSize = Math.min(
      50,
      Math.max(1, Math.floor(Number(query.pageSize || 16)) || 16),
    );
    const result = await this.client.search(keyword, page, pageSize);
    return {
      list: result.skills.map((item) => this.item(item)),
      total: result.total,
      page,
      pageSize,
    };
  }

  async detail(rawSlug: string) {
    const slug = this.slug(rawSlug);
    const [raw, versions] = await Promise.all([
      this.client.detail(slug),
      this.client.versions(slug).catch(() => []),
    ]);
    const skill = (raw.skill || raw) as SkillHubRawSkill;
    const stats = (skill.stats || {}) as Record<string, unknown>;
    const latest = (raw.latestVersion || {}) as Record<string, unknown>;
    const securityReports = (raw.securityReports || {}) as Record<
      string,
      Record<string, unknown>
    >;
    const item = this.item({
      ...skill,
      slug,
      name: skill.displayName || skill.name,
      description: skill.summary,
      description_zh: skill.summary_zh || skill.summary,
      version: latest.version || skill.version,
      downloads: stats.downloads,
      stars: stats.stars,
      publisher: raw.publisher,
      namespace: raw.namespace,
      updated_at: latest.createdAt || skill.createdAt,
    });
    return {
      ...item,
      summaryZh: text(skill.summary_zh).trim(),
      overview: text(skill.overviewMd).trim(),
      homepage: text(skill.homepage).trim(),
      installs: Number(stats.installs || 0),
      security: Object.entries(securityReports)
        .map(([key, value]) => ({
          name: key,
          status: text(value?.status).trim(),
          statusText: text(value?.statusText).trim(),
        }))
        .filter((entry) => entry.status || entry.statusText),
      versions: versions.slice(0, 20).map((entry) => ({
        version: text(entry.version).trim(),
        changelog: text(entry.changelog).trim().slice(0, 500),
        createdAt: iso(entry.createdAt),
      })),
    };
  }

  download(rawSlug: string, version = '') {
    return this.client.download(this.slug(rawSlug), version);
  }

  async install(user: CurrentUser, rawSlug: string) {
    const slug = this.slug(rawSlug);
    const zip = await this.client.download(slug);
    const skill = await this.skills.importZip(user, zip.bytes, zip.filename);
    // 「下载并安装」＝下载 + 自动入库；声明了权限的技能要先让用户在站内确认，不能替用户点同意
    if (!skill.enabled && !skill.permissionsDeclared) {
      return this.skills.setEnabled(user, String(skill.id), { enabled: true });
    }
    return skill;
  }

  // ---------- 插件目录（/api/v1/plugins，上游是 GitHub 上的 DSH 插件仓库） ----------

  private pluginSegment(raw: unknown, label: string) {
    const value = text(raw).trim();
    if (!PLUGIN_SEGMENT_RE.test(value)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, `${label}无效`);
    }
    return value;
  }

  private pluginItem(raw: SkillHubRawPlugin) {
    const manifest = (raw.manifest || {}) as Record<string, unknown>;
    const category = text(raw.categoryKey).trim();
    const owner = text(raw.owner).trim();
    const name = text(manifest.name || raw.name).trim();
    return {
      slug:
        text(raw.fullName).trim() ||
        (owner && name ? `${owner}/${name}` : name),
      name,
      summary: text(manifest.description || raw.description).trim(),
      category,
      categoryLabel:
        PLUGIN_CATEGORY_LABELS[category] || (category ? '其他' : ''),
      stars: Number(raw.stars || 0),
      forks: Number(raw.forks || 0),
      license: text(raw.license).trim(),
      iconUrl: text(raw.avatarUrl).trim(),
      owner,
      homepage: text(manifest.homepage || raw.homepage).trim(),
      repositoryUrl: text(raw.repositoryUrl).trim(),
      version: text(manifest.version).trim(),
      updatedAt: iso(raw.pushedAt || raw.githubUpdatedAt || raw.lastSyncedAt),
    };
  }

  async pluginList(query: {
    keyword?: string;
    page?: number;
    pageSize?: number;
  }) {
    const keyword = text(query.keyword).trim().slice(0, 120);
    // 不传关键词时上游按 Star 降序返回，站内当「热门插件」用；传了就按 q 搜索。
    const page = Math.max(1, Math.floor(Number(query.page || 1)) || 1);
    const pageSize = Math.min(
      50,
      Math.max(1, Math.floor(Number(query.pageSize || 16)) || 16),
    );
    const result = await this.client.pluginSearch(keyword, page, pageSize);
    return {
      list: result.items.map((item) => this.pluginItem(item)),
      total: result.total,
      page,
      pageSize,
    };
  }

  async pluginDetail(rawOwner: string, rawName: string) {
    const owner = this.pluginSegment(rawOwner, '插件作者');
    const name = this.pluginSegment(rawName, '插件名');
    const [raw, readme] = await Promise.all([
      this.client.pluginDetail(owner, name),
      this.client.pluginReadme(owner, name),
    ]);
    const item = this.pluginItem(raw);
    const topics = Array.isArray(raw.topics)
      ? raw.topics
          .map((topic) => text(topic).trim())
          .filter(Boolean)
          .slice(0, 12)
      : [];
    return {
      ...item,
      fullName: text(raw.fullName).trim() || `${owner}/${name}`,
      topics,
      readme,
    };
  }

  /** 「安装」＝把插件目录里的 README 存成本站插件（Agent 可用 load_plugin 阅读）。 */
  async pluginInstall(user: CurrentUser, rawOwner: string, rawName: string) {
    const owner = this.pluginSegment(rawOwner, '插件作者');
    const name = this.pluginSegment(rawName, '插件名');
    const [raw, readme] = await Promise.all([
      this.client.pluginDetail(owner, name),
      this.client.pluginReadme(owner, name),
    ]);
    const item = this.pluginItem(raw);
    return this.plugins.installFromDirectory(user, {
      name: item.name || name,
      description: item.summary,
      content: readme,
      sourceSlug: item.slug || `${owner}/${name}`,
    });
  }
}
