import type { CurrentUser } from '../auth/current-user';
import type { SeoLinkProspect } from '../../generated/prisma';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { fetchHtml } from './seo-crawler';
import { extractContact, ruleOutreachDraft } from './seo-outreach';
import { orgKeyOf, SeoBase } from './seo-base.service';
import {
  clip,
  normalizeDomain,
  num,
  pageOf,
  skipTake,
  type PageQuery,
  type Row,
} from './seo-shared';

const STATUSES = [
  'NEW',
  'QUALIFIED',
  'DRAFTED',
  'SENT',
  'REPLIED',
  'WON',
  'IGNORED',
];

/**
 * 外链建设：SERP 找线索 → 抓公开联系方式 → 生成 outreach 草稿。
 * 只生成草稿，绝不自动群发；联系方式抽不到就留空，绝不猜邮箱。
 */
export class SeoOutreachService extends SeoBase {
  async discoverProspects(user: CurrentUser, body: Row) {
    const { org, row: project } = await this.project(user, num(body.projectId));
    const query = clip(body.query, 200).trim();
    if (!query)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写搜索词');
    const credential = await this.ctx.dfs.credential(user.userId);
    if (!credential) return { prospects: [], mode: 'manual' as const };
    const key = orgKeyOf(org);
    const limit = Math.min(50, Math.max(1, num(body.limit, 20)));
    const result = await this.research<{
      items: Array<{ domain: string; url: string; title: string }>;
    }>({
      org: key,
      projectId: project.id,
      action: 'prospects',
      params: {
        query,
        locationCode: num(body.locationCode, project.locationCode),
        languageCode: clip(body.languageCode, 12) || project.languageCode,
        limit,
      },
      resultRef: `prospects:${query}`,
      load: async () => {
        const serp = await this.ctx.dfs.serp(credential, {
          keyword: query,
          locationCode: num(body.locationCode, project.locationCode),
          languageCode: clip(body.languageCode, 12) || project.languageCode,
          device: 'DESKTOP',
          depth: Math.min(100, limit + 10),
        });
        return {
          items: serp.items.slice(0, limit).map((item) => ({
            domain: normalizeDomain(item.domain || item.url),
            url: clip(item.url, 500),
            title: clip(item.title, 300),
          })),
        };
      },
    });
    const existing = await this.prisma.seoLinkProspect.findMany({
      where: { ...key, projectId: project.id },
      select: { domain: true },
    });
    const known = new Set(existing.map((item) => item.domain));
    const fresh = result.value.items.filter(
      (item) =>
        item.domain &&
        item.domain !== project.domain &&
        !known.has(item.domain),
    );
    if (fresh.length)
      await this.prisma.seoLinkProspect.createMany({
        data: fresh.map((item) => ({
          ...key,
          projectId: project.id,
          domain: item.domain,
          url: item.url,
          sourceQuery: query,
          note: clip(item.title, 500),
          status: 'NEW',
        })),
      });
    const rows = await this.prisma.seoLinkProspect.findMany({
      where: {
        ...key,
        projectId: project.id,
        domain: { in: fresh.map((item) => item.domain) },
      },
      orderBy: { id: 'desc' },
    });
    return {
      prospects: rows.map((item) => this.prospectView(item)),
      mode: 'dataforseo' as const,
    };
  }

  async listProspects(user: CurrentUser, query: PageQuery & Row) {
    const { org, row } = await this.project(user, num(query.projectId));
    const status = typeof query.status === 'string' ? query.status : '';
    const where = {
      ...orgKeyOf(org),
      projectId: row.id,
      ...(status && STATUSES.includes(status) ? { status } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.seoLinkProspect.count({ where }),
      this.prisma.seoLinkProspect.findMany({
        where,
        orderBy: { id: 'desc' },
        ...skipTake(query),
      }),
    ]);
    return pageOf(
      rows.map((item) => this.prospectView(item)),
      total,
      query,
    );
  }

