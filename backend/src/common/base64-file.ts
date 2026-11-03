import { BusinessException } from './business.exception';
import { ErrorCode } from './error-code';
/** 严格校验后再解码，避免 Buffer.from 静默忽略损坏内容或超限分配。 */
export function decodeBase64File(
  value: unknown,
  maxBytes: number,
  label: string,
) {
  const fail = (reason: string): never => {
    throw new BusinessException(ErrorCode.BAD_REQUEST, `${label}${reason}`);
  };
  if (typeof value !== 'string' || !value)
    fail('缺少文件内容，请重新选择后上传');
  const encoded = (value as string).replace(/^data:[^,]*;base64,/, '');
  if (
    !encoded ||
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  ) {
    fail('文件内容无效，请重新选择后上传');
  }
  const size =
    (encoded.length / 4) * 3 -
    (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
  if (size > maxBytes) fail(`超过 ${maxBytes / 1024 / 1024}MB，请压缩后重试`);
  const content = Buffer.from(encoded, 'base64');
  if (!content.length || content.toString('base64') !== encoded) {
    fail('文件内容无效，请重新选择后上传');
  }
  return content;
}
