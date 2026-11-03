import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { Logger } from '../common/logger';
import { httpRequest } from '../http/transport';

const logger = new Logger('SkillHubClient');
const MAX_ZIP_BYTES = 20 * 1024 * 1024;

export type SkillHubRawSkill = Record<string, unknown>;
export type SkillHubRawDetail = Record<string, unknown>;
export type SkillHubRawPlugin = Record<string, unknown>;

export type SkillHubZip = {
  bytes: Uint8Array;
  filename: string;
};

function baseUrl() {
  return String(process.env.SKILLHUB_BASE_URL || 'https://api.skillhub.cn')
    .trim()
    .replace(/\/+$/, '');
}

/**
 * SkillHub 公开技能目录（api.skillhub.cn）：
 * 搜索用公开 `/api/skills`，详情与版本用 `/api/v1/skills/{slug}`，安装包用 `/api/v1/download`。
 * 只允许固定主机的公开接口，不接受用户传入整条外部 URL。
 */
export class SkillHubClient {
  private async json<T>(
    path: string,
    timeoutMs = 15000,
    kind: 'skill' | 'plugin' = 'skill',
  ): Promise<T> {
    const unavailable =
      kind === 'plugin'
        ? '插件中心暂时不可用，请稍后重试'
        : '技能中心暂时不可用，请稍后重试';
    let response;
    try {
      response = await httpRequest<T>(`${baseUrl()}${path}`, {
        timeoutMs,
        operation: kind === 'plugin' ? 'skillhub:plugin' : 'skillhub',
        headers: {
          accept: 'application/json',
          'user-agent': 'AIworkin-Enterprise',
        },
      });
    } catch (error) {
      logger.warn({ path, error: this.errorInfo(error) });
      throw new BusinessException(ErrorCode.SERVICE_UNAVAILABLE, unavailable);
    }
    if (!response.ok || !response.data) {
      if (response.status === 404) {
        throw new BusinessException(
          ErrorCode.NOT_FOUND,
          kind === 'plugin' ? '插件不存在' : '技能不存在',
        );
      }
      throw new BusinessException(ErrorCode.SERVICE_UNAVAILABLE, unavailable);
    }
    return response.data;
  }

  async search(keyword: string, page: number, pageSize: number) {
    const query = new URLSearchParams({
      // SkillHub 只认单数 keyword；写成 keywords 会被忽略并返回全库。
      // sortBy=sort 也已不接受；score 与列表页“综合排序”一致。
      keyword,
      sortBy: 'score',
      page: String(page),
      pageSize: String(pageSize),
    });
    const payload = await this.json<{
      code?: number;
      message?: string;
      data?: { skills?: SkillHubRawSkill[]; total?: number };
    }>(`/api/skills?${query.toString()}`);
    if (payload.code !== 0) {
      logger.warn({ message: payload.message || '', keyword });
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '技能中心暂时不可用，请稍后重试',
      );
    }
    const skills = payload.data?.skills;
    return {
      skills: Array.isArray(skills) ? skills : [],
      total: Number(payload.data?.total || 0),
    };
  }

  detail(slug: string) {
    return this.json<SkillHubRawDetail>(
      `/api/v1/skills/${encodeURIComponent(slug)}`,
    );
  }

  async versions(slug: string) {
    const payload = await this.json<{ versions?: Record<string, unknown>[] }>(
      `/api/v1/skills/${encodeURIComponent(slug)}/versions`,
    );
    return Array.isArray(payload.versions) ? payload.versions : [];
  }

  /** 插件目录：公开 /api/v1/plugins；搜索参数是 q，不传 q 时上游按 Star 排序回热门。 */
  async pluginSearch(keyword: string, page: number, pageSize: number) {
    const query = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (keyword) query.set('q', keyword);
    const payload = await this.json<{
      items?: SkillHubRawPlugin[];
      total?: number;
    }>(`/api/v1/plugins?${query.toString()}`, 15000, 'plugin');
    const items = payload.items;
    return {
      items: Array.isArray(items) ? items : [],
      total: Number(payload.total || 0),
    };
  }

  pluginDetail(owner: string, name: string) {
    return this.json<SkillHubRawPlugin>(
      `/api/v1/plugins/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
      15000,
      'plugin',
    );
  }

  /** 插件 README（上游 302 到 COS）：拿不到就当没有，不阻断详情与安装。 */
  async pluginReadme(owner: string, name: string) {
    try {
      const response = await httpRequest<string>(
        `${baseUrl()}/api/v1/plugins/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/readme`,
        {
          timeoutMs: 20000,
          readAs: 'text',
          operation: 'skillhub:plugin-readme',
          headers: {
            accept: 'text/markdown, text/plain, */*',
            'user-agent': 'AIworkin-Enterprise',
          },
        },
      );
      if (!response.ok || !response.data) return '';
      return response.data.slice(0, 20000);
    } catch (error) {
      logger.warn({ owner, name, error: this.errorInfo(error) });
      return '';
    }
  }

  async download(slug: string, version = ''): Promise<SkillHubZip> {
    const query = new URLSearchParams({ slug, source: 'dsh' });
    if (version) query.set('version', version);
    let response;
    try {
      response = await httpRequest<Uint8Array>(
        `${baseUrl()}/api/v1/download?${query.toString()}`,
        {
          timeoutMs: 60000,
          readAs: 'bytes',
          operation: 'skillhub:download',
          headers: { 'user-agent': 'AIworkin-Enterprise' },
        },
      );
    } catch (error) {
      logger.warn({ slug, error: this.errorInfo(error) });
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '技能包下载失败，请稍后重试',
      );
    }
    if (!response.ok || !response.data) {
      throw new BusinessException(
        response.status === 404
          ? ErrorCode.NOT_FOUND
          : ErrorCode.SERVICE_UNAVAILABLE,
        response.status === 404 ? '技能不存在' : '技能包下载失败，请稍后重试',
      );
    }
    const bytes = response.data;
    if (bytes.length > MAX_ZIP_BYTES) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '技能包超过 20MB，不能在站内直接安装',
      );
    }
    const contentType = response.headers.get('content-type') || '';
    if (
      !/zip|octet-stream/i.test(contentType) &&
      !(bytes[0] === 0x50 && bytes[1] === 0x4b)
    ) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '技能包下载失败，请稍后重试',
      );
    }
    return {
      bytes,
      filename: this.filename(
        response.headers.get('content-disposition'),
        slug,
      ),
    };
  }

  private filename(header: string | null, slug: string) {
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header || '');
    if (match?.[1]) {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return match[1];
      }
    }
    return `${slug}.zip`;
  }

  private errorInfo(error: unknown) {
    if (error instanceof Error)
      return { name: error.name, message: error.message };
    return { message: String(error) };
  }
}
