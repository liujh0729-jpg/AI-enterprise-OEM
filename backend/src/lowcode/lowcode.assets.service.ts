import { CurrentUser } from '../auth/current-user';
import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { AIPDD_MEDIA_MAX_BYTES } from '../content/aipdd-asset.client';
import { DigitalAssetService } from '../content/digital-asset.service';
import { ownerUser } from './lowcode.shared';
import { LowCodeAccessService } from './lowcode.access.service';

/** 项目内的数字资产靠保留标签圈定：`lowcode-<projectId>`，可选再按字段细分。 */
const LABEL_MAX_LEN = 30;

const CONTENT_TYPE_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/mp4': 'm4a',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'application/json': 'json',
};

/**
 * 内建应用的附件：复用「数字资产」底座（AIPDD 平台存储 + 本系统归属台账）。
 *
 * 上传与列表一律以**项目所有者**的身份调用，这样同一项目的成员都能看到项目附件，
 * 而不会因为各自台账不同而互相看不见；平台上的资产仍保持 isOpen:false（不公开）。
 */
export class LowCodeAssetsService {
  constructor(
    private readonly digitalAssets: DigitalAssetService,
    private readonly access: LowCodeAccessService,
  ) {}

  private labelOf(projectId: number) {
    return `lowcode-${projectId}`.slice(0, LABEL_MAX_LEN);
  }

  private async projectOf(user: CurrentUser, raw: unknown) {
    const access = await this.access.resolve(user, raw);
    return access.project;
  }

  async assets(
    user: CurrentUser,
    raw: unknown,
    token: string,
    query: Record<string, unknown>,
  ) {
    const project = await this.projectOf(user, raw);
    const owner = ownerUser(project);
    // 台账按项目所有者圈定，平台 Key 仍用真实调用者（token 属于他，开发态兜底 Key 也按登录账号匹配）。
    const page = await this.digitalAssets.list(
      owner,
      token,
      { ...query, label: this.labelOf(project.id) },
      user,
    );
    return {
      list: page.list.map((asset) => ({
        id: asset.id,
        name: asset.name,
        url: asset.url,
        type: asset.type,
        size: asset.fileSize,
        createdAt: asset.createdAt,
      })),
      total: page.total,
      page: page.page,
      pageSize: page.pageSize,
    };
  }

  async uploadAsset(
    user: CurrentUser,
    raw: unknown,
    _token: string,
    body: {
      name: string;
      contentType: string;
      contentBase64: string;
      fieldKey: string;
    },
  ) {
    const project = await this.projectOf(user, raw);
    const owner = ownerUser(project);
    const rawName = text(body.name).trim().slice(0, 180) || 'file';
    const filename = this.filenameOf(rawName, text(body.contentType));
    const bytes = this.decode(body.contentBase64);
    if (!bytes.length) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '文件内容为空');
    }
    if (bytes.length > AIPDD_MEDIA_MAX_BYTES) {
      throw new BusinessException(ErrorCode.PAYLOAD_TOO_LARGE);
    }
    const fieldKey = text(body.fieldKey).trim();
    const labels = [this.labelOf(project.id)];
    if (fieldKey) labels.push(`${this.labelOf(project.id)}-${fieldKey}`);
    const file = new File([bytes], filename);
    const asset = await this.digitalAssets.upload(owner, file, {
      name: rawName,
      labels,
    });
    return {
      id: asset.id,
      name: asset.name,
      url: asset.url,
      type: asset.type,
      size: asset.fileSize,
    };
  }

  /** 名字没带受支持的扩展名时，按 contentType 补一个，否则平台侧上传会拒。 */
  private filenameOf(name: string, contentType: string) {
    if (/\.[A-Za-z0-9]{1,8}$/.test(name)) return name;
    const ext =
      CONTENT_TYPE_EXT[contentType.split(';')[0].trim().toLowerCase()];
    return ext ? `${name}.${ext}` : name;
  }

  private decode(contentBase64: string) {
    const compact = text(contentBase64).replace(/\s+/g, '');
    const payload = compact.startsWith('data:')
      ? compact.slice(compact.indexOf(',') + 1)
      : compact;
    try {
      return new Uint8Array(Buffer.from(payload, 'base64'));
    } catch {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '文件内容不是合法的 Base64',
      );
    }
  }
}
