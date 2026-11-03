import { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
/**
 * 需求单据的共享判权（七板块通用）。
 *
 * 只上提**判定序列**：单据模型仍由各模块自己加载，公开池可接单判定与「发言」文案
 * 仍由各模块自己给，故各板块的判权语义与提示语一字不变。
 */
export type DemandAccessRow = {
  createdBy: string;
  enterpriseId: number | null;
  status: string;
  providerUserId: string;
  staffUserId?: string;
};
export type DemandAccessDeps = {
  prisma: PrismaService;
  identity: IdentityService;
  /** 公开需求池可接单判定：营销＝服务商角色，物流/IT服务＝备案类目，资产＝已发布服务 */
  poolEligible?: (user: CurrentUser) => Promise<boolean>;
};
/** 数据可见性口径（全站统一文案）：只有承办人与企业当事人可见。 */
export const DEMAND_VISIBLE_DENIED = '数据仅对承办人与企业当事人可见';
/**
 * 单据可达性：平台管理员 / 需求当事人 / 承办人（服务商账号或承办职员）。
 * allowPool：可接单的服务商可读公开需求池需求的消息（回复即接单，先读后写）。
 */
export async function requireDemandAccess<Row extends DemandAccessRow>(
  deps: DemandAccessDeps,
  notFoundLabel: string,
  user: CurrentUser,
  row: Row | null,
  allowPool = false,
): Promise<Row> {
  if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, notFoundLabel);
  const { prisma, identity } = deps;
  if (identity.isPlatformAdmin(user)) return row;
  if (row.createdBy === user.userId) return row;
  if (await identity.canWorkOn(user, row)) return row;
  const enterprise = row.enterpriseId
    ? await prisma.enterpriseProfile.findUnique({
        where: { id: row.enterpriseId },
      })
    : null;
  if (enterprise?.userId === user.userId) return row;
  if (
    allowPool &&
    row.status === 'OPEN' &&
    !row.providerUserId &&
    deps.poolEligible &&
    (await deps.poolEligible(user))
  ) {
    return row;
  }
  throw new BusinessException(ErrorCode.ROLE_MISMATCH, DEMAND_VISIBLE_DENIED);
}
/** 编辑/删除前置：创建人或平台管理员（服务商不可改企业填写的需求内容）。 */
export function isDemandOwner(
  user: CurrentUser,
  row: {
    createdBy: string;
  },
  isAdmin: boolean,
) {
  return isAdmin || row.createdBy === user.userId;
}
/**
 * 企业侧需求可达性（法律/知产/灵活用工口径）：平台管理员 / 承办人（服务商账号或
 * 承办职员）/ 企业当事人。管理员在 `canWorkOn` 内已放行，故不再单列。
 * allowCreator：灵工的发起人本人（不一定是企业档案归属账号）。
 */
export async function requireEnterpriseDemandAccess<
  Row extends {
    enterpriseId: number;
    createdBy?: string;
    providerUserId?: string;
    staffUserId?: string;
  },
>(
  deps: {
    identity: IdentityService;
  },
  user: CurrentUser,
  row: Row,
  options: {
    allowCreator?: boolean;
  } = {},
): Promise<Row> {
  if (await deps.identity.canWorkOn(user, row)) return row;
  if (options.allowCreator && row.createdBy === user.userId) return row;
  const eps = await deps.identity.myEnterprises(user.userId);
  if (eps.some((item) => item.id === row.enterpriseId)) return row;
  throw new BusinessException(ErrorCode.ROLE_MISMATCH, DEMAND_VISIBLE_DENIED);
}
/** 需求消息的发言侧：需求方＝ENTERPRISE，承办方＝PROVIDER（即消息角色）。 */
export type DemandSpeaker = {
  side: 'ENTERPRISE' | 'PROVIDER';
  /** 需求企业档案（非企业当事人或无档案时为 null） */
  enterprise: {
    name: string;
    userId: string;
  } | null;
};
/**
 * 发言方判定：企业当事人/发起人＝需求侧，其余按**承办人**判定（承办职员发言属于
 * 服务侧，服务商账号未承办时不代替作业）。两侧都不是时返回 null，由调用方给出
 * 本板块的文案。
 */
export async function resolveDemandSpeaker(
  deps: {
    prisma: PrismaService;
    identity: IdentityService;
  },
  user: CurrentUser,
  row: {
    createdBy: string;
    enterpriseId: number | null;
    providerUserId?: string;
    staffUserId?: string;
  },
): Promise<DemandSpeaker | null> {
  const enterprise = row.enterpriseId
    ? await deps.prisma.enterpriseProfile.findUnique({
        where: { id: row.enterpriseId },
      })
    : null;
  if (enterprise?.userId === user.userId || row.createdBy === user.userId) {
    return { side: 'ENTERPRISE', enterprise };
  }
  if (await deps.identity.canWorkOn(user, row)) {
    return { side: 'PROVIDER', enterprise };
  }
  return null;
}
