import type { CurrentUser } from '../auth/current-user';
import type {
  SeoProgrammaticPage,
  SeoProgrammaticRun,
} from '../../generated/prisma';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { parseJsonObject } from '../ai/ai-gateway';
import { createZip } from '../content/zip-write';
import { orgKeyOf, SeoBase } from './seo-base.service';
import {
  defaultTemplate,
  hubHtml,
  pageHtml,
  pageJsonLd,
  pageUrl,
  renderPlain,
  renderTemplate,
  sitemapXml,
  templateKeys,
  uniqueSlug,
  type ProgrammaticPageInput,
  type TemplateValues,
} from './seo-programmatic';
import { clip, siteOrigin, text } from './seo-shared';

const LLM_BATCH = 3;

type SourceRow = { values: TemplateValues; label: string };

/** 程序化 SEO：多维表格 → 批量页面。确定性模板打底，LLM 只补首屏文案。 */
export class SeoProgrammaticService extends SeoBase {
  async programmaticPreview(
    user: CurrentUser,
    body: {
      projectId: number;
      tableId: number;
      keywordPattern?: string;
      template?: string;
      sampleRows?: number;
    },
  ) {
    const { row } = await this.project(user, body.projectId);
    const limit = Math.min(5, Math.max(1, Number(body.sampleRows) || 3));
    const source = await this.source(user, body.tableId, limit);
    const built = await this.resolveTemplate(
      user,
      row.id,
      body.template || '',
      source.columns,
      source.rows,
      body.keywordPattern || '',
    );
    const pages = this.renderPages({
      rows: source.rows,
      template: built.template,
      keywordPattern: body.keywordPattern || '',
      origin: siteOrigin(row.domain),
      brandName: row.brandName,
      hubTitle: this.hubTitle(row.brandName, body.keywordPattern || ''),
    });
    return {
      pages: pages.map((page) => ({ id: 0, runId: 0, ...page })),
      template: built.template,
      mode: built.mode,
    };
  }

