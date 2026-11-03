import { CurrentUser } from '../auth/current-user';
import { QuestionHallService } from './question-hall.service';

/**
 * 专题大厅控制器：方法名与契约 operationId 去 `QuestionHall_` 前缀一致（首字母小写），
 * 由 automation-routes 的 moduleHandlers 自动映射并统一包 envelope。
 */
export class QuestionHallController {
  constructor(readonly service: QuestionHallService) {}

  questions(
    user: CurrentUser,
    query: {
      page?: number;
      pageSize?: number;
      scope?: string;
      status?: string;
      keyword?: string;
      mine?: string;
    },
  ) {
    return this.service.list(user, query);
  }

  questionDetail(user: CurrentUser, id: string) {
    return this.service.questionDetail(user, id);
  }

  createQuestion(user: CurrentUser, body: Record<string, unknown>) {
    return this.service.createQuestion(user, body);
  }

  reply(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.service.reply(user, id, body);
  }

  resolve(user: CurrentUser, id: string) {
    return this.service.resolve(user, id);
  }

  close(user: CurrentUser, id: string) {
    return this.service.close(user, id);
  }

  reopen(user: CurrentUser, id: string) {
    return this.service.reopen(user, id);
  }

  deleteQuestion(user: CurrentUser, id: string) {
    return this.service.deleteQuestion(user, id);
  }

  deleteReply(user: CurrentUser, id: string) {
    return this.service.deleteReply(user, id);
  }

  config(user: CurrentUser) {
    return this.service.config(user);
  }
}
