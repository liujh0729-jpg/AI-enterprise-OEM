import { createHash, randomUUID } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, join, normalize, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { httpRequest, streamRequest } from '../http/transport';
import { PrismaService } from '../prisma/prisma.service';
import {
  archiveCommand,
  githubHeaders,
  packagesDir,
  sourcesDir,
  UPGRADE_ARCHIVE_MAX_ENTRIES,
  UPGRADE_EXTRACT_MAX_BYTES,
  UPGRADE_GITHUB_REPO,
  UPGRADE_PACKAGE_MAX_BYTES,
  updateDir,
} from './upgrade.config';
import { packageView } from './upgrade.dto';
import {
  normalizeVersion,
  versionFromManifest,
  versionFromName,
} from './upgrade-version';
import type { UpgradeCheckResult, UpgradePackage } from '@enterprise/contracts';

type ReleaseAsset = {
  name?: string;
  size?: number;
  browser_download_url?: string;
};

type ReleasePayload = {
  tag_name?: string;
  name?: string;
  body?: string;
  published_at?: string;
  html_url?: string;
  zipball_url?: string;
  assets?: ReleaseAsset[];
};

type UploadFile = {
  name: string;
  size: number;
  stream(): ReadableStream<Uint8Array>;
};

const REQUIRED_PATHS = [
  'package.json',
  'pnpm-workspace.yaml',
  'backend/package.json',
  'frontend/package.json',
  'packages/contracts/package.json',
  'backend/prisma/schema.prisma',
];

function ensureDirs() {
  for (const dir of [updateDir(), packagesDir(), sourcesDir()]) {
    mkdirSync(dir, { recursive: true });
  }
}

/** 全局 fetch 与 node:stream/web 各有一套 ReadableStream 声明，运行时是同一对象；收口这一处转换。 */
function toNodeStream(stream: ReadableStream<Uint8Array>) {
  return Readable.fromWeb(stream as NodeReadableStream<Uint8Array>);
}

function safeFileName(value: string) {
  const name = basename(String(value || 'package.zip')).replace(
    /[^0-9A-Za-z._-]/g,
    '_',
  );
  return name.toLowerCase().endsWith('.zip') ? name : `${name}.zip`;
}

async function githubJson(url: string) {
  const result = await httpRequest<ReleasePayload>(url, {
    headers: githubHeaders(),
    timeoutMs: 30_000,
    operation: 'upgrade.github',
    maxBytes: 8 * 1024 * 1024,
  });
  if (result.status === 403 || result.status === 429) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      'GitHub 接口访问受限：请稍后重试，或在服务端配置 UPGRADE_GITHUB_TOKEN',
    );
  }
  if (!result.ok) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      `GitHub 接口返回 HTTP ${result.status}`,
    );
  }
  return result.data || {};
}

async function latestRelease() {
  return githubJson(
    `https://api.github.com/repos/${UPGRADE_GITHUB_REPO}/releases/latest`,
  );
}

async function releaseByTag(tag: string) {
  return githubJson(
    `https://api.github.com/repos/${UPGRADE_GITHUB_REPO}/releases/tags/${encodeURIComponent(tag)}`,
  );
}

async function downloadToFile(url: string, file: string, maxBytes: number) {
  const { response, close } = await streamRequest(url, {
    headers: { 'User-Agent': 'aiworkin-enterprise-upgrade' },
    redirect: 'follow',
    timeoutMs: 10 * 60_000,
    operation: 'upgrade.download',
  });
  try {
    if (!response.ok || !response.body) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `下载升级包失败：HTTP ${response.status}`,
      );
    }
    const hash = createHash('sha256');
    let bytes = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          callback(new Error('升级包超过大小限制'));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(
      toNodeStream(response.body),
      meter,
      createWriteStream(file, { mode: 0o600 }),
    );
    return { bytes, sha256: hash.digest('hex') };
  } finally {
    close();
  }
}

async function saveStream(stream: ReadableStream<Uint8Array>, file: string) {
  const hash = createHash('sha256');
  let bytes = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > UPGRADE_PACKAGE_MAX_BYTES) {
        callback(new Error('升级包超过 512MB 限制'));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(
    toNodeStream(stream),
    meter,
    createWriteStream(file, { mode: 0o600 }),
  );
  return { bytes, sha256: hash.digest('hex') };
}

