import type { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { pageOf } from '../common/api';
import type { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma';
import type { HrmOrg } from '../hrm/hrm.scope';
import { clip, iso } from '../hrm/hrm.helpers';
import { ScrmClient } from './scrm.client';
import { ScrmScopeService, type ScrmSecrets } from './scrm.scope';
import { ScrmMaterialService } from './scrm-material.service';
import { ScrmComplianceService } from './scrm-compliance';
import {
  addTimeline,
  dayKey,
  dayStart,
  int,
  intArr,
  json,
  nameOf,
  orgKey,
  orgOf,
  safePage,
  text,
} from './scrm.helpers';

/**
 * 活码与欢迎语。
 *
 * - 活码成员在企微侧维护；某人达到当日上限（或活码总量达到上限）时，
 *   调 update_contact_way 把该成员从引流名单摘掉；无人可接时停用活码并删除企微配置。
 * - 欢迎语必须用回调里的 WelcomeCode（20 秒有效）发送，失败重试 3 次后放弃并留痕，
 *   不承诺必达，也不把失败说成已发送。
 * - 自动打标只开放「新客户」「活码来源」两类事件；关键词/群事件需要会话存档，首期不伪造。
 */

const WELCOME_RETRIES = 3;

export class ScrmCodeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScrmScopeService,
    private readonly client: ScrmClient,
    private readonly materials: ScrmMaterialService,
    private readonly compliance: ScrmComplianceService,
  ) {}

  private async tagNames(org: HrmOrg, ids: number[]): Promise<string[]> {
    if (!ids.length) return [];
    const rows = await this.prisma.scrmTag.findMany({
      where: { ...orgKey(org), id: { in: ids } },
      select: { name: true },
    });
    return rows.map((row) => row.name);
  }

  private async codeStaff(org: HrmOrg, codeIds: number[]) {
    if (!codeIds.length) return [];
    return this.prisma.scrmCodeStaff.findMany({
      where: { ...orgKey(org), codeId: { in: codeIds } },
      orderBy: { id: 'asc' },
    });
  }

  private async codeViews(
    org: HrmOrg,
    rows: {
      id: number;
      name: string;
      groupName: string;
      configId: string;
      qrUrl: string;
      scene: string;
      tagIds: unknown;
      welcomeId: number;
      staffStrategy: string;
      dailyLimit: number;
      status: string;
      scanned: number;
      added: number;
      createdAt: Date;
    }[],
  ) {
    const staff = await this.codeStaff(
      org,
      rows.map((row) => row.id),
    );
    const names = await this.scope.names([
      ...new Set(staff.map((row) => row.staffUserId)),
    ]);
    return Promise.all(
      rows.map(async (row) => {
        const tagIds = intArr(row.tagIds);
        return {
          id: row.id,
          name: row.name,
          groupName: row.groupName,
          configId: row.configId,
          qrUrl: row.qrUrl,
          scene: row.scene,
          tagIds,
          tagNames: await this.tagNames(org, tagIds),
          welcomeId: row.welcomeId,
          staffStrategy: row.staffStrategy,
          dailyLimit: row.dailyLimit,
          status: row.status,
          scanned: row.scanned,
          added: row.added,
          staff: staff
            .filter((item) => item.codeId === row.id)
            .map((item) => ({
              staffUserId: item.staffUserId,
              name: nameOf(names, item.staffUserId),
              weight: item.weight,
              dailyLimit: item.dailyLimit,
              usedToday: item.usedToday,
            })),
          createdAt: iso(row.createdAt),
        };
      }),
    );
  }

  async codes(user: CurrentUser, query: Record<string, unknown>) {
    const org = await this.scope.resolve(user);
    const { page, pageSize, offset } = safePage(query.page, query.pageSize, 20);
    const where: Prisma.ScrmCodeWhereInput = { ...orgKey(org) };
    const keyword = clip(query.keyword, 100).trim();
    if (keyword) where.name = { contains: keyword };
    const [rows, total] = await Promise.all([
      this.prisma.scrmCode.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: offset,
        take: pageSize,
      }),
      this.prisma.scrmCode.count({ where }),
    ]);
    return pageOf(await this.codeViews(org, rows), total, page, pageSize);
  }

  /** 保存活码：新建时调 add_contact_way 生成二维码；改成员时同步企微。 */
  async saveCode(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.scope.requireAdmin(user);
    const id = int(body.id);
    const name = clip(body.name, 60).trim();
    if (!name) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写活码名称');
    }
    const staffInput = Array.isArray(body.staff)
      ? (body.staff as Record<string, unknown>[])
      : [];
    if (!staffInput.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请至少选择一位引流成员',
      );
    }
    const memberIds: string[] = [];
    for (const item of staffInput) {
      memberIds.push(
        await this.scope.requireMember(org, text(item.staffUserId)),
      );
    }
    const { corp, secrets } = await this.scope.requireCorp(org);
    const staffLinks = await this.scope.staffLinks(org);
    const wecomOf = (memberId: string) =>
      [...staffLinks.entries()].find(
        ([, member]) => member === memberId,
      )?.[0] || '';
    const wecomIds = memberIds.map((memberId) => wecomOf(memberId));
    const unmapped = memberIds.filter((_, index) => !wecomIds[index]);
    if (unmapped.length) {
      const names = await this.scope.names(unmapped);
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `以下成员尚未绑定企业微信账号，请先在「IM 连接器」完成成员映射：${unmapped
          .map((memberId) => nameOf(names, memberId))
          .join('、')}`,
      );
    }
    const tagIds = intArr(body.tagIds);
    if (tagIds.length) {
      const count = await this.prisma.scrmTag.count({
        where: { ...orgKey(org), id: { in: tagIds }, deleted: false },
      });
      if (count !== tagIds.length) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '部分标签不存在或已删除',
        );
      }
    }
    const existing = id
      ? await this.prisma.scrmCode.findFirst({ where: { ...orgKey(org), id } })
      : null;
    if (id && !existing) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '活码不存在');
    }
    const scene =
      clip(body.scene, 40) ||
      existing?.scene ||
      `scrm${Date.now().toString(36)}`;
    const data = {
      name,
      groupName: clip(body.groupName, 40),
      scene,
      tagIds: json(tagIds),
      welcomeId: int(body.welcomeId),
      staffStrategy: text(body.staffStrategy) || 'ROUND_ROBIN',
      dailyLimit: int(body.dailyLimit),
    };
    let configId = existing?.configId || '';
    let qrUrl = existing?.qrUrl || '';
    if (!configId) {
      const created = await this.client.addContactWay(
        corp.corpId,
        secrets.contactSecret,
        {
          type: 2,
          scene: 1,
          style: 1,
          skip_verify: true,
          state: scene,
          user: wecomIds.slice(0, 100),
        },
      );
      configId = created.configId;
      qrUrl = created.qrCode;
      if (!configId) {
        throw new BusinessException(
          ErrorCode.SERVICE_UNAVAILABLE,
          '企微未返回活码配置，请稍后重试',
        );
      }
    } else {
      try {
        await this.client.updateContactWay(
          corp.corpId,
          secrets.contactSecret,
          configId,
          wecomIds.slice(0, 100),
        );
        const refreshed = await this.client.getContactWay(
          corp.corpId,
          secrets.contactSecret,
          configId,
        );
        if (refreshed.qrCode) qrUrl = refreshed.qrCode;
      } catch (error) {
        throw new BusinessException(
          ErrorCode.SERVICE_UNAVAILABLE,
          `更新企微活码失败：${error instanceof Error ? error.message : '请稍后重试'}`,
        );
      }
    }
    const saved = existing
      ? await this.prisma.scrmCode.update({
          where: { id: existing.id },
          data: { ...data, configId, qrUrl, status: 'ACTIVE' },
        })
      : await this.prisma.scrmCode.create({
          data: {
            ...orgKey(org),
            ...data,
            configId,
            qrUrl,
            status: 'ACTIVE',
            createdBy: user.userId,
          },
        });
    const existingStaff = new Map(
      (await this.codeStaff(org, [saved.id])).map((row) => [
        row.staffUserId,
        row,
      ]),
    );
    await this.prisma.$transaction([
      this.prisma.scrmCodeStaff.deleteMany({
        where: { ...orgKey(org), codeId: saved.id },
      }),
      this.prisma.scrmCodeStaff.createMany({
        data: staffInput.map((item, index) => {
          const staffUserId = memberIds[index];
          const previous = existingStaff.get(staffUserId);
          return {
            ...orgKey(org),
            codeId: saved.id,
            staffUserId,
            weight: Math.max(1, int(item.weight, 1)),
            dailyLimit: Math.max(0, int(item.dailyLimit)),
            usedToday:
              previous && previous.usedDate === dayKey()
                ? previous.usedToday
                : 0,
            usedDate: dayKey(),
          };
        }),
      }),
    ]);
    const [view] = await this.codeViews(org, [saved]);
    return view;
  }

  async removeCode(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.scope.requireAdmin(user);
    const id = int(body.id);
    const code = await this.prisma.scrmCode.findFirst({
      where: { ...orgKey(org), id },
    });
    if (!code) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '活码不存在');
    }
    if (code.configId) {
      const corp = await this.scope.corp(org);
      if (corp?.enabled) {
        try {
          const secrets = this.scope.secretsOf(corp);
          await this.client.delContactWay(
            corp.corpId,
            secrets.contactSecret,
            code.configId,
          );
        } catch {
          // 企微侧已删/无权限时仍允许删除本地记录
        }
      }
    }
    await this.prisma.$transaction([
      this.prisma.scrmCodeStaff.deleteMany({
        where: { ...orgKey(org), codeId: code.id },
      }),
      this.prisma.scrmCode.delete({ where: { id: code.id } }),
    ]);
    return { id: code.id };
  }

  /** 活码统计：累计扫码 + 指定周期内新增客户。 */
  async codeStats(user: CurrentUser, query: Record<string, unknown>) {
    const org = await this.scope.resolve(user);
    const days = Math.max(1, Math.min(int(query.days, 30) || 30, 90));
    const from = dayStart(
      dayKey(new Date(Date.now() - (days - 1) * 86_400_000)),
    );
    const codes = await this.prisma.scrmCode.findMany({
      where: orgKey(org),
      orderBy: { id: 'desc' },
      take: 200,
    });
    if (!codes.length) return [];
    const counts = await this.prisma.scrmContact.groupBy({
      by: ['sourceCodeId'],
      where: {
        ...orgKey(org),
        sourceCodeId: { in: codes.map((code) => code.id) },
        addedAt: { gte: from },
      },
      _count: { _all: true },
    });
    const addedBy = new Map(
      counts.map((row) => [row.sourceCodeId, row._count._all]),
    );
    return codes.map((code) => ({
      codeId: code.id,
      name: code.name,
      scanned: code.scanned,
      added: addedBy.get(code.id) || 0,
    }));
  }

  // ---------- 欢迎语 ----------

  private welcomeView(row: {
    id: number;
    name: string;
    scope: string;
    staffUserId: string;
    content: string;
    materialIds: unknown;
    enabled: boolean;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      name: row.name,
      scope: row.scope,
      staffUserId: row.staffUserId,
      content: row.content,
      materialIds: intArr(row.materialIds),
      enabled: row.enabled,
      createdAt: iso(row.createdAt),
    };
  }

  async welcomes(user: CurrentUser) {
    const org = await this.scope.resolve(user);
    const rows = await this.prisma.scrmWelcome.findMany({
      where: orgKey(org),
      orderBy: { id: 'desc' },
      take: 200,
    });
    return rows.map((row) => this.welcomeView(row));
  }

  async saveWelcome(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.scope.requireAdmin(user);
    const name = clip(body.name, 60).trim();
    if (!name) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写欢迎语名称');
    }
    const materialIds = intArr(body.materialIds);
    if (materialIds.length) {
      const list = await this.materials.byIds(org, materialIds);
      const unsupported = list.filter(
        (item) => item.type === 'IMAGE' || item.type === 'FILE',
      );
      if (unsupported.length) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `欢迎语暂不支持直接发送图片/文件素材：${unsupported
            .map((item) => item.title)
            .join('、')}；请改用文本、链接或小程序素材`,
        );
      }
    }
    const data = {
      name,
      scope: text(body.scope) || 'ALL',
      staffUserId: clip(body.staffUserId, 64),
      content: clip(body.content, 2000),
      materialIds: json(materialIds),
      enabled: body.enabled !== false,
    };
    const id = int(body.id);
    const existing = id
      ? await this.prisma.scrmWelcome.findFirst({
          where: { ...orgKey(org), id },
        })
      : null;
    if (id && !existing) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '欢迎语不存在');
    }
    const row = existing
      ? await this.prisma.scrmWelcome.update({
          where: { id: existing.id },
          data,
        })
      : await this.prisma.scrmWelcome.create({
          data: { ...orgKey(org), createdBy: user.userId, ...data },
        });
    return this.welcomeView(row);
  }

  async removeWelcome(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.scope.requireAdmin(user);
    const id = int(body.id);
    const row = await this.prisma.scrmWelcome.findFirst({
      where: { ...orgKey(org), id },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '欢迎语不存在');
    }
    await this.prisma.scrmWelcome.delete({ where: { id: row.id } });
    return { id: row.id };
  }

  /**
   * 新客户欢迎语：必须用回调 WelcomeCode 在 20 秒内发送。
   * 优先活码绑定欢迎语 → 指定员工 → 全员默认；失败重试 3 次，仍失败只告警。
   */
  async sendWelcomeOnAdd(
    org: HrmOrg,
    secrets: ScrmSecrets,
    event: Record<string, string>,
  ): Promise<boolean> {
    const welcomeCode = clip(event.WelcomeCode, 200);
    if (!welcomeCode) return false;
    const state = clip(event.State, 40);
    const staffLinks = await this.scope.staffLinks(org);
    const staffUserId = staffLinks.get(text(event.UserID)) || '';
    const code = state
      ? await this.prisma.scrmCode.findFirst({
          where: { ...orgKey(org), scene: state, status: 'ACTIVE' },
        })
      : null;
    let welcome = code?.welcomeId
      ? await this.prisma.scrmWelcome.findFirst({
          where: { ...orgKey(org), id: code.welcomeId, enabled: true },
        })
      : null;
    if (!welcome && staffUserId) {
      welcome = await this.prisma.scrmWelcome.findFirst({
        where: { ...orgKey(org), enabled: true, scope: 'STAFF', staffUserId },
        orderBy: { id: 'desc' },
      });
    }
    if (!welcome) {
      welcome = await this.prisma.scrmWelcome.findFirst({
        where: { ...orgKey(org), enabled: true, scope: 'ALL' },
        orderBy: { id: 'desc' },
      });
    }
    if (!welcome) return false;
    const materials = await this.materials.byIds(
      org,
      intArr(welcome.materialIds),
    );
    const extraText = this.materials.textOf(materials);
    const raw = [welcome.content, extraText]
      .filter(Boolean)
      .join('\n')
      .slice(0, 1000);
    if (!raw && !materials.length) return false;
    const attachments = this.materials.buildAttachments(materials);
    let content = raw;
    if (raw) {
      try {
        [content] = await this.compliance.outbound(org, [raw]);
      } catch {
        // 命中敏感词：文本整段不发，有附件时只发附件，否则放弃本次欢迎语
        content = '';
        console.warn(
          JSON.stringify({
            event: 'scrm_welcome_blocked',
            orgType: org.orgType,
            orgUserId: org.orgUserId,
            welcomeId: welcome.id,
          }),
        );
        if (!attachments.length) return false;
      }
    }
    for (let attempt = 1; attempt <= WELCOME_RETRIES; attempt += 1) {
      try {
        await this.client.sendWelcome(secrets.corpId, secrets.contactSecret, {
          welcome_code: welcomeCode,
          ...(content ? { text: { content } } : {}),
          ...(attachments.length ? { attachments } : {}),
        });
        return true;
      } catch (error) {
        if (attempt === WELCOME_RETRIES) {
          console.warn(
            JSON.stringify({
              event: 'scrm_welcome_failed',
              orgType: org.orgType,
              orgUserId: org.orgUserId,
              welcomeId: welcome.id,
              staffUserId,
              message: error instanceof Error ? error.message : String(error),
            }),
          );
          return false;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
    return false;
  }

  /** 新增客户后的活码计量与自动打标（等客户已落库后调用）。 */
  async afterAdded(
    org: HrmOrg,
    secrets: ScrmSecrets,
    event: Record<string, string>,
  ): Promise<void> {
    const state = clip(event.State, 40);
    const externalUserId = clip(event.ExternalUserID, 64);
    if (!externalUserId) return;
    const contact = await this.prisma.scrmContact.findUnique({
      where: {
        orgType_orgUserId_externalUserId: {
          orgType: org.orgType,
          orgUserId: org.orgUserId,
          externalUserId,
        },
      },
    });
    if (!contact) return;
    const code = state
      ? await this.prisma.scrmCode.findFirst({
          where: { ...orgKey(org), scene: state },
        })
      : null;
    if (code) {
      const staffLinks = await this.scope.staffLinks(org);
      const staffUserId = staffLinks.get(text(event.UserID)) || '';
      if (staffUserId) {
        const row = await this.prisma.scrmCodeStaff.findFirst({
          where: { ...orgKey(org), codeId: code.id, staffUserId },
        });
        if (row) {
          const today = dayKey();
          const usedToday = row.usedDate === today ? row.usedToday + 1 : 1;
          await this.prisma.scrmCodeStaff.update({
            where: { id: row.id },
            data: { usedToday, usedDate: today },
          });
        }
      }
      try {
        await this.rebalance(org, secrets, code);
      } catch (error) {
        console.warn(
          JSON.stringify({
            event: 'scrm_code_rebalance_failed',
            codeId: code.id,
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }
    await this.applyAutoTags(org, contact.id, {
      codeId: code?.id || 0,
      tagIds: intArr(code?.tagIds),
    });
  }

  /**
   * 重新计算活码可用成员：超过当日上限的成员摘掉；无人可接时停用活码。
   * 次日调度会把已停用的活码重新生成二维码并启用。
   */
  async rebalance(
    org: HrmOrg,
    secrets: ScrmSecrets,
    code: {
      id: number;
      configId: string;
      qrUrl: string;
      scene: string;
      dailyLimit: number;
      status: string;
    },
  ): Promise<void> {
    const today = dayKey();
    const staff = await this.codeStaff(org, [code.id]);
    for (const row of staff) {
      if (row.usedDate !== today && row.usedToday !== 0) {
        await this.prisma.scrmCodeStaff.update({
          where: { id: row.id },
          data: { usedToday: 0, usedDate: today },
        });
        row.usedToday = 0;
        row.usedDate = today;
      }
    }
    let overCodeLimit = false;
    if (code.dailyLimit > 0) {
      const todayAdded = await this.prisma.scrmContact.count({
        where: {
          ...orgKey(org),
          sourceCodeId: code.id,
          addedAt: { gte: dayStart(today) },
        },
      });
      overCodeLimit = todayAdded >= code.dailyLimit;
    }
    const available = overCodeLimit
      ? []
      : staff.filter(
          (row) => row.dailyLimit === 0 || row.usedToday < row.dailyLimit,
        );
    const staffLinks = await this.scope.staffLinks(org);
    const wecomOf = (memberId: string) =>
      [...staffLinks.entries()].find(
        ([, member]) => member === memberId,
      )?.[0] || '';
    const wecomIds = available
      .map((row) => wecomOf(row.staffUserId))
      .filter(Boolean);
    if (!wecomIds.length) {
      if (code.configId) {
        try {
          await this.client.delContactWay(
            secrets.corpId,
            secrets.contactSecret,
            code.configId,
          );
        } catch {
          // 已删除/无权限时继续落本地状态
        }
      }
      await this.prisma.scrmCode.update({
        where: { id: code.id },
        data: { configId: '', qrUrl: '', status: 'PAUSED' },
      });
      return;
    }
    if (!code.configId) {
      const created = await this.client.addContactWay(
        secrets.corpId,
        secrets.contactSecret,
        {
          type: 2,
          scene: 1,
          style: 1,
          skip_verify: true,
          state: code.scene,
          user: wecomIds.slice(0, 100),
        },
      );
      await this.prisma.scrmCode.update({
        where: { id: code.id },
        data: {
          configId: created.configId,
          qrUrl: created.qrCode || code.qrUrl,
          status: 'ACTIVE',
        },
      });
      return;
    }
    const limited = staff.some(
      (row) => row.dailyLimit > 0 && row.usedToday >= row.dailyLimit,
    );
    if (limited || overCodeLimit) {
      await this.client.updateContactWay(
        secrets.corpId,
        secrets.contactSecret,
        code.configId,
        wecomIds.slice(0, 100),
      );
    }
    if (code.status !== 'ACTIVE') {
      await this.prisma.scrmCode.update({
        where: { id: code.id },
        data: { status: 'ACTIVE' },
      });
    }
  }

  /** 调度：每天把因上限停用的活码重新拉起（成员上限按日重置）。 */
  async rebalanceAll(): Promise<number> {
    const corps = await this.prisma.scrmCorp.findMany({
      where: { enabled: true, status: 'ACTIVE' },
      take: 500,
    });
    let resumed = 0;
    for (const corp of corps) {
      const org = orgOf({ orgType: corp.orgType, orgUserId: corp.orgUserId });
      const codes = await this.prisma.scrmCode.findMany({
        where: { ...orgKey(org), status: 'PAUSED' },
        take: 200,
      });
      if (!codes.length) continue;
      const secrets = this.scope.secretsOf(corp);
      for (const code of codes) {
        try {
          await this.rebalance(org, secrets, code);
          resumed += 1;
        } catch {
          // 单个活码失败不阻塞其他企业
        }
      }
    }
    return resumed;
  }

  // ---------- 自动打标 ----------

  private ruleView(row: {
    id: number;
    name: string;
    event: string;
    conditions: unknown;
    tagIds: unknown;
    codeIds: unknown;
    enabled: boolean;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      name: row.name,
      event: row.event,
      conditions:
        row.conditions && typeof row.conditions === 'object'
          ? (row.conditions as Record<string, unknown>)
          : {},
      tagIds: intArr(row.tagIds),
      codeIds: intArr(row.codeIds),
      enabled: row.enabled,
      createdAt: iso(row.createdAt),
    };
  }

  async autoTagRules(user: CurrentUser) {
    const org = await this.scope.resolve(user);
    const rows = await this.prisma.scrmAutoTagRule.findMany({
      where: orgKey(org),
      orderBy: { id: 'desc' },
      take: 200,
    });
    return rows.map((row) => this.ruleView(row));
  }

  async saveAutoTagRule(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.scope.requireAdmin(user);
    const name = clip(body.name, 60).trim();
    if (!name) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写规则名称');
    }
    const tagIds = intArr(body.tagIds);
    if (!tagIds.length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择要打上的标签');
    }
    const count = await this.prisma.scrmTag.count({
      where: { ...orgKey(org), id: { in: tagIds }, deleted: false },
    });
    if (count !== tagIds.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '部分标签不存在或已删除',
      );
    }
    const data = {
      name,
      event: text(body.event) === 'CODE' ? 'CODE' : 'ADD',
      conditions: json(
        body.conditions && typeof body.conditions === 'object'
          ? body.conditions
          : {},
      ),
      tagIds: json(tagIds),
      codeIds: json(intArr(body.codeIds)),
      enabled: body.enabled !== false,
    };
    const id = int(body.id);
    const existing = id
      ? await this.prisma.scrmAutoTagRule.findFirst({
          where: { ...orgKey(org), id },
        })
      : null;
    if (id && !existing) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '规则不存在');
    }
    const row = existing
      ? await this.prisma.scrmAutoTagRule.update({
          where: { id: existing.id },
          data,
        })
      : await this.prisma.scrmAutoTagRule.create({
          data: { ...orgKey(org), createdBy: user.userId, ...data },
        });
    return this.ruleView(row);
  }

  async removeAutoTagRule(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.scope.requireAdmin(user);
    const id = int(body.id);
    const row = await this.prisma.scrmAutoTagRule.findFirst({
      where: { ...orgKey(org), id },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '规则不存在');
    }
    await this.prisma.scrmAutoTagRule.delete({ where: { id: row.id } });
    return { id: row.id };
  }

  /** 命中规则后打标并留痕；重复触发不会重复插同一条标签。 */
  async applyAutoTags(
    org: HrmOrg,
    contactId: number,
    context: { codeId: number; tagIds: number[] },
  ): Promise<number> {
    const rules = await this.prisma.scrmAutoTagRule.findMany({
      where: { ...orgKey(org), enabled: true },
      take: 200,
    });
    const tagIds: number[] = [];
    const matched: string[] = [];
    for (const rule of rules) {
      if (rule.event === 'CODE' && !context.codeId) continue;
      const codeIds = intArr(rule.codeIds);
      if (codeIds.length && !codeIds.includes(context.codeId)) continue;
      const conditions =
        rule.conditions && typeof rule.conditions === 'object'
          ? (rule.conditions as Record<string, unknown>)
          : {};
      if (conditions.codeId && int(conditions.codeId) !== context.codeId)
        continue;
      if (conditions.tagId && !context.tagIds.includes(int(conditions.tagId))) {
        continue;
      }
      tagIds.push(...intArr(rule.tagIds));
      matched.push(rule.name);
    }
    if (!tagIds.length) return 0;
    await this.prisma.scrmContactTag.createMany({
      data: [...new Set(tagIds)].map((tagId) => ({
        ...orgKey(org),
        contactId,
        tagId,
        source: 'AUTO',
      })),
      skipDuplicates: true,
    });
    await addTimeline(
      this.prisma,
      org,
      contactId,
      'TAG',
      '自动打标',
      `命中规则：${matched.join('、')}`,
    );
    return tagIds.length;
  }

  /** 内部：按活码 id 取标签（群发/统计回显用）。 */
  async tagsOfCode(org: HrmOrg, codeId: number): Promise<number[]> {
    const code = await this.prisma.scrmCode.findFirst({
      where: { ...orgKey(org), id: codeId },
      select: { tagIds: true },
    });
    return intArr(code?.tagIds);
  }

  /** 内部：欢迎语内容（群发/入群欢迎语复用）。 */
  async welcomeText(org: HrmOrg, welcomeId: number): Promise<string> {
    if (!welcomeId) return '';
    const welcome = await this.prisma.scrmWelcome.findFirst({
      where: { ...orgKey(org), id: welcomeId, enabled: true },
    });
    if (!welcome) return '';
    const materials = await this.materials.byIds(
      org,
      intArr(welcome.materialIds),
    );
    return [welcome.content, this.materials.textOf(materials)]
      .filter(Boolean)
      .join('\n')
      .slice(0, 1000);
  }
}
