/**
 * 平台统一 OSS（企业服务后端附件存储）。
 * 默认桶与目录：oss://aiworkinenterprise/asset/，公开读。
 * **账号密钥不写死源码**——管理后台保存的配置优先（加密入库，见 OssSettingsService），
 * 未保存时回退环境变量（`OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET`，见 `backend/.env.example`）。
 */
export type OssConfig = {
  bucket: string;
  endpoint: string;
  region: string;
  /** 统一目录前缀，规范化后保证以 / 结尾（默认 asset/）。 */
  dir: string;
};

/** 部署默认值：后台未保存过配置时使用，也是表单的初始值。 */
export const OSS_CONFIG: OssConfig = {
  bucket: 'aiworkinenterprise',
  endpoint: 'oss-cn-beijing.aliyuncs.com',
  region: 'cn-beijing',
  dir: 'asset/',
};

/** 目录规范化：去前导斜杠、补尾随斜杠；空目录表示桶根。 */
export function ossDirOf(config: OssConfig) {
  const dir = String(config.dir || '')
    .trim()
    .replace(/^\/+/, '');
  if (!dir) return '';
  return dir.endsWith('/') ? dir : `${dir}/`;
}

export function ossHostOf(config: OssConfig) {
  return `${config.bucket}.${config.endpoint}`;
}

export const OSS_HOST = ossHostOf(OSS_CONFIG);

export function ossObjectKey(path: string, config: OssConfig = OSS_CONFIG) {
  return `${ossDirOf(config)}${path.replace(/^\/+/, '')}`;
}

export function ossPublicUrl(key: string, config: OssConfig = OSS_CONFIG) {
  return `https://${ossHostOf(config)}/${ossEncodePath(key)}`;
}

/** OSS V4 使用 RFC 3986 编码，保留对象键中的路径分隔符。 */
export function ossEncodePath(path: string) {
  return path
    .split('/')
    .map((part) =>
      encodeURIComponent(part).replace(
        /[!'()*]/g,
        (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join('/');
}