function commandAvailable(command: string, args: string[]) {
  try {
    execFileSync(command, args, {
      stdio: 'ignore',
      timeout: 10_000,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

function run(command: string, args: string[], timeout = 600_000) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    timeout,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
}

function listArchive(file: string) {
  if (process.platform !== 'win32' && commandAvailable('unzip', ['-v'])) {
    return run('unzip', ['-Z1', file]);
  }
  return run(archiveCommand(), ['-tf', file]);
}

function extractArchive(file: string, dest: string) {
  mkdirSync(dest, { recursive: true });
  if (process.platform !== 'win32' && commandAvailable('unzip', ['-v'])) {
    run('unzip', ['-q', '-o', file, '-d', dest]);
    return;
  }
  run(archiveCommand(), ['-xf', file, '-C', dest]);
}

function validateEntries(entries: string[]) {
  if (entries.length > UPGRADE_ARCHIVE_MAX_ENTRIES) {
    throw new BusinessException(
      ErrorCode.BAD_REQUEST,
      '升级包文件数量异常，已拒绝解压',
    );
  }
  for (const entry of entries) {
    const value = entry.replace(/\\/g, '/');
    const normalized = normalize(value).replace(/\\/g, '/');
    if (
      !value ||
      value.startsWith('/') ||
      /^[A-Za-z]:/.test(value) ||
      value.split('/').includes('..') ||
      normalized.startsWith('../') ||
      value.length > 500
    ) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `升级包包含非法路径：${entry.slice(0, 120)}`,
      );
    }
  }
}

function directorySize(dir: string) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop() as string;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isSymbolicLink()) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '升级包包含符号链接，已拒绝使用',
        );
      }
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        total += statSync(full).size;
        if (total > UPGRADE_EXTRACT_MAX_BYTES) {
          throw new BusinessException(
            ErrorCode.BAD_REQUEST,
            '升级包解压后体积超过 2GB 限制',
          );
        }
      }
    }
  }
  return total;
}

function candidateRoot(dest: string) {
  const entries = readdirSync(dest, { withFileTypes: true });
  if (entries.length === 1 && entries[0].isDirectory()) {
    return join(dest, entries[0].name);
  }
  return dest;
}

function assertPackageRoot(root: string) {
  for (const required of REQUIRED_PATHS) {
    if (!existsSync(resolve(root, required))) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `升级包结构不完整：缺少 ${required}`,
      );
    }
  }
}

/**
 * 升级包台账：GitHub Release / 源码包 / 管理员上传。
 * 下载与上传都先落 update/packages，再安全解压到 update/sources/<id>/；
 * 解压前逐条校验路径，解压后拒绝符号链接与超限体积。
 */
