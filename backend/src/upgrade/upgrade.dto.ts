import type {
  PlatformBackup,
  PlatformUpgradeJob,
  PlatformUpgradePackage,
  PlatformUpgradeStep,
} from '../../generated/prisma';
import type {
  UpgradeAnalysis,
  UpgradeBackup,
  UpgradeJob,
  UpgradePackage,
  UpgradeStep,
} from '@enterprise/contracts';

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function iso(value: Date | null | undefined) {
  return value ? value.toISOString() : '';
}

export function packageView(row: PlatformUpgradePackage): UpgradePackage {
  return {
    id: row.id,
    source: row.source as UpgradePackage['source'],
    status: row.status as UpgradePackage['status'],
    version: row.version,
    tag: row.tag,
    fileName: row.fileName,
    bytes: row.bytes,
    sha256: row.sha256,
    releaseNotes: row.releaseNotes,
    publishedAt: row.publishedAt,
    extracted: row.extracted,
    invalidReason: row.invalidReason,
    createdAt: iso(row.createdAt),
  };
}

export function backupView(row: PlatformBackup): UpgradeBackup {
  return {
    id: row.id,
    jobId: row.jobId,
    kind: row.kind as UpgradeBackup['kind'],
    version: row.version,
    dialect: row.dialect,
    fileName: row.fileName,
    bytes: row.bytes,
    sha256: row.sha256,
    verified: row.verified,
    locked: row.locked,
    createdAt: iso(row.createdAt),
  };
}

export function analysisView(row: PlatformUpgradeJob): UpgradeAnalysis | null {
  if (!row.adviceJson) return null;
  const parsed = parseJson<UpgradeAnalysis | null>(row.adviceJson, null);
  return parsed && typeof parsed === 'object' ? parsed : null;
}

export function stepView(row: PlatformUpgradeStep): UpgradeStep {
  return {
    key: row.stepKey,
    label: row.label,
    status: row.status as UpgradeStep['status'],
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
    message: row.message,
  };
}

export function jobView(
  row: PlatformUpgradeJob,
  steps: PlatformUpgradeStep[],
): UpgradeJob {
  const options = parseJson<UpgradeJob['options']>(row.optionsJson, null);
  return {
    id: row.id,
    type: row.type as UpgradeJob['type'],
    status: row.status as UpgradeJob['status'],
    packageId: row.packageId,
    fromVersion: row.fromVersion,
    toVersion: row.toVersion,
    currentStep: row.currentStep,
    progress: row.progress,
    error: row.error,
    sourceKind: row.sourceKind as UpgradeJob['sourceKind'],
    sourceRefId: row.sourceRefId,
    analysis: analysisView(row),
    options,
    steps: steps.map(stepView),
    createdAt: iso(row.createdAt),
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
  };
}
