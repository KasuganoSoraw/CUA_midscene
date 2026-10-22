import { spawn } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { resolvePythonExecutable, spawnPythonWorker } from '../../cua/python-worker.js';
import type { RecordingAssets } from '../shared/recording.js';

export async function validatePreparedAssets(raw: unknown, root: string): Promise<RecordingAssets> {
  const assets = raw as RecordingAssets;
  const base = await realpath(root);
  if (!assets || typeof assets !== 'object' || await realpath(assets.recordingRoot) !== base) {
    throw new Error('预处理录制目录不匹配');
  }
  for (const name of ['processedLogPath', 'screenshotsDir'] as const) {
    const target = await realpath(assets[name]);
    const relative = path.relative(base, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('预处理资产路径越界');
    assets[name] = target;
  }
  const log = JSON.parse(await readFile(assets.processedLogPath, 'utf8')) as unknown;
  if (!Array.isArray(log) || log.length === 0 || log.length !== assets.stepCount) {
    throw new Error('预处理步骤数量无效');
  }
  if (!(await stat(assets.screenshotsDir)).isDirectory()) throw new Error('预处理截图目录不存在');
  for (const name of ['log', 'screenshots', 'total'] as const) {
    const value = assets.timingsMs?.[name];
    if (!Number.isFinite(value) || value < 0) throw new Error('预处理耗时无效');
  }
  for (const step of log) await validatePreparedStep(step, base, assets.screenshotsDir);
  assets.recordingRoot = base;
  return assets;
}

async function validatePreparedStep(raw: unknown, root: string, screenshots: string): Promise<void> {
  if (!raw || typeof raw !== 'object') throw new Error('预处理步骤无效');
  const step = raw as Record<string, unknown>;
  for (const key of ['screenshot_full', 'screenshot_crop', 'screenshot_reference']) {
    const value = step[key];
    if (key === 'screenshot_reference' && value === undefined) continue;
    if (typeof value !== 'string' || !value || path.isAbsolute(value)) throw new Error('截图引用无效');
    const target = await realpath(path.join(root, value));
    const relative = path.relative(screenshots, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)
      || !(await stat(target)).isFile() || (await stat(target)).size === 0) {
      throw new Error('截图缺失、为空或越出截图目录');
    }
  }
}

export async function prepareRecording(
  root: string, executionRoot: string, signal: AbortSignal, progress: (phase: string) => void,
): Promise<RecordingAssets> {
  const pythonExecutable = await resolvePythonExecutable(undefined, {
    executionRoot, devProjectRoot: path.resolve(executionRoot, '..', 'record'),
  });
  signal.throwIfAborted();
  const child = spawnPythonWorker({ pythonExecutable, module: 'cua_record', args: ['prepare', root] }, spawn);
  let stdout = '';
  let stderr = '';
  let rest = '';
  child.stdout!.on('data', (chunk) => { stdout = (stdout + String(chunk)).slice(-65_536); });
  child.stderr!.on('data', (chunk) => {
    stderr = (stderr + String(chunk)).slice(-16_384);
    const lines = (rest + String(chunk)).split(/\r?\n/u);
    rest = lines.pop() ?? '';
    for (const line of lines) {
      try {
        const event = JSON.parse(line) as { event?: string; phase?: string };
        if (event.event === 'prepare.progress' && event.phase) progress(event.phase);
      } catch { /* 非协议诊断保留在 stderr 中。 */ }
    }
  });
  const abort = () => { child.kill(); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
      if (signal.aborted) abort();
    });
    signal.throwIfAborted();
    if (code !== 0) throw new Error(`录制预处理失败：exit=${String(code)}\n${stderr}`);
    const result = JSON.parse(stdout.trim()) as { event?: string; assets?: unknown };
    if (result.event !== 'prepared') throw new Error('预处理未返回资产清单');
    return await validatePreparedAssets(result.assets, root);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
