import {spawn,spawnSync} from 'node:child_process';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
const root=path.resolve(import.meta.dirname,'..');
if(Number(process.versions.node.split('.')[0])<24)throw new Error('开发环境需要 Node.js 24');
for(const port of [15889,15890,1690,1695])await new Promise((resolve,reject)=>{
  const server=net.createServer();server.once('error',()=>reject(new Error(`端口 ${port} 已占用，请先停止该服务`)));server.listen(port,'127.0.0.1',()=>server.close(resolve));
});
const pnpmEntry=path.join(process.env.APPDATA||path.join(os.homedir(),'AppData','Roaming'),'npm','node_modules','pnpm','bin','pnpm.cjs');
const pnpmCommand=process.platform==='win32'?process.execPath:'pnpm';
const pnpmPrefix=process.platform==='win32'?[pnpmEntry]:[];
if(process.platform==='win32'&&!existsSync(pnpmEntry))throw new Error(`未找到 pnpm 入口：${pnpmEntry}`);
const build=spawnSync(pnpmCommand,[...pnpmPrefix,'--filter','@enterprise/contracts','build'],{cwd:root,stdio:'inherit'});if(build.error)throw build.error;if(build.status)process.exit(build.status);
const tempRoot=process.env.ENTERPRISE_TEMP_DIR||path.join(root,'.tmp','dev-runtime');mkdirSync(tempRoot,{recursive:true});
const runtime=mkdtempSync(path.join(tempRoot,'enterprise-dev-'));for(const dir of ['logs','temp/client_body_temp','temp/proxy_temp','temp/fastcgi_temp','temp/uwsgi_temp','temp/scgi_temp'])mkdirSync(path.join(runtime,dir),{recursive:true});const runtimePath=runtime.split(path.sep).join('/');const conf=readFileSync(path.join(root,'infra/nginx/enterprise.conf'),'utf8');
writeFileSync(path.join(runtime,'nginx.conf'),`pid ${runtimePath}/nginx.pid;\nerror_log stderr;\nevents {}\nhttp { access_log off; client_body_temp_path ${runtimePath}/body; ${conf} }`);
const nginxBin=process.env.NGINX_BIN||'nginx';
const nginxCheck=spawnSync(nginxBin,['-t','-p',runtimePath+'/', '-c',path.join(runtime,'nginx.conf')],{cwd:root,stdio:'inherit'});
if(nginxCheck.error||nginxCheck.status!==0)throw new Error('Nginx 配置检查失败，请确认已安装并检查入口配置');
const children=[];let stopping=false;
function stop(){if(stopping)return;stopping=true;for(const child of children){try{if(process.platform==='win32')spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'});else process.kill(-child.pid,'SIGTERM');}catch{}}}
function run(cmd,args,options={}){const child=spawn(cmd,args,{cwd:root,stdio:'inherit',detached:true,...options});children.push(child);child.once('error',(error)=>{console.error(error);process.exitCode=1;stop();});child.once('exit',code=>{if(!stopping){process.exitCode=code||0;stop();}});return child;}
run(pnpmCommand,[...pnpmPrefix,'--filter','aiworkin-enterprise-api','dev']);
run(pnpmCommand,[...pnpmPrefix,'--filter','aiworkin-enterprise-web','dev']);
run(pnpmCommand,[...pnpmPrefix,'--filter','aiworkin-enterprise-api','worker:dev']);
run(nginxBin,['-p',runtimePath+'/', '-c',path.join(runtime,'nginx.conf'),'-g','daemon off;']);
process.once('SIGINT',stop);process.once('SIGTERM',stop);
