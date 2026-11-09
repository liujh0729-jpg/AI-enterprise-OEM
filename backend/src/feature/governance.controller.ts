import type { AiGuardSettings } from '@enterprise/contracts';
import type { CurrentUser } from '../auth/current-user';
import type { AiGuardService } from '../ai/ai-guard.service';
import type { FeatureToggleService } from './feature-toggle.service';
import type { AccessPolicyService } from './access-policy.service';
import type { SkillReviewService } from './skill-review.service';
import type {
  BillingRuleInput,
  BillingRuleService,
} from '../points/billing-rule.service';

type RequireAdmin = (user: CurrentUser) => void;

/**
 * 平台治理控制器：契约端点 id `Platform_xxx` → 方法 `xxx`，由 automation-routes 的
 * moduleHandlers 统一注册（自动进 OpenAPI/MCP）。除菜单外全部管理端动作统一 requireAdmin。
 */
export class PlatformController {
  constructor(
    private readonly toggle: FeatureToggleService,
    private readonly accessPolicyService: AccessPolicyService,
    private readonly skillReview: SkillReviewService,
    private readonly aiGuardService: AiGuardService,
    private readonly requireAdmin: RequireAdmin,
  ) {}

  menu(user: CurrentUser) {
    return this.toggle.menuFor(user.userId);
  }

  featureCatalog(user: CurrentUser) {
    this.requireAdmin(user);
    return this.toggle.adminCatalog();
  }

  setFeatureToggle(
    user: CurrentUser,
    body: {
      code: string;
      state: 'open' | 'closed';
      scope: 'PLATFORM' | 'ORG';
      orgUserId: string;
    },
  ) {
    this.requireAdmin(user);
    return this.toggle.setToggle(body, user.userId);
  }

  accessPolicy(user: CurrentUser) {
    this.requireAdmin(user);
    return this.accessPolicyService.current();
  }

  saveAccessPolicy(user: CurrentUser, body: unknown) {
    this.requireAdmin(user);
    return this.accessPolicyService.save(
      body as Parameters<AccessPolicyService['save']>[0],
      user.userId,
    );
  }

  /** §5.7 AI 三闸读数：平台总闸、组织收紧、用户×组织每分钟上限。 */
  aiGuard(user: CurrentUser) {
    this.requireAdmin(user);
    return this.aiGuardService.current();
  }

  saveAiGuard(user: CurrentUser, body: AiGuardSettings) {
    this.requireAdmin(user);
    return this.aiGuardService.save(body);
  }

  skillReviews(
    user: CurrentUser,
    query: {
      page: number;
      pageSize: number;
      kind?: string;
      decision?: string;
    },
  ) {
    this.requireAdmin(user);
    return this.skillReview
      .list({
        page: query.page,
        size: query.pageSize,
        kind: query.kind,
        decision: query.decision,
      })
      .then((data) => ({
        list: data.list,
        total: data.total,
        page: data.page,
        pageSize: data.size,
      }));
  }

  reviewSkillDecision(
    user: CurrentUser,
    body: Parameters<SkillReviewService['applyDecision']>[0],
  ) {
    this.requireAdmin(user);
    return this.skillReview.applyDecision(body, user.userId);
  }
}

/** Agent 按用量计费规则（§5.12）：管理端改价即时生效。 */
export class PointsBillingController {
  constructor(
    private readonly billingRule: BillingRuleService,
    private readonly requireAdmin: RequireAdmin,
  ) {}

  billingRules(user: CurrentUser) {
    this.requireAdmin(user);
    return this.billingRule.list();
  }

  upsertBillingRule(user: CurrentUser, body: BillingRuleInput) {
    this.requireAdmin(user);
    return this.billingRule.upsert(body, user.userId);
  }

  deleteBillingRule(user: CurrentUser, body: { id: number }) {
    this.requireAdmin(user);
    return this.billingRule.remove(body.id);
  }
}
