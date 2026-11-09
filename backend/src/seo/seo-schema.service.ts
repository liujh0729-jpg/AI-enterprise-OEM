import { randomBytes } from 'node:crypto';
import type { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { parseJsonObject } from '../ai/ai-gateway';
import { httpRequest } from '../http/transport';
import { assertOutboundUrl } from '../http/outbound-guard';
import { SeoBase } from './seo-base.service';
import {
  buildJsonLd,
  mergeLlmText,
  requiredHints,
  SCHEMA_TYPE_NAMES,
  validateJsonLd,
  type SchemaFields,
  type SchemaType,
} from './seo-jsonld';
import {
  clip,
  iso,
  json,
  normalizeDomain,
  num,
  siteOrigin,
  strArr,
  text,
} from './seo-shared';

type IndexnowSubmission = {
  id: number;
  urls: string[];
  responseCode: number;
  submittedBy: string;
  createdAt: string;
};

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
/** 百度主动推送只提供 http（证书与主机名不匹配，https 握手失败），走守卫的常量主机例外。 */
const BAIDU_ENDPOINT = 'http://data.zz.baidu.com/urls';
const BAIDU_GUARD = { allowOfficialHttp: true } as const;

const INDEXNOW_STATUS: Record<number, string> = {
  200: '已通知参与方（Bing/Yandex/Seznam/Naver 等）',
  202: '已接收，key 文件验证仍在进行中',
  400: '请求格式不正确',
  403: 'key 无效：请确认根目录 key 文件可访问且内容与 key 一致',
  422: 'URL 与 key 所在主机不匹配，或 URL 格式不被接受',
  429: '提交过于频繁，请稍后再试',
};

export const INDEXNOW_NOTE =
  'IndexNow 只通知 Bing/Yandex/Seznam/Naver 等参与方；Google 与百度明确不参与。返回成功仅代表「已通知」，不保证抓取与收录。';

export const BAIDU_NOTE =
  '百度主动推送需站点已在百度搜索资源平台完成归属验证并开通「普通收录-主动推送」。配额由站长平台决定（看 remain）；成功仅代表「已推送」，不保证收录。';

/** 结构化数据与收录：JSON-LD 生成/校验 + IndexNow + 百度站长主动提交。 */
export class SeoSchemaService extends SeoBase {
  async generateSchema(
    user: CurrentUser,
    body: {
      projectId: number;
      type: SchemaType;
      pageUrl?: string;
      fields?: SchemaFields;
    },
  ) {
    const { row } = await this.project(user, body.projectId);
    const pageUrl = text(body.pageUrl).trim();
    if (pageUrl && !/^https?:\/\//i.test(pageUrl))
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '页面地址需要完整的 http(s):// URL',
      );
    const fields = await this.prefill(row.id, pageUrl, body.fields || {});
    const base = buildJsonLd({
      type: body.type,
      fields,
      pageUrl,
      brandName: row.brandName,
    });
    const call = await this.ai(
      user,
      [
        '你是结构化数据专家。任务：为给定的 schema.org 类型补写缺失的文案字段。',
        '硬约束：只输出一个 JSON 对象；只允许出现 description、headline、name 三个键；',
        '只依据用户提供的字段与品牌上下文写作，不得编造作者、价格、日期、评分、认证、销量等事实；',
        '没有依据就返回 {}，不要凑字数；中文文案，description 不超过 160 字。',
      ].join('\n'),
      [
        `类型：${SCHEMA_TYPE_NAMES[body.type] || body.type}`,
        `页面地址：${pageUrl || '未提供'}`,
        `品牌：${row.brandName}`,
        `已有字段：${JSON.stringify(fields)}`,
        `规则式骨架：${base}`,
      ].join('\n'),
      800,
    );
    let jsonLd = base;
    let mode: 'llm' | 'rule' = 'rule';
    if (call.reply) {
      const merged = mergeLlmText(base, call.reply, fields);
      if (merged.used) {
        jsonLd = merged.jsonLd;
        mode = 'llm';
        await this.charge(
          user,
          'seo_schema_ai',
          call,
          `seo-schema:${row.id}:${body.type}`,
        );
      }
    }
    const checked = validateJsonLd(jsonLd, pageUrl);
    const issues = [...checked.issues];
    if (!checked.valid)
      issues.unshift(
        `必填字段未齐：${requiredHints(body.type).join('、')}。请在字段里补齐后重新生成。`,
      );
    return { jsonLd: checked.jsonLd, valid: checked.valid, issues, mode };
  }

  async validateSchema(
    user: CurrentUser,
    body: { jsonLd: string; pageUrl?: string },
  ) {
    await this.org(user);
    const pageUrl = text(body.pageUrl).trim();
    const result = validateJsonLd(body.jsonLd, pageUrl);
    return { ...result, mode: 'rule' as const };
  }

  /** 从本站体检抓过的同名页面预填标题/描述：真实抓取结果，不是模型编的。 */
  private async prefill(
    projectId: number,
    pageUrl: string,
    fields: SchemaFields,
  ): Promise<SchemaFields> {
    const out: SchemaFields = { ...fields };
    if (!pageUrl) return out;
    if (out.headline || out.title || out.description) return out;
    const audits = await this.prisma.seoAudit.findMany({
      where: { projectId },
      select: { id: true },
      orderBy: { id: 'desc' },
      take: 5,
    });
    if (!audits.length) return out;
    const page = await this.prisma.seoAuditPage.findFirst({
      where: { auditId: { in: audits.map((item) => item.id) }, url: pageUrl },
      orderBy: { id: 'desc' },
    });
    if (!page) return out;
    if (!out.headline && !out.title && page.title) out.headline = page.title;
    if (!out.description && page.metaDescription)
      out.description = page.metaDescription;
    return out;
  }

  // -------------------------------------------------------------------------
  // IndexNow
  // -------------------------------------------------------------------------

  async setupIndexnow(user: CurrentUser, body: { projectId: number }) {
    const { row } = await this.project(user, body.projectId);
    const existing = await this.prisma.seoIndexnowKey.findUnique({
      where: { projectId: row.id },
    });
    if (existing)
      return this.indexnowKeyView(
        row.domain,
        existing.keyValue,
        existing.verifiedAt,
      );
    const keyValue = randomBytes(16).toString('hex');
    const created = await this.prisma.seoIndexnowKey.create({
      data: { projectId: row.id, keyValue },
    });
    return this.indexnowKeyView(
      row.domain,
      created.keyValue,
      created.verifiedAt,
    );
  }

  async verifyIndexnow(user: CurrentUser, body: { projectId: number }) {
    const { row } = await this.project(user, body.projectId);
    const key = await this.prisma.seoIndexnowKey.findUnique({
      where: { projectId: row.id },
    });
    if (!key)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请先生成 IndexNow key',
      );
    const fileUrl = `${siteOrigin(row.domain)}/${key.keyValue}.txt`;
    let bodyText = '';
    try {
      await assertOutboundUrl(fileUrl, 'IndexNow key 文件');
      const response = await httpRequest<string>(fileUrl, {
        readAs: 'text',
        timeoutMs: 20_000,
        maxBytes: 8 * 1024,
        redirect: 'manual',
        operation: 'seo.indexnow.verify',
        limiterKey: 'seo-crawl',
        concurrency: 2,
        headers: { 'user-agent': 'OEMEnterpriseSEO/1.0' },
      });
      if (!response.ok)
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `key 文件返回 HTTP ${response.status}：请把 ${key.keyValue}.txt 放到站点根目录，内容就是 key 本身（一行、无多余字符）`,
        );
      bodyText = text(response.data).trim();
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `无法抓取 key 文件（${fileUrl}）：${error instanceof Error ? error.message : '网络错误'}。本期只支持根目录 key 文件验证；若站点（SaaS/CDN）放不了根文件，请改由站点自行完成 IndexNow 验证，本系统不代验。`,
      );
    }
    if (bodyText !== key.keyValue)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `key 文件内容与系统生成的 key 不一致（读到 ${clip(bodyText, 40) || '空内容'}），请检查是否多了换行/BOM/HTML 包装`,
      );
    const updated = await this.prisma.seoIndexnowKey.update({
      where: { projectId: row.id },
      data: { verifiedAt: new Date() },
    });
    return this.indexnowKeyView(
      row.domain,
      updated.keyValue,
      updated.verifiedAt,
    );
  }

  async submitIndexnow(
    user: CurrentUser,
    body: { projectId: number; urls: string[] },
  ): Promise<IndexnowSubmission> {
    const { org, row } = await this.project(user, body.projectId);
    const key = await this.prisma.seoIndexnowKey.findUnique({
      where: { projectId: row.id },
    });
    if (!key?.verifiedAt)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请先完成 key 文件托管验证再提交（生成 key → 托管到根目录 → 点验证）',
      );
    const urls = this.sameHostUrls(body.urls, row.domain);
    const keyLocation = `${siteOrigin(row.domain)}/${key.keyValue}.txt`;
    const payload = {
      host: normalizeDomain(row.domain),
      key: key.keyValue,
      keyLocation,
      urlList: urls,
    };
    await assertOutboundUrl(INDEXNOW_ENDPOINT, 'IndexNow 提交端点');
    const response = await httpRequest<unknown>(INDEXNOW_ENDPOINT, {
      method: 'POST',
      readAs: 'text',
      timeoutMs: 30_000,
      maxBytes: 64 * 1024,
      redirect: 'manual',
      operation: 'seo.indexnow.submit',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
    });
    const created = await this.prisma.seoIndexnowSubmission.create({
      data: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        projectId: row.id,
        urls: json(urls),
        responseCode: response.status,
        submittedBy: user.userId,
      },
    });
    if (!response.ok)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `IndexNow 提交失败（HTTP ${response.status}）：${INDEXNOW_STATUS[response.status] || '上游拒绝，请检查 key 与 URL 主机是否一致'}。本次已记入台账。`,
      );
    return this.indexnowView(created);
  }

  async indexnowHistory(user: CurrentUser, query: { projectId: number }) {
    const { row } = await this.project(user, query.projectId);
    const rows = await this.prisma.seoIndexnowSubmission.findMany({
      where: { projectId: row.id },
      orderBy: { id: 'desc' },
      take: 50,
    });
    return rows.map((item) => this.indexnowView(item));
  }

  private indexnowKeyView(
    domain: string,
    keyValue: string,
    verifiedAt: Date | null,
  ) {
    return {
      keyValue,
      verifiedAt: iso(verifiedAt),
      keyFileUrl: `${siteOrigin(domain)}/${keyValue}.txt`,
    };
  }

  private indexnowView(row: {
    id: number;
    urls: unknown;
    responseCode: number;
    submittedBy: string;
    createdAt: Date;
  }): IndexnowSubmission {
    return {
      id: row.id,
      urls: strArr(row.urls),
      responseCode: row.responseCode,
      submittedBy: row.submittedBy,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** IndexNow/百度都要求 URL 属于已验证的那个主机，跨主机提交注定被拒，先拦下。 */
  private sameHostUrls(urls: string[], domain: string): string[] {
    const host = normalizeDomain(domain);
    const list = [
      ...new Set(urls.map((item) => text(item).trim()).filter(Boolean)),
    ];
    if (!list.length)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请至少填写一个待提交 URL',
      );
    const bad: string[] = [];
    for (const value of list) {
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        bad.push(value);
        continue;
      }
      if (!/^https?:$/.test(parsed.protocol)) bad.push(value);
      else if (parsed.hostname.toLowerCase() !== host) bad.push(value);
    }
    if (bad.length)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `以下 URL 不属于站点主机 ${host}，收录提交只接受同一主机：${bad.slice(0, 5).join('、')}${bad.length > 5 ? ` 等 ${bad.length} 条` : ''}`,
      );
    return list;
  }

  // -------------------------------------------------------------------------
  // 百度站长主动提交
  // -------------------------------------------------------------------------

  async baiduCredential(user: CurrentUser, query: { projectId: number }) {
    const { row } = await this.project(user, query.projectId);
    const credential = await this.prisma.seoBaiduCredential.findUnique({
      where: { projectId: row.id },
    });
    return {
      site: credential?.site || row.domain,
      configured: Boolean(credential?.tokenCipher),
    };
  }

  async saveBaiduCredential(
    user: CurrentUser,
    body: { projectId: number; site: string; token?: string },
  ) {
    const { row } = await this.project(user, body.projectId);
    const site = text(body.site).trim().replace(/\/+$/, '');
    if (!site)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写百度搜索资源平台里登记的站点',
      );
    const existing = await this.prisma.seoBaiduCredential.findUnique({
      where: { projectId: row.id },
    });
    const token = text(body.token).trim();
    const cipher = token
      ? this.ctx.crypto.encrypt(token)
      : existing?.tokenCipher || '';
    if (!cipher)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写百度搜索资源平台的主动推送 token（准入密钥）',
      );
    const probeUrl = /^https?:\/\//i.test(site)
      ? `${site}/`
      : `https://${site}/`;
    const plain = token || this.ctx.crypto.decrypt(cipher);
    const probe = await this.pushBaidu(site, plain, [probeUrl]);
    if (probe.error)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `百度凭证校验失败：${probe.error}。请确认 token 正确、站点已完成归属验证并开通「普通收录-主动推送」。`,
      );
    if (probe.notSameSite.length)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `百度返回 not_same_site：站点 ${site} 未通过归属验证或与 token 不匹配，请先在百度搜索资源平台完成验证。`,
      );
    if (probe.notValid.length)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `百度把探针 URL 判为无效（not_valid）：${probe.notValid.slice(0, 3).join('、')}。请确认站点可正常访问、URL 属于该站点。`,
      );
    await this.prisma.seoBaiduCredential.upsert({
      where: { projectId: row.id },
      create: { projectId: row.id, site, tokenCipher: cipher },
      update: { site, tokenCipher: cipher },
    });
    return { site, configured: true };
  }

  async submitBaidu(
    user: CurrentUser,
    body: { projectId: number; urls: string[] },
  ) {
    const { org, row } = await this.project(user, body.projectId);
    const credential = await this.prisma.seoBaiduCredential.findUnique({
      where: { projectId: row.id },
    });
    if (!credential?.tokenCipher)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '未配置百度站长凭证：请先在「结构化数据与收录」里填站点与主动推送 token',
      );
    const urls = this.sameHostUrls(body.urls, row.domain);
    const result = await this.pushBaidu(
      credential.site,
      this.ctx.crypto.decrypt(credential.tokenCipher),
      urls,
    );
    const created = await this.prisma.seoBaiduSubmission.create({
      data: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        projectId: row.id,
        urls: json(urls),
        response: json({
          success: result.success,
          remain: result.remain,
          not_valid: result.notValid,
          not_same_site: result.notSameSite,
          error: result.error,
        }),
        submittedBy: user.userId,
      },
    });
    if (result.error)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `百度推送失败：${result.error}。本次已记入台账。`,
      );
    return this.baiduView(created);
  }

  async baiduHistory(user: CurrentUser, query: { projectId: number }) {
    const { row } = await this.project(user, query.projectId);
    const rows = await this.prisma.seoBaiduSubmission.findMany({
      where: { projectId: row.id },
      orderBy: { id: 'desc' },
      take: 50,
    });
    return rows.map((item) => this.baiduView(item));
  }

  /** 百度推送：POST 纯文本，每行一个 URL；响应可能是 JSON 也可能是错误文本。 */
  private async pushBaidu(
    site: string,
    token: string,
    urls: string[],
  ): Promise<{
    success: number;
    remain: number | null;
    notValid: string[];
    notSameSite: string[];
    error: string;
  }> {
    const url = `${BAIDU_ENDPOINT}?site=${encodeURIComponent(site)}&token=${encodeURIComponent(token)}`;
    await assertOutboundUrl(url, '百度主动推送端点', BAIDU_GUARD);
    let raw = '';
    let status = 0;
    try {
      const response = await httpRequest<string>(url, {
        method: 'POST',
        readAs: 'text',
        timeoutMs: 30_000,
        maxBytes: 256 * 1024,
        redirect: 'manual',
        operation: 'seo.baidu.submit',
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        body: urls.join('\n'),
      });
      status = response.status;
      raw = text(response.data);
    } catch (error) {
      return {
        success: 0,
        remain: null,
        notValid: [],
        notSameSite: [],
        error: `无法连接百度推送端点：${error instanceof Error ? error.message : '网络错误'}`,
      };
    }
    const parsed = parseJsonObject(raw);
    if (!parsed)
      return {
        success: 0,
        remain: null,
        notValid: [],
        notSameSite: [],
        error: `百度返回 HTTP ${status} 且响应不是 JSON：${clip(raw, 200) || '空响应'}`,
      };
    const errorValue = num(parsed.error, 0);
    return {
      success: num(parsed.success, 0),
      remain: parsed.remain === undefined ? null : num(parsed.remain, 0),
      notValid: strArr(parsed.not_valid),
      notSameSite: strArr(parsed.not_same_site),
      error: errorValue
        ? `${clip(parsed.message, 200) || '百度返回错误'}（error=${errorValue}）`
        : '',
    };
  }

  private baiduView(row: {
    id: number;
    urls: unknown;
    response: unknown;
    submittedBy: string;
    createdAt: Date;
  }) {
    const response = (row.response || {}) as Record<string, unknown>;
    return {
      id: row.id,
      urls: strArr(row.urls),
      success: num(response.success, 0),
      remain:
        response.remain === undefined || response.remain === null
          ? null
          : num(response.remain, 0),
      notValid: strArr(response.not_valid),
      submittedBy: row.submittedBy,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
