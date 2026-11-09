import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const root=path.resolve(import.meta.dirname,'..');const errors=[];
const require=createRequire(path.join(root,'backend/package.json'));
const ts=require('typescript');
function files(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path.join(dir,entry.name)):[path.join(dir,entry.name)]);}
for(const base of ['frontend/src','backend/src'])for(const file of files(path.join(root,base)).filter(file=>/\.tsx?$/.test(file)&&!file.endsWith('.spec.ts'))){
 const source=readFileSync(file,'utf8'),relative=path.relative(root,file).split(path.sep).join('/');
 if(/(?<![\w.$])fetch\s*\(/.test(source)&&!['frontend/src/api/http.ts','backend/src/http/transport.ts','backend/src/http/app.ts'].includes(relative))errors.push(`${relative}: 网络请求必须经过统一传输层`);
 if(relative.startsWith('frontend/')&&/from\s*['"]@\/lib\/api['"]/.test(source))errors.push(`${relative}: 已移除旧请求入口，请使用具名业务 API`);
 if(source.includes('@nestjs/'))errors.push(`${relative}: 遗留 Nest 依赖`);
 if(relative.startsWith('frontend/')&&/\bfrom\s*['"][^'"]*(generated\/prisma|backend\/src)|process\.env\.(JWT_SECRET|EXTERNAL_CRED_KEY)/.test(source))errors.push(`${relative}: 浏览器模块不能依赖服务端配置或数据库`);
 if(relative.startsWith('frontend/')&&!relative.startsWith('frontend/src/api/')&&/import\s*\{[^}]*\bhttp\b[^}]*\}\s*from\s*['"]@\/api\/http['"]/.test(source))errors.push(`${relative}: 页面与 Hook 不能越过业务 API 直接调用 HTTP 客户端`);
}
for(const file of files(path.join(root,'packages/contracts/src')).filter(file=>file.endsWith('.ts'))){
 const source=readFileSync(file,'utf8'),relative=path.relative(root,file).split(path.sep).join('/');
 const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
 function visit(node){
  if(ts.isAsExpression(node)&&node.type.getText(ast)!=='const')errors.push(`${relative}: 契约通过 Schema 推导类型，不允许类型断言`);
  if(ts.isImportDeclaration(node)){const target=node.moduleSpecifier.text;if(target!=='zod'&&!target.startsWith('.'))errors.push(`${relative}: 契约不能依赖服务端或应用运行时`);}
  ts.forEachChild(node,visit);
 }
 visit(ast);
}
const AI_GATEWAY = ['backend/src/ai/ai-gateway.ts','backend/src/geo/geo-llm.client.ts'];
const AI_GUARD = /resolveTarget\s*\(|assertAiAllowed\s*\(|aiGuardDeny\s*\(/;
for(const file of files(path.join(root,'backend/src')).filter(file=>file.endsWith('.ts')&&!file.endsWith('.spec.ts'))){
 const source=readFileSync(file,'utf8'),relative=path.relative(root,file).split(path.sep).join('/');
 if(!source.includes('geoChatMulti')||AI_GATEWAY.includes(relative))continue;
 if(!AI_GUARD.test(source))errors.push(`${relative}: 直接调用 geoChatMulti 必须先过 AI 闸门（resolveTarget / assertAiAllowed / aiGuardDeny）`);
}
const baseline=JSON.parse(readFileSync(path.join(root,'docs/migration/route-baseline.json'),'utf8'));
const routeDir=path.join(root,'backend/src/http/route-groups');
const routes=[readFileSync(path.join(root,'backend/src/http/routes.ts'),'utf8'),
  ...readdirSync(routeDir).filter(file=>file.endsWith('.ts')).map(file=>readFileSync(path.join(routeDir,file),'utf8'))].join('\n');
for(const route of baseline)if(!(routes.includes(`"${route.operationId}"`)||routes.includes(`'${route.operationId}'`)))errors.push(`遗漏迁移路由: ${route.operationId}`);
if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}else console.log(`架构边界检查通过（${baseline.length} 个业务路由）`);
