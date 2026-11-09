import type { CurrentUser } from '../auth/current-user';
import { text as readText } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { extractLibraryText, libraryTypeOf } from '../content/library-extract';
import { httpRequest } from '../http/transport';
import { assertOutboundUrl } from '../http/outbound-guard';
import type { StorageService } from '../storage/storage.service';
import type { KbSourceService, KbSourceView } from './kb-source.service';
import type { KbSpaceService } from './kb-space.service';
import { clip } from './kb-util';

/**
 * 摄取管道（AI 底座 §5 P1-A）：把「文本直投」之外的四类入口收口到一处——
 * - URL 抓取：出站守卫（仅 https 公网）→ 拉取字节 → 零依赖 HTML→文本；
 * - 文件上传：字节进本站 OSS 桶（StorageService）→ 可读文档直接抽取，图片/音视频标记 OCR 待解析；
 * - 飞书文档：租户令牌读 docx raw_content（未配飞书应用凭据时如实报错，不编造）；
 * - OCR/音视频：当前无本地识别引擎，落 OCR 类型并给明确指引（诚实缺口，绝不伪造成正文）。
 * 抽取结果交给 KbSourceService 落行去重；编译（Ingest）仍由 KbIngestService 负责。
 */

const MAX_FETCH_BYTES = 2_000_000;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const FEISHU_BASE = 'https://open.feishu.cn/open-apis';

function safeName(name: string) {
  return (
    String(name || 'file')
      .replace(/[^\w.-]+/g, '_')
      .slice(-120) || 'file'
  );
}

/** 图片/音视频类扩展名（无引擎时落 OCR 类型给指引，而不是当作可读文档强抽）。 */
function ocrKindOf(fileName: string): 'image' | 'audio' | 'video' | null {
  const ext = fileName.toLowerCase().split('.').pop() || '';
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff'].includes(ext))
    return 'image';
  if (['mp4', 'mov', 'webm', 'avi', 'mkv'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'm4a', 'aac', 'flac'].includes(ext)) return 'audio';
  return null;
}

export interface FeishuCredentials {
  appId: string;
  appSecret: string;
}

export class KbIntakeService {
  constructor(
    private readonly spaces: KbSpaceService,
    private readonly sources: KbSourceService,
    private readonly storage: StorageService,
    /** 飞书应用凭据提供者（从 IM 连接器读；未配置返回 null） */
    private readonly feishuCreds: () => Promise<FeishuCredentials | null>,
  ) {}

