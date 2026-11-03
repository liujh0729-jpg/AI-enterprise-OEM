// Loaded only by the isolated regression harness, never by application startup.
if (process.env.ISOLATED_TEST !== '1')
  throw new Error('仅允许在隔离测试中使用上游模拟');
const Module = require('node:module');
const load = Module._load;
Module._load = function (request, parent, isMain) {
  const exports = load.call(this, request, parent, isMain);
  if (request.endsWith('/oss/oss.service') && exports.OssService) {
    exports.OssService.prototype.upload = async function (path, content) {
      const { ossObjectKey, ossPublicUrl } = load.call(
        this,
        require.resolve('../src/oss/oss.config.ts'),
        parent,
        false,
      );
      const key = ossObjectKey(path);
      return {
        key,
        url: ossPublicUrl(key),
        size: content.length,
        contentType: 'application/pdf',
      };
    };
  }
  return exports;
};
