import { ok } from '../common/api';
import { parseId } from '../common/parse-id';
import { CurrentUser } from '../auth/current-user';
import { AiCallAccountService } from './ai-call-account.service';

/**
 * AI 调用账号机器通道（x-api-key）。
 *
 * AI 自动化任务凭本系统 API Key（ek_）调用，但每次都要声明自己在哪把
 * Workbuddy Enterprise 账号下运行（`workbuddyAccountId`）：
 * 只有与该账号绑定的 AI 调用账号才列得出来、才取得到明文凭据。
 *
 * 列表不含任何明文；明文只在 `GET /:id/credentials` 解密一次并记审计。
 */
export class AiCallOpenController {
  constructor(private readonly accounts: AiCallAccountService) {}

  async list(
    user: CurrentUser,
    query: { workbuddyAccountId: number; platform?: string },
  ) {
    return ok(
      await this.accounts.openList(
        user,
        query.workbuddyAccountId,
        query.platform,
      ),
    );
  }

  async credentials(
    user: CurrentUser,
    id: string,
    query: { workbuddyAccountId: number },
  ) {
    return ok(
      await this.accounts.openCredentials(
        user,
        parseId(id, '账号 ID'),
        query.workbuddyAccountId,
      ),
    );
  }
}
