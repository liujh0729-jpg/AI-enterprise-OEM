import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from './app';
import { createServices } from './services';
async function generate() {
  const app = createApp(createServices());
  const response = await app.request('/api/openapi.json');
  if (!response.ok) throw new Error('OpenAPI 生成失败');
  const content = JSON.stringify(await response.json()) + '\n';
  const output = resolve(__dirname, '../../../docs/api/openapi.json');
  if (process.argv.includes('--check')) {
    if (readFileSync(output, 'utf8') !== content)
      throw new Error('接口文档与路由不一致，请执行 pnpm api:docs');
  } else {
    mkdirSync(resolve(output, '..'), { recursive: true });
    writeFileSync(output, content);
  }
  console.log('OpenAPI 契约检查通过');
}
void generate().catch((error) => {
  console.error(error instanceof Error ? error.message : 'OpenAPI 生成失败');
  process.exitCode = 1;
});
