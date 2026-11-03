import { createRequire } from 'node:module';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(join(root, 'frontend/package.json'));
const ts = require('typescript');
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, file) => {
  module._compile(ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, file);
};
const { ADMIN_SECTIONS } = require('./src/config/routes.ts');
const { DIRECTORY_ITEMS } = require('./src/lib/provider-categories.tsx');
const app = join(root, 'frontend/src/app');
function walk(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]); }
const files = walk(app).filter(p => p.endsWith('/page.tsx'));
const routes = files.flatMap(file => {
  const route = '/' + relative(app, file).replace(/(?:^|\/)page\.tsx$/, '');
  const paths = route.includes('[section]') ? ADMIN_SECTIONS.map(s => route.replace('[section]', s.key))
    : route.includes('[type]') ? Object.keys(DIRECTORY_ITEMS).map(t => route.replace('[type]', t)) : [route];
  return paths.map(path => ({ path, source: relative(root, file) }));
});
writeFileSync(join(root, 'docs/performance/evidence/page-inventory.json'), JSON.stringify({ pageFiles: files.length, expandedRoutes: routes.length, routes }, null, 2) + '\n');
console.log(`${files.length} 个页面文件，${routes.length} 个展开路由`);
