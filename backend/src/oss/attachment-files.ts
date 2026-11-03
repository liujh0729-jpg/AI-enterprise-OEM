import { decodeBase64File } from '../common/base64-file';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
/** 对象类型由服务端按扩展名判定，不信任客户端的 Content-Type。 */
export function attachmentContentType(path: string) {
  const ext = path.toLowerCase().split('.').pop() || '';
  if (!Object.hasOwn(CONTENT_TYPES, ext)) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '仅支持 jpg / jpeg / png / pdf / doc / docx / xls / xlsx 格式的文件',
    );
  }
  return CONTENT_TYPES[ext];
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
