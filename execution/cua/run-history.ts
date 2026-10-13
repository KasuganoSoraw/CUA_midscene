import { lstat, readFile, readdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { readEnvironmentValue } from './environment.js';

export const runStateFilename = 'run-state.json';
const mib = 1024 * 1024;
const runNamePattern = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]{8}$/;

export interface RunHistoryPolicy {
  maxBytes: number;
  targetBytes: number;
  minAgeMs: number;
}

export interface RunHistoryCleanupResult {
  beforeBytes: number;
  afterBytes: number;
  deletedRuns: string[];
  errors: string[];
}

export async function readRunHistoryPolicy(): Promise<RunHistoryPolicy> {
  async function numberFromEnvironment(name: string, fallback: number): Promise<number> {
    const value = process.env[name] ?? (await readEnvironmentValue(name)).value;
    if (value === undefined) return fallback;
    const number = Number(value);
    if (!value.trim() || !Number.isFinite(number) || number < 0) {
      throw new Error(`${name} must be a non-negative number`);
    }
    return number;
  }
  const maxMb = await numberFromEnvironment('CUA_RUNS_MAX_MB', 5120);
  const targetMb = await numberFromEnvironment('CUA_RUNS_TARGET_MB', maxMb * 0.8);
  const minAgeHours = await numberFromEnvironment('CUA_RUNS_MIN_AGE_HOURS', 24);
  const policy = { maxBytes: maxMb * mib, targetBytes: targetMb * mib, minAgeMs: minAgeHours * 3600_000 };
  validatePolicy(policy);
  return policy;
}

function validatePolicy(policy: RunHistoryPolicy): void {
  if (Object.values(policy).some((value) => !Number.isFinite(value) || value < 0)
    || (policy.maxBytes > 0 && policy.targetBytes > policy.maxBytes)) {
    throw new Error('Run history policy requires 0 <= targetBytes <= maxBytes and minAgeMs >= 0');
  }
}

function processIsAlive(pid: unknown): boolean {
  if (!Number.isInteger(pid) || Number(pid) <= 0) return true;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function readObject(file: string): Promise<Record<string, unknown> | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(file, 'utf8'));
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown> : undefined;
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

interface RunEntry {
  directory: string;
  bytes: number;
  modifiedAt: number;
  eligible: boolean;
}

async function treeUsage(directory: string): Promise<{ bytes: number; modifiedAt: number } | undefined> {
  const info = await lstat(directory);
  if (info.isSymbolicLink()) return undefined;
  if (info.isFile()) return { bytes: info.size, modifiedAt: info.mtimeMs };
  if (!info.isDirectory()) return undefined;
  let bytes = 0;
  let modifiedAt = info.mtimeMs;
  for (const name of await readdir(directory)) {
    const child = await treeUsage(path.join(directory, name));
    if (!child) return undefined;
    bytes += child.bytes;
    modifiedAt = Math.max(modifiedAt, child.modifiedAt);
  }
  return { bytes, modifiedAt };
}

async function inspectRun(directory: string, cutoff: number, protectedRuns: Set<string>): Promise<RunEntry | undefined> {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) return undefined;
  const usage = await treeUsage(directory);
  if (!usage) return undefined;
  let eligible = false;
  const stateFile = path.join(directory, runStateFilename);
  const state = await readObject(stateFile);
  if (state) {
    if (state.schemaVersion === '1.0') {
      eligible = state.state === 'completed' || state.state === 'failed'
        || (state.state === 'running' && !processIsAlive(state.pid));
    }
  } else {
    // A malformed lifecycle marker is not treated as a legacy execution.
    const markerExists = await lstat(stateFile).then(() => true, (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    });
    if (!markerExists) {
      for (const filename of ['execution-result.json', 'ai-act-result.json']) {
        const result = await readObject(path.join(directory, filename));
        if (result && ['succeeded', 'failed'].includes(String(result.status))
          && typeof result.finishedAt === 'string' && Number.isFinite(Date.parse(result.finishedAt))) {
          eligible = true;
          break;
        }
      }
    }
  }
  return {
    directory, ...usage,
    eligible: eligible && usage.modifiedAt <= cutoff && !protectedRuns.has(directory),
  };
}

