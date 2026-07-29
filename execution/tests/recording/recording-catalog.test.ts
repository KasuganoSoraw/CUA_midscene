import assert from 'node:assert/strict';
import type { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import dotenv from 'dotenv';
import {
  describeRecording,
  listRecordings,
  openRecordingDirectory,
  resolveRecordingDirectory,
  resolveRecordingsRoot,
} from '../../cua/recording/recording-catalog.js';

async function recording(
  root: string,
  id: string,
  files: Array<[string, string]>,
): Promise<string> {
  const inputs = path.join(root, id, 'inputs');
  await mkdir(inputs, { recursive: true });
  await Promise.all(files.map(([name, content]) => writeFile(path.join(inputs, name), content, 'utf8')));
  return path.join(root, id);
}

test('录制根遵循显式、进程、env.local、env 和未配置状态', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-recordings-root-'));
  const executionRoot = path.join(root, 'execution');
  const explicit = path.join(root, 'explicit');
  const processRoot = path.join(root, 'process');
  const localRoot = path.join(root, 'local');
  const envRoot = path.join(root, 'env');
  await Promise.all([
    mkdir(executionRoot),
    mkdir(explicit),
    mkdir(processRoot),
    mkdir(localRoot),
    mkdir(envRoot),
  ]);
  await writeFile(path.join(executionRoot, '.env'), `CUA_RECORDINGS_ROOT=${envRoot}\n`, 'utf8');
  await writeFile(path.join(executionRoot, '.env.local'), `CUA_RECORDINGS_ROOT=${localRoot}\n`, 'utf8');
  const previous = process.env.CUA_RECORDINGS_ROOT;
  try {
    process.env.CUA_RECORDINGS_ROOT = processRoot;
    assert.equal(await resolveRecordingsRoot(explicit, { executionRoot }), explicit);
    assert.equal(await resolveRecordingsRoot(undefined, { executionRoot }), processRoot);
    delete process.env.CUA_RECORDINGS_ROOT;
    assert.equal(await resolveRecordingsRoot(undefined, { executionRoot }), localRoot);
    await writeFile(path.join(executionRoot, '.env.local'), '', 'utf8');
    assert.equal(await resolveRecordingsRoot(undefined, { executionRoot }), envRoot);
    await writeFile(path.join(executionRoot, '.env'), '', 'utf8');
    assert.equal(await resolveRecordingsRoot(undefined, { executionRoot }), undefined);
    assert.deepEqual(await listRecordings({ executionRoot }), {
      configured: false,
      envName: 'CUA_RECORDINGS_ROOT',
      recordings: [],
    });
  } finally {
    if (previous === undefined) delete process.env.CUA_RECORDINGS_ROOT;
    else process.env.CUA_RECORDINGS_ROOT = previous;
  }
});

test('录制根必须是可读绝对目录', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-recordings-invalid-'));
  await assert.rejects(resolveRecordingsRoot('relative'), /必须配置绝对路径/);
  await assert.rejects(resolveRecordingsRoot(path.join(root, 'missing')), /录制目录不可读/);
});

test('catalog 展示有效、不完整和多文件录制并解析日志元数据', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-recordings-catalog-'));
  await recording(root, 'Recording_valid', [
    ['capture.mp4', 'video'],
    ['capture.txt', [
      '# Started: 2026-07-28 17:00:35.649',
      '# Metadata: {"screen_info":{"0":{"width":1920,"height":1080,"scale_factor":1}}}',
    ].join('\n')],
  ]);
  await mkdir(path.join(root, 'Recording_missing'));
  await recording(root, 'Quick_Recording_multiple', [
    ['one.mp4', 'one'],
    ['two.mp4', 'two'],
    ['events.txt', 'events'],
  ]);

  const catalog = await listRecordings({ recordingsRoot: root });
  assert.equal(catalog.configured, true);
  assert.equal(catalog.recordings.length, 3);
  const valid = catalog.recordings.find((item) => item.id === 'Recording_valid')!;
  assert.equal(valid.ready, true);
  assert.deepEqual(valid.video, { name: 'capture.mp4', size: 5 });
  assert.equal(valid.eventLog?.name, 'capture.txt');
  assert.deepEqual(valid.screen, { width: 1920, height: 1080, scaleFactor: 1 });
  assert.match(valid.startedAt ?? '', /^2026-07-28T/);

  const missing = catalog.recordings.find((item) => item.id === 'Recording_missing')!;
  assert.equal(missing.ready, false);
  assert.match(missing.errors.join('\n'), /缺少 inputs/);
  const multiple = catalog.recordings.find((item) => item.id === 'Quick_Recording_multiple')!;
  assert.equal(multiple.ready, false);
  assert.match(multiple.errors.join('\n'), /2 个/);
});

test('录制详情与目录解析拒绝越界和不存在目标', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-recordings-boundary-'));
  const target = await recording(root, 'Recording_demo', [
    ['capture.mp4', 'video'],
    ['capture.txt', 'events'],
  ]);
  assert.equal(await resolveRecordingDirectory('Recording_demo', { recordingsRoot: root }), target);
  assert.equal((await describeRecording('Recording_demo', { recordingsRoot: root })).ready, true);
  await assert.rejects(resolveRecordingDirectory('../outside', { recordingsRoot: root }), /单一目录标识/);
  await assert.rejects(resolveRecordingDirectory('missing', { recordingsRoot: root }), /录制目录不存在/);
});

test('打开录制目录使用无 shell 系统命令', async () => {
  const child = new EventEmitter() as EventEmitter & { unref(): void };
  child.unref = () => undefined;
  let invocation: {
    command: string;
    args: readonly string[];
    shell: unknown;
    windowsHide: unknown;
  } | undefined;
  const fakeSpawn = ((
    command: string,
    args: readonly string[],
    options: { shell?: boolean; windowsHide?: boolean },
  ) => {
    invocation = {
      command,
      args,
      shell: options.shell,
      windowsHide: options.windowsHide,
    };
    setImmediate(() => child.emit('spawn'));
    return child;
  }) as unknown as typeof spawn;
  await openRecordingDirectory('E:\\recordings\\demo', fakeSpawn);
  assert.equal(invocation?.shell, false);
  assert.equal(invocation?.windowsHide, false);
  assert.deepEqual(invocation?.args, ['E:\\recordings\\demo']);
});
