import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';

export type UpgradeDeploymentMode =
  'dev' | 'pm2' | 'systemd' | 'command' | 'docker';

export type UpgradeDeployment = {
  mode: UpgradeDeploymentMode;
  autoRestart: boolean;
  hostUpgradeRequired: boolean;
  hostCommand: string;
};

/** 固定为本项目开源仓库；公开仓库不需要 Token。 */
export const UPGRADE_GITHUB_REPO =
  process.env.UPGRADE_GITHUB_REPO || 'liujh0729-jpg/AI-enterprise-OEM';
export const UPGRADE_GITHUB_TOKEN = process.env.UPGRADE_GITHUB_TOKEN || '';
export const UPGRADE_DIR_NAME = 'update';
export const UPGRADE_PACKAGE_MAX_BYTES = 512 * 1024 * 1024;
export const UPGRADE_EXTRACT_MAX_BYTES = 2 * 1024 * 1024 * 1024;
export const UPGRADE_ARCHIVE_MAX_ENTRIES = 200_000;

export function installDir() {
  return resolve(process.env.UPGRADE_INSTALL_DIR || defaultInstallDir());
}

function defaultInstallDir() {
  const cwd = process.cwd();
  return basename(cwd) === 'backend' ? resolve(cwd, '..') : cwd;
}

export function updateDir() {
  return resolve(
    process.env.UPGRADE_DIR || resolve(installDir(), UPGRADE_DIR_NAME),
  );
}

export function jobsDir() {
  return resolve(updateDir(), 'jobs');
}

export function packagesDir() {
  return resolve(updateDir(), 'packages');
}

export function sourcesDir() {
  return resolve(updateDir(), 'sources');
}

export function backupsDir() {
  return resolve(updateDir(), 'backups');
}

export function runnerScript() {
  return resolve(installDir(), 'scripts/upgrade-runner.mjs');
}

export function deploymentMode(): UpgradeDeploymentMode {
  const configured = String(
    process.env.UPGRADE_RESTART_MODE || '',
  ).toLowerCase();
  if (
    configured === 'dev' ||
    configured === 'pm2' ||
    configured === 'systemd' ||
    configured === 'command' ||
    configured === 'docker'
  ) {
    return configured;
  }
  if (existsSync('/.dockerenv') || process.env.DOCKER_CONTAINER === '1') {
    return 'docker';
  }
  return 'dev';
}

export function deployment(): UpgradeDeployment {
  const mode = deploymentMode();
  const hostCommand = `cd ${installDir()} && docker compose down && docker compose up -d --build`;
  return {
    mode,
    autoRestart: mode !== 'docker',
    hostUpgradeRequired: mode === 'docker',
    hostCommand: mode === 'docker' ? hostCommand : '',
  };
}

/** runner 执行重启时用的端口/命令参数，全部来自环境变量，不接受请求体输入。 */
export function runnerDeploymentConfig() {
  return {
    mode: deploymentMode(),
    apiPort: Number(process.env.PORT || 1690),
    webPort: Number(process.env.WEB_PORT || 15890),
    systemdUnits:
      process.env.UPGRADE_SYSTEMD_UNITS ||
      'aiworkin-enterprise-api aiworkin-enterprise-web',
    stopCommand: process.env.UPGRADE_STOP_COMMAND || '',
    startCommand: process.env.UPGRADE_START_COMMAND || '',
    healthUrl:
      process.env.UPGRADE_HEALTH_URL ||
      `http://127.0.0.1:${Number(process.env.PORT || 1690)}/health/ready`,
  };
}

/**
 * Windows 下 PATH 里的 tar 常是 Git Bash 的 GNU tar，会把 `E:\...` 当成远端主机；
 * 必须显式使用系统自带的 bsdtar。其他平台沿用 PATH 中的 tar。
 */
export function archiveCommand() {
  if (process.platform !== 'win32') return 'tar';
  return resolve(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'tar.exe',
  );
}

export function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'aiworkin-enterprise-upgrade',
  };
  if (UPGRADE_GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${UPGRADE_GITHUB_TOKEN}`;
  }
  return headers;
}
