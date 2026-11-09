import { decodeBase64File } from '../common/base64-file';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
/**
 * 附件上传白名单（面向业务表单附件）：仍只收常见图片/PDF/Office。
 * 数字资产、AI 产物等走 `objectContentType`，类型范围更宽但同样拒绝可执行/脚本类。
 */
const ATTACHMENT_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
]);

/** 公开读桶里绝不允许出现的脚本/超文本类型：避免被当成页面执行。 */
const BLOCKED_OBJECT_EXTENSIONS = new Set([
  'html',
  'htm',
  'xhtml',
  'svg',
  'xml',
  'js',
  'mjs',
  'swf',
]);

const OBJECT_CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
  gz: 'application/gzip',
  tar: 'application/x-tar',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8',
};

function extensionOf(path: string) {
  return path.toLowerCase().split('.').pop() || '';
}

/**
 * 对象存储 Content-Type：按扩展名判定，不信任客户端。
 * 未登记的类型回退 `application/octet-stream`（下载而不内联渲染）；
 * 脚本/超文本类型直接拒绝，防止公开读桶变成 XSS 载体。
 */
export function objectContentType(path: string) {
  const ext = extensionOf(path);
  if (BLOCKED_OBJECT_EXTENSIONS.has(ext)) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '不支持直接公开存储 HTML/SVG/脚本类文件，请压缩后再上传',
    );
  }
  return OBJECT_CONTENT_TYPES[ext] || 'application/octet-stream';
}

/** 表单附件类型由服务端按扩展名判定，只放行白名单。 */
export function attachmentContentType(path: string) {
  const ext = extensionOf(path);
  if (!ATTACHMENT_EXTENSIONS.has(ext)) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '仅支持 jpg / jpeg / png / pdf / doc / docx / xls / xlsx 格式的文件',
    );
  }
  return OBJECT_CONTENT_TYPES[ext];
}
/** 整批校验完成后才写入 OSS，避免后续无效文件导致前面的对象遗留。 */
export function parseAttachmentFiles(files: unknown) {
  if (!Array.isArray(files) || !files.length) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, '请选择要上传的附件');
  }
  if (files.length > 10) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '单次最多上传 10 个附件',
    );
  }
  return files.map((file: unknown, index) => {
    if (!file || typeof file !== 'object' || Array.isArray(file)) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '附件信息无效，请重新选择后上传',
      );
    }
    const input = file as Record<string, unknown>;
    const name =
      typeof input.name === 'string' && input.name
        ? input.name
        : `附件${index + 1}`;
    attachmentContentType(name);
    return {
      name,
      safe: name.replace(/[^\w.\u4e00-\u9fa5-]+/g, '_'),
      content: decodeBase64File(
        input.contentBase64,
        10 * 1024 * 1024,
        `「${name}」`,
      ),
    };
  });
}
