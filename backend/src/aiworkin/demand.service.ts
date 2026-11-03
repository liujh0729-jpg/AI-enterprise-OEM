import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { AiworkinClient } from './aiworkin.client';
import {
  AgentConversation,
  AgentConversationPage,
  AgentMessage,
  DemandDraft,
  MarketListing,
  MarketListingPage,
  MatchRunPage,
  PublishDemandResult,
} from './aiworkin.types';
export interface DemandQuery {
  page?: number | string;
  pageSize?: number | string;
  direction?: string;
  matchRunId?: string;
  listingId?: string;
  keyword?: string;
  status?: string;
  /** 一级类目 key（平台 `list` 的 `category`，只认父类目 key） */
  category?: string;
  province?: string;
  city?: string;
}
const REPLY_MIN_LENGTH = 1;
const REPLY_MAX_LENGTH = 20000;
/**
 * 需求与需求回复：增查全部调用 AIworkin 运行时接口，本库不落需求内容。
 * 契约见《企业财税出海物流综合服务系统需求文档 2.0》§7。
 */
export class DemandService {
  constructor(private readonly client: AiworkinClient) {}
  async publish(
    token: string,
    draft: DemandDraft,
    idempotencyKey?: string,
  ): Promise<PublishDemandResult> {
    const direction = draft.direction === 'SUPPLY' ? 'SUPPLY' : 'DEMAND';
    assertDraftRules(draft, direction);
    const result = await this.client.request<PublishDemandResult>(
      '/market/listings',
      {
        method: 'POST',
        token,
        body: {
          publishAction: 'PUBLISH',
          ...draft,
          direction,
        },
        idempotencyKey: idempotencyKey || this.client.newIdempotencyKey(),
      },
    );
    if (!result?.listing?.id) {
      throw new BusinessException(
        ErrorCode.AIWORKIN_UNAVAILABLE,
        'AIworkin 未返回需求标识',
      );
    }
    return result;
  }
  /**
   * 我的挂单：平台 `GET /market/listings/mine` 只接受 `direction/page/pageSize`
   * （按属主取，无类目与状态过滤），因此板块级的类目筛选由调用方本地完成。
   */
  listMine(token: string, query: DemandQuery = {}) {
    return this.client.request<MarketListingPage>(
      `/market/listings/mine${toQuery({
        page: query.page,
        pageSize: query.pageSize,
        direction: query.direction || 'DEMAND',
      })}`,
      { token },
    );
  }
  /**
   * 公开池：平台 `GET /market/listings` 的类目参数是**一级类目 key**（`category`），
   * 省市为精确匹配（`RADIUS` 模式的省市由平台按坐标另存，不参与该筛选）。
   */
  listPublic(token: string, query: DemandQuery = {}) {
    return this.client.request<MarketListingPage>(
      `/market/listings${toQuery({
        page: query.page,
        pageSize: query.pageSize,
        direction: query.direction || 'DEMAND',
        keyword: query.keyword,
        category: query.category,
        province: query.province,
        city: query.city,
        status: query.status,
      })}`,
      { token },
    );
  }
  /**
   * 修改自己发布的挂单：平台 `PATCH /market/listings/{id}` 按属主校验，
   * 入参与发布同一份报文（未给的字段由平台按已存值合并，`a2aConfig`/`serviceArea` 逐字段合并）。
   */
  async updateListing(
    token: string,
    listingId: string,
    draft: DemandDraft,
    idempotencyKey: string,
  ): Promise<MarketListing> {
    const direction = draft.direction === 'SUPPLY' ? 'SUPPLY' : 'DEMAND';
    assertDraftRules(draft, direction);
    return this.client.request<MarketListing>(
      `/market/listings/${encodeURIComponent(listingId)}`,
      {
        method: 'PATCH',
        token,
        body: { ...draft, direction },
        idempotencyKey: this.client.assertValidIdempotencyKey(idempotencyKey),
      },
    );
  }
  getMine(token: string, listingId: string) {
    return this.client.request<MarketListing>(
      `/market/listings/mine/${encodeURIComponent(listingId)}`,
      { token },
    );
  }
  getPublic(token: string, listingId: string) {
    return this.client.request<MarketListing>(
      `/market/listings/${encodeURIComponent(listingId)}`,
      { token },
    );
  }
  listConversations(token: string, query: DemandQuery = {}) {
    return this.client.request<AgentConversationPage>(
      `/market/agent-conversations${toQuery({
        page: query.page,
        pageSize: query.pageSize,
        matchRunId: query.matchRunId,
        listingId: query.listingId,
      })}`,
      { token },
    );
  }
  /**
   * 一条需求下的全部会话（＝各服务商的回复线程）。
   * 平台的 `listingId` 过滤能力尚未在正式环境实测，因此拿不到时回落按 `matchRunId`
   * 取回再本地筛，两条路都留：实测确认平台支持后即可去掉回落分支。
   *
   * `matchRunId` 可以是现成的号，也可以是一段按需解析的回调：兜底号往往要多打一次对外
   * 请求才能拿到（见 `GET /enterprise/aiworkin/demands/:listingId/conversations`），
   * 直查已经命中时不该付这笔钱。
   */
  async listConversationsForListing(
    token: string,
    listingId: string,
    matchRunId?: string | (() => Promise<string | undefined>),
    query: DemandQuery = {},
  ): Promise<AgentConversationPage> {
    const direct = await this.listConversations(token, { ...query, listingId });
    const directHits = (direct?.list || []).filter(
      (item) => !item.listingId || item.listingId === listingId,
    );
    let runId = '';
    if (!directHits.length) {
      runId =
        (typeof matchRunId === 'function' ? await matchRunId() : matchRunId) ||
        '';
    }
    if (directHits.length || !runId) {
      return {
        list: directHits,
        total: directHits.length,
        page: Number(query.page) || 1,
        pageSize: Number(query.pageSize) || directHits.length || 10,
      };
    }
    const byRun = await this.listConversations(token, {
      ...query,
      matchRunId: runId,
    });
    const list = (byRun?.list || []).filter(
      (item) => item.listingId === listingId,
    );
    return {
      list,
      total: list.length,
      page: Number(query.page) || 1,
      pageSize: Number(query.pageSize) || list.length || 10,
    };
  }
  /**
   * 一条挂单的匹配批次（平台 `GET /market/listings/{id}/match-runs`，**仅属主可读**）。
   * 会话收件箱不带 `listingId`，回复方会话只能按「本单的批次 ∩ 收件箱」定位，见 market-board。
   */
  listMatchRuns(token: string, listingId: string, pageSize = 100) {
    return this.client.request<MatchRunPage>(
      `/market/listings/${encodeURIComponent(listingId)}/match-runs${toQuery({
        page: 1,
        pageSize,
      })}`,
      { token },
    );
  }
  getConversation(token: string, conversationId: string) {
    return this.client.request<AgentConversation>(
      `/market/agent-conversations/${encodeURIComponent(conversationId)}`,
      { token },
    );
  }
  /** 下架（撤回）自己发布的挂单：平台为软删，删后属主侧与公开侧均 404。 */
  removeListing(token: string, listingId: string, idempotencyKey?: string) {
    return this.client.request<MarketListing>(
      `/market/listings/${encodeURIComponent(listingId)}`,
      {
        method: 'DELETE',
        token,
        idempotencyKey: idempotencyKey || this.client.newIdempotencyKey(),
      },
    );
  }
  /** 回复需求：仅会话属主（服务商侧）可回复，长度 1-20000。 */
  reply(
    token: string,
    conversationId: string,
    content: string,
    idempotencyKey?: string,
  ) {
    const text = String(content || '').trim();
    if (text.length < REPLY_MIN_LENGTH || text.length > REPLY_MAX_LENGTH) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `回复内容长度需在 ${REPLY_MIN_LENGTH}-${REPLY_MAX_LENGTH} 字符之间`,
      );
    }
    return this.client.request<AgentMessage>(
      `/market/agent-conversations/${encodeURIComponent(conversationId)}/replies`,
      {
        method: 'POST',
        token,
        body: { content: text },
        idempotencyKey: idempotencyKey || this.client.newIdempotencyKey(),
      },
    );
  }
}
/** 发布与修改共用的报文校验（平台的必填项在两侧一致）。 */
function assertDraftRules(draft: DemandDraft, direction: 'DEMAND' | 'SUPPLY') {
  if (!draft.title?.trim()) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写需求标题');
  }
  if (!draft.description?.trim()) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写详细说明');
  }
  if (!draft.subcategoryId) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择二级类目');
  }
  if (!draft.moneyMode) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择计价方式');
  }
  validateMoneyRule(draft);
  // 截止时间只有需求侧要求：平台对 DEMAND 发布态校验「未来截止时间」
  if (direction === 'DEMAND') validatePublishRule(draft);
  if (direction === 'SUPPLY' && draft.publishAction !== 'DRAFT') {
    if (!draft.priceDescription?.trim()) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写报价说明');
    }
    if (!draft.serviceArea?.mode) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择服务范围');
    }
  }
}
function validateMoneyRule(draft: DemandDraft) {
  if (
    draft.demandMode === 'BOUNTY' &&
    draft.moneyMode &&
    draft.moneyMode !== 'FIXED'
  ) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '悬赏需求（BOUNTY）的预算方式必须为固定价格（FIXED）',
    );
  }
  for (const amount of [draft.amountMin, draft.amountMax]) {
    if (amount != null && !Number.isSafeInteger(amount)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '预算金额必须为安全整数',
      );
    }
  }
  if (
    draft.amountMin != null &&
    draft.amountMax != null &&
    draft.amountMin > draft.amountMax
  ) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '预算下限不可大于预算上限',
    );
  }
}
function validatePublishRule(draft: DemandDraft) {
  if (draft.publishAction === 'DRAFT') return;
  if (!draft.deadline) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写截止时间');
  }
  if (Number.isNaN(Date.parse(draft.deadline))) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, '截止时间格式不正确');
  }
  if (Date.parse(draft.deadline) <= Date.now()) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '发布需求的截止时间必须晚于当前时间',
    );
  }
}
function toQuery(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value));
    }
  });
  const query = search.toString();
  return query ? `?${query}` : '';
}