  async addProspect(user: CurrentUser, body: Row) {
    const { org, row: project } = await this.project(user, num(body.projectId));
    const domain = normalizeDomain(
      typeof body.domain === 'string' ? body.domain : '',
    );
    const key = orgKeyOf(org);
    const existing = await this.prisma.seoLinkProspect.findFirst({
      where: { ...key, projectId: project.id, domain },
    });
    if (existing) return this.prospectView(existing);
    const row = await this.prisma.seoLinkProspect.create({
      data: {
        ...key,
        projectId: project.id,
        domain,
        url: clip(body.url, 500) || `https://${domain}`,
        sourceQuery: clip(body.sourceQuery, 200),
        note: clip(body.note, 500),
        status: 'NEW',
      },
    });
    return this.prospectView(row);
  }

  async extractContact(user: CurrentUser, body: Row) {
    const prospect = await this.prospect(user, num(body.id));
    const url = prospect.url || `https://${prospect.domain}`;
    const page = await fetchHtml(url, prospect.domain, { timeoutMs: 15_000 });
    if (page.fetchStatus !== 'OK')
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `对方站点抓取失败（${page.fetchStatus}），无法抽取公开联系方式；可手工填写`,
      );
    const hit = extractContact(page.html, page.links);
    if (!hit.email && !hit.contactUrl) {
      const contactPage = page.links.find((link) =>
        /(contact|about|联系|关于)/i.test(link.href),
      );
      if (contactPage) {
        const deeper = await fetchHtml(contactPage.href, prospect.domain, {
          timeoutMs: 15_000,
        });
        if (deeper.fetchStatus === 'OK') {
          const second = extractContact(deeper.html, deeper.links);
          hit.email = second.email;
          hit.contactUrl = contactPage.href;
        }
      }
    }
    const row = await this.prisma.seoLinkProspect.update({
      where: { id: prospect.id },
      data: {
        ...(hit.email ? { contactEmail: clip(hit.email, 200) } : {}),
        ...(hit.contactUrl ? { contactUrl: clip(hit.contactUrl, 500) } : {}),
      },
    });
    return this.prospectView(row);
  }

  async draftOutreach(user: CurrentUser, body: Row) {
    const org = await this.org(user);
    const prospect = await this.prospect(user, num(body.id));
    const project = await this.prisma.seoProject.findUnique({
      where: { id: prospect.projectId },
    });
    const context = await this.brandContext(org);
    const call = await this.ai(
      user,
      '你是外链建设（digital PR）写手。写一封中文 outreach 邮件草稿：主题行 + 正文 + 署名占位。' +
        '要求：不超过 200 字正文、开头点明读过对方哪篇内容、给出一个具体的合作角度、不夸大、不承诺排名、' +
        '不编造对方姓名与事实；缺失信息用〔请填写：…〕标注。只输出邮件文本。',
      `我方品牌背景：${context || '未提供'}\n我方站点：${project?.domain || ''}\n` +
        `对方站点：${prospect.domain}\n对方页面：${prospect.url}\n` +
        `对方页面标题：${prospect.note || '未抓取'}\n` +
        `合作角度：${prospect.outreachAngle || '由你根据双方业务提出一个合理角度'}`,
      1200,
    );
    await this.charge(
      user,
      'seo_outreach_ai',
      call,
      `seo-outreach:${prospect.id}`,
    );
    const draft =
      call.reply ||
      ruleOutreachDraft({
        brandName: project?.brandName || '',
        domain: project?.domain || '',
        prospectDomain: prospect.domain,
        prospectUrl: prospect.url,
        angle: prospect.outreachAngle,
      });
    const artifact = await this.prisma.mktArtifact.create({
      data: {
        ...orgKeyOf(org),
        title: clip(`外链草稿 · ${prospect.domain}`, 120),
        kind: 'SEO_OUTREACH',
        body: draft,
        status: 'DRAFT',
        createdBy: org.actorId,
      },
    });
    await this.prisma.seoLinkProspect.update({
      where: { id: prospect.id },
      data: {
        draftArtifactId: artifact.id,
        status: prospect.status === 'NEW' ? 'DRAFTED' : prospect.status,
      },
    });
    return {
      artifactId: artifact.id,
      draft,
      mode: call.reply ? ('llm' as const) : ('rule' as const),
    };
  }

  async updateProspect(user: CurrentUser, body: Row) {
    const prospect = await this.prospect(user, num(body.id));
    const status = typeof body.status === 'string' ? body.status : '';
    if (body.status !== undefined && !STATUSES.includes(status))
      throw new BusinessException(ErrorCode.BAD_REQUEST, '线索状态非法');
    const row = await this.prisma.seoLinkProspect.update({
      where: { id: prospect.id },
      data: {
        ...(body.status !== undefined ? { status } : {}),
        ...(body.contactEmail !== undefined
          ? { contactEmail: clip(body.contactEmail, 200) }
          : {}),
        ...(body.contactUrl !== undefined
          ? { contactUrl: clip(body.contactUrl, 500) }
          : {}),
        ...(body.outreachAngle !== undefined
          ? { outreachAngle: clip(body.outreachAngle, 500) }
          : {}),
        ...(body.note !== undefined ? { note: clip(body.note, 500) } : {}),
      },
    });
    return this.prospectView(row);
  }

  async removeProspect(user: CurrentUser, body: Row) {
    const prospect = await this.prospect(user, num(body.id));
    await this.prisma.seoLinkProspect.delete({ where: { id: prospect.id } });
    return this.ok('线索已删除');
  }

  /**
   * 潜客邮箱 → 阿里云邮件推送：把已提取的邮箱写成一张多维表格，再走既有
   * 「表格 → 收件人列表」同步（本系统不发送邮件，模板/发送仍在阿里云控制台）。
   */
  async pushProspectsToMail(user: CurrentUser, body: Row) {
    const { org, row: project } = await this.project(user, num(body.projectId));
    const ids = [
      ...new Set(
        (Array.isArray(body.ids) ? body.ids : [])
          .map((id) => num(id))
          .filter((id) => id > 0),
      ),
    ].slice(0, 200);
    if (!ids.length)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择要推送的潜客');
    const settings = await this.ctx.mail.getSettings(user);
    if (!settings.configured)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请先在「阿里云邮件推送」配置 AccessKey，再推送潜客邮箱',
      );
    const rows = await this.prisma.seoLinkProspect.findMany({
      where: { ...orgKeyOf(org), projectId: project.id, id: { in: ids } },
      orderBy: { id: 'asc' },
    });
    const withEmail = rows.filter((row) => row.contactEmail.trim());
    if (!withEmail.length)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '所选潜客都没有已提取的联系邮箱：请先「提取联系方式」，抽不到的不会编造',
      );
    const table = await this.ctx.tables.create(user, {
      name: clip(`SEO 外链线索 · ${project.domain}`, 200),
      description:
        '由 SEO 外链建设转来的潜客邮箱，用于阿里云邮件推送收件人列表',
    });
    const fields = await this.ctx.tables.addFields(user, table.id, [
      { name: '邮箱', field_key: 'email', field_type: 'email', required: true },
      { name: '域名', field_key: 'domain', field_type: 'text' },
      { name: '来源查询', field_key: 'source_query', field_type: 'text' },
    ]);
    const emailFieldKey = fields[0]?.fieldKey || 'email';
    await this.ctx.tables.createRows(
      user,
      table.id,
      withEmail.map((row) => ({
        email: row.contactEmail,
        domain: row.domain,
        source_query: row.sourceQuery,
      })),
    );
    const receiverId = clip(body.receiverId, 120).trim();
    const imported = await this.ctx.mail.createImport(user, {
      mode: receiverId ? 'append' : 'new',
      tableId: table.id,
      receiverId,
      receiverName: receiverId ? '' : clip(`${project.domain} 外链线索`, 120),
      receiverAlias: clip(`${project.domain} outreach`, 120),
      description: 'SEO 外链建设潜客邮箱',
      mapping: {
        emailFieldKey,
        variables: [{ key: 'Domain', fieldKey: 'domain' }],
        writeBack: false,
      },
    });
    return {
      tableId: table.id,
      tableName: table.name,
      importId: imported.id,
      total: withEmail.length,
    };
  }

  private async prospect(user: CurrentUser, id: number) {
    const org = await this.org(user);
    const row = await this.prisma.seoLinkProspect.findFirst({
      where: { id: Number(id), ...orgKeyOf(org) },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '外链线索不存在');
    return row;
  }

  private prospectView(row: SeoLinkProspect) {
    return {
      id: row.id,
      projectId: row.projectId,
      domain: row.domain,
      url: row.url,
      sourceQuery: row.sourceQuery,
      contactEmail: row.contactEmail,
      contactUrl: row.contactUrl,
      outreachAngle: row.outreachAngle,
      status: row.status,
      draftArtifactId: row.draftArtifactId,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
