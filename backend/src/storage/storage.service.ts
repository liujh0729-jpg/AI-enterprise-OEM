import type { OssObjectStat, OssUploadResult } from '../oss/oss.service';
import { OssService } from '../oss/oss.service';

/**
 * 全站唯一存储出口（积分/OSS 方案 §2.2）：业务模块只依赖这里，不直接持有字节落盘、
 * 也不走第三方中转。当前实现是阿里云 OSS；换底座只改本类。
 */
export class StorageService {
  constructor(private readonly oss: OssService) {}

  /** path 是相对上传目录的对象路径；返回的 key 已含目录前缀，可直接用于 remove/stat。 */
  put(path: string, content: Buffer): Promise<OssUploadResult> {
    return this.oss.upload(path, content);
  }

  /** 浏览器直传签名：业务侧只拿「表单目标 + 字段」，字节由前端直传桶。 */
  signFormPost(
    path: string,
    options?: { maxBytes?: number; expiresSeconds?: number },
  ) {
    return this.oss.signFormPost(path, options);
  }

  /** 删除完整对象键；对象不存在按已删除处理。 */
  async remove(key: string): Promise<void> {
    if (!key) return;
    await this.oss.remove(key);
  }

  /** 完整对象键 → 公开访问 URL（桶公开读口径）。 */
  urlOf(key: string): string {
    return this.oss.keyUrlOf(key);
  }

  stat(key: string): Promise<OssObjectStat> {
    return this.oss.stat(key);
  }

  /** 读回对象字节（文档抽取/理解用）；调用方自行限制大小并处理异常。 */
  read(key: string, maxBytes?: number): Promise<Buffer> {
    return this.oss.read(key, maxBytes);
  }
}
