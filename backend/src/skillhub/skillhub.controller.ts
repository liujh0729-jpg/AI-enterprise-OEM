import { CurrentUser } from '../auth/current-user';
import { SkillHubService } from './skillhub.service';

/** SkillHub 技能中心：列表 / 详情 / 下载 / 下载并安装；插件目录：列表 / 详情 / 安装。 */
export class SkillHubController {
  constructor(private readonly service: SkillHubService) {}

  async list(_user: CurrentUser, query: Record<string, unknown>) {
    return this.service.list({
      keyword: query.keyword as string | undefined,
      page: query.page as number | undefined,
      pageSize: query.pageSize as number | undefined,
    });
  }

  async detail(_user: CurrentUser, slug: string) {
    return this.service.detail(slug);
  }

  download(_user: CurrentUser, slug: string) {
    return this.service.download(slug);
  }

  async install(user: CurrentUser, slug: string) {
    return this.service.install(user, slug);
  }

  async pluginList(_user: CurrentUser, query: Record<string, unknown>) {
    return this.service.pluginList({
      keyword: query.keyword as string | undefined,
      page: query.page as number | undefined,
      pageSize: query.pageSize as number | undefined,
    });
  }

  async pluginDetail(_user: CurrentUser, owner: string, name: string) {
    return this.service.pluginDetail(owner, name);
  }

  async pluginInstall(user: CurrentUser, owner: string, name: string) {
    return this.service.pluginInstall(user, owner, name);
  }
}
