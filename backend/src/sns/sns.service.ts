import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { listMyOrgs } from '../common/org-scope';
import { text } from '../common/api';
import { CurrentUser } from '../auth/current-user';
import { IdentityService } from '../identity/identity.service';
import { PrismaService } from '../prisma/prisma.service';
import { SnsClient, type SnsNotification } from './sns.client';

type Row = Record<string, unknown>;

const TYPE_LABELS: Record<string, string> = {
  NEW_MAIL: '新私信',
  FRIEND_REQUEST: '好友申请',
  FRIEND_REQUEST_RESULT: '好友申请结果',
  CONTENT_REMOVED: '内容已下架',
};

/**
 * AIworkin 社交（SNS）私信：
 * - 发信只允许发给「我所在组织」的在职职员/代理人，避免拿员工列表当通讯录外发；
 * - 通知只读取 SNS 本站通知（主机通知由 AIworkin 自己维护），按本系统铃铛的行格式返回。
 */
export class SnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly client = new SnsClient(),
  ) {}

  private async assertTeammate(user: CurrentUser, toUserId: string) {
    if (!toUserId) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择收信人');
    }
    if (toUserId === user.userId) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '不能给自己发私信');
    }
    const orgs = await listMyOrgs(this.prisma, this.identity, user.userId);
    if (!orgs.length) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '当前账号不属于任何组织，不能给职员/代理人发私信',
      );
    }
    const staff = await this.prisma.orgStaff.findFirst({
      where: {
        memberUserId: toUserId,
        status: 'ACTIVE',
        OR: orgs.map((org) => ({
          orgType: org.orgType,
          orgUserId: org.orgUserId,
        })),
      },
      select: { id: true },
    });
    const legacy = staff
      ? null
      : await this.prisma.providerStaff.findFirst({
          where: {
            staffUserId: toUserId,
            status: 'ACTIVE',
            providerUserId: {
              in: orgs
                .filter((org) => org.orgType === 'PROVIDER')
                .map((org) => org.orgUserId),
            },
          },
          select: { id: true },
        });
    if (!staff && !legacy) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '只能给本组织的职员/代理人发私信',
      );
    }
  }

  async send(user: CurrentUser, body: Row) {
    const toUserId = text(body.toUserId).trim();
    await this.assertTeammate(user, toUserId);
    const subject = text(body.subject).trim().slice(0, 200);
    const content = text(body.body).trim();
    if (!content) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写私信正文');
    }
    const message = await this.client.sendMail(user.userId, {
      toUserId,
      subject,
      body: content,
    });
    await this.identity.audit(
      user.userId,
      'AIworkin 社交发私信',
      `${toUserId}${subject ? ` · ${subject}` : ''}`,
    );
    return {
      messageId: Number(message?.id || 0),
      toUserId,
      subject,
    };
  }

  /** SNS 本站通知 → 本系统铃铛行；主机通知不在这里取，避免与平台通知重复。 */
  private view(row: SnsNotification) {
    const payload = (row.payload || {}) as Row;
    const person = row.person?.displayName || '';
    const label = TYPE_LABELS[row.type] || row.type;
    const subject = text(payload.subject).trim();
    const reason = text(
      payload.reason || payload.summary || payload.message,
    ).trim();
    const accepted = payload.accepted === true;
    const title =
      row.type === 'NEW_MAIL'
        ? `${person || '同事'} 给你发了私信`
        : row.type === 'FRIEND_REQUEST'
          ? `${person || '同事'} 申请加你好友`
          : row.type === 'FRIEND_REQUEST_RESULT'
            ? `好友申请${accepted ? '已通过' : '未通过'}`
            : label;
    const bodyText =
      row.type === 'NEW_MAIL'
        ? subject
        : row.type === 'FRIEND_REQUEST_RESULT'
          ? person
          : reason;
    const link = this.client.webUrl
      ? row.type === 'NEW_MAIL'
        ? `${this.client.webUrl}/mail`
        : `${this.client.webUrl}/network`
      : '';
    return {
      id: 0,
      category: 'sns',
      categoryLabel: 'AIworkin 社交',
      level: 'info',
      title: title.slice(0, 200),
      body: bodyText.slice(0, 500),
      link,
      entityType: `sns_${row.type}`.slice(0, 32),
      entityId: String(row.id).slice(0, 64),
      read: Boolean(row.read),
      createdAt: row.createdAt,
      source: 'sns',
      externalId: String(row.id),
    };
  }

  async notifications(userId: string) {
    const data = await this.client.notifications(userId);
    const rows = (data?.rows || [])
      .filter((row) => (row.source || 'local') === 'local')
      .map((row) => this.view(row))
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    return {
      rows,
      unread: rows.filter((row) => !row.read).length,
    };
  }

  async read(userId: string, id: string) {
    const externalId = String(id || '').trim();
    if (!/^\d+$/.test(externalId)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '通知编号无效');
    }
    await this.client.read(userId, externalId);
    return { id: externalId, read: true };
  }

  async readAll(userId: string) {
    return this.client.readAll(userId);
  }
}