const cleanups = new Map<string, Promise<RunHistoryCleanupResult>>();

/** Remove oldest eligible run directories when the history exceeds its size budget. */
export async function cleanupRunHistory(options: {
  runsRoot: string;
  policy?: RunHistoryPolicy;
  now?: number;
  protectedRunDirectories?: string[];
}): Promise<RunHistoryCleanupResult> {
  const root = path.resolve(options.runsRoot);
  const previous = cleanups.get(root);
  const cleanup = (previous ?? Promise.resolve()).catch(() => undefined)
    .then(() => performCleanup(root, options));
  cleanups.set(root, cleanup);
  try {
    return await cleanup;
  } finally {
    if (cleanups.get(root) === cleanup) cleanups.delete(root);
  }
}

async function performCleanup(root: string, options: Parameters<typeof cleanupRunHistory>[0]): Promise<RunHistoryCleanupResult> {
  const policy = options.policy ?? await readRunHistoryPolicy();
  validatePolicy(policy);
  const result: RunHistoryCleanupResult = { beforeBytes: 0, afterBytes: 0, deletedRuns: [], errors: [] };
  if (policy.maxBytes === 0) return result;
  const info = await lstat(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (!info) return result;
  if (!info.isDirectory() || info.isSymbolicLink() || path.parse(root).root === root) {
    throw new Error(`Run history root must be a regular non-root directory: ${root}`);
  }
  const canonicalRoot = await realpath(root);
  const cutoff = (options.now ?? Date.now()) - policy.minAgeMs;
  const protectedRuns = new Set((options.protectedRunDirectories ?? []).map((directory) => path.resolve(directory)));
  const entries: RunEntry[] = [];
  for (const name of await readdir(root)) {
    if (!runNamePattern.test(name)) continue;
    try {
      const entry = await inspectRun(path.join(root, name), cutoff, protectedRuns);
      if (entry) entries.push(entry);
    } catch (error) {
      result.errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  result.beforeBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  result.afterBytes = result.beforeBytes;
  if (result.beforeBytes <= policy.maxBytes) return result;
  await removeEligibleRuns(entries, result, policy.targetBytes, cutoff, protectedRuns, canonicalRoot);
  return result;
}

async function removeEligibleRuns(
  entries: RunEntry[], result: RunHistoryCleanupResult, targetBytes: number,
  cutoff: number, protectedRuns: Set<string>, canonicalRoot: string,
): Promise<void> {
  for (const entry of entries.filter((item) => item.eligible).sort((a, b) => a.modifiedAt - b.modifiedAt)) {
    if (result.afterBytes <= targetBytes) break;
    try {
      const current = await inspectRun(entry.directory, cutoff, protectedRuns);
      if (!current?.eligible) continue;
      const canonicalDirectory = await realpath(entry.directory);
      if (path.dirname(canonicalDirectory) !== canonicalRoot) continue;
      await rm(entry.directory, { recursive: true, force: false });
      result.deletedRuns.push(path.basename(entry.directory));
      result.afterBytes -= entry.bytes;
    } catch (error) {
      result.errors.push(`${path.basename(entry.directory)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export async function cleanupRunHistorySafely(runsRoot: string, protectedRunDirectory: string): Promise<void> {
  try {
    const result = await cleanupRunHistory({ runsRoot, protectedRunDirectories: [protectedRunDirectory] });
    if (result.deletedRuns.length) {
      console.warn(`Run history cleanup removed ${result.deletedRuns.length} runs (${result.beforeBytes - result.afterBytes} bytes).`);
    }
    for (const error of result.errors) console.warn(`Run history cleanup: ${error}`);
  } catch (error) {
    console.warn(`Run history cleanup skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
}
