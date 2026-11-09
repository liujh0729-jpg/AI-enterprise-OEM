import {
  surveyCreateBodySchema,
  surveyUpdateBodySchema,
} from '@enterprise/contracts';
import type { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { SurveyService } from './survey.service';

function surveyId(raw: string) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, '问卷编号不合法');
  }
  return id;
}

/** 营销问卷：请求体在这里按契约再解析一次，服务层只接收收口后的数据。 */
export class SurveyController {
  constructor(private readonly surveys: SurveyService) {}

  page(user: CurrentUser, query: Record<string, unknown>) {
    return this.surveys.page(user, query);
  }

  detail(user: CurrentUser, id: string) {
    return this.surveys.detail(user, surveyId(id));
  }

  create(user: CurrentUser, body: Record<string, unknown>) {
    return this.surveys.create(user, surveyCreateBodySchema.parse(body));
  }

  update(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.surveys.update(
      user,
      surveyId(id),
      surveyUpdateBodySchema.parse(body),
    );
  }

  publish(user: CurrentUser, id: string) {
    return this.surveys.publish(user, surveyId(id));
  }

  close(user: CurrentUser, id: string) {
    return this.surveys.close(user, surveyId(id));
  }

  reopen(user: CurrentUser, id: string) {
    return this.surveys.reopen(user, surveyId(id));
  }

  remove(user: CurrentUser, id: string) {
    return this.surveys.remove(user, surveyId(id));
  }

  results(user: CurrentUser, id: string, query: Record<string, unknown>) {
    return this.surveys.results(user, surveyId(id), query);
  }
}
