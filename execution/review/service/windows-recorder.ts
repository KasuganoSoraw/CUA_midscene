import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { access, mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { constants as fsConstants } from 'node:fs';

export type RecorderPhase = 'idle' | 'arming' | 'armed' | 'starting' | 'recording' | 'stopping' | 'failed';

export interface RecorderStatus {
  phase: RecorderPhase;
  outputRoot?: string;
  recordingId?: string;
  startedAt?: string;
  hotkey?: string;
  error?: string;
}

export interface RecorderDisplay {
  id: string;
  deviceName: string;
  index: number;
  left: number;
  top: number;
  width: number;
  height: number;
  scaleFactor: number;
  primary: boolean;
  previewUrl: string;
}

interface WorkerDisplay {
  id: string;
  device_name: string;
  index: number;
  left: number;
  top: number;
  width: number;
  height: number;
  scale_factor: number;
  primary: boolean;
  preview_path?: string;
}

interface WorkerEvent extends Record<string, unknown> {
  event: string;
  message?: string;
  displays?: WorkerDisplay[];
  recording_id?: string;
  started_at?: string;
  hotkey?: string;
}

type SpawnProcess = typeof spawn;

export interface RecorderControl {
  status(): RecorderStatus;
  refreshDisplays(): Promise<{ displays: RecorderDisplay[]; revision: string }>;
  preview(index: number): Promise<string>;
  start(displayId: string): Promise<RecorderStatus>;
  stop(): Promise<RecorderStatus>;
  close(): Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function splitLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split(/\r?\n/);
  return { lines: parts.slice(0, -1), rest: parts.at(-1) ?? '' };
}

function parseWorkerEvent(line: string): WorkerEvent {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error(`录制 Worker 输出了非法 JSON：${line.slice(0, 500)}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('录制 Worker 输出必须是 JSON 对象');
  }
  const event = (value as { event?: unknown }).event;
  if (typeof event !== 'string' || !event) throw new Error('录制 Worker 输出缺少 event');
  return value as WorkerEvent;
}

async function requireWritableDirectory(raw: string): Promise<string> {
  if (!raw.trim()) throw new Error('尚未配置 CUA_RECORDINGS_ROOT');
  if (!path.isAbsolute(raw)) throw new Error(`录制输出根必须是绝对路径：${raw}`);
  const resolved = path.resolve(raw);
  const details = await stat(resolved).catch(() => undefined);
  if (!details?.isDirectory()) throw new Error(`录制输出根不存在或不是目录：${resolved}`);
  await access(resolved, fsConstants.W_OK).catch((error) => {
    throw new Error(`录制输出根不可写：${resolved}（${errorMessage(error)}）`);
  });
  return resolved;
}

export async function resolveRecorderRoot(executionRoot: string, explicit?: string): Promise<string> {
  const configured = explicit?.trim() || process.env.CUA_RECORDER_ROOT?.trim();
  const root = path.resolve(configured || path.join(executionRoot, '..', 'recorder'));
  const markers = [path.join(root, 'pyproject.toml'), path.join(root, 'src', 'cua_recorder', '__main__.py')];
  for (const marker of markers) {
    await access(marker).catch(() => {
      throw new Error(`Windows 录制器目录无效，缺少 ${marker}；请配置 CUA_RECORDER_ROOT`);
    });
  }
  return root;
}

export class WindowsRecorderManager implements RecorderControl {
  private readonly previewDirectories = new Set<string>();
  private readonly previewPaths = new Map<number, string>();
  private currentStatus: RecorderStatus;
  private child?: ChildProcessWithoutNullStreams;
  private completion?: Promise<void>;
  private resolveCompletion?: () => void;
  private diagnostics: string[] = [];
  private recorderRoot?: string;

  constructor(private readonly options: {
    executionRoot: string;
    recordingsRoot?: string;
    recorderRoot?: string;
    spawnProcess?: SpawnProcess;
    stopTimeoutMs?: number;
  }) {
    this.currentStatus = {
      phase: 'idle',
      outputRoot: options.recordingsRoot ? path.resolve(options.recordingsRoot) : undefined,
    };
  }

  status(): RecorderStatus {
    return { ...this.currentStatus };
  }

  async refreshDisplays(): Promise<{ displays: RecorderDisplay[]; revision: string }> {
    const previewDirectory = await mkdtemp(path.join(os.tmpdir(), 'cua-recorder-previews-'));
    this.previewDirectories.add(previewDirectory);
    const event = await this.runOnce(['displays', '--preview-dir', previewDirectory]);
    if (event.event !== 'displays' || !Array.isArray(event.displays)) {
      throw new Error(`录制 Worker 未返回 displays：${event.event}`);
    }
    const revision = `${Date.now()}`;
    this.previewPaths.clear();
    const displays = event.displays.map((item) => {
      if (!Number.isInteger(item.index) || !item.preview_path) {
        throw new Error('录制 Worker 返回了无效显示器预览');
      }
      const previewPath = path.resolve(item.preview_path);
      const relative = path.relative(previewDirectory, previewPath);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('录制 Worker 预览路径越出临时目录');
      }
      this.previewPaths.set(item.index, previewPath);
      return {
        id: item.id,
        deviceName: item.device_name,
        index: item.index,
        left: item.left,
        top: item.top,
        width: item.width,
        height: item.height,
        scaleFactor: item.scale_factor,
        primary: item.primary,
        previewUrl: `/api/recorder/displays/${item.index}/preview?revision=${revision}`,
      };
    });
    return { displays, revision };
  }

  async preview(index: number): Promise<string> {
    const previewPath = this.previewPaths.get(index);
    if (!previewPath) throw Object.assign(new Error(`显示器预览不存在：${index}`), { statusCode: 404 });
    await access(previewPath).catch(() => {
      throw Object.assign(new Error(`显示器预览文件已失效：${index}`), { statusCode: 404 });
    });
    return previewPath;
  }

  async start(displayId: string): Promise<RecorderStatus> {
    if (isActive(this.currentStatus.phase)) {
      throw Object.assign(new Error(`已有录制会话正在运行：${this.currentStatus.phase}`), { statusCode: 409 });
    }
    const outputRoot = await requireWritableDirectory(this.currentStatus.outputRoot || '');
    this.currentStatus = { phase: 'arming', outputRoot };
    this.diagnostics = [];
    const root = await this.root();
    const spawnProcess = this.options.spawnProcess ?? spawn;
    const child = spawnProcess('uv', [
      'run', 'python', '-m', 'cua_recorder', 'record', '--display-id', displayId, '--output-root', outputRoot,
    ], {
      cwd: root,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    this.completion = new Promise<void>((resolve) => {
      this.resolveCompletion = resolve;
    });
    let stdoutBuffer = '';
    let settledStart = false;

    const started = new Promise<RecorderStatus>((resolve, reject) => {
      child.stdout.on('data', (chunk) => {
        stdoutBuffer += chunk.toString('utf8');
        const split = splitLines(stdoutBuffer);
        stdoutBuffer = split.rest;
        for (const line of split.lines.filter(Boolean)) {
          try {
            const event = parseWorkerEvent(line);
            if (event.event === 'armed') {
              this.currentStatus = {
                phase: 'armed',
                outputRoot,
                hotkey: typeof event.hotkey === 'string' ? event.hotkey : undefined,
              };
              if (!settledStart) {
                settledStart = true;
                resolve(this.status());
              }
            } else if (event.event === 'starting') {
              this.currentStatus = {
                ...this.currentStatus,
                phase: 'starting',
                recordingId: String(event.recording_id ?? ''),
              };
            } else if (event.event === 'recording') {
              this.currentStatus = {
                phase: 'recording',
                outputRoot,
                recordingId: String(event.recording_id ?? ''),
                startedAt: typeof event.started_at === 'string' ? event.started_at : undefined,
                hotkey: this.currentStatus.hotkey,
              };
              if (!settledStart) {
                settledStart = true;
                resolve(this.status());
              }
            } else if (event.event === 'stopping') {
              this.currentStatus = { ...this.currentStatus, phase: 'stopping' };
            } else if (event.event === 'completed') {
              this.currentStatus = { phase: 'idle', outputRoot };
            } else if (event.event === 'cancelled') {
              this.currentStatus = { phase: 'idle', outputRoot };
            } else if (event.event === 'error') {
              throw new Error(event.message || '录制 Worker 报告未知错误');
            }
          } catch (error) {
            const resolved = error instanceof Error ? error : new Error(String(error));
            this.fail(resolved);
            child.kill();
            if (!settledStart) {
              settledStart = true;
              reject(resolved);
            }
          }
        }
      });
      child.stderr.on('data', (chunk) => {
        this.diagnostics.push(chunk.toString('utf8'));
        this.diagnostics = this.diagnostics.join('').slice(-16_384).split(/(?<=\n)/);
      });
      child.once('error', (error) => {
        this.fail(error);
        if (!settledStart) {
          settledStart = true;
          reject(error);
        }
      });
      child.once('close', (code, signal) => {
        this.child = undefined;
        const completed = code === 0 && this.currentStatus.phase === 'idle';
        if (completed) {
          this.resolveCompletion?.();
        } else {
          const detail = this.diagnostics.join('').trim();
          const error = new Error(`录制 Worker 异常退出：exit=${String(code)} signal=${signal ?? '-'}${detail ? `\n${detail}` : ''}`);
          this.fail(error);
          this.resolveCompletion?.();
          if (!settledStart) {
            settledStart = true;
            reject(error);
          }
        }
      });
    });
    return started;
  }

  async stop(): Promise<RecorderStatus> {
    if (!this.child || !isActive(this.currentStatus.phase) || this.currentStatus.phase === 'stopping') {
      return this.status();
    }
    this.currentStatus = { ...this.currentStatus, phase: 'stopping' };
    this.child.stdin.write('stop\n');
    const timeoutMs = this.options.stopTimeoutMs ?? 20_000;
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.completion,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`等待录制 Worker 停止超时（${timeoutMs} ms）`)), timeoutMs);
        }),
      ]);
      if (this.currentStatus.phase === 'failed') {
        throw new Error(this.currentStatus.error ?? '录制 Worker 停止失败');
      }
    } catch (error) {
      this.child?.kill();
      this.fail(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
    return this.status();
  }

  async close(): Promise<void> {
    if (this.child && isActive(this.currentStatus.phase) && this.currentStatus.phase !== 'stopping') {
      await this.stop().catch(() => this.child?.kill());
    }
    this.child?.kill();
    const tempRoot = path.resolve(os.tmpdir());
    for (const directory of this.previewDirectories) {
      const resolved = path.resolve(directory);
      const relative = path.relative(tempRoot, resolved);
      if (!relative.startsWith('..') && !path.isAbsolute(relative) && path.basename(resolved).startsWith('cua-recorder-previews-')) {
        await rm(resolved, { recursive: true, force: true }).catch(() => undefined);
      }
    }
    this.previewDirectories.clear();
    this.previewPaths.clear();
  }

  private async root(): Promise<string> {
    this.recorderRoot ??= await resolveRecorderRoot(this.options.executionRoot, this.options.recorderRoot);
    return this.recorderRoot;
  }

  private async runOnce(args: string[]): Promise<WorkerEvent> {
    const root = await this.root();
    const spawnProcess = this.options.spawnProcess ?? spawn;
    const child = spawnProcess('uv', ['run', 'python', '-m', 'cua_recorder', ...args], {
      cwd: root,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    const code = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (value) => resolve(value ?? 1));
    });
    const lines = stdout.split(/\r?\n/).filter(Boolean);
    const event = lines.length ? parseWorkerEvent(lines.at(-1)!) : undefined;
    if (code !== 0 || event?.event === 'error') {
      throw new Error(event?.message || stderr.trim() || `录制 Worker 失败：exit=${code}`);
    }
    if (!event) throw new Error('录制 Worker 未返回 JSON 状态');
    return event;
  }

  private fail(error: Error): void {
    this.currentStatus = {
      ...this.currentStatus,
      phase: 'failed',
      error: error.message,
    };
  }
}

function isActive(phase: RecorderPhase): boolean {
  return phase === 'arming' || phase === 'armed' || phase === 'starting'
    || phase === 'recording' || phase === 'stopping';
}
