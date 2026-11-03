import { ok } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { AiworkinClient } from './aiworkin.client';
import { aiworkinBaseUrl } from './aiworkin.config';
import { DemandService } from './demand.service';
import { EnterpriseProfileService } from './enterprise-profile.service';
import { ConnectionProfileInput, DemandDraft } from './aiworkin.types';
import { MODULE_CATEGORIES, findModuleCategory } from './category-catalog';
/**
 * AIworkin 联动端点：需求与需求回复、企业档案的读写均转发到 AIworkin。
 * 「代平台查/申 sk- Key」已随设计 3.5 取消：本系统只有本地 ek_ Key 与 AIPDD 绑定 Key。
 */
export class AiworkinController {
  constructor(
    private readonly client: AiworkinClient,
    private readonly demands: DemandService,
    private readonly profiles: EnterpriseProfileService,
  ) {}
  status() {
    return ok({
      enabled: this.client.isEnabled(),
      baseUrl: aiworkinBaseUrl(),
    });
  }
  /**
   * 供需市场类目（六模块子树镜像）：发布需求/服务必填 subcategoryId，
   * 本接口不受 AIWORKIN_ENABLED 门控（ID 与平台一致，运行时未起也可选）。
   */
  categories(domain?: string) {
    let modules = MODULE_CATEGORIES;
    if (domain) {
      const hit = findModuleCategory(String(domain).toUpperCase());
      if (!hit) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `未知业务域：${domain}`,
        );
      }
      modules = [hit];
    }
    return ok({
      modules: modules.map((item) => ({
        domain: item.domain,
        label: item.label,
        category1: item.parentName,
        category1Id: item.parentId,
        category2Options: item.children.map((child) => ({
          id: child.id,
          key: child.key,
          label: child.name,
          credentialTypes: child.credentialTypes,
          manualOnly: child.manualOnly,
        })),
      })),
    });
  }
  /**
   * 我的挂单：不传 direction 即「我的需求」（DEMAND，与既有调用一致）；
   * `direction=SUPPLY` 为「我的服务」（服务发布）。
   * 平台只按属主 + 方向取单，没有类目/状态过滤参数。
   */
  async myDemands(
    token: string,
    page?: string,
    pageSize?: string,
    direction?: string,
  ) {
    this.requireEnabled();
    return ok(
      await this.demands.listMine(token, { page, pageSize, direction }),
    );
  }
  /**
   * 公开需求池 / 公开服务池（服务商侧取单用）：平台的 `GET /market/listings`，
   * 本系统不落任何副本，翻页与筛选参数原样透传（`category`＝一级类目 key）。
   */
  async marketListings(
    token: string,
    page?: string,
    pageSize?: string,
    direction?: string,
    keyword?: string,
    category?: string,
    province?: string,
    city?: string,
    status?: string,
  ) {
    this.requireEnabled();
    return ok(
      await this.demands.listPublic(token, {
        page,
        pageSize,
        direction,
        keyword,
        category,
        province,
        city,
        status,
      }),
    );
  }
  async demandDetail(token: string, listingId: string) {
    this.requireEnabled();
    const mine = await this.demands.getMine(token, listingId).catch((error) => {
      if (
        error instanceof BusinessException &&
        error.errorCode === ErrorCode.NOT_FOUND
      ) {
        return null;
      }
      throw error;
    });
    return ok(mine || (await this.demands.getPublic(token, listingId)));
  }
  async publishDemand(token: string, body: DemandDraft) {
    this.requireEnabled();
    return ok(await this.demands.publish(token, body));
  }
  /** 撤回自己发布的挂单（平台软删）。 */
  async removeDemand(token: string, listingId: string) {
    this.requireEnabled();
    return ok(await this.demands.removeListing(token, listingId));
  }
  /**
   * 一条需求下的服务商回复线程清单（一家一条）：需求页「查看消息」的列表侧。
   * 会话属主与轮次由平台侧维护，本系统只读转发。
   */
  async demandConversations(
    token: string,
    listingId: string,
    page?: string,
    pageSize?: string,
  ) {
    this.requireEnabled();
    // 兜底号要先查本人挂单才拿得到：交给 demand.service 按需解析，
    // 平台按 listingId 直查命中时这一枪就不打了
    return ok(
      await this.demands.listConversationsForListing(
        token,
        listingId,
        async () => {
          const listing = await this.demands
            .getMine(token, listingId)
            .catch(() => null);
          return String(
            (
              listing as {
                initialMatchRunId?: string;
              } | null
            )?.initialMatchRunId ||
              (
                listing as {
                  matchRunId?: string;
                } | null
              )?.matchRunId ||
              '',
          );
        },
        { page, pageSize },
      ),
    );
  }
  async conversations(
    token: string,
    page?: string,
    pageSize?: string,
    matchRunId?: string,
  ) {
    this.requireEnabled();
    return ok(
      await this.demands.listConversations(token, {
        page,
        pageSize,
        matchRunId,
      }),
    );
  }
  async conversation(token: string, conversationId: string) {
    this.requireEnabled();
    return ok(await this.demands.getConversation(token, conversationId));
  }
  async reply(
    token: string,
    conversationId: string,
    body: {
      content?: string;
      idempotencyKey?: string;
    },
  ) {
    this.requireEnabled();
    return ok(
      await this.demands.reply(
        token,
        conversationId,
        String(body.content || ''),
        body.idempotencyKey,
      ),
    );
  }
  async profile(token: string) {
    this.requireEnabled();
    return ok(await this.profiles.get(token));
  }
  async saveProfile(token: string, body: ConnectionProfileInput) {
    this.requireEnabled();
    return ok(await this.profiles.save(token, body));
  }
  private requireEnabled() {
    if (!this.client.isEnabled()) {
      throw new BusinessException(
        ErrorCode.AIWORKIN_UNAVAILABLE,
        'AIworkin 能力暂不可用',
      );
    }
  }
}
