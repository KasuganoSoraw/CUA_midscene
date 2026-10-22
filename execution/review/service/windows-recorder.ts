import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { access, mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { constants as fsConstants } from 'node:fs';
import { resolvePythonExecutable, spawnPythonWorker } from '../../cua/python-worker.js';
import type { RecorderCompletion } from '../shared/recording.js';

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
  start(displayId: string, sessionId?: string): Promise<RecorderStatus>;
  stop(): Promise<RecorderStatus>;
  close(): Promise<void>;
  primaryDisplay?(): Promise<string>;
  waitForResult?(sessionId: string): Promise<RecorderCompletion>;
  abort?(sessionId: string): Promise<void>;
  subscribe?(listener: (status: RecorderStatus) => void): () => void;
}

interface RecorderTicket {
  id: string;
  done: Promise<void>;
  resolve(): void;
  result?: RecorderCompletion;
}

function newTicket(id: string): RecorderTicket {
  let resolve!: () => void;
  const done = new Promise<void>((complete) => { resolve = complete; });
  return { id, done, resolve };
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

export class WindowsRecorderManager implements RecorderControl {
  private readonly previewDirectories = new Set<string>();
  private readonly previewPaths = new Map<number, string>();
  private currentStatus: RecorderStatus;
  private child?: ChildProcessWithoutNullStreams;
  private completion?: Promise<void>;
  private resolveCompletion?: () => void;
  private diagnostics: string[] = [];
  private resolvedPythonExecutable?: string;
  private ticket?: RecorderTicket;
  private readonly tickets = new Map<string, RecorderTicket>();
  private readonly listeners = new Set<(status: RecorderStatus) => void>();
  private startReady?: { resolve(status: RecorderStatus): void; reject(error: Error): void };

  constructor(private readonly options: {
    executionRoot: string;
    recordingsRoot?: string;
    pythonExecutable?: string;
    previewRoot?: string;
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
    const previewDirectory = await mkdtemp(path.join(this.options.previewRoot ?? os.tmpdir(), 'cua-recorder-previews-'));
    this.previewDirectories.add(previewDirectory);
    const event = await this.runOnce(['displays', '--preview-dir', previewDirectory]);
    if (event.event !== 'displays' || !Array.isArray(event.displays)) {
      throw new Error(`录制 Worker 未返回 displays：${event.event}`);
    }
    const revision = `${Date.now()}`;
    const resolvedPreviewDirectory = await realpath(previewDirectory);
    this.previewPaths.clear();
    const displays = await Promise.all(event.displays.map(async (item) => {
      if (!Number.isInteger(item.index) || !item.preview_path) {
        throw new Error('录制 Worker 返回了无效显示器预览');
      }
      const previewPath = await realpath(path.resolve(item.preview_path));
      const relative = path.relative(resolvedPreviewDirectory, previewPath);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
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
    }));
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

  async start(displayId: string, sessionId: string = randomUUID()): Promise<RecorderStatus> {
    if (this.child || isActive(this.currentStatus.phase)) {
      throw Object.assign(new Error(`已有录制会话正在运行：${this.currentStatus.phase}`), { statusCode: 409 });
    }
    if (this.tickets.has(sessionId)) throw new Error('录制会话标识已使用');
    this.currentStatus = { ...this.currentStatus, phase: 'arming' };
    this.ticket = newTicket(sessionId);
    this.tickets.set(sessionId, this.ticket);
    if (this.tickets.size > 16) this.tickets.delete(this.tickets.keys().next().value!);
    this.completion = this.ticket.done;
    this.resolveCompletion = this.ticket.resolve;
    this.diagnostics = [];
    try {
      const outputRoot = await requireWritableDirectory(this.currentStatus.outputRoot || '');
      const pythonExecutable = await this.pythonExecutable();
      this.child = spawnPythonWorker({
        pythonExecutable, module: 'cua_recorder',
        args: ['record', '--display-id', displayId, '--output-root', outputRoot],
        stdio: ['pipe', 'pipe', 'pipe'],
      }, this.options.spawnProcess ?? spawn) as ChildProcessWithoutNullStreams;
      return await this.watchWorker(this.child, outputRoot);
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
      this.resolveCompletion?.();
      throw error;
    }
  }

  private watchWorker(child: ChildProcessWithoutNullStreams, outputRoot: string): Promise<RecorderStatus> {
    return new Promise((resolve, reject) => {
      this.startReady = { resolve, reject };
      let buffer = '';
      child.stdout.on('data', (chunk) => {
        const split = splitLines(buffer + chunk.toString('utf8'));
        buffer = split.rest;
        for (const line of split.lines.filter(Boolean)) this.workerLine(line, outputRoot);
      });
      child.stderr.on('data', (chunk) => {
        this.diagnostics.push(chunk.toString('utf8'));
        this.diagnostics = this.diagnostics.join('').slice(-16_384).split(/(?<=\n)/);
      });
      child.once('error', (error) => this.workerError(error));
      child.once('close', (code, signal) => this.workerClosed(code, signal));
    });
  }

  private workerLine(line: string, outputRoot: string): void {
    try {
      if (this.applyWorkerEvent(parseWorkerEvent(line), outputRoot)) {
        this.startReady?.resolve(this.status());
        this.startReady = undefined;
      }
      for (const listener of this.listeners) listener(this.status());
    } catch (error) {
      this.workerError(error instanceof Error ? error : new Error(String(error)));
      this.child?.kill();
    }
  }

  private workerError(error: Error): void {
    this.fail(error);
    this.startReady?.reject(error);
    this.startReady = undefined;
    this.resolveCompletion?.();
  }

  private workerClosed(code: number | null, signal: NodeJS.Signals | null): void {
    this.child = undefined;
    if (code !== 0 || !this.ticket?.result) {
      const detail = this.diagnostics.join('').trim();
      this.workerError(new Error(`录制 Worker 异常退出：exit=${String(code)} signal=${signal ?? '-'}\n${detail}`));
    } else {
      this.startReady?.resolve(this.status());
      this.startReady = undefined;
      this.resolveCompletion?.();
    }
  }

  async primaryDisplay(): Promise<string> {
    const event = await this.runOnce(['displays']);
    const display = event.displays?.find((item) => item.primary);
    if (!display) throw new Error('未找到主屏幕');
    return display.id;
  }

  async waitForResult(sessionId: string): Promise<RecorderCompletion> {
    const ticket = this.tickets.get(sessionId);
    if (!ticket) throw new Error('录制会话已失效');
    await ticket.done;
    return ticket.result ?? { status: 'failed', error: '录制未返回终态' };
  }

  subscribe(listener: (status: RecorderStatus) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  async abort(sessionId: string): Promise<void> {
    if (this.ticket?.id !== sessionId) return;
    await this.control('abort');
  }

  private applyWorkerEvent(event: ReturnType<typeof parseWorkerEvent>, outputRoot: string): boolean {
    if (event.event === 'armed') {
      this.currentStatus = {
        phase: 'armed', outputRoot,
        hotkey: typeof event.hotkey === 'string' ? event.hotkey : undefined,
      };
      return true;
    }
    if (event.event === 'starting') {
      this.currentStatus = {
        ...this.currentStatus, phase: 'starting', recordingId: String(event.recording_id ?? ''),
      };
    } else if (event.event === 'recording') {
      this.currentStatus = {
        phase: 'recording', outputRoot,
        recordingId: String(event.recording_id ?? ''),
        startedAt: typeof event.started_at === 'string' ? event.started_at : undefined,
        hotkey: this.currentStatus.hotkey,
      };
      return true;
    } else if (event.event === 'stopping') {
      this.currentStatus = { ...this.currentStatus, phase: 'stopping' };
    } else if (event.event === 'completed' || event.event === 'cancelled') {
      if (this.ticket && !this.ticket.result) {
        this.ticket.result = this.recordingResult(event, outputRoot);
      }
      this.currentStatus = { phase: 'idle', outputRoot };
    } else if (event.event === 'error') {
      throw new Error(event.message || '录制 Worker 报告未知错误');
    }
    return false;
  }

  async stop(): Promise<RecorderStatus> {
    return this.control('stop');
  }

  private recordingResult(event: WorkerEvent, outputRoot: string): RecorderCompletion {
    if (event.event === 'cancelled') {
      return { status: 'cancelled', reason: String(event.reason ?? 'user_cancelled') };
    }
    const id = String(event.recording_id ?? '');
    if (!id || /[\\/]|^\.{1,2}$/u.test(id)) throw new Error('录制 Worker 返回了无效录制标识');
    return { status: 'completed', recordingId: id, recordingPath: path.join(outputRoot, id),
      completedAt: Date.now() };
  }

  private async control(command: 'stop' | 'abort'): Promise<RecorderStatus> {
    if (!this.child || !isActive(this.currentStatus.phase) || this.currentStatus.phase === 'stopping') {
      return this.status();
    }
    this.currentStatus = { ...this.currentStatus, phase: 'stopping' };
    this.child.stdin.write(`${command}\n`);
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
      this.resolveCompletion?.();
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
    const tempRoot = path.resolve(this.options.previewRoot ?? os.tmpdir());
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

  private async pythonExecutable(): Promise<string> {
    this.resolvedPythonExecutable ??= await resolvePythonExecutable(
      this.options.pythonExecutable,
      {
        executionRoot: this.options.executionRoot,
        devProjectRoot: path.resolve(this.options.executionRoot, '..', 'recorder'),
      },
    );
    return this.resolvedPythonExecutable;
  }

  private async runOnce(args: string[]): Promise<WorkerEvent> {
    const pythonExecutable = await this.pythonExecutable();
    const spawnProcess = this.options.spawnProcess ?? spawn;
    const child = spawnPythonWorker({
      pythonExecutable,
      module: 'cua_recorder',
      args,
      stdio: ['ignore', 'pipe', 'pipe'],
    }, spawnProcess);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
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
    if (this.ticket) this.ticket.result = { status: 'failed', error: error.message };
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
