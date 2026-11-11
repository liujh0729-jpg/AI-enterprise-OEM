import { ok } from '../common/api';
import { CurrentUser } from '../auth/current-user';
import { HelpService } from './help.service';

/**
 * 帮助中心（章节知识库）：章节目录 / 主题详情 / 全文搜索三个只读接口。
 * 前端 /help 页与 MCP（Help_*）读同一份内置知识，内容随代码版本化维护。
 * 接口按当前账号隔离平台管理员专区，并给可见内容附加角色分区。
 */
export class HelpController {
  constructor(private readonly help: HelpService) {}

  chapters(user: CurrentUser) {
    return ok(this.help.chapters(user));
  }

  topic(user: CurrentUser, code: string) {
    return ok(this.help.topic(user, code));
  }

  search(user: CurrentUser, query: { keyword?: string }) {
    return ok(this.help.search(user, query));
  }
}
