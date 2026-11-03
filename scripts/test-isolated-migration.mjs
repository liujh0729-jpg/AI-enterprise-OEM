/** Creates and drops only its own localhost database. No .env credentials or remote upstreams are used. */
import {spawnSync} from 'node:child_process';
import {userInfo} from 'node:os';
const root=new URL('../',import.meta.url).pathname;
const database=`enterprise_migration_${Date.now()}_${process.pid}`;
const db=new URL(`postgresql://127.0.0.1:5432/${database}`);db.username=process.env.PGUSER||userInfo().username;if(process.env.PGPASSWORD)db.password=process.env.PGPASSWORD;db.searchParams.set('schema','public');
function command(program,args,env=process.env){const result=spawnSync(program,args,{cwd:root,env,encoding:'utf8'});if(result.status!==0)throw new Error(`${program} failed: ${((result.stdout||'')+(result.stderr||'')).replaceAll(db.toString(),'[isolated database]').slice(-18000)}`);return result.stdout;}
const env={...process.env,DATABASE_URL:db.toString(),JWT_SECRET:'isolated-test-signing-key-20261023',EXTERNAL_CRED_KEY:'isolated-credential-encryption-key',AIWORKIN_ENABLED:'false',JAVA_BASE_URL:'http://127.0.0.1:1',AIWORKIN_BASE_URL:'http://127.0.0.1:1',GEO_AUTO_COLLECT_DISABLED:'1',NODE_OPTIONS:'--require='+root+'backend/test/isolated-upstreams.cjs',ISOLATED_TEST:'1',REGRESSION_LOG_DIR:(process.env.ENTERPRISE_TEMP_DIR||'/Volumes/Projects/tmp')+'/enterprise-hono-migration'};
command('createdb',['-h','127.0.0.1',database]);
try{
  command('pnpm',['--filter','aiworkin-enterprise-api','exec','prisma','migrate','deploy'],env);
  console.log('隔离数据库：全部迁移执行成功');
  command('pnpm',['--filter','aiworkin-enterprise-api','exec','tsx','test/isolated-migration.ts'],env);
  console.log('隔离数据库：编号并发、历史最大号接续与健康检查通过');
  if(process.argv.includes('--full')){
    command('pnpm',['--filter','aiworkin-enterprise-api','exec','tsx','prisma/seed.ts'],env);
    command('pnpm',['--filter','aiworkin-enterprise-api','exec','tsx','test/prepare-fixtures.ts'],env);
    process.stdout.write(command('node',['scripts/regression-instance.mjs','--','node','scripts/e2e-test.mjs'],env));
  }
  if(process.argv.includes('--performance')){
    command('pnpm',['--filter','aiworkin-enterprise-api','build'],env);
    process.stdout.write(command('pnpm',['--filter','aiworkin-enterprise-api','exec','tsx','test/performance.ts'],env));
  }
  if(process.argv.includes('--query-plans')){
    process.stdout.write(command('pnpm',['--filter','aiworkin-enterprise-api','exec','tsx','test/query-plans.ts'],env));
  }
}finally{command('dropdb',['-h','127.0.0.1',database]);}