  async programmaticGenerate(
    user: CurrentUser,
    body: {
      projectId: number;
      tableId: number;
      keywordPattern?: string;
      template?: string;
      maxRows?: number;
    },
  ) {
    const { org, row } = await this.project(user, body.projectId);
    const limit = Math.min(200, Math.max(1, Number(body.maxRows) || 50));
    const source = await this.source(user, body.tableId, limit);
    if (!source.rows.length)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '数据源表里没有行，请先在多维表格录入数据',
      );
    const table = await this.prisma.dataTable.findUnique({
      where: { id: body.tableId },
      select: { name: true },
    });
    const run = await this.prisma.seoProgrammaticRun.create({
      data: {
        ...orgKeyOf(org),
        projectId: row.id,
        tableId: body.tableId,
        tableName: clip(table?.name, 120),
        keywordPattern: clip(body.keywordPattern, 200),
        template: '',
        rowCount: 0,
        status: 'RUNNING',
      },
    });
    void this.execute(user, run.id, {
      domain: row.domain,
      brandName: row.brandName,
      keywordPattern: body.keywordPattern || '',
      template: body.template || '',
      columns: source.columns,
      rows: source.rows,
    });
    return this.runView(run);
  }

  async programmaticRuns(user: CurrentUser, query: { projectId: number }) {
    const { org, row } = await this.project(user, query.projectId);
    const runs = await this.prisma.seoProgrammaticRun.findMany({
      where: { ...orgKeyOf(org), projectId: row.id },
      orderBy: { id: 'desc' },
      take: 20,
    });
    return runs.map((item) => this.runView(item));
  }

  async programmaticPages(user: CurrentUser, query: { runId: number }) {
    const run = await this.run(user, query.runId);
    const pages = await this.prisma.seoProgrammaticPage.findMany({
      where: { runId: run.id },
      orderBy: { id: 'asc' },
      take: 200,
    });
    return pages.map((page) => this.pageView(page));
  }

  async programmaticExport(user: CurrentUser, query: { runId: number }) {
    const run = await this.run(user, query.runId);
    if (run.status !== 'DONE')
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '生成尚未完成，完成后才能导出',
      );
    const project = await this.prisma.seoProject.findUnique({
      where: { id: run.projectId },
    });
    if (!project)
      throw new BusinessException(ErrorCode.NOT_FOUND, 'SEO 站点档案不存在');
    const pages = await this.prisma.seoProgrammaticPage.findMany({
      where: { runId: run.id },
      orderBy: { id: 'asc' },
      take: 200,
    });
    if (!pages.length)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '这次生成没有页面可导出',
      );
    const origin = siteOrigin(project.domain);
    const hubTitle = this.hubTitle(project.brandName, run.keywordPattern);
    const entries = pages.map((page) => ({
      path: `${page.slug}/index.html`,
      content: pageHtml({
        title: page.title,
        metaDescription: page.metaDescription,
        body: page.body,
        jsonLd: page.jsonLd,
        canonical: pageUrl(origin, page.slug),
        hubUrl: '../',
        hubTitle,
        brandName: project.brandName,
      }),
    }));
    entries.push({
      path: 'index.html',
      content: hubHtml({
        title: hubTitle,
        description: `${project.brandName} ${run.keywordPattern} 相关页面索引，共 ${pages.length} 页。`,
        origin,
        brandName: project.brandName,
        pages: pages.map((page) => ({ slug: page.slug, title: page.title })),
      }),
    });
    entries.push({
      path: 'sitemap.xml',
      content: sitemapXml(
        [`${origin}/`, ...pages.map((page) => pageUrl(origin, page.slug))],
        run.createdAt,
      ),
    });
    let bundle: Buffer;
    try {
      bundle = createZip(entries, run.createdAt);
    } catch (error) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `导出包超出限制（最多 500 个文件 / 10MB）：${error instanceof Error ? error.message : '打包失败'}。请减少生成行数后重试。`,
      );
    }
    return {
      fileName: `seo-pages-${project.domain}-${run.id}.zip`,
      contentBase64: bundle.toString('base64'),
    };
  }

  // -------------------------------------------------------------------------

  private async execute(
    user: CurrentUser,
    runId: number,
    input: {
      domain: string;
      brandName: string;
      keywordPattern: string;
      template: string;
      columns: string[];
      rows: SourceRow[];
    },
  ): Promise<void> {
    try {
      const built = await this.resolveTemplate(
        user,
        runId,
        input.template,
        input.columns,
        input.rows.slice(0, 3),
        input.keywordPattern,
      );
      const origin = siteOrigin(input.domain);
      const hubTitle = this.hubTitle(input.brandName, input.keywordPattern);
      const pages = this.renderPages({
        rows: input.rows,
        template: built.template,
        keywordPattern: input.keywordPattern,
        origin,
        brandName: input.brandName,
        hubTitle,
      });
      // LLM 只补首屏摘要，正文始终走模板：逐行 1 次调用，命中才计积分。
      for (let at = 0; at < pages.length; at += LLM_BATCH) {
        const batch = pages.slice(at, at + LLM_BATCH);
        await Promise.all(
          batch.map(async (page, index) => {
            const row = input.rows[at + index];
            const call = await this.ai(
              user,
              [
                '你是 SEO 文案编辑。任务：为批量生成的页面写一条 meta description。',
                '硬约束：只输出 JSON 对象 {"description":"..."}；不超过 160 字；',
                '只能依据给出的行数据与页面标题，不得编造价格、认证、销量、排名承诺；',
                '数据不足就返回 {}。',
              ].join('\n'),
              [
                `品牌：${input.brandName}`,
                `关键词模式：${input.keywordPattern || '未设置'}`,
                `页面标题：${page.title}`,
                `行数据：${JSON.stringify(row.values)}`,
              ].join('\n'),
              300,
            );
            if (!call.reply) return;
            const parsed = parseJsonObject(call.reply);
            const description = clip(parsed?.description, 160).trim();
            if (!description) return;
            page.metaDescription = description;
            await this.charge(
              user,
              'seo_programmatic_ai',
              call,
              `seo-programmatic:${runId}:${page.slug}`,
            );
          }),
        );
      }
      await this.prisma.$transaction([
        this.prisma.seoProgrammaticPage.deleteMany({ where: { runId } }),
        this.prisma.seoProgrammaticPage.createMany({
          data: pages.map((page) => ({
            runId,
            slug: page.slug,
            title: page.title,
            metaDescription: page.metaDescription,
            body: page.body,
            jsonLd: page.jsonLd,
          })),
        }),
        this.prisma.seoProgrammaticRun.update({
          where: { id: runId },
          data: {
            status: 'DONE',
            rowCount: pages.length,
            template: built.template,
          },
        }),
      ]);
    } catch {
      await this.prisma.seoProgrammaticRun
        .update({ where: { id: runId }, data: { status: 'FAILED' } })
        .catch(() => undefined);
    }
  }

  /** 模板来源：用户自带 > LLM 按样例行生成 > 确定性骨架。 */
  private async resolveTemplate(
    user: CurrentUser,
    refId: number,
    template: string,
    columns: string[],
    rows: SourceRow[],
    keywordPattern: string,
  ): Promise<{ template: string; mode: 'llm' | 'rule' }> {
    const given = template.trim();
    if (given) {
      const unknown = templateKeys(given).filter(
        (key) => !columns.includes(key),
      );
      if (unknown.length)
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          `模板里的占位符在数据源表中不存在：${unknown.slice(0, 5).join('、')}。可用列：${columns.join('、')}`,
        );
      return { template: given, mode: 'rule' };
    }
    const call = await this.ai(
      user,
      [
        '你是 SEO 页面模板工程师。任务：按数据源列名写一段可复用的 HTML 正文模板。',
        '硬约束：只输出 HTML 片段（不含 <html>/<head>/<body>）；用 {{列名}} 占位，列名必须与给出的列完全一致；',
        '包含一个 <h1>、若干 <h2> 小节与对比/参数表格；不得编造任何具体数值、认证或承诺；',
        '中文，面向搜索引擎与真实读者，不要堆砌关键词。',
      ].join('\n'),
      [
        `可用列：${columns.join('、')}`,
        `目标关键词模式：${keywordPattern || '未设置'}`,
        `样例行：${JSON.stringify(rows.slice(0, 3).map((row) => row.values))}`,
      ].join('\n'),
      1500,
    );
    const reply = (call.reply || '').trim();
    const html = reply
      .replace(/^```(?:html)?/i, '')
      .replace(/```$/, '')
      .trim();
    if (html && html.includes('{{')) {
      const unknown = templateKeys(html).filter(
        (key) => !columns.includes(key),
      );
      const usable = unknown.length
        ? defaultTemplate(columns, keywordPattern)
        : html;
      await this.charge(
        user,
        'seo_programmatic_ai',
        call,
        `seo-programmatic-template:${refId}`,
      );
      return { template: usable, mode: unknown.length ? 'rule' : 'llm' };
    }
    return { template: defaultTemplate(columns, keywordPattern), mode: 'rule' };
  }

  private renderPages(input: {
    rows: SourceRow[];
    template: string;
    keywordPattern: string;
    origin: string;
    brandName: string;
    hubTitle: string;
  }): ProgrammaticPageInput[] {
    const used = new Set<string>();
    return input.rows.map((row) => {
      const keyword = input.keywordPattern
        ? renderPlain(input.keywordPattern, row.values).trim()
        : row.label;
      const slug = uniqueSlug(keyword || row.label, used);
      const title = clip(
        keyword ? `${keyword} | ${input.brandName}` : row.label,
        300,
      );
      const body = renderTemplate(input.template, row.values);
      const description = clip(
        body
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim(),
        160,
      );
      return {
        slug,
        title,
        metaDescription: description,
        body,
        jsonLd: pageJsonLd({
          origin: input.origin,
          slug,
          title,
          description,
          keywords: keyword,
          brandName: input.brandName,
          hubTitle: input.hubTitle,
        }),
      };
    });
  }

  /** 读表走 DataTableService 的授权校验；列名与 fieldKey 都可作为占位符。 */
  private async source(user: CurrentUser, tableId: number, limit: number) {
    const fields = await this.ctx.tables.fieldsOf(tableId);
    if (!fields.length)
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '数据源表还没有列，请先在多维表格建列',
      );
    const rows = await this.ctx.tables.listRowsByOffset(
      user,
      tableId,
      limit,
      0,
    );
    const columns = fields.map((field) => field.name || field.fieldKey);
    return {
      columns,
      rows: rows.map((row): SourceRow => {
        const values: TemplateValues = {};
        for (const field of fields) {
          const value = text(row.data[field.fieldKey]);
          values[field.fieldKey] = value;
          if (field.name) values[field.name] = value;
        }
        const label =
          columns.map((name) => values[name]).find((value) => value.trim()) ||
          `row-${row.id}`;
        return { values, label: clip(label, 200) };
      }),
    };
  }

  private hubTitle(brandName: string, keywordPattern: string): string {
    const keyword = keywordPattern.replace(/\{\{[^}]+\}\}/g, '').trim();
    return clip(
      keyword ? `${brandName} ${keyword}` : `${brandName} 页面索引`,
      120,
    );
  }

  private async run(
    user: CurrentUser,
    runId: number,
  ): Promise<SeoProgrammaticRun> {
    const org = await this.org(user);
    const row = await this.prisma.seoProgrammaticRun.findFirst({
      where: { id: Number(runId), ...orgKeyOf(org) },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '生成批次不存在');
    return row;
  }

  private runView(row: SeoProgrammaticRun) {
    return {
      id: row.id,
      projectId: row.projectId,
      tableId: row.tableId,
      tableName: row.tableName,
      keywordPattern: row.keywordPattern,
      rowCount: row.rowCount,
      status: row.status as 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED',
      createdAt: row.createdAt.toISOString(),
    };
  }

  private pageView(row: SeoProgrammaticPage) {
    return {
      id: row.id,
      runId: row.runId,
      slug: row.slug,
      title: row.title,
      metaDescription: row.metaDescription,
      body: row.body,
      jsonLd: row.jsonLd,
    };
  }
}
