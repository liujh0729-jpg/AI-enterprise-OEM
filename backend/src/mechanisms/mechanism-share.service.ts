import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { clip, orgKey } from '../hrm/hrm.helpers';
import { json, num, slug, strArr, text } from './mechanism.shared';
import type { PageQuery, Row } from './mechanism.shared';
import { MechanismBase } from './mechanism.base';

/** 公开分享与附件共享策略。 */
export class MechanismShareService extends MechanismBase {
  private hashPassword(password: string): string {
    if (!password) return '';
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 32).toString('hex');
    return `${salt}:${hash}`;
  }

  private verifyPassword(password: string, stored: string): boolean {
    if (!stored) return true;
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const actual = scryptSync(password, salt, 32);
    const expected = Buffer.from(hash, 'hex');
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }

  private shareView(row: {
    id: number;
    slug: string;
    kind: string;
    targetId: string;
    title: string;
    enabled: boolean;
    passwordHash: string;
    expiresAt: Date;
    viewCount: number;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      slug: row.slug,
      kind: row.kind as 'REPORT' | 'PROJECT' | 'BOARD' | 'DOC',
      targetId: row.targetId,
      title: row.title,
      enabled: row.enabled,
      hasPassword: Boolean(row.passwordHash),
      expiresAt: row.expiresAt.toISOString(),
      viewCount: row.viewCount,
      url: `/share/${row.slug}`,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async listShares(user: CurrentUser, query: PageQuery & { kind?: string }) {
    const org = await this.org(user);
    const where = {
      orgType: org.orgType,
      orgUserId: org.orgUserId,
      ...(query.kind ? { kind: query.kind } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.publicShare.count({ where }),
      this.prisma.publicShare.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      list: rows.map((row) => this.shareView(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async createShare(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const policy = await this.getSharePolicy(user);
    if (!policy.allowPublic) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '资产策略已关闭公开分享',
      );
    }
    const kinds = policy.allowedKinds;
    if (kinds.length && !kinds.includes(String(body.kind))) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '该类型不在允许分享的资产范围内',
      );
    }
    const days = Math.min(
      Math.max(1, Math.trunc(num(body.expiresDays, policy.defaultExpiresDays))),
      policy.maxExpiresDays,
    );
    const password = text(body.password);
    if (policy.requirePassword && !password) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '资产策略要求分享必须设置访问密码',
      );
    }
    const row = await this.prisma.publicShare.create({
      data: {
        ...orgKey(org),
        slug: slug(),
        kind: clip(body.kind, 16),
        targetId: clip(body.targetId, 64),
        title: clip(body.title, 120),
        projection: json(body.projection || {}),
        passwordHash: this.hashPassword(password),
        expiresAt: new Date(Date.now() + days * 86_400_000),
        createdBy: user.userId,
      },
    });
    return this.shareView(row);
  }

  async updateShare(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const id = Number(body.id);
    const existing = await this.prisma.publicShare.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!existing)
      throw new BusinessException(ErrorCode.NOT_FOUND, '分享不存在');
    const data: Row = {};
    if (body.enabled !== undefined) data.enabled = Boolean(body.enabled);
    if (body.password !== undefined)
      data.passwordHash = this.hashPassword(text(body.password));
    if (body.expiresDays !== undefined) {
      data.expiresAt = new Date(
        Date.now() +
          Math.max(1, Math.trunc(num(body.expiresDays))) * 86_400_000,
      );
    }
    const row = await this.prisma.publicShare.update({ where: { id }, data });
    return this.shareView(row);
  }

  async removeShare(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const id = Number(body.id);
    const row = await this.prisma.publicShare.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '分享不存在');
    await this.prisma.publicShare.delete({ where: { id } });
    return { id };
  }

  async publicView(slugValue: string, password = '') {
    const row = await this.prisma.publicShare.findUnique({
      where: { slug: slugValue },
    });
    if (!row || !row.enabled)
      throw new BusinessException(ErrorCode.NOT_FOUND, '分享不存在或已关闭');
    if (row.expiresAt.getTime() < Date.now()) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '分享链接已过期');
    }
    // 旧分享每次打开都复核创建人的账号与组织在册资格：发起人离职/被移出后立即失效，
    // 不依赖异步清理分享记录；对外统一按「不存在」处理，不泄露失效原因。
    const creator = row.createdBy || row.orgUserId;
    const standing = await this.scope.isStanding(creator, {
      orgType: row.orgType,
      orgUserId: row.orgUserId,
    });
    if (!standing) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '分享不存在或已关闭');
    }
    if (!this.verifyPassword(password, row.passwordHash)) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED, '访问密码错误');
    }
    await this.prisma.publicShare.update({
      where: { id: row.id },
      data: { viewCount: { increment: 1 } },
    });
    let target: Row | null = null;
    if (row.kind === 'PROJECT') {
      const project = await this.prisma.pjProject.findFirst({
        where: {
          id: Number(row.targetId),
          orgType: row.orgType,
          orgUserId: row.orgUserId,
        },
      });
      if (project) {
        const [total, done] = await Promise.all([
          this.prisma.pjTask.count({ where: { projectId: project.id } }),
          this.prisma.pjTask.count({
            where: { projectId: project.id, status: 'DONE' },
          }),
        ]);
        target = {
          name: project.name,
          status: project.status,
          startDate: project.startDate,
          endDate: project.endDate,
          progress: total ? Math.round((done / total) * 100) : 0,
          taskTotal: total,
          taskDone: done,
        };
      }
    }
    return {
      slug: row.slug,
      kind: row.kind,
      title: row.title,
      targetId: row.targetId,
      projection: row.projection,
      target,
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  private policyView(row: {
    id: number;
    name: string;
    defaultExpiresDays: number;
    maxExpiresDays: number;
    requirePassword: boolean;
    allowPublic: boolean;
    allowedKinds: unknown;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      name: row.name,
      defaultExpiresDays: row.defaultExpiresDays,
      maxExpiresDays: row.maxExpiresDays,
      requirePassword: row.requirePassword,
      allowPublic: row.allowPublic,
      allowedKinds: strArr(row.allowedKinds),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async getSharePolicy(user: CurrentUser) {
    const org = await this.org(user);
    const row = await this.prisma.assetSharePolicy.findUnique({
      where: {
        orgType_orgUserId: { orgType: org.orgType, orgUserId: org.orgUserId },
      },
    });
    if (row) return this.policyView(row);
    const created = await this.prisma.assetSharePolicy.create({
      data: {
        ...orgKey(org),
        allowedKinds: ['REPORT', 'PROJECT', 'BOARD', 'DOC'],
      },
    });
    return this.policyView(created);
  }

  async saveSharePolicy(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    this.scope.requireAdmin(org);
    const data = {
      name: clip(body.name, 64) || '默认策略',
      defaultExpiresDays: Math.max(
        1,
        Math.trunc(num(body.defaultExpiresDays, 7)),
      ),
      maxExpiresDays: Math.max(1, Math.trunc(num(body.maxExpiresDays, 30))),
      requirePassword: Boolean(body.requirePassword),
      allowPublic: body.allowPublic !== false,
      allowedKinds: strArr(body.allowedKinds),
    };
    if (data.defaultExpiresDays > data.maxExpiresDays) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '默认有效期不能大于最大有效期',
      );
    }
    const row = await this.prisma.assetSharePolicy.upsert({
      where: {
        orgType_orgUserId: { orgType: org.orgType, orgUserId: org.orgUserId },
      },
      create: { ...orgKey(org), ...data },
      update: data,
    });
    return this.policyView(row);
  }
}
