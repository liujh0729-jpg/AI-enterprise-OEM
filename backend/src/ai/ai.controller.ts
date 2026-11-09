import type { CurrentUser } from '../auth/current-user';
import type {
  AiAbilitiesService,
  AiAskInput,
  AiAskOutput,
  AiClassifyInput,
  AiClassifyOutput,
  AiExtractInput,
  AiExtractOutput,
  AiScoreInput,
  AiScoreOutput,
  AiSummarizeInput,
  AiSummarizeOutput,
} from './ai-abilities.service';
import type { AiPointsService } from './ai-points.service';

type Row = Record<string, unknown>;

/**
 * 点状 AI 控制器：契约端点 id `Ai_xxx` → 方法名 `xxx`，由 automation-routes 的
 * moduleHandlers 统一注册（自动进 OpenAPI/MCP）。通用能力走 AiAbilitiesService，
 * 各模块点走 AiPointsService（内部先按业务 scope 取数，再做能力调用与规则回落）。
 */
export class AiController {
  constructor(
    private readonly abilities: AiAbilitiesService,
    private readonly points: AiPointsService,
  ) {}

  summarize(
    user: CurrentUser,
    body: AiSummarizeInput,
  ): Promise<AiSummarizeOutput> {
    return this.abilities.summarize(user, body);
  }

  extract(user: CurrentUser, body: AiExtractInput): Promise<AiExtractOutput> {
    return this.abilities.extract(user, body);
  }

  classify(
    user: CurrentUser,
    body: AiClassifyInput,
  ): Promise<AiClassifyOutput> {
    return this.abilities.classify(user, body);
  }

  score(user: CurrentUser, body: AiScoreInput): Promise<AiScoreOutput> {
    return this.abilities.score(user, body);
  }

  ask(user: CurrentUser, body: AiAskInput): Promise<AiAskOutput> {
    return this.abilities.ask(user, body);
  }

  crmLeadScore(user: CurrentUser, body: Row) {
    return this.points.crmLeadScore(user, body);
  }

  okrCheckKr(user: CurrentUser, body: Row) {
    return this.points.okrCheckKr(user, body);
  }

  okrProgressSummary(user: CurrentUser, body: Row) {
    return this.points.okrProgressSummary(user, body);
  }

  projectStandup(user: CurrentUser, body: Row) {
    return this.points.projectStandup(user, body);
  }

  projectSplitTask(user: CurrentUser, body: Row) {
    return this.points.projectSplitTask(user, body);
  }

  surveyReport(user: CurrentUser, body: Row) {
    return this.points.surveyReport(user, body);
  }

  distributionRewrite(user: CurrentUser, body: Row) {
    return this.points.distributionRewrite(user, body);
  }

  mailboxAnalyze(user: CurrentUser, body: Row) {
    return this.points.mailboxAnalyze(user, body);
  }

  hrmAttrition(user: CurrentUser, body: Row) {
    return this.points.hrmAttrition(user, body);
  }

  legalReview(user: CurrentUser, body: Row) {
    return this.points.legalReview(user, body);
  }

  overseasCheck(user: CurrentUser, body: Row) {
    return this.points.overseasCheck(user, body);
  }

  invoiceExtract(user: CurrentUser, body: Row) {
    return this.points.invoiceExtract(user, body);
  }

  taxCheck(user: CurrentUser, body: Row) {
    return this.points.taxCheck(user, body);
  }

  socialCompose(user: CurrentUser, body: Row) {
    return this.points.socialCompose(user, body);
  }

  oaDraftApplication(user: CurrentUser, body: Row) {
    return this.points.oaDraftApplication(user, body);
  }
}
