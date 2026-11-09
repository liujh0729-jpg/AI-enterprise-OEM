import { randomBytes } from 'node:crypto';
import {
  QR_CHILD_KIND_LABELS,
  QR_CHILD_LIMIT_SCOPE_LABELS,
  QR_CODE_STATUS_LABELS,
  QR_DOMAIN_MODE_LABELS,
  QR_DOMAIN_STATUS_LABELS,
  QR_LIMIT_SCOPE_LABELS,
  QR_MAX_CHILDREN_PER_CODE,
  QR_MAX_CODES_PER_USER,
  QR_MAX_DOMAINS,
  QR_SELECT_MODE_LABELS,
} from '@enterprise/contracts';
import { pageOf, pageParam, text } from '../common/api';
import type { Prisma } from '../../generated/prisma';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { httpRequest } from '../http/transport';
import { ossObjectKey, ossPublicUrl } from '../oss/oss.config';
import type { OssService } from '../oss/oss.service';

const DOMAIN_RE = /^(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,}$/i;
const BASE32 = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

const randomCode = (length = 8) => {
  const bytes = randomBytes(length);
  let out = '';
  for (let index = 0; index < length; index += 1) {
    out += BASE32[bytes[index] % BASE32.length];
  }
  return out;
};

const normalizeDomain = (raw: string) => {
  const value = text(raw)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');
  if (!DOMAIN_RE.test(value)) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '域名格式不正确，例如 go.example.com',
    );
  }
  if (
    /(^|\.)aiworkin\.com$/.test(value) ||
    /(^|\.)aipdd\.work$/.test(value) ||
    value === 'localhost'
  ) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '不能使用本站或平台域名作为活码短链域名',
    );
  }
  return value;
};

/**
 * 活码引流：固定入口 + 动态子码。
 * 域名池由客户自管（≤100），平台只做绑定/检测/权重/轮换，不签发证书、不做平台封禁探测。
 */
