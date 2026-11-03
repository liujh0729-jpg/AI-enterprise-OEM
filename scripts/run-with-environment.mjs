import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadEnvironment } from './lib/enterprise-environment.mjs';

try {
  const split = process.argv.indexOf('--');
  if (split < 0 || !process.argv[split + 1]) throw new Error('用法：run-with-environment.mjs --environment production -- <command> [args]');
  const { values } = parseArgs({ args: process.argv.slice(2, split), options: {
    environment: { type: 'string' }, 'env-file': { type: 'string' }, 'backend-dir': { type: 'string' },
  } });
  const backendDir = resolve(values['backend-dir'] || new URL('../backend', import.meta.url).pathname);
  const { env } = loadEnvironment({ environment: values.environment, backendDir, envFile: values['env-file'] });
  const child = spawn(process.argv[split + 1], process.argv.slice(split + 2), { cwd: backendDir, env, stdio: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
  child.once('error', () => { console.error('所选环境的命令启动失败'); process.exitCode = 1; });
  child.once('exit', code => { process.exitCode = code ?? 1; });
} catch (error) {
  console.error(error.message); process.exitCode = 1;
}
