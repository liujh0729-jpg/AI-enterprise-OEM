/**
 * 全站业务数据可见性（用户口径）：
 * **签约主体是服务商，具体作业由承办人完成；数据只有「做事的人」与「企业当事人」可见。**
 *
 * - 平台管理员：全量
 * - 企业当事人：本企业（或本人发起）的单据
 * - 职员/代理人：仅 `staff_user_id = 本人`（承办中的单据）
 * - 服务商账号：仅本人承办（小微＝本人即职员）或**尚未指派承办人**的单据
 *   （未指派时需服务商先指派，故可见；指派给他人后服务商账号亦不可见）
 * - 公开需求池（物流/营销无签约前置）：服务商可见待接收需求
 */
export interface VisibilityInput {
  isAdmin: boolean;
  identity: string;
  userId: string;
  enterpriseIds: number[];
  /** 物流/营销等无签约前置的业务：额外可见公开池 */
  includeOpenPool?: boolean;
  /** 模型无 created_by 列（灵活用工进件/发薪单）时置 false：企业当事人仅按 enterprise_id 判定 */
  hasCreatedBy?: boolean;
  /** 模型无 staff_user_id 列（灵活用工发薪单）时置 false：无「指派承办职员」概念，仅签约服务商本人可见可办 */
  hasStaffUserId?: boolean;
}
export function visibilityWhere(
  input: VisibilityInput,
): Record<string, unknown> | undefined {
  const {
    isAdmin,
    identity,
    userId,
    enterpriseIds,
    includeOpenPool,
    hasCreatedBy = true,
    hasStaffUserId = true,
  } = input;
  if (isAdmin) return undefined;
  if (identity === 'PROVIDER_STAFF') {
    // 无 staff 列的模型不存在「指派承办职员」，职员不承接该类单据
    return hasStaffUserId ? { staffUserId: userId } : { id: -1 };
  }
  if (identity === 'SERVICE_PROVIDER') {
    if (!hasStaffUserId) return { providerUserId: userId };
    const own = {
      providerUserId: userId,
      OR: [{ staffUserId: userId }, { staffUserId: '' }],
    };
    return includeOpenPool
      ? { OR: [own, { status: 'OPEN', providerUserId: '' }] }
      : own;
  }
  // 企业当事人
  return {
    OR: [
      { enterpriseId: { in: enterpriseIds } },
      ...(hasCreatedBy ? [{ createdBy: userId }] : []),
    ],
  };
}