  /** URL 抓取：守卫 + 抓字节 + 抽正文（跟随有限次重定向，每次重定向都重新守卫）。 */
  async addUrl(
    body: { spaceId: number; url: string; title: string; kind: string },
    user: CurrentUser,
  ): Promise<KbSourceView> {
    const space = await this.spaces.loadWritable(body.spaceId, user);
    const { bytes, finalUrl } = await this.fetchPage(body.url);
    const extraction = extractLibraryText(bytes, 'html');
    const text = extraction.text.trim();
    if (!text) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '网页未抓取到可读正文（可能是脚本渲染页或反爬），请改用「文本直投」',
      );
    }
    const title =
      body.title.trim() ||
      pageTitle(bytes) ||
      finalUrl.replace(/^https?:\/\//, '').slice(0, 120);
    return this.sources.putExtracted(
      {
        spaceId: space.id,
        kind: body.kind,
        type: 'URL',
        title,
        text,
        originUrl: finalUrl,
      },
      user,
    );
  }

  private async fetchPage(
    rawUrl: string,
    hops = 0,
  ): Promise<{ bytes: Uint8Array; finalUrl: string }> {
    const url = String(rawUrl || '').trim();
    if (!url) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请填写要抓取的网页地址',
      );
    }
    await assertOutboundUrl(url, '知识库抓取地址');
    const response = await httpRequest<unknown>(url, {
      method: 'GET',
      readAs: 'bytes',
      redirect: 'manual',
      maxBytes: MAX_FETCH_BYTES,
      timeoutMs: 15_000,
      operation: 'kb-fetch',
      headers: { accept: 'text/html,application/xhtml+xml,text/plain' },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      const next = location ? new URL(location, url).toString() : '';
      if (!next || hops >= 3) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '网页重定向次数过多或缺少目标地址，抓取失败',
        );
      }
      return this.fetchPage(next, hops + 1);
    }
    if (!response.ok) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `抓取失败：目标返回 ${response.status}`,
      );
    }
    const data = response.data;
    const bytes =
      data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
    return { bytes, finalUrl: url };
  }

  /** 文件上传：字节进本站 OSS 桶，可读文档立即抽取；图片/音视频落 OCR 类型给指引。 */
  async addUpload(
    file: File,
    fields: Record<string, unknown>,
    user: CurrentUser,
  ): Promise<KbSourceView> {
    const spaceId = Number(fields.spaceId || 0);
    if (!Number.isFinite(spaceId) || spaceId <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '缺少知识空间');
    }
    const space = await this.spaces.loadWritable(spaceId, user);
    const name = String(file?.name || 'upload.bin');
    if (!file?.size) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择要上传的文件');
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BusinessException(ErrorCode.PAYLOAD_TOO_LARGE);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const ext = libraryTypeOf(name);
    const ocr = ocrKindOf(name);
    let ossKey = '';
    try {
      const stored = await this.storage.put(
        `kb/${space.id}/${Date.now()}-${safeName(name)}`,
        Buffer.from(bytes),
      );
      ossKey = stored.key;
    } catch {
      // 存储不可用不应阻断文本可抽的文档入库（文件仅丢失回链）
      ossKey = '';
    }
    const kind = readText(fields.kind).trim();
    if (ext) {
      const extraction = extractLibraryText(bytes, ext, { name });
      const text = extraction.text.trim();
      return this.sources.putExtracted(
        {
          spaceId: space.id,
          kind: kind || 'article',
          type: 'UPLOAD',
          title: readText(fields.title).trim() || name,
          text,
          ossKey,
          errorNote: extraction.note || undefined,
        },
        user,
      );
    }
    if (ocr) {
      return this.sources.putExtracted(
        {
          spaceId: space.id,
          kind: kind || (ocr === 'image' ? 'image' : 'transcript'),
          type: 'OCR',
          title: readText(fields.title).trim() || name,
          text: '',
          ossKey,
          errorNote:
            '图片/音视频需先配置识别能力：当前部署未接入通用 OCR/转写引擎，可改用「文本直投」或先转成文本文档',
        },
        user,
      );
    }
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '仅支持 md / txt / csv / json / html / docx / pptx / xlsx / pdf 文档与图片/音视频',
    );
  }

  /** 飞书文档导入：文档 URL 或 token → 租户令牌读 raw_content。 */
  async addFeishu(
    body: {
      spaceId: number;
      url: string;
      token: string;
      title: string;
      kind: string;
    },
    user: CurrentUser,
  ): Promise<KbSourceView> {
    const space = await this.spaces.loadWritable(body.spaceId, user);
    const ref = this.feishuRef(body.url, body.token);
    if (!ref) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请给出飞书文档链接或文档 token',
      );
    }
    const creds = await this.feishuCreds().catch(() => null);
    if (!creds?.appId || !creds.appSecret) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '未配置飞书应用凭据（设置 → 飞书/企微同步），无法导入飞书文档',
      );
    }
    const token = await this.feishuTenantToken(creds);
    const docToken =
      ref.kind === 'wiki'
        ? await this.feishuWikiToken(token, ref.token)
        : ref.token;
    const text = await this.feishuRawContent(token, docToken);
    if (!text.trim()) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '飞书文档未读到正文（可能无权限或为空白文档）',
      );
    }
    return this.sources.putExtracted(
      {
        spaceId: space.id,
        kind: body.kind,
        type: 'FEISHU',
        title: body.title.trim() || `飞书文档 ${docToken.slice(0, 12)}`,
        text,
        originUrl: body.url.trim() || `https://feishu.cn/docx/${docToken}`,
      },
      user,
    );
  }

  /** URL/token → { kind: 'docx'|'wiki', token }；无法识别返回 null。 */
  private feishuRef(
    url: string,
    token: string,
  ): { kind: 'docx' | 'wiki'; token: string } | null {
    const bare = String(token || '').trim();
    if (bare) {
      return { kind: bare.startsWith('wik') ? 'wiki' : 'docx', token: bare };
    }
    const raw = String(url || '').trim();
    if (!raw) return null;
    const match = /\/(docx|docs|wiki)\/([A-Za-z0-9]+)/.exec(raw);
    if (!match) return null;
    const kind = match[1] === 'wiki' ? 'wiki' : 'docx';
    return { kind, token: match[2] };
  }

  private async feishuTenantToken(creds: FeishuCredentials): Promise<string> {
    const response = await httpRequest<{
      tenant_access_token?: string;
    }>(`${FEISHU_BASE}/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      body: JSON.stringify({
        app_id: creds.appId,
        app_secret: creds.appSecret,
      }),
      headers: { 'content-type': 'application/json' },
      operation: 'kb-feishu',
    });
    const value = response.data?.tenant_access_token;
    if (!value) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '飞书应用凭据无效：换取租户令牌失败',
      );
    }
    return value;
  }

  private async feishuWikiToken(token: string, wikiToken: string) {
    const response = await httpRequest<{
      data?: { node?: { obj_token?: string } };
    }>(
      `${FEISHU_BASE}/wiki/v2/spaces/get_node?token=${encodeURIComponent(wikiToken)}`,
      {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
        operation: 'kb-feishu',
      },
    );
    const obj = response.data?.data?.node?.obj_token;
    if (!obj) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '无法解析飞书知识库节点（可能无权限）',
      );
    }
    return obj;
  }

  private async feishuRawContent(token: string, docToken: string) {
    const response = await httpRequest<{
      data?: { content?: string };
    }>(
      `${FEISHU_BASE}/docx/v1/documents/${encodeURIComponent(docToken)}/raw_content?lang=0`,
      {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
        operation: 'kb-feishu',
      },
    );
    return clip(response.data?.data?.content || '', 400_000);
  }
}

/** 从 HTML 头部抓 <title>，抓不到返回空串。 */
function pageTitle(bytes: Uint8Array): string {
  const head = new TextDecoder('utf-8')
    .decode(bytes.subarray(0, 4000))
    .replace(/[\r\n]+/g, ' ');
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  return match ? clip(match[1].trim(), 200) : '';
}