export class LivecodeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly oss?: OssService,
  ) {}

  // ---------------------------------------------------------------- 域名

  private domainView(
    row: {
      id: number;
      domain: string;
      domainKey: string;
      mode: string;
      status: string;
      weight: number;
      lastCheckAt: Date | null;
      lastSeenAt: Date | null;
      lastError: string;
    },
    codeCount = 0,
  ) {
    const modeLabel = QR_DOMAIN_MODE_LABELS[row.mode] || row.mode;
    return {
      id: row.id,
      domain: row.domain,
      domainKey: row.domainKey,
      mode: row.mode,
      modeLabel,
      status: row.status,
      statusLabel: QR_DOMAIN_STATUS_LABELS[row.status] || row.status,
      weight: row.weight,
      originPath:
        row.mode === 'CDN'
          ? `/api/public/lk/o/${row.domainKey}`
          : '/api/public/lk/embed.js',
      lastCheckAt: row.lastCheckAt ? row.lastCheckAt.toISOString() : '',
      lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : '',
      lastError: row.lastError,
      codeCount,
    };
  }

  async domains(user: CurrentUser) {
    await this.autoFailover(user.userId);
    await this.refreshStaleDomains(user.userId);
    const rows = await this.prisma.marketingQrDomain.findMany({
      where: { userId: user.userId },
      orderBy: { id: 'asc' },
    });
    const counts = await this.prisma.marketingQrCode.groupBy({
      by: ['currentDomainId'],
      where: { userId: user.userId },
      _count: { _all: true },
    });
    const map = new Map(
      counts.map((item) => [item.currentDomainId, item._count._all]),
    );
    return rows.map((row) => this.domainView(row, map.get(row.id) || 0));
  }

  async domainCreate(user: CurrentUser, body: Record<string, unknown>) {
    const count = await this.prisma.marketingQrDomain.count({
      where: { userId: user.userId },
    });
    if (count >= QR_MAX_DOMAINS) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `每个账号最多绑定 ${QR_MAX_DOMAINS} 个域名`,
      );
    }
    if (body.ack !== true) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请先确认：域名已备案、证书由你自己的 CDN 提供、内容由你负责',
      );
    }
    const domain = normalizeDomain(text(body.domain));
    const exist = await this.prisma.marketingQrDomain.findUnique({
      where: { domain },
    });
    if (exist) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        exist.userId === user.userId
          ? '该域名已绑定'
          : '该域名已被其他账号绑定',
      );
    }
    const row = await this.prisma.marketingQrDomain.create({
      data: {
        userId: user.userId,
        domain,
        domainKey: randomBytes(5).toString('hex'),
        mode: text(body.mode) === 'SCRIPT' ? 'SCRIPT' : 'CDN',
        ackedAt: new Date(),
      },
    });
    return this.domainView(row);
  }

  async domainUpdate(
    user: CurrentUser,
    id: number,
    body: Record<string, unknown>,
  ) {
    const row = await this.prisma.marketingQrDomain.findFirst({
      where: { id, userId: user.userId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '域名不存在');
    const updated = await this.prisma.marketingQrDomain.update({
      where: { id: row.id },
      data: {
        ...(typeof body.weight === 'number'
          ? { weight: Math.max(0, Math.min(100, Math.round(body.weight))) }
          : {}),
        ...(body.status === 'DISABLED'
          ? { status: 'DISABLED' }
          : body.status === 'ACTIVE' && row.lastCheckAt
            ? { status: row.lastError ? 'ERROR' : 'ACTIVE' }
            : {}),
      },
    });
    return this.domainView(updated);
  }

  async domainRemove(user: CurrentUser, id: number) {
    const row = await this.prisma.marketingQrDomain.findFirst({
      where: { id, userId: user.userId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '域名不存在');
    await this.prisma.marketingQrDomain.delete({ where: { id: row.id } });
    return { removed: true };
  }

  async domainCheck(user: CurrentUser, id: number) {
    const row = await this.prisma.marketingQrDomain.findFirst({
      where: { id, userId: user.userId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '域名不存在');
    return this.checkDomain(row);
  }

  private async checkDomain(row: {
    id: number;
    userId: string;
    domain: string;
    domainKey: string;
    mode: string;
  }) {
    const checks: { key: string; label: string; ok: boolean }[] = [];
    let error = '';
    if (row.mode === 'SCRIPT') {
      const httpsOk = await this.probe(`https://${row.domain}/`, '');
      checks.push({ key: 'https', label: 'HTTPS 可访问', ok: httpsOk.ok });
      if (!httpsOk.ok) error = httpsOk.error;
    } else {
      const probe = await this.probe(
        `https://${row.domain}/s/_probe_${row.domainKey}?t=${Date.now()}`,
        `data-lk-probe="${row.domainKey}"`,
      );
      checks.push({ key: 'https', label: 'HTTPS 可访问', ok: probe.ok });
      checks.push({
        key: 'rewrite',
        label: '回源与路径可用',
        ok: probe.ok && probe.matched,
      });
      if (!probe.ok) error = probe.error;
      else if (!probe.matched)
        error = '回源没有到达本站：请检查回源 Host 是否已改为本站域名';
    }
    const status = checks.every((item) => item.ok) ? 'ACTIVE' : 'ERROR';
    await this.prisma.marketingQrDomain.update({
      where: { id: row.id },
      data: {
        status,
        lastCheckAt: new Date(),
        lastError: status === 'ACTIVE' ? '' : error || '检测未通过',
      },
    });
    if (status === 'ACTIVE') {
      this.autoFailoverReverse();
    } else {
      await this.autoFailover(row.userId);
    }
    return {
      status,
      statusLabel: QR_DOMAIN_STATUS_LABELS[status] || status,
      error: status === 'ACTIVE' ? '' : error || '检测未通过',
      checks,
    };
  }

  private async probe(url: string, marker: string) {
    try {
      const response = await httpRequest<string>(url, {
        method: 'GET',
        readAs: 'text',
        timeoutMs: 8000,
        concurrency: 1,
        limiterKey: 'livecode:probe',
        operation: 'livecode:probe',
        redirect: 'follow',
      });
      if (!response.ok) {
        return {
          ok: false,
          matched: false,
          error: `站点返回 HTTP ${response.status}`,
        };
      }
      return {
        ok: true,
        matched: marker ? String(response.data).includes(marker) : true,
        error: '',
      };
    } catch (error) {
      return {
        ok: false,
        matched: false,
        error: `连接失败：${(error as Error)?.message || '网络异常'}`,
      };
    }
  }

  /** 每小时最多抽 3 个「超过 24 小时未检测」的域名复检（不打满 100 个）。 */
  private async refreshStaleDomains(userId: string) {
    const before = new Date(Date.now() - 24 * 3600 * 1000);
    const rows = await this.prisma.marketingQrDomain.findMany({
      where: {
        userId,
        status: { in: ['ACTIVE', 'ERROR'] },
        OR: [{ lastCheckAt: null }, { lastCheckAt: { lt: before } }],
      },
      orderBy: { lastCheckAt: 'asc' },
      take: 3,
    });
    for (const row of rows) {
      await this.checkDomain(row).catch(() => undefined);
    }
  }

  /** 当前入口域名失效 → 自动切到池内健康域名（只影响新入口，不改旧码）。 */
  private async autoFailover(userId: string) {
    const bad = await this.prisma.marketingQrDomain.findMany({
      where: { userId, status: { in: ['ERROR', 'DISABLED'] } },
      select: { id: true, domain: true },
    });
    if (!bad.length) return;
    const badIds = bad.map((item) => item.id);
    const codes = await this.prisma.marketingQrCode.findMany({
      where: {
        userId,
        autoFailover: true,
        currentDomainId: { in: badIds },
        status: { not: 'DISABLED' },
      },
      take: 50,
    });
    for (const code of codes) {
      const recent = await this.prisma.marketingQrCode.findFirst({
        where: {
          id: code.id,
          entryChangedAt: { gt: new Date(Date.now() - 10 * 60 * 1000) },
        },
      });
      if (recent) continue;
      const next = await this.pickDomain(userId, code.id);
      if (!next) continue;
      await this.prisma.marketingQrCode.update({
        where: { id: code.id },
        data: { currentDomainId: next.id, entryChangedAt: new Date() },
      });
      await this.prisma.auditLog
        .create({
          data: {
            userId,
            action: '活码入口自动切换',
            detail: `活码 #${code.id}：${
              bad.find((item) => item.id === code.currentDomainId)?.domain || ''
            } → ${next.domain}`,
          },
        })
        .catch(() => undefined);
      await this.prisma.notification
        .create({
          data: {
            userId,
            category: 'automation',
            title: '活码入口域名已自动切换',
            body: `「${code.name}」的入口域名已切到 ${next.domain}，请下载新二维码替换物料`,
            link: `/marketing-tools?tool=livecode&code=${code.id}`,
            level: 'warning',
            entityType: 'livecode',
            entityId: String(code.id),
          },
        })
        .catch(() => undefined);
    }
  }

  /** 域名恢复后不自动切回（防抖），只由客户手动切换。 */
  private autoFailoverReverse() {
    return undefined;
  }

  private async pickDomain(userId: string, codeId: number) {
    const rows = await this.prisma.marketingQrDomain.findMany({
      where: { userId, status: 'ACTIVE', weight: { gt: 0 } },
      orderBy: { lastUsedAt: 'asc' },
    });
    if (!rows.length) return null;
    const total = rows.reduce((sum, item) => sum + item.weight, 0);
    let point = Math.random() * total;
    let picked = rows[rows.length - 1];
    for (const row of rows) {
      point -= row.weight;
      if (point <= 0) {
        picked = row;
        break;
      }
    }
    await this.prisma.marketingQrDomain.update({
      where: { id: picked.id },
      data: { lastUsedAt: new Date() },
    });
    await this.prisma.marketingQrCode.updateMany({
      where: { id: codeId, currentDomainId: 0 },
      data: { currentDomainId: picked.id },
    });
    return picked;
  }

  // ---------------------------------------------------------------- 活码

  private async domainsById(userId: string) {
    const rows = await this.prisma.marketingQrDomain.findMany({
      where: { userId },
    });
    return new Map(rows.map((row) => [row.id, row]));
  }

  private childView(row: {
    id: number;
    codeId: number;
    name: string;
    kind: string;
    imageKey: string;
    linkUrl: string;
    textContent: string;
    channel: string;
    weight: number;
    sortOrder: number;
    limitScope: string;
    dailyLimit: number;
    totalLimit: number;
    todayCount: number;
    totalCount: number;
    status: string;
  }) {
    return {
      id: row.id,
      codeId: row.codeId,
      name: row.name,
      kind: row.kind,
      kindLabel: QR_CHILD_KIND_LABELS[row.kind] || row.kind,
      imageKey: row.imageKey,
      imageUrl: row.imageKey
        ? this.oss?.urlOf(row.imageKey) ||
          ossPublicUrl(ossObjectKey(row.imageKey))
        : '',
      linkUrl: row.linkUrl,
      textContent: row.textContent,
      channel: row.channel,
      weight: row.weight,
      sortOrder: row.sortOrder,
      limitScope: row.limitScope,
      limitScopeLabel:
        QR_CHILD_LIMIT_SCOPE_LABELS[row.limitScope] || row.limitScope,
      dailyLimit: row.dailyLimit,
      totalLimit: row.totalLimit,
      todayCount: row.todayCount,
      totalCount: row.totalCount,
      status: row.status,
    };
  }

  private codeView(
    code: {
      id: number;
      name: string;
      code: string;
      entryMode: string;
      domainMode: string;
      domainId: number;
      currentDomainId: number;
      autoFailover: boolean;
      scriptUrl: string;
      title: string;
      note: string;
      selectMode: string;
      sticky: boolean;
      limitScope: string;
      dailyLimit: number;
      totalLimit: number;
      fallbackChildId: number;
      todayCount: number;
      totalCount: number;
      status: string;
      disabledReason: string;
      entryChangedAt: Date | null;
      createdAt: Date;
    },
    domains: Map<number, { domain: string }>,
    children: ReturnType<LivecodeService['childView']>[] = [],
  ) {
    const current = domains.get(code.currentDomainId);
    return {
      id: code.id,
      name: code.name,
      code: code.code,
      entryMode: code.entryMode,
      entryModeLabel: QR_DOMAIN_MODE_LABELS[code.entryMode] || code.entryMode,
      domainMode: code.domainMode,
      domainId: code.domainId,
      currentDomainId: code.currentDomainId,
      currentDomain: current?.domain || '',
      autoFailover: code.autoFailover,
      scriptUrl: code.scriptUrl,
      title: code.title,
      note: code.note,
      selectMode: code.selectMode,
      selectModeLabel:
        QR_SELECT_MODE_LABELS[code.selectMode] || code.selectMode,
      sticky: code.sticky,
      limitScope: code.limitScope,
      limitScopeLabel:
        QR_LIMIT_SCOPE_LABELS[code.limitScope] || code.limitScope,
      dailyLimit: code.dailyLimit,
      totalLimit: code.totalLimit,
      fallbackChildId: code.fallbackChildId,
      todayCount: code.todayCount,
      totalCount: code.totalCount,
      status: code.status,
      statusLabel: QR_CODE_STATUS_LABELS[code.status] || code.status,
      disabledReason: code.disabledReason,
      entryChangedAt: code.entryChangedAt
        ? code.entryChangedAt.toISOString()
        : '',
      children,
      createdAt: code.createdAt.toISOString(),
    };
  }

  async list(
    user: CurrentUser,
    query: {
      page?: number | string;
      pageSize?: number | string;
      keyword?: string;
      status?: string;
    },
  ) {
    await this.autoFailover(user.userId);
    const { page, pageSize, offset } = pageParam(
      query.page,
      query.pageSize,
      20,
    );
    const where = {
      userId: user.userId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.keyword
        ? {
            OR: [
              {
                name: { contains: query.keyword },
              },
              {
                code: { contains: query.keyword },
              },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.marketingQrCode.count({ where }),
      this.prisma.marketingQrCode.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: offset,
        take: pageSize,
      }),
    ]);
    const domains = await this.domainsById(user.userId);
    const children = rows.length
      ? await this.prisma.marketingQrChild.findMany({
          where: { codeId: { in: rows.map((row) => row.id) } },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        })
      : [];
    const childrenMap = new Map<
      number,
      ReturnType<LivecodeService['childView']>[]
    >();
    for (const child of children) {
      const bucket = childrenMap.get(child.codeId) || [];
      bucket.push(this.childView(child));
      childrenMap.set(child.codeId, bucket);
    }
    return pageOf(
      rows.map((row) =>
        this.codeView(row, domains, childrenMap.get(row.id) || []),
      ),
      total,
      page,
      pageSize,
    );
  }

  async get(user: CurrentUser, id: number) {
    const code = await this.prisma.marketingQrCode.findFirst({
      where: { id, userId: user.userId },
    });
    if (!code) throw new BusinessException(ErrorCode.NOT_FOUND, '活码不存在');
    const [domains, children] = await Promise.all([
      this.domainsById(user.userId),
      this.prisma.marketingQrChild.findMany({
        where: { codeId: code.id },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      }),
    ]);
    return this.codeView(
      code,
      domains,
      children.map((row) => this.childView(row)),
    );
  }

  async create(user: CurrentUser, body: Record<string, unknown>) {
    const count = await this.prisma.marketingQrCode.count({
      where: { userId: user.userId },
    });
    if (count >= QR_MAX_CODES_PER_USER) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `每个账号最多创建 ${QR_MAX_CODES_PER_USER} 个活码`,
      );
    }
    const name = text(body.name).trim().slice(0, 60);
    if (!name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写活码名称');
    let code = randomCode();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const exist = await this.prisma.marketingQrCode.findUnique({
        where: { code },
      });
      if (!exist) break;
      code = randomCode();
    }
    const row = await this.prisma.marketingQrCode.create({
      data: {
        userId: user.userId,
        name,
        code,
        entryMode: text(body.entryMode) === 'SCRIPT' ? 'SCRIPT' : 'CDN',
        domainMode: text(body.domainMode) === 'PINNED' ? 'PINNED' : 'ROTATE',
        domainId: Number(body.domainId || 0),
        title: text(body.title).slice(0, 60),
        note: text(body.note).slice(0, 1000),
        selectMode: ['RANDOM', 'ORDER', 'WEIGHT'].includes(
          text(body.selectMode),
        )
          ? text(body.selectMode)
          : 'RANDOM',
        sticky: body.sticky !== false,
        limitScope: ['NONE', 'DAILY', 'TOTAL'].includes(text(body.limitScope))
          ? text(body.limitScope)
          : 'NONE',
        dailyLimit: Math.max(0, Number(body.dailyLimit || 0)),
        totalLimit: Math.max(0, Number(body.totalLimit || 0)),
        scriptUrl: text(body.scriptUrl).slice(0, 500),
      },
    });
    if (row.entryMode === 'CDN') {
      const picked = await this.pickDomain(user.userId, row.id);
      if (picked) {
        await this.prisma.marketingQrCode.update({
          where: { id: row.id },
          data: {
            currentDomainId:
              row.domainMode === 'PINNED' && row.domainId
                ? row.domainId
                : picked.id,
          },
        });
      }
    }
    return this.get(user, row.id);
  }

  async update(user: CurrentUser, id: number, body: Record<string, unknown>) {
    const code = await this.prisma.marketingQrCode.findFirst({
      where: { id, userId: user.userId },
    });
    if (!code) throw new BusinessException(ErrorCode.NOT_FOUND, '活码不存在');
    await this.prisma.marketingQrCode.update({
      where: { id: code.id },
      data: {
        ...(typeof body.name === 'string'
          ? { name: body.name.slice(0, 60) }
          : {}),
        ...(typeof body.title === 'string'
          ? { title: body.title.slice(0, 60) }
          : {}),
        ...(typeof body.note === 'string'
          ? { note: body.note.slice(0, 1000) }
          : {}),
        ...(body.domainMode === 'PINNED' || body.domainMode === 'ROTATE'
          ? { domainMode: body.domainMode }
          : {}),
        ...(typeof body.domainId === 'number'
          ? { domainId: body.domainId }
          : {}),
        ...(typeof body.autoFailover === 'boolean'
          ? { autoFailover: body.autoFailover }
          : {}),
        ...(typeof body.selectMode === 'string' &&
        ['RANDOM', 'ORDER', 'WEIGHT'].includes(body.selectMode)
          ? { selectMode: body.selectMode }
          : {}),
        ...(typeof body.sticky === 'boolean' ? { sticky: body.sticky } : {}),
        ...(typeof body.limitScope === 'string' &&
        ['NONE', 'DAILY', 'TOTAL'].includes(body.limitScope)
          ? { limitScope: body.limitScope }
          : {}),
        ...(typeof body.dailyLimit === 'number'
          ? { dailyLimit: Math.max(0, body.dailyLimit) }
          : {}),
        ...(typeof body.totalLimit === 'number'
          ? { totalLimit: Math.max(0, body.totalLimit) }
          : {}),
        ...(typeof body.fallbackChildId === 'number'
          ? { fallbackChildId: body.fallbackChildId }
          : {}),
        ...(typeof body.scriptUrl === 'string'
          ? { scriptUrl: body.scriptUrl.slice(0, 500) }
          : {}),
        ...(body.status === 'ACTIVE' || body.status === 'PAUSED'
          ? { status: body.status }
          : {}),
      } satisfies Prisma.MarketingQrCodeUncheckedUpdateInput,
    });
    return this.get(user, id);
  }

  async remove(user: CurrentUser, id: number) {
    const code = await this.prisma.marketingQrCode.findFirst({
      where: { id, userId: user.userId },
    });
    if (!code) throw new BusinessException(ErrorCode.NOT_FOUND, '活码不存在');
    await this.prisma.marketingQrCode.delete({ where: { id: code.id } });
    await this.prisma.marketingQrChild.deleteMany({
      where: { codeId: code.id },
    });
    return { removed: true };
  }

  async entry(user: CurrentUser, id: number, count: number) {
    const code = await this.prisma.marketingQrCode.findFirst({
      where: { id, userId: user.userId },
    });
    if (!code) throw new BusinessException(ErrorCode.NOT_FOUND, '活码不存在');
    if (code.entryMode === 'SCRIPT') {
      const base = code.scriptUrl || '';
      if (!base) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '脚本链路需要先填写落地页地址（二维码将指向该地址）',
        );
      }
      return {
        entries: [
          {
            domainId: 0,
            domain: '',
            url: `${base}${base.includes('?') ? '&' : '?'}lk=${code.code}`,
          },
        ],
      };
    }
    const domains = await this.domainsById(user.userId);
    const active = [...domains.values()].filter(
      (row) => (row as { status?: string }).status === 'ACTIVE',
    );
    if (code.domainMode === 'PINNED' && code.domainId) {
      const pinned = domains.get(code.domainId);
      if (!pinned) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '指定的入口域名已被解绑',
        );
      }
      return {
        entries: [
          {
            domainId: pinned.id,
            domain: pinned.domain,
            url: `https://${pinned.domain}/s/${code.code}`,
          },
        ],
      };
    }
    const limit = Math.max(1, Math.min(100, count));
    const entries: { domainId: number; domain: string; url: string }[] = [];
    for (let index = 0; index < limit; index += 1) {
      const picked = await this.pickDomain(user.userId, code.id);
      if (!picked) break;
      entries.push({
        domainId: picked.id,
        domain: picked.domain,
        url: `https://${picked.domain}/s/${code.code}`,
      });
    }
    if (!entries.length) {
      // 还没有生效域名时给出站内自查地址，便于先验证内容
      return {
        entries: [{ domainId: 0, domain: '', url: `/s/${code.code}` }],
      };
    }
    if (!active.length) {
      return {
        entries: [
          { domainId: 0, domain: '', url: `/s/${code.code}` },
          ...entries,
        ],
      };
    }
    return { entries };
  }

  async switchDomain(user: CurrentUser, id: number, domainId?: number) {
    const code = await this.prisma.marketingQrCode.findFirst({
      where: { id, userId: user.userId },
    });
    if (!code) throw new BusinessException(ErrorCode.NOT_FOUND, '活码不存在');
    let target: { id: number; domain: string } | null = null;
    if (domainId) {
      target = await this.prisma.marketingQrDomain.findFirst({
        where: { id: domainId, userId: user.userId, status: 'ACTIVE' },
      });
      if (!target) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '只能切换到本账号已生效的域名',
        );
      }
    } else {
      target = await this.pickDomain(user.userId, code.id);
    }
    if (!target) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '域名池里没有可用的域名',
      );
    }
    await this.prisma.marketingQrCode.update({
      where: { id: code.id },
      data: {
        currentDomainId: target.id,
        entryChangedAt: new Date(),
        ...(domainId ? { domainMode: 'PINNED', domainId } : {}),
      },
    });
    return this.get(user, id);
  }

  // ---------------------------------------------------------------- 子码

  async childCreate(
    user: CurrentUser,
    codeId: number,
    body: Record<string, unknown>,
  ) {
    const code = await this.prisma.marketingQrCode.findFirst({
      where: { id: codeId, userId: user.userId },
    });
    if (!code) throw new BusinessException(ErrorCode.NOT_FOUND, '活码不存在');
    const count = await this.prisma.marketingQrChild.count({
      where: { codeId },
    });
    if (count >= QR_MAX_CHILDREN_PER_CODE) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `每个活码最多 ${QR_MAX_CHILDREN_PER_CODE} 个子码`,
      );
    }
    const kind = ['IMAGE', 'LINK', 'TEXT'].includes(text(body.kind))
      ? text(body.kind)
      : 'TEXT';
    const name = text(body.name).trim().slice(0, 60) || '子码';
    const linkUrl = text(body.linkUrl).trim().slice(0, 1000);
    if (kind === 'LINK') {
      const url = (() => {
        try {
          const parsed = new URL(linkUrl);
          return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
          return false;
        }
      })();
      if (!url) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '链接子码只能填 http/https 地址',
        );
      }
    }
    if (kind === 'IMAGE' && !text(body.imageKey)) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请先上传图片');
    }
    if (kind === 'TEXT' && !text(body.textContent).trim()) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写文本内容');
    }
    const row = await this.prisma.marketingQrChild.create({
      data: {
        codeId,
        name,
        kind,
        imageKey: text(body.imageKey).slice(0, 255),
        linkUrl,
        textContent: text(body.textContent).slice(0, 2000),
        channel: text(body.channel).slice(0, 32),
        weight: Math.max(1, Math.min(100, Number(body.weight || 1))),
        sortOrder: Number(body.sortOrder || count),
        limitScope: ['INHERIT', 'NONE', 'DAILY', 'TOTAL'].includes(
          text(body.limitScope),
        )
          ? text(body.limitScope)
          : 'INHERIT',
        dailyLimit: Math.max(0, Number(body.dailyLimit || 0)),
        totalLimit: Math.max(0, Number(body.totalLimit || 0)),
      },
    });
    return this.childView(row);
  }

  async childUpdate(
    user: CurrentUser,
    codeId: number,
    childId: number,
    body: Record<string, unknown>,
  ) {
    const code = await this.prisma.marketingQrCode.findFirst({
      where: { id: codeId, userId: user.userId },
    });
    if (!code) throw new BusinessException(ErrorCode.NOT_FOUND, '活码不存在');
    const child = await this.prisma.marketingQrChild.findFirst({
      where: { id: childId, codeId },
    });
    if (!child) throw new BusinessException(ErrorCode.NOT_FOUND, '子码不存在');
    if (typeof body.linkUrl === 'string' && body.linkUrl) {
      try {
        const parsed = new URL(body.linkUrl);
        if (!['http:', 'https:'].includes(parsed.protocol))
          throw new Error('bad');
      } catch {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '链接子码只能填 http/https 地址',
        );
      }
    }
    const row = await this.prisma.marketingQrChild.update({
      where: { id: child.id },
      data: {
        ...(typeof body.name === 'string'
          ? { name: body.name.slice(0, 60) }
          : {}),
        ...(typeof body.imageKey === 'string'
          ? { imageKey: body.imageKey.slice(0, 255) }
          : {}),
        ...(typeof body.linkUrl === 'string'
          ? { linkUrl: body.linkUrl.slice(0, 1000) }
          : {}),
        ...(typeof body.textContent === 'string'
          ? { textContent: body.textContent.slice(0, 2000) }
          : {}),
        ...(typeof body.channel === 'string'
          ? { channel: body.channel.slice(0, 32) }
          : {}),
        ...(typeof body.weight === 'number'
          ? { weight: Math.max(1, Math.min(100, body.weight)) }
          : {}),
        ...(typeof body.sortOrder === 'number'
          ? { sortOrder: body.sortOrder }
          : {}),
        ...(typeof body.limitScope === 'string' &&
        ['INHERIT', 'NONE', 'DAILY', 'TOTAL'].includes(body.limitScope)
          ? { limitScope: body.limitScope }
          : {}),
        ...(typeof body.dailyLimit === 'number'
          ? { dailyLimit: Math.max(0, body.dailyLimit) }
          : {}),
        ...(typeof body.totalLimit === 'number'
          ? { totalLimit: Math.max(0, body.totalLimit) }
          : {}),
        ...(body.status === 'ACTIVE' || body.status === 'PAUSED'
          ? { status: body.status }
          : {}),
      } satisfies Prisma.MarketingQrChildUncheckedUpdateInput,
    });
    return this.childView(row);
  }

  async childRemove(user: CurrentUser, codeId: number, childId: number) {
    const code = await this.prisma.marketingQrCode.findFirst({
      where: { id: codeId, userId: user.userId },
    });
    if (!code) throw new BusinessException(ErrorCode.NOT_FOUND, '活码不存在');
    const child = await this.prisma.marketingQrChild.findFirst({
      where: { id: childId, codeId },
    });
    if (!child) throw new BusinessException(ErrorCode.NOT_FOUND, '子码不存在');
    await this.prisma.marketingQrChild.delete({ where: { id: child.id } });
    if (code.fallbackChildId === child.id) {
      await this.prisma.marketingQrCode.update({
        where: { id: code.id },
        data: { fallbackChildId: 0 },
      });
    }
    return { removed: true };
  }

  // ---------------------------------------------------------------- 统计

  async stats(user: CurrentUser, id: number, days: number) {
    const code = await this.prisma.marketingQrCode.findFirst({
      where: { id, userId: user.userId },
    });
    if (!code) throw new BusinessException(ErrorCode.NOT_FOUND, '活码不存在');
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    const scans = await this.prisma.marketingQrScan.findMany({
      where: { codeId: id, createdAt: { gte: since } },
      orderBy: { id: 'desc' },
      take: 20000,
    });
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const dayMap = new Map<string, { scans: number; visitors: Set<string> }>();
    for (const scan of scans) {
      const key = scan.createdAt.toISOString().slice(0, 10);
      const bucket = dayMap.get(key) || {
        scans: 0,
        visitors: new Set<string>(),
      };
      if (scan.result === 'SHOWN' || scan.result === 'FALLBACK') {
        bucket.scans += 1;
        if (scan.visitorHash) bucket.visitors.add(scan.visitorHash);
      }
      dayMap.set(key, bucket);
    }
    const childRows = await this.prisma.marketingQrChild.findMany({
      where: { codeId: id },
    });
    const childNames = new Map(childRows.map((row) => [row.id, row.name]));
    const perChild = new Map<number, number>();
    const perChannel = new Map<string, number>();
    const perDomain = new Map<number, number>();
    for (const scan of scans) {
      if (scan.result !== 'SHOWN' && scan.result !== 'FALLBACK') continue;
      perChild.set(scan.childId, (perChild.get(scan.childId) || 0) + 1);
      const channel = scan.channel || '未标注';
      perChannel.set(channel, (perChannel.get(channel) || 0) + 1);
      perDomain.set(scan.domainId, (perDomain.get(scan.domainId) || 0) + 1);
    }
    const domains = await this.domainsById(user.userId);
    const todayScans = scans.filter(
      (scan) =>
        scan.createdAt >= todayStart &&
        (scan.result === 'SHOWN' || scan.result === 'FALLBACK'),
    );
    return {
      days,
      today: todayScans.length,
      todayVisitors: new Set(todayScans.map((scan) => scan.visitorHash)).size,
      total: code.totalCount,
      clicks: scans.filter((scan) => scan.result === 'CLICK').length,
      perDay: [...dayMap.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, value]) => ({
          date,
          scans: value.scans,
          visitors: value.visitors.size,
        })),
      perChild: [...perChild.entries()]
        .map(([childId, count]) => ({
          childId,
          name: childNames.get(childId) || `子码 #${childId}`,
          scans: count,
        }))
        .sort((a, b) => b.scans - a.scans),
      perChannel: [...perChannel.entries()]
        .map(([channel, count]) => ({ channel, scans: count }))
        .sort((a, b) => b.scans - a.scans),
      perDomain: [...perDomain.entries()]
        .map(([domainId, count]) => ({
          domainId,
          domain: domains.get(domainId)?.domain || '未识别域名',
          scans: count,
        }))
        .sort((a, b) => b.scans - a.scans),
    };
  }

  async scans(
    user: CurrentUser,
    id: number,
    query: { page?: number | string; pageSize?: number | string },
  ) {
    const code = await this.prisma.marketingQrCode.findFirst({
      where: { id, userId: user.userId },
    });
    if (!code) throw new BusinessException(ErrorCode.NOT_FOUND, '活码不存在');
    const { page, pageSize, offset } = pageParam(
      query.page,
      query.pageSize,
      20,
    );
    const [total, rows, children, domains] = await Promise.all([
      this.prisma.marketingQrScan.count({ where: { codeId: id } }),
      this.prisma.marketingQrScan.findMany({
        where: { codeId: id },
        orderBy: { id: 'desc' },
        skip: offset,
        take: pageSize,
      }),
      this.prisma.marketingQrChild.findMany({ where: { codeId: id } }),
      this.domainsById(user.userId),
    ]);
    const names = new Map(children.map((row) => [row.id, row.name]));
    return pageOf(
      rows.map((row) => ({
        id: row.id,
        childName: names.get(row.childId) || '',
        channel: row.channel,
        domain: domains.get(row.domainId)?.domain || '',
        region: row.region,
        device: row.device,
        result: row.result,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    );
  }

  // ---------------------------------------------------------------- 平台监管

  async adminList(query: {
    page?: number | string;
    pageSize?: number | string;
    keyword?: string;
  }) {
    const { page, pageSize, offset } = pageParam(
      query.page,
      query.pageSize,
      20,
    );
    const where = query.keyword
      ? {
          OR: [
            { name: { contains: query.keyword } },
            { code: { contains: query.keyword } },
            { userId: { contains: query.keyword } },
          ],
        }
      : {};
    const [total, rows] = await Promise.all([
      this.prisma.marketingQrCode.count({ where }),
      this.prisma.marketingQrCode.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: offset,
        take: pageSize,
      }),
    ]);
    const domains = await this.prisma.marketingQrDomain.findMany({
      where: { userId: { in: [...new Set(rows.map((row) => row.userId))] } },
    });
    const domainMap = new Map(domains.map((row) => [row.id, row.domain]));
    return pageOf(
      rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        name: row.name,
        code: row.code,
        domain: domainMap.get(row.currentDomainId) || '',
        status: row.status,
        totalCount: row.totalCount,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    );
  }

  async adminDisable(id: number, reason: string, enable: boolean) {
    const row = await this.prisma.marketingQrCode.findUnique({ where: { id } });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '活码不存在');
    const updated = await this.prisma.marketingQrCode.update({
      where: { id },
      data: {
        status: enable ? 'ACTIVE' : 'DISABLED',
        disabledReason: enable ? '' : reason.slice(0, 200),
      },
    });
    return { id: updated.id, status: updated.status };
  }

  // ---------------------------------------------------------------- 公开分发辅助

  /** 公开访问：按短码取活码（不校验账号）。 */
  async codeForPublic(code: string) {
    return this.prisma.marketingQrCode.findUnique({ where: { code } });
  }

  async domainByKey(key: string) {
    return this.prisma.marketingQrDomain.findUnique({
      where: { domainKey: key },
    });
  }

  async markDomainSeen(id: number) {
    if (!id) return;
    await this.prisma.marketingQrDomain
      .update({ where: { id }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);
  }

  async recordClick(code: { id: number }, childId: number, domainId: number) {
    await this.prisma.marketingQrScan.create({
      data: {
        codeId: code.id,
        childId,
        domainId,
        result: 'CLICK',
      },
    });
  }
}