export class UpgradePackageService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<UpgradePackage[]> {
    const rows = await this.prisma.platformUpgradePackage.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map(packageView);
  }

  async check(): Promise<UpgradeCheckResult> {
    const release = await latestRelease();
    const tag = String(release.tag_name || '');
    if (!tag) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        'GitHub Release 缺少版本标签',
      );
    }
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const asset =
      assets.find((item) =>
        String(item.name || '')
          .toLowerCase()
          .endsWith('.zip'),
      ) || assets[0];
    const sourceUrl = `https://github.com/${UPGRADE_GITHUB_REPO}/archive/refs/tags/${encodeURIComponent(tag)}.zip`;
    return {
      tag,
      name: String(release.name || tag),
      version: normalizeVersion(versionFromName(tag, tag)),
      publishedAt: String(release.published_at || ''),
      releaseNotes: String(release.body || '').slice(0, 8000),
      assetName: String(asset?.name || `${tag}.zip`),
      assetBytes: Number(asset?.size || 0),
      downloadUrl: String(asset?.browser_download_url || sourceUrl),
      sourceUrl,
    };
  }

  async download(
    mode: 'release' | 'source',
    tag: string,
  ): Promise<UpgradePackage> {
    ensureDirs();
    let release: ReleasePayload | null = null;
    if (mode === 'release') {
      release = tag ? await releaseByTag(tag) : await latestRelease();
    } else if (!tag) {
      release = await latestRelease();
    }
    const resolvedTag = String(release?.tag_name || tag || '');
    if (!resolvedTag) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '无法确定要下载的版本',
      );
    }
    const assets = Array.isArray(release?.assets) ? release.assets : [];
    const asset = assets.find((item) =>
      String(item.name || '')
        .toLowerCase()
        .endsWith('.zip'),
    );
    const url =
      mode === 'release' && asset?.browser_download_url
        ? String(asset.browser_download_url)
        : `https://github.com/${UPGRADE_GITHUB_REPO}/archive/refs/tags/${encodeURIComponent(resolvedTag)}.zip`;
    const fileName = safeFileName(
      `${resolvedTag}-${mode === 'source' ? 'source' : String(asset?.name || 'release')}.zip`,
    );
    const file = resolve(packagesDir(), `${randomUUID()}-${fileName}`);

    const row = await this.prisma.platformUpgradePackage.create({
      data: {
        source: mode === 'source' ? 'GITHUB_SOURCE' : 'GITHUB_RELEASE',
        status: 'DOWNLOADING',
        version: normalizeVersion(versionFromName(resolvedTag, resolvedTag)),
        tag: resolvedTag,
        fileName,
        path: file,
        releaseNotes: String(release?.body || '').slice(0, 8000),
        publishedAt: String(release?.published_at || ''),
      },
    });
    try {
      const saved = await downloadToFile(url, file, UPGRADE_PACKAGE_MAX_BYTES);
      await this.prisma.platformUpgradePackage.update({
        where: { id: row.id },
        data: { bytes: saved.bytes, sha256: saved.sha256 },
      });
      return await this.extractAndValidate(row.id);
    } catch (error) {
      rmSync(file, { force: true });
      await this.prisma.platformUpgradePackage.update({
        where: { id: row.id },
        data: {
          status: 'INVALID',
          invalidReason: String(
            error instanceof Error ? error.message : '下载失败',
          ).slice(0, 500),
        },
      });
      throw error;
    }
  }

  async upload(file: UploadFile, versionHint = ''): Promise<UpgradePackage> {
    ensureDirs();
    if (!file || !file.name) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请选择要上传的升级包',
      );
    }
    if (!file.name.toLowerCase().endsWith('.zip')) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '只支持 zip 升级包');
    }
    const fileName = safeFileName(file.name);
    const stored = resolve(packagesDir(), `${randomUUID()}-${fileName}`);
    const saved = await saveStream(file.stream(), stored);
    const version =
      normalizeVersion(versionHint) || versionFromName(fileName) || 'unknown';
    const row = await this.prisma.platformUpgradePackage.create({
      data: {
        source: 'UPLOAD',
        status: 'VERIFIED',
        version,
        tag: version === 'unknown' ? '' : `v${version}`,
        fileName,
        path: stored,
        bytes: saved.bytes,
        sha256: saved.sha256,
      },
    });
    return this.extractAndValidate(row.id);
  }

  async extractAndValidate(id: number): Promise<UpgradePackage> {
    const row = await this.prisma.platformUpgradePackage.findUnique({
      where: { id },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '升级包不存在');
    }
    const dest = resolve(sourcesDir(), String(row.id));
    rmSync(dest, { recursive: true, force: true });
    try {
      const entries = listArchive(row.path)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      validateEntries(entries);
      extractArchive(row.path, dest);
      const root = candidateRoot(dest);
      assertPackageRoot(root);
      directorySize(root);
      const meta = versionFromManifest(root);
      const version =
        meta?.version ||
        normalizeVersion(row.version) ||
        versionFromName(basename(root)) ||
        'unknown';
      const updated = await this.prisma.platformUpgradePackage.update({
        where: { id: row.id },
        data: {
          status: 'EXTRACTED',
          extracted: true,
          candidateDir: root,
          version,
          invalidReason: '',
        },
      });
      return packageView(updated);
    } catch (error) {
      rmSync(dest, { recursive: true, force: true });
      const reason = String(
        error instanceof Error ? error.message : '升级包校验失败',
      ).slice(0, 500);
      await this.prisma.platformUpgradePackage.update({
        where: { id: row.id },
        data: { status: 'INVALID', extracted: false, invalidReason: reason },
      });
      if (error instanceof BusinessException) throw error;
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `升级包校验失败：${reason}`,
      );
    }
  }

  async remove(id: number) {
    const row = await this.prisma.platformUpgradePackage.findUnique({
      where: { id },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '升级包不存在');
    }
    const active = await this.prisma.platformUpgradeJob.findFirst({
      where: {
        packageId: id,
        status: { in: ['PENDING', 'RUNNING'] },
      },
    });
    if (active) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '该升级包正在被任务使用，请等待任务结束后再删除',
      );
    }
    rmSync(row.path, { force: true });
    rmSync(resolve(sourcesDir(), String(row.id)), {
      recursive: true,
      force: true,
    });
    await this.prisma.platformUpgradePackage.delete({ where: { id } });
    return { id };
  }

  async get(id: number) {
    const row = await this.prisma.platformUpgradePackage.findUnique({
      where: { id },
    });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '升级包不存在');
    }
    return row;
  }

  sha256(file: string) {
    return new Promise<string>((resolvePromise, reject) => {
      const hash = createHash('sha256');
      const stream = createReadStream(file);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolvePromise(hash.digest('hex')));
    });
  }
}
