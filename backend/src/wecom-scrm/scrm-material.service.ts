import type { CurrentUser } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import type { PrismaService } from '../prisma/prisma.service';
import type { HrmOrg } from '../hrm/hrm.scope';
import { clip, iso } from '../hrm/hrm.helpers';
import { ScrmScopeService } from './scrm.scope';
import { int, json, orgKey, strArr, text } from './scrm.helpers';

/** 企微素材库：群发、欢迎语、侧边栏共用；图片/文件只存数字资产引用。 */
export class ScrmMaterialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScrmScopeService,
  ) {}

  private view(row: {
    id: number;
    type: string;
    title: string;
    content: string;
    assetId: number;
    link: string;
    miniProgram: unknown;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      content: row.content,
      assetId: row.assetId,
      link: row.link,
      miniProgram:
        row.miniProgram && typeof row.miniProgram === 'object'
          ? (row.miniProgram as Record<string, unknown>)
          : {},
      createdAt: iso(row.createdAt),
    };
  }

  async list(user: CurrentUser) {
    return this.listFor(await this.scope.resolve(user));
  }

  async listFor(org: HrmOrg) {
    const rows = await this.prisma.scrmMaterial.findMany({
      where: orgKey(org),
      orderBy: { id: 'desc' },
      take: 500,
    });
    return rows.map((row) => this.view(row));
  }

  async save(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.scope.resolve(user);
    const id = int(body.id);
    const title = clip(body.title, 80).trim();
    if (!title) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请填写素材标题');
    }
    const type = text(body.type) || 'TEXT';
    if (type === 'LINK' && !clip(body.link, 500).trim()) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '外链素材必须填写链接地址',
      );
    }
    if ((type === 'IMAGE' || type === 'FILE') && !int(body.assetId)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '图片/文件素材请先从数字资产选择文件',
      );
    }
    const data = {
      type,
      title,
      content: clip(body.content, 2000),
      assetId: int(body.assetId),
      link: clip(body.link, 500),
      miniProgram: json(
        body.miniProgram && typeof body.miniProgram === 'object'
          ? body.miniProgram
          : {},
      ),
    };
    const row = id
      ? await this.prisma.scrmMaterial.update({ where: { id }, data })
      : await this.prisma.scrmMaterial.create({
          data: { ...orgKey(org), createdBy: user.userId, ...data },
        });
    return this.view(row);
  }

  async remove(user: CurrentUser, body: Record<string, unknown>) {
    const org = await this.scope.requireAdmin(user);
    const id = int(body.id);
    const row = await this.prisma.scrmMaterial.findFirst({
      where: { ...orgKey(org), id },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '素材不存在');
    }
    await this.prisma.scrmMaterial.delete({ where: { id: row.id } });
    return { id: row.id };
  }

  /** 内部：欢迎语/群发按 id 取素材（文本与附件拼装用）。 */
  async byIds(org: { orgType: string; orgUserId: string }, ids: number[]) {
    if (!ids.length) return [];
    const rows = await this.prisma.scrmMaterial.findMany({
      where: { ...orgKey(org), id: { in: ids } },
    });
    return rows.map((row) => this.view(row));
  }

  /** 内部：把素材拼成企微文本 + 附件结构。 */
  buildAttachments(
    materials: {
      type: string;
      title: string;
      content: string;
      link: string;
      miniProgram: Record<string, unknown>;
    }[],
  ): Record<string, unknown>[] {
    const attachments: Record<string, unknown>[] = [];
    for (const material of materials) {
      if (material.type === 'LINK' && material.link) {
        attachments.push({
          msgtype: 'link',
          link: {
            title: material.title,
            url: material.link,
            desc: material.content.slice(0, 300),
          },
        });
      } else if (material.type === 'MINIPROGRAM') {
        const appId = text(material.miniProgram.appId).trim();
        if (appId) {
          attachments.push({
            msgtype: 'miniprogram',
            miniprogram: {
              appid: appId,
              title: material.title,
              page: text(material.miniProgram.page),
            },
          });
        }
      }
    }
    return attachments;
  }

  /** 内部：素材里的纯文本部分（群发正文追加）。 */
  textOf(materials: { type: string; content: string }[]): string {
    return materials
      .filter((material) => material.type === 'TEXT' && material.content)
      .map((material) => material.content)
      .join('\n')
      .slice(0, 2000);
  }

  /** 内部：素材 id 归一（欢迎语/群发表单里可能传字符串）。 */
  idsOf(value: unknown): number[] {
    return strArr(value)
      .map((item) => int(item))
      .filter(Boolean);
  }
}
