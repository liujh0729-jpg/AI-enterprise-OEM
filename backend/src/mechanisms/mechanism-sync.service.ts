import type { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { clip, orgKey } from '../hrm/hrm.helpers';
import type { HrmOrg } from '../hrm/hrm.scope';
import type { Row } from './mechanism.shared';
import { MechanismBase } from './mechanism.base';

/** 飞书 / 企微通讯录、考勤与消息同步。 */
export class MechanismSyncService extends MechanismBase {
  private bindingView(row: {
    id: number;
    channel: string;
    domain: string;
    externalId: string;
    principalType: string;
    localId: string;
    label: string;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      channel: row.channel as 'FEISHU' | 'WECOM',
      domain: row.domain as 'CONTACT' | 'ATTENDANCE' | 'APPROVAL' | 'MESSAGE',
      externalId: row.externalId,
      principalType: row.principalType,
      localId: row.localId,
      label: row.label,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async listBindings(
    user: CurrentUser,
    query: { channel?: string; domain?: string },
  ) {
    const org = await this.org(user);
    const rows = await this.prisma.hrmSyncBinding.findMany({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        ...(query.channel ? { channel: query.channel } : {}),
        ...(query.domain ? { domain: query.domain } : {}),
      },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => this.bindingView(row));
  }

  async saveBinding(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    this.scope.requireAdmin(org);
    const data = {
      channel: String(body.channel),
      domain: String(body.domain),
      externalId: clip(body.externalId, 128),
      principalType: clip(body.principalType, 24) || 'STAFF',
      localId: clip(body.localId, 64),
      label: clip(body.label, 120),
    };
    const id = Number(body.id ?? 0);
    const row = id
      ? await this.prisma.hrmSyncBinding.update({ where: { id }, data })
      : await this.prisma.hrmSyncBinding.upsert({
          where: {
            orgType_orgUserId_channel_domain_externalId: {
              orgType: org.orgType,
              orgUserId: org.orgUserId,
              channel: data.channel,
              domain: data.domain,
              externalId: data.externalId,
            },
          },
          create: { ...orgKey(org), ...data, createdBy: user.userId },
          update: data,
        });
    return this.bindingView(row);
  }

  async removeBinding(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    this.scope.requireAdmin(org);
    const id = Number(body.id);
    const row = await this.prisma.hrmSyncBinding.findFirst({
      where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '绑定不存在');
    await this.prisma.hrmSyncBinding.delete({ where: { id } });
    return { id };
  }

  async syncOverview(user: CurrentUser) {
    const org = await this.org(user);
    const rows = await this.prisma.hrmSyncBinding.findMany({
      where: { orgType: org.orgType, orgUserId: org.orgUserId },
    });
    const connectors = await this.prisma.imConnector.findMany({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        status: 'active',
      },
      select: { provider: true },
    });
    const byChannel: Record<string, number> = {};
    const byDomain: Record<string, number> = {};
    for (const row of rows) {
      byChannel[row.channel] = (byChannel[row.channel] || 0) + 1;
      byDomain[row.domain] = (byDomain[row.domain] || 0) + 1;
    }
    return {
      bindings: rows.length,
      byChannel,
      byDomain,
      lastSyncAt: rows.length
        ? rows
            .map((row) => row.createdAt)
            .sort((a, b) => b.getTime() - a.getTime())[0]
            .toISOString()
        : '',
      feishuConfigured: connectors.some((row) => row.provider === 'FEISHU'),
      wecomConfigured: connectors.some((row) => row.provider === 'WECOM'),
    };
  }

  private async connectors(org: HrmOrg, channel: string) {
    return this.prisma.imConnector.findMany({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        provider: channel,
        status: 'active',
      },
    });
  }

  private connectorSecrets(row: {
    appId: string;
    appSecretEnc: string;
    corpId: string;
    contactSecretEnc: string;
    agentId: string;
  }) {
    return {
      appId: row.appId,
      appSecret: this.imCrypto.decrypt(row.appSecretEnc),
      corpId: row.corpId,
      contactSecret: this.imCrypto.decrypt(row.contactSecretEnc),
      agentId: row.agentId,
    };
  }

  async runContacts(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    this.scope.requireAdmin(org);
    const channel = String(body.channel);
    const dryRun = body.dryRun === true;
    const connectors = await this.connectors(org, channel);
    if (!connectors.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `尚未配置${channel === 'FEISHU' ? '飞书' : '企业微信'}连接器`,
      );
    }
    const ids = connectors.map((row) => row.id);
    const links = await this.prisma.imMemberLink.findMany({
      where: {
        connectorId: { in: ids },
        memberUserId: { not: '' },
        status: 'LINKED',
      },
    });
    let created = 0;
    let updated = 0;
    let skipped = 0;
    for (const link of links) {
      if (!link.externalUserId) {
        skipped += 1;
        continue;
      }
      const existing = await this.prisma.hrmSyncBinding.findUnique({
        where: {
          orgType_orgUserId_channel_domain_externalId: {
            orgType: org.orgType,
            orgUserId: org.orgUserId,
            channel,
            domain: 'CONTACT',
            externalId: link.externalUserId,
          },
        },
      });
      if (!dryRun) {
        const row = await this.prisma.hrmSyncBinding.upsert({
          where: {
            orgType_orgUserId_channel_domain_externalId: {
              orgType: org.orgType,
              orgUserId: org.orgUserId,
              channel,
              domain: 'CONTACT',
              externalId: link.externalUserId,
            },
          },
          create: {
            ...orgKey(org),
            channel,
            domain: 'CONTACT',
            externalId: link.externalUserId,
            principalType: 'STAFF',
            localId: link.memberUserId,
            label: link.nameSnapshot,
            createdBy: user.userId,
          },
          update: { localId: link.memberUserId, label: link.nameSnapshot },
        });
        void row;
      }
      if (existing) updated += 1;
      else created += 1;
    }
    return {
      channel,
      domain: 'CONTACT',
      processed: links.length,
      created,
      updated,
      skipped,
      errors: [],
    };
  }

  async runAttendance(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    this.scope.requireAdmin(org);
    const channel = String(body.channel);
    const startDate = String(body.startDate);
    const endDate = String(body.endDate);
    const from = Math.floor(
      new Date(`${startDate}T00:00:00Z`).getTime() / 1000,
    );
    const to = Math.floor(new Date(`${endDate}T23:59:59Z`).getTime() / 1000);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '考勤日期区间无效');
    }
    const connectors = await this.connectors(org, channel);
    if (!connectors.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `尚未配置${channel === 'FEISHU' ? '飞书' : '企业微信'}连接器`,
      );
    }
    const bindings = await this.prisma.hrmSyncBinding.findMany({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        channel,
        domain: 'CONTACT',
      },
    });
    if (!bindings.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请先执行联系人同步，建立外部账号与本地成员绑定',
      );
    }
    const localByExternal = new Map(
      bindings.map((row) => [row.externalId, row.localId]),
    );
    const punches: { externalId: string; at: Date }[] = [];
    const errors: string[] = [];
    for (const connector of connectors) {
      const secrets = this.connectorSecrets(connector);
      try {
        const externalIds = bindings.map((row) => row.externalId);
        if (channel === 'FEISHU') {
          const token = await this.feishu.tenantToken(
            secrets.appId,
            secrets.appSecret,
          );
          for (let i = 0; i < externalIds.length; i += 100) {
            const flows = await this.feishu.attendanceFlows(
              token,
              externalIds.slice(i, i + 100),
              from,
              to,
            );
            punches.push(
              ...flows.map((item) => ({
                externalId: item.externalUserId,
                at: new Date(item.checkTime),
              })),
            );
          }
        } else {
          const token = await this.wecom.token(
            secrets.corpId,
            secrets.contactSecret || secrets.appSecret,
          );
          for (let i = 0; i < externalIds.length; i += 100) {
            const records = await this.wecom.checkinRecords(
              token,
              externalIds.slice(i, i + 100),
              from,
              to,
            );
            punches.push(
              ...records.map((item) => ({
                externalId: item.externalUserId,
                at: new Date(item.checkTime),
              })),
            );
          }
        }
      } catch (error) {
        errors.push(
          clip(error instanceof Error ? error.message : '考勤拉取失败', 300),
        );
      }
    }
    const grouped = new Map<string, Date[]>();
    let skipped = 0;
    for (const punch of punches) {
      const localId = localByExternal.get(punch.externalId);
      if (!localId) {
        skipped += 1;
        continue;
      }
      const day = punch.at.toISOString().slice(0, 10);
      const key = `${localId}|${day}`;
      const list = grouped.get(key) || [];
      list.push(punch.at);
      grouped.set(key, list);
    }
    let created = 0;
    let updated = 0;
    for (const [key, times] of grouped) {
      const [localId, day] = key.split('|');
      times.sort((a, b) => a.getTime() - b.getTime());
      const minutes = Math.max(
        0,
        Math.round(
          (times[times.length - 1].getTime() - times[0].getTime()) / 60_000,
        ),
      );
      const existing = await this.prisma.pjTimeLog.findFirst({
        where: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          principalType: 'STAFF',
          principalId: localId,
          workDate: day,
          source: channel,
          projectId: 0,
        },
      });
      if (existing) {
        await this.prisma.pjTimeLog.update({
          where: { id: existing.id },
          data: {
            durationMinutes: minutes,
            startAt: times[0].toISOString(),
            endAt: times[times.length - 1].toISOString(),
          },
        });
        updated += 1;
      } else {
        await this.prisma.pjTimeLog.create({
          data: {
            ...orgKey(org),
            projectId: 0,
            taskId: 0,
            principalType: 'STAFF',
            principalId: localId,
            workDate: day,
            startAt: times[0].toISOString(),
            endAt: times[times.length - 1].toISOString(),
            durationMinutes: minutes,
            source: channel,
            status: 'DRAFT',
            createdBy: org.actorId,
          },
        });
        created += 1;
      }
    }
    return {
      channel,
      domain: 'ATTENDANCE',
      processed: punches.length,
      created,
      updated,
      skipped,
      errors,
    };
  }

  async sendMessage(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const channel = String(body.channel);
    const connectors = await this.connectors(org, channel);
    if (!connectors.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `尚未配置${channel === 'FEISHU' ? '飞书' : '企业微信'}连接器`,
      );
    }
    const connector = connectors[0];
    const secrets = this.connectorSecrets(connector);
    const to = String(body.to);
    const title = clip(body.title, 120);
    const content = clip(body.content, 2000);
    const link = clip(body.link, 500);
    if (channel === 'FEISHU') {
      const token = await this.feishu.tenantToken(
        secrets.appId,
        secrets.appSecret,
      );
      await this.feishu.sendCard(token, 'open_id', to, title, content, link);
    } else {
      const token = await this.wecom.token(secrets.corpId, secrets.appSecret);
      await this.wecom.sendTextCard(
        token,
        secrets.agentId,
        to,
        title,
        content,
        link,
      );
    }
    return { ok: true, message: '消息已发送' };
  }
}
