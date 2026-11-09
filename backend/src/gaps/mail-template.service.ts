import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { toJsonInput } from '../common/json-input';
import type { CurrentUser } from '../auth/current-user';
import type { PrismaService } from '../prisma/prisma.service';
import type { MailboxService } from '../mailbox/mailbox.service';
import type { GapScopeService } from './gaps.scope';
import {
  asBool,
  asInt,
  asText,
  clip,
  htmlToText,
  iso,
  jsonArray,
  jsonBlock,
  renderVars,
  Row,
  varsIn,
} from './gaps.helpers';

type TemplateRow = {
  id: number;
  orgType: string;
  orgUserId: string;
  code: string;
  name: string;
  locale: string;
  subject: string;
  html: string;
  text: string;
  variables: unknown;
  enabled: boolean;
  updatedBy: string;
  updatedAt: Date;
};

/**
 * B1#10 邮件模板体系：站内触发点 → 模板（按 code + locale）→ 渲染预览 → 测试发送。
 * 变量占位统一 `{{key}}`，保存时把声明列表与实际占位对齐，避免「模板里有、声明里没有」。
 */
export class MailTemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: GapScopeService,
    private readonly mailbox: MailboxService,
  ) {}

  private view(row: TemplateRow) {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      locale: row.locale,
      subject: row.subject,
      html: row.html,
      text: row.text,
      variables: jsonArray(row.variables).map((item) => ({
        key: asText(item.key).slice(0, 48),
        label: clip(item.label, 64),
        required: asBool(item.required),
      })),
      enabled: row.enabled,
      updatedBy: row.updatedBy,
      updatedAt: iso(row.updatedAt),
    };
  }

  async templates(user: CurrentUser, query: Row) {
    const org = await this.scope.resolve(user);
    const q = asText(query.q).trim();
    const rows = await this.prisma.emailTemplate.findMany({
      where: {
        orgType: org.orgType,
        orgUserId: org.orgUserId,
        ...(q
          ? {
              OR: [
                { code: { contains: q } },
                { name: { contains: q } },
                { subject: { contains: q } },
              ],
            }
          : {}),
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map((row) => this.view(row));
  }

  private async owned(user: CurrentUser, idRaw: string | number) {
    const org = await this.scope.resolve(user);
    const row = await this.prisma.emailTemplate.findFirst({
      where: {
        id: asInt(idRaw),
        orgType: org.orgType,
        orgUserId: org.orgUserId,
      },
    });
    if (!row)
      throw new BusinessException(ErrorCode.NOT_FOUND, '邮件模板不存在');
    return { org, row };
  }

  async template(user: CurrentUser, idRaw: string) {
    const { row } = await this.owned(user, idRaw);
    return this.view(row);
  }

  async saveTemplate(user: CurrentUser, body: Row) {
    const org = await this.scope.requireAdmin(user);
    const id = asInt(body.id);
    const code = asText(body.code).trim().toUpperCase().slice(0, 48);
    const name = clip(body.name, 80).trim();
    const locale = asText(body.locale).trim() || 'zh-CN';
    const subject = clip(body.subject, 200).trim();
    if (code.length < 2)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写模板编码');
    if (!name)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写模板名称');
    if (!subject)
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写邮件主题');
    const html = asText(body.html).slice(0, 200_000);
    const text = asText(body.text).slice(0, 20_000);
    const declared = Array.isArray(body.variables)
      ? body.variables.map((item) => {
          const row = item as Row;
          return {
            key: asText(row.key).slice(0, 48),
            label: clip(row.label, 64) || asText(row.key).slice(0, 48),
            required: asBool(row.required),
          };
        })
      : [];
    const used = varsIn(`${subject}\n${html}\n${text}`);
    const merged = [
      ...declared.filter((item) => item.key),
      ...used
        .filter((key) => !declared.some((item) => item.key === key))
        .map((key) => ({ key, label: key, required: false })),
    ].slice(0, 50);
    const data = {
      code,
      name,
      locale,
      subject,
      html,
      text,
      variables: toJsonInput(merged),
      enabled: asBool(body.enabled, true),
      updatedBy: org.actorId,
    };
    const existing = id
      ? await this.prisma.emailTemplate.findFirst({
          where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
        })
      : null;
    if (id && !existing)
      throw new BusinessException(ErrorCode.NOT_FOUND, '邮件模板不存在');
    const conflict = await this.prisma.emailTemplate.findFirst({
      where: { orgType: org.orgType, orgUserId: org.orgUserId, code, locale },
    });
    if (conflict && conflict.id !== existing?.id) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '同编码、同语言的模板已存在，请直接编辑那一条',
      );
    }
    const row = existing
      ? await this.prisma.emailTemplate.update({
          where: { id: existing.id },
          data,
        })
      : await this.prisma.emailTemplate.create({
          data: { ...data, orgType: org.orgType, orgUserId: org.orgUserId },
        });
    return this.view(row);
  }

  async removeTemplate(user: CurrentUser, idRaw: number) {
    const { row } = await this.owned(user, idRaw);
    await this.scope.requireAdmin(user);
    await this.prisma.emailTemplate.delete({ where: { id: row.id } });
    return { removed: true };
  }

  async preview(user: CurrentUser, body: Row) {
    const org = await this.scope.resolve(user);
    const id = asInt(body.id);
    const existing = id
      ? await this.prisma.emailTemplate.findFirst({
          where: { id, orgType: org.orgType, orgUserId: org.orgUserId },
        })
      : null;
    if (id && !existing)
      throw new BusinessException(ErrorCode.NOT_FOUND, '邮件模板不存在');
    const subjectTpl = asText(body.subject) || existing?.subject || '';
    const htmlTpl = asText(body.html) || existing?.html || '';
    const textTpl = asText(body.text) || existing?.text || '';
    const vars = jsonBlock(body.variables);
    const subject = renderVars(subjectTpl, vars);
    const html = renderVars(htmlTpl, vars);
    const text = renderVars(textTpl || htmlToText(htmlTpl), vars);
    return {
      subject: subject.text,
      html: html.text,
      text: text.text,
      missing: [
        ...new Set([...subject.missing, ...html.missing, ...text.missing]),
      ],
    };
  }

  async sendTest(user: CurrentUser, body: Row) {
    const { row } = await this.owned(user, asInt(body.id));
    const to = asText(body.to).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写正确的收件人邮箱',
      );
    }
    const vars = jsonBlock(body.variables);
    const subject = renderVars(row.subject, vars);
    const html = renderVars(row.html, vars);
    const text = renderVars(row.text || htmlToText(row.html), vars);
    const required = jsonArray(row.variables)
      .filter((item) => asBool(item.required))
      .map((item) => asText(item.key));
    const missing = required.filter((key) => !vars[key]);
    if (missing.length) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `缺少必填变量：${missing.join('、')}`,
      );
    }
    const { savedTo } = await this.mailbox.sendTemplate(
      user,
      String(asInt(body.mailboxId)),
      {
        to,
        subject: subject.text,
        body: text.text || htmlToText(html.text),
      },
    );
    return { sent: true, savedTo };
  }
}
