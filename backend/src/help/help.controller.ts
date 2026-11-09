import { ok } from '../common/api';
import { HelpService } from './help.service';

/**
 * 帮助中心（章节知识库）：章节目录 / 主题详情 / 全文搜索三个只读接口。
 * 前端 /help 页与 MCP（Help_*）读同一份内置知识，内容随代码版本化维护。
 * 三接口都是内置静态知识、与身份无关，故不接收 CurrentUser。
 */
export class HelpController {
  constructor(private readonly help: HelpService) {}

  chapters() {
    return ok(this.help.chapters());
  }

  topic(code: string) {
    return ok(this.help.topic(code));
  }

  search(query: { keyword?: string }) {
    return ok(this.help.search(query));
  }
}
