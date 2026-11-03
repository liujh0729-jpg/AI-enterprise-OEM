import { Prisma } from '../../generated/prisma';
import { LIST_ALL_LIMIT, text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { maskKey } from '../rpa/rpa-crypto';
import { wbDescribeAgentList, type WbCreds } from './workbuddy-client';
import { WorkbuddyCrypto } from './workbuddy-crypto';
import {
  ACCOUNT_STATUSES,
  normalizeChoice,
  normalizeRegion,
  shorten,
} from './workbuddy-shared';

/**
 * 用户自带的腾讯云凭据（Workbuddy 企业云是 SaaS，谁绑的 key 就看谁企业的 Agent）。
 * 一个用户可绑多条：同一份计划把指令铺给多把 key 并行跑，用来加速。
 * SecretKey 只以密文落库，只有派发执行与连通性校验这两条链路会解密。
 */
export class WorkbuddyAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly crypto: WorkbuddyCrypto,
  ) {}

  async list(user: CurrentUser) {
    const rows = await this.prisma.workbuddyAccount.findMany({
      where: { createdBy: user.userId },
      orderBy: { updatedAt: 'desc' },
      // 界面侧没有分页参数：一次读取封顶（与 pageQuery 上限一致）
      take: LIST_ALL_LIMIT + 1,
    });
    const truncated = rows.length > LIST_ALL_LIMIT;
    const visible = truncated ? rows.slice(0, LIST_ALL_LIMIT) : rows;
    return visible.map((row) => this.decorate(row));
  }

  async create(user: CurrentUser, body: Record<string, unknown>) {
    const name = text(body.name).trim().slice(0, 128);
    if (!name) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请给这把腾讯云凭据起个名字（如「主账号」「A 组加速」）',
      );
    }
    const secretId = text(body.secretId).trim();
    const secretKey = text(body.secretKey).trim();
    if (!secretId || !secretKey) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写腾讯云 SecretId 与 SecretKey（控制台「访问管理 · API 密钥管理」获取）',
      );
    }
    const row = await this.prisma.workbuddyAccount.create({
      data: {
        createdBy: user.userId,
        name,
        secretIdCipher: this.crypto.encrypt(secretId),
        secretKeyCipher: this.crypto.encrypt(secretKey),
        region: normalizeRegion(body.region),
        status: normalizeChoice(
          body.status,
          ACCOUNT_STATUSES,
          '凭据状态',
          'active',
        ),
        notes: text(body.notes).trim().slice(0, 500),
      },
    });
    await this.identity.audit(
      user.userId,
      'Workbuddy绑定凭据',
      `#${row.id} ${row.name}（SecretId ${maskKey(secretId)}）`,
    );
    return this.decorate(row);
  }

  async update(user: CurrentUser, id: number, body: Record<string, unknown>) {
    const row = await this.loadOwned(user, id);
    const data: Prisma.WorkbuddyAccountUpdateInput = {};
    if (body.name !== undefined) {
      const name = text(body.name).trim().slice(0, 128);
      if (!name) {
        throw new BusinessException(ErrorCode.BAD_REQUEST, '名称不能为空');
      }
      data.name = name;
    }
    const secretId = text(body.secretId).trim();
    if (secretId) data.secretIdCipher = this.crypto.encrypt(secretId);
    const secretKey = text(body.secretKey).trim();
    if (secretKey) data.secretKeyCipher = this.crypto.encrypt(secretKey);
    if (body.region !== undefined) data.region = normalizeRegion(body.region);
    if (body.status !== undefined) {
      data.status = normalizeChoice(
        body.status,
        ACCOUNT_STATUSES,
        '凭据状态',
        row.status,
      );
    }
    if (body.notes !== undefined) {
      data.notes = text(body.notes).trim().slice(0, 500);
    }
    if (!Object.keys(data).length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '没有需要保存的修改');
    }
    const saved = await this.prisma.workbuddyAccount.update({
      where: { id },
      data,
    });
    await this.identity.audit(
      user.userId,
      'Workbuddy修改凭据',
      `#${id} ${saved.name}`,
    );
    return this.decorate(saved);
  }

  async remove(user: CurrentUser, id: number) {
    const row = await this.loadOwned(user, id);
    const bound = await this.prisma.workbuddyTask.findMany({
      where: { accountId: id, status: { in: ['pending', 'running'] } },
      select: { id: true, planId: true },
    });
    if (bound.length) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        `这把凭据上还挂着 ${bound.length} 个未跑完的任务，请先取消或等它们结束`,
      );
    }
    const aiCallBound = await this.prisma.aiCallAccountBinding.count({
      where: { workbuddyAccountId: id },
    });
    if (aiCallBound) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        `这把凭据还绑定着 ${aiCallBound} 个 AI 调用账号，请先在「AI 调用账号」里解绑`,
      );
    }
    await this.prisma.workbuddyAccount.delete({ where: { id } });
    await this.identity.audit(
      user.userId,
      'Workbuddy删除凭据',
      `#${id} ${row.name}`,
    );
    return { id };
  }

  /** 连通性校验：真打一次 DescribeAgentList，通了就记下时间并清空失败原因。 */
  async verify(user: CurrentUser, id: number) {
    const row = await this.loadOwned(user, id);
    const creds = this.creds(row);
    try {
      const result = await wbDescribeAgentList(creds, { limit: 1 });
      const saved = await this.prisma.workbuddyAccount.update({
        where: { id },
        data: { lastVerifiedAt: new Date(), lastError: '' },
      });
      await this.identity.audit(
        user.userId,
        'Workbuddy校验凭据',
        `#${id} ${row.name} 通过（可见 Agent ${Number(result.TotalCount || 0)} 个）`,
      );
      return {
        ok: true,
        agentTotal: Number(result.TotalCount || 0),
        account: this.decorate(saved),
      };
    } catch (error) {
      const message =
        error instanceof BusinessException
          ? error.message
          : (error as Error)?.message || '未知异常';
      await this.prisma.workbuddyAccount.update({
        where: { id },
        data: { lastError: shorten(message) },
      });
      throw error;
    }
  }

  /** 界面可见性收口：只认本人的凭据（密钥即权限，管理员也不代看他人密钥）。 */
  async loadOwned(user: CurrentUser, id: number) {
    const row = await this.prisma.workbuddyAccount.findUnique({
      where: { id },
    });
    if (!row) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '这把 Workbuddy 凭据不存在',
      );
    }
    if (row.createdBy !== user.userId) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '该 Workbuddy 凭据归他人所有',
      );
    }
    return row;
  }

  /** 解密成签名要用的三元组；调用方只在出站请求里用，绝不回传前端。 */
  creds(row: {
    secretIdCipher: string;
    secretKeyCipher: string;
    region: string;
  }): WbCreds {
    return {
      secretId: this.crypto.decrypt(row.secretIdCipher),
      secretKey: this.crypto.decrypt(row.secretKeyCipher),
      region: row.region,
    };
  }

  /** 取本人某把凭据的签名参数；停用的不参与派发。 */
  async credsOf(user: CurrentUser, id: number) {
    const row = await this.loadOwned(user, id);
    if (row.status !== 'active') {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `凭据「${row.name}」已停用，请先在「Workbuddy Enterprise 账号」里启用`,
      );
    }
    return { row, creds: this.creds(row) };
  }

  private decorate(row: {
    id: number;
    createdBy: string;
    name: string;
    secretIdCipher: string;
    secretKeyCipher: string;
    region: string;
    status: string;
    lastVerifiedAt: Date | null;
    lastError: string;
    notes: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      createdBy: row.createdBy,
      name: row.name,
      region: row.region,
      status: row.status,
      lastVerifiedAt: row.lastVerifiedAt,
      lastError: row.lastError,
      notes: row.notes,
      secretIdMasked: maskKey(this.crypto.decrypt(row.secretIdCipher)),
      hasSecretKey: Boolean(row.secretKeyCipher),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
