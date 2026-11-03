/**
 * 在本机 PG 的一次性空库中验证 GEO 事务、幂等与实例接管。
 * 不读取 backend/.env 的连接串，不启动后端，不调用任何外部模型。
 * 用法：node scripts/verify-geo-collection-recovery.mjs
 */
import { spawnSync } from "node:child_process";
import { userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const backend = join(root, "backend");
const database = `aipdd_enterprise_geo_test_${process.pid}_${Date.now()}`;
const localUrl = new URL("postgresql://127.0.0.1:5432");
localUrl.username = process.env.PGUSER || userInfo().username;
if (process.env.PGPASSWORD) localUrl.password = process.env.PGPASSWORD;
localUrl.pathname = `/${database}`;
localUrl.searchParams.set("schema", "public");
const env = {
  ...process.env,
  DATABASE_URL: localUrl.href,
  GEO_COLLECTION_TEST_DATABASE_URL: localUrl.href,
};

function run(command, args, childEnv = env) {
  const result = spawnSync(command, args, {
    cwd: backend,
    env: childEnv,
    encoding: "utf8",
  });
  // 即使子进程报错，也不把完整连接串或密码写到日志。
  for (let output of [result.stdout, result.stderr]) {
    if (!output) continue;
    output = output.replaceAll(localUrl.href, "[isolated local database]");
    if (process.env.PGPASSWORD) {
      output = output.replaceAll(process.env.PGPASSWORD, "[redacted]");
    }
    process.stdout.write(output);
  }
  if (result.error) throw new Error(`无法执行 ${command}`);
  if (result.status !== 0)
    throw new Error(`${command} 退出码 ${result.status}`);
}

let created = false;
try {
  run("createdb", ["-h", "127.0.0.1", "-p", "5432", database]);
  created = true;
  console.log(`GEO 故障测试隔离库已创建：${database}`);
  run("pnpm", ["exec", "prisma", "db", "push", "--skip-generate"]);
  run("pnpm", [
    "exec",
    "jest",
    "--config",
    "./test/jest-unit.json",
    "--runInBand",
    "--runTestsByPath",
    "src/geo/geo-collection.service.spec.ts",
  ]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (created) {
    try {
      run("dropdb", ["-h", "127.0.0.1", "-p", "5432", database]);
      console.log("GEO 故障测试隔离库已清理");
    } catch {
      console.error(`隔离库清理失败，请清理本机测试库 ${database}`);
      process.exitCode = 1;
    }
  }
}
