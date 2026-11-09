import type { CurrentUser } from '../auth/current-user';
import { ErrorCode } from '../common/error-code';
import { BusinessException } from '../common/business.exception';
import type { PrismaService } from '../prisma/prisma.service';
import type { KbSource } from '../../generated/prisma';
import { sha256Hex } from './kb-llm';
import { KbSpaceService, putLog } from './kb-space.service';
import { clip, excerptOf, iso } from './kb-util';

/**
 * 原始资料层（§10.3 Raw，不可变只读）：hash 去重（同空间同内容返回既有行）。
 * 入口类型（AI 底座 §5 P1-A）：TEXT 直投、UPLOAD 文件上传（走本站 OSS 桶）、
 * URL 抓取、FEISHU 文档导入、OCR 图像/音视频解析——URL/UPLOAD/FEISHU/OCR 的
 * 抽取逻辑在 KbIntakeService，本服务只做「落行去重 + 台账」这一件事。
 * assetId 引用数字资产：资产上传时已抽正文（DigitalAssetEntry.text），这里直接取用可编译
 * （修「资产不存正文导致投料即 FAILED」的断链；仍为空则如实 FAILED 提示补文）。
 */

export interface AddSourceInput {
  spaceId: number;
  kind:
    | 'article'
    | 'paper'
    | 'transcript'
    | 'meeting'
    | 'customer-call'
    | 'note'
    | 'image';
  title: string;
  text: string;
  assetId: number;
  /** 兼容旧客户端：显式声明入口类型，缺省 TEXT */
  type?: 'TEXT' | 'UPLOAD' | 'URL' | 'FEISHU' | 'OCR';
  url?: string;
}

/** 抽取后的落行入参（KbIntakeService 与直投共用）。 */
export interface ExtractedSourceInput {
  spaceId: number;
  kind: string;
  type: 'TEXT' | 'UPLOAD' | 'URL' | 'FEISHU' | 'OCR';
  title: string;
  text: string;
  assetId?: number;
  originUrl?: string;
  ossKey?: string;
  /** 正文为空时的失败说明（缺省用通用文案）；OCR/音视频类给明确指引 */
  errorNote?: string;
}

export type KbSourceView = ReturnType<typeof toView>;

function toView(row: KbSource) {
  return {
    id: row.id,
    spaceId: row.spaceId,
    assetId: row.assetId,
    kind: row.kind,
    type: row.type,
    originUrl: row.originUrl,
    title: row.title,
    hash: row.hash,
    status: row.status,
    error: row.error,
    excerpt: excerptOf(row.text),
    chars: row.text.length,
    ingestedAt: iso(row.ingestedAt),
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
  };
}

export class KbSourceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly spaces: KbSpaceService,
  ) {}

  async addSource(
    body: AddSourceInput,
    user: CurrentUser,
  ): Promise<KbSourceView> {
    const space = await this.spaces.loadWritable(body.spaceId, user);
    let text = body.text ?? '';
    let ossKey = '';
    if (!text.trim() && body.assetId > 0) {
      const asset = await this.prisma.digitalAssetEntry.findUnique({
        where: { id: body.assetId },
      });
      if (!asset) {
        throw new BusinessException(
          ErrorCode.NOT_FOUND,
          '引用的数字资产不存在',
        );
      }
      // 资产上传时已抽正文：直接取用即可编译；未抽到（图片/音视频）则留空等解析
      text = (asset.text ?? '').trim();
      ossKey = asset.ossKey || '';
    }
    if (!text.trim() && body.assetId <= 0) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '正文与资产引用至少给一个',
      );
    }
    return this.putExtracted(
      {
        spaceId: space.id,
        kind: body.kind,
        type: body.type || (body.assetId > 0 ? 'OCR' : 'TEXT'),
        title: body.title,
        text,
        assetId: body.assetId,
        originUrl: (body.url || '').trim(),
        ossKey,
      },
      user,
    );
  }

  /** 落行去重 + 台账（各摄取入口共用）：同空间同 hash 直接返回既有行。 */
  async putExtracted(
    input: ExtractedSourceInput,
    user: CurrentUser,
  ): Promise<KbSourceView> {
    const text = input.text ?? '';
    const title = clip(input.title.trim() || '未命名资料', 200);
    const ready = Boolean(text.trim());
    const hash = sha256Hex(`${title}\n${text}`);
    const existing = await this.prisma.kbSource.findFirst({
      where: { spaceId: input.spaceId, hash },
    });
    if (existing) return toView(existing);
    const row = await this.prisma.kbSource.create({
      data: {
        spaceId: input.spaceId,
        assetId: input.assetId ?? 0,
        kind: input.kind,
        type: input.type,
        originUrl: clip(input.originUrl || '', 2000),
        ossKey: clip(input.ossKey || '', 512),
        title,
        text,
        hash,
        status: ready ? 'PENDING' : 'FAILED',
        error: ready
          ? ''
          : input.errorNote || '正文为空：等待资产解析回填或改用文本直投',
        createdBy: user.userId,
      },
    });
    await putLog(
      this.prisma,
      input.spaceId,
      'WRITE',
      `投料「${row.title}」（${row.type}，${row.text.length} 字）`,
      { sourceId: row.id, type: row.type },
      user.userId,
    );
    return toView(row);
  }

  async listSources(
    query: { spaceId: number; page: number; pageSize: number; status?: string },
    user: CurrentUser,
  ) {
    await this.spaces.loadReadable(query.spaceId, user);
    const where = {
      spaceId: query.spaceId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.kbSource.count({ where }),
      this.prisma.kbSource.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      list: rows.map(toView),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** Ingest/内部读取用：带存在与读权限校验的取源。 */
  async loadSource(id: number, user: CurrentUser) {
    const row = await this.prisma.kbSource.findUnique({ where: { id } });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '资料不存在');
    await this.spaces.loadReadable(row.spaceId, user);
    return row;
  }
}
