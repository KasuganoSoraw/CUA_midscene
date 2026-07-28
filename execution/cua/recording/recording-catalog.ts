import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import type { Dirent } from 'node:fs';
import { access, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import { packageRoot } from '../package-root.js';
import { requireIdentifier } from '../task/tasks.js';

export const recordingsRootEnv = 'CUA_RECORDINGS_ROOT';

export interface RecordingFileInfo {
  name: string;
  size: number;
}

export interface RecordingScreenInfo {
  width: number;
  height: number;
  scaleFactor?: number;
}

export interface RecordingEntry {
  id: string;
  ready: boolean;
  errors: string[];
  video?: RecordingFileInfo;
  eventLog?: RecordingFileInfo;
  startedAt?: string;
  screen?: RecordingScreenInfo;
}

export interface RecordingCatalog {
  configured: boolean;
  envName: typeof recordingsRootEnv;
  recordings: RecordingEntry[];
}

async function configuredRecordingsRoot(
  explicit: string | undefined,
  executionRoot: string,
): Promise<{ value?: string; source?: string }> {
  if (explicit !== undefined) return { value: explicit, source: 'recordingsRoot' };
  const processValue = process.env[recordingsRootEnv]?.trim();
  if (processValue) return { value: processValue, source: recordingsRootEnv };

  for (const filename of ['.env.local', '.env']) {
    const envPath = path.join(executionRoot, filename);
    try {
      const parsed = dotenv.parse(await readFile(envPath));
      const value = parsed[recordingsRootEnv]?.trim();
      if (value) return { value, source: envPath };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return {};
}

export async function resolveRecordingsRoot(
  explicit?: string,
  options: { executionRoot?: string } = {},
): Promise<string | undefined> {
  const executionRoot = path.resolve(options.executionRoot ?? packageRoot);
  const configured = await configuredRecordingsRoot(explicit, executionRoot);
  if (configured.value === undefined) return undefined;
  if (!path.isAbsolute(configured.value)) {
    throw new Error(`${configured.source} 必须配置绝对路径：${configured.value}`);
  }
  const resolved = path.resolve(configured.value);
  try {
    const value = await stat(resolved);
    if (!value.isDirectory()) throw new Error('不是目录');
    await access(resolved, constants.R_OK);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`录制目录不可读：${resolved}\n${message}`);
  }
  return resolved;
}

function metadataObject(text: string): Record<string, unknown> | undefined {
  const marker = '# Metadata:';
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return undefined;
  const start = text.indexOf('{', markerIndex + marker.length);
  if (start < 0) return undefined;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1)) as Record<string, unknown>;
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

function normalizedStartedAt(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const raw = value.trim();
  const parsed = new Date(raw.replace(' ', 'T'));
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString();
}

function screenInfo(metadata: Record<string, unknown> | undefined): RecordingScreenInfo | undefined {
  const raw = metadata?.screen_info;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const first = Object.values(raw)[0];
  if (!first || typeof first !== 'object' || Array.isArray(first)) return undefined;
  const value = first as Record<string, unknown>;
  const width = Number(value.width);
  const height = Number(value.height);
  const scaleFactor = Number(value.scale_factor);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined;
  return {
    width,
    height,
    ...(Number.isFinite(scaleFactor) ? { scaleFactor } : {}),
  };
}

async function logMetadata(logPath: string): Promise<{
  startedAt?: string;
  screen?: RecordingScreenInfo;
}> {
  const handle = await open(logPath, 'r');
  try {
    const buffer = Buffer.alloc(64 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    const metadata = metadataObject(text);
    const startedLine = /^# Started:\s*(.+)$/m.exec(text)?.[1];
    const startedAt = normalizedStartedAt(startedLine)
      ?? normalizedStartedAt(metadata?.recording_timestamp)
      ?? normalizedStartedAt(metadata?.video_start_time);
    const screen = screenInfo(metadata);
    return {
      ...(startedAt ? { startedAt } : {}),
      ...(screen ? { screen } : {}),
    };
  } finally {
    await handle.close();
  }
}

async function recordingEntry(root: string, id: string): Promise<RecordingEntry> {
  const inputs = path.join(root, id, 'inputs');
  const errors: string[] = [];
  let entries: Dirent[] = [];
  try {
    const inputsStat = await stat(inputs);
    if (!inputsStat.isDirectory()) throw new Error('不是目录');
    entries = await readdir(inputs, { withFileTypes: true });
  } catch {
    errors.push('缺少 inputs/ 目录');
  }

  const files = entries.filter((entry) => entry.isFile());
  const videos = files.filter((entry) => path.extname(entry.name).toLowerCase() === '.mp4');
  const logs = files.filter((entry) => ['.txt', '.log', '.json'].includes(path.extname(entry.name).toLowerCase()));
  if (videos.length !== 1) errors.push(`需要恰好一个 MP4 视频，当前为 ${videos.length} 个`);
  if (logs.length !== 1) errors.push(`需要恰好一个事件日志，当前为 ${logs.length} 个`);

  const videoPath = videos.length === 1 ? path.join(inputs, videos[0].name) : undefined;
  const logPath = logs.length === 1 ? path.join(inputs, logs[0].name) : undefined;
  const [videoStat, logStat, metadata] = await Promise.all([
    videoPath ? stat(videoPath) : undefined,
    logPath ? stat(logPath) : undefined,
    logPath ? logMetadata(logPath).catch(() => ({})) : {},
  ]);
  return {
    id,
    ready: errors.length === 0,
    errors,
    ...(videoStat && videoPath ? {
      video: { name: path.basename(videoPath), size: videoStat.size },
    } : {}),
    ...(logStat && logPath ? {
      eventLog: { name: path.basename(logPath), size: logStat.size },
    } : {}),
    ...metadata,
  };
}

export async function listRecordings(options: {
  recordingsRoot?: string;
  executionRoot?: string;
} = {}): Promise<RecordingCatalog> {
  const root = await resolveRecordingsRoot(options.recordingsRoot, {
    executionRoot: options.executionRoot,
  });
  if (!root) {
    return { configured: false, envName: recordingsRootEnv, recordings: [] };
  }
  const directories = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const recordings = await Promise.all(directories.map((id) => recordingEntry(root, id)));
  recordings.sort((left, right) => {
    const byTime = String(right.startedAt ?? '').localeCompare(String(left.startedAt ?? ''));
    return byTime || right.id.localeCompare(left.id);
  });
  return { configured: true, envName: recordingsRootEnv, recordings };
}

export async function resolveRecordingDirectory(
  recordingId: string,
  options: { recordingsRoot?: string; executionRoot?: string } = {},
): Promise<string> {
  const id = requireIdentifier(recordingId, 'recording');
  const root = await resolveRecordingsRoot(options.recordingsRoot, {
    executionRoot: options.executionRoot,
  });
  if (!root) throw new Error(`尚未配置 ${recordingsRootEnv}`);
  const target = path.resolve(root, id);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.dirname(relative) !== '.') {
    throw new Error(`recording 必须是录制根下的一级目录标识：${recordingId}`);
  }
  try {
    if (!(await stat(target)).isDirectory()) throw new Error('不是目录');
  } catch {
    throw new Error(`录制目录不存在：${recordingId}`);
  }
  return target;
}

export async function describeRecording(
  recordingId: string,
  options: { recordingsRoot?: string; executionRoot?: string } = {},
): Promise<RecordingEntry> {
  const target = await resolveRecordingDirectory(recordingId, options);
  return recordingEntry(path.dirname(target), path.basename(target));
}

export async function openRecordingDirectory(
  recordingPath: string,
  spawnProcess: typeof spawn = spawn,
): Promise<void> {
  const command = process.platform === 'win32'
    ? 'explorer.exe'
    : process.platform === 'darwin' ? 'open' : 'xdg-open';
  await new Promise<void>((resolve, reject) => {
    const child = spawnProcess(command, [recordingPath], {
      detached: true,
      shell: false,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

function pickerCommand(platform: NodeJS.Platform): { command: string; args: string[] } {
  if (platform === 'win32') {
    const script = [
      '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
      'Add-Type -AssemblyName System.Windows.Forms',
      '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
      "$dialog.Description = '选择原始录制目录'",
      '$dialog.ShowNewFolderButton = $false',
      'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
      '  [Console]::Write($dialog.SelectedPath)',
      '}',
    ].join('\n');
    return {
      command: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-STA', '-WindowStyle', 'Hidden', '-Command', script],
    };
  }
  if (platform === 'darwin') {
    return {
      command: 'osascript',
      args: ['-e', 'POSIX path of (choose folder with prompt "选择原始录制目录")'],
    };
  }
  return {
    command: 'zenity',
    args: ['--file-selection', '--directory', '--title=选择原始录制目录'],
  };
}

export async function selectRecordingRootDirectory(
  spawnProcess: typeof spawn = spawn,
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
  const picker = pickerCommand(platform);
  return new Promise<string | undefined>((resolve, reject) => {
    const child = spawnProcess(picker.command, picker.args, {
      shell: false,
      windowsHide: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer | string) => stdout.push(Buffer.from(chunk)));
    child.stderr?.on('data', (chunk: Buffer | string) => stderr.push(Buffer.from(chunk)));
    child.once('error', reject);
    child.once('close', (code) => {
      const selected = Buffer.concat(stdout).toString('utf8').trim();
      if (code === 0) {
        resolve(selected || undefined);
        return;
      }
      if (code === 1 && platform !== 'win32') {
        resolve(undefined);
        return;
      }
      const detail = Buffer.concat(stderr).toString('utf8').trim();
      reject(new Error(`无法打开系统文件夹选择框${detail ? `：${detail}` : ''}`));
    });
  });
}

function envAssignment(value: string): string {
  if (/[\r\n]/u.test(value)) throw new Error('录制目录路径不能包含换行符');
  if (!value.includes('#')) return `${recordingsRootEnv}=${value}`;
  if (!value.includes("'")) return `${recordingsRootEnv}='${value}'`;
  throw new Error("录制目录路径不能同时包含 # 和单引号");
}

export async function saveRecordingsRoot(
  recordingsRoot: string,
  options: { executionRoot?: string } = {},
): Promise<string> {
  const executionRoot = path.resolve(options.executionRoot ?? packageRoot);
  const resolved = await resolveRecordingsRoot(recordingsRoot, { executionRoot });
  if (!resolved) throw new Error('录制目录不能为空');
  const envPath = path.join(executionRoot, '.env.local');
  let original = '';
  try {
    original = await readFile(envPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  const assignment = envAssignment(resolved);
  const lines = original.split(/\r?\n/u);
  let replaced = false;
  const nextLines = lines.flatMap((line) => {
    if (!new RegExp(`^\\s*(?:export\\s+)?${recordingsRootEnv}\\s*=`).test(line)) return [line];
    if (replaced) return [];
    replaced = true;
    return [assignment];
  });
  if (!replaced) {
    if (nextLines.length === 1 && nextLines[0] === '') nextLines.length = 0;
    nextLines.push(assignment);
  }
  const content = `${nextLines.join(newline).replace(/(?:\r?\n)+$/u, '')}${newline}`;
  const temporary = `${envPath}.recordings-${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temporary, content, 'utf8');
  try {
    await rename(temporary, envPath);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return resolved;
}
