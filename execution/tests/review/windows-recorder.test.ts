import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { WindowsRecorderManager } from '../../review/service/windows-recorder.js';

interface FakeChild extends EventEmitter {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  killed: boolean;
  kill(): boolean;
}

function childProcess(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    return true;
  };
  return child;
}

async function recorderFixture(): Promise<{ root: string; executionRoot: string; pythonExecutable: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-recorder-manager-'));
  const executionRoot = path.join(root, 'execution');
  const pythonExecutable = path.join(root, 'python.exe');
  await mkdir(executionRoot, { recursive: true });
  await writeFile(pythonExecutable, 'python');
  return { root, executionRoot, pythonExecutable };
}

test('WindowsRecorderManager 串行启动并通过 stdin 正常停止 Worker', async () => {
  const fixture = await recorderFixture();
  const outputRoot = path.join(fixture.root, 'recordings');
  await mkdir(outputRoot);
  const child = childProcess();
  const spawnCalls: Array<{ command: string; args: readonly string[] }> = [];
  const manager = new WindowsRecorderManager({
    executionRoot: fixture.executionRoot,
    pythonExecutable: fixture.pythonExecutable,
    recordingsRoot: outputRoot,
    spawnProcess: ((command: string, args: readonly string[]) => {
      spawnCalls.push({ command, args });
      queueMicrotask(() => child.stdout.write(JSON.stringify({
        event: 'armed', hotkey: 'Ctrl+Shift+F9',
      }) + '\n'));
      child.stdin.once('data', () => {
        child.stdout.write(JSON.stringify({ event: 'completed', recording_id: 'Recording_test' }) + '\n');
        queueMicrotask(() => child.emit('close', 0, null));
      });
      return child;
    }) as any,
  });

  const status = await manager.start('display-0');
  assert.equal(status.phase, 'armed');
  assert.equal(status.hotkey, 'Ctrl+Shift+F9');
  await assert.rejects(manager.start('display-0'), /已有录制会话/);
  child.stdout.write(JSON.stringify({
    event: 'recording', recording_id: 'Recording_test', started_at: '2026-08-19T10:00:00.000',
  }) + '\n');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.status().phase, 'recording');
  assert.equal(manager.status().recordingId, 'Recording_test');
  assert.equal((await manager.stop()).phase, 'idle');
  assert.equal(spawnCalls[0]?.command, fixture.pythonExecutable);
  assert.deepEqual(spawnCalls[0]?.args.slice(0, 3), ['-m', 'cua_recorder', 'record']);
  await manager.close();
});

test('WindowsRecorderManager 将 Worker 首帧前失败暴露为 failed', async () => {
  const fixture = await recorderFixture();
  const outputRoot = path.join(fixture.root, 'recordings');
  await mkdir(outputRoot);
  const child = childProcess();
  const manager = new WindowsRecorderManager({
    executionRoot: fixture.executionRoot,
    pythonExecutable: fixture.pythonExecutable,
    recordingsRoot: outputRoot,
    spawnProcess: (() => {
      queueMicrotask(() => {
        child.stderr.write('pyav missing h264_mf\n');
        child.emit('close', 2, null);
      });
      return child;
    }) as any,
  });

  await assert.rejects(manager.start('display-0'), /exit=2/);
  assert.equal(manager.status().phase, 'failed');
  assert.match(manager.status().error ?? '', /h264_mf/);
  await manager.close();
});

test('WindowsRecorderManager 要求录制输出根并支持显示器预览边界', async () => {
  const fixture = await recorderFixture();
  const preview = path.join(fixture.root, 'preview.png');
  await writeFile(preview, 'png');
  const child = childProcess();
  const manager = new WindowsRecorderManager({
    executionRoot: fixture.executionRoot,
    pythonExecutable: fixture.pythonExecutable,
    spawnProcess: ((_command: string, args: readonly string[]) => {
      const previewIndex = args.indexOf('--preview-dir');
      const previewDir = String(args[previewIndex + 1]);
      const previewPath = path.join(previewDir, 'display-0.png');
      void writeFile(previewPath, 'png').then(() => {
        child.stdout.write(JSON.stringify({
          event: 'displays',
          displays: [{
            id: 'display-0', device_name: 'DISPLAY0', index: 0,
            left: 0, top: 0, width: 1920, height: 1080,
            scale_factor: 1, primary: true, preview_path: previewPath,
          }],
        }) + '\n');
        child.emit('close', 0, null);
      });
      return child;
    }) as any,
  });

  await assert.rejects(manager.start('display-0'), /尚未配置 CUA_RECORDINGS_ROOT/);
  const result = await manager.refreshDisplays();
  assert.equal(result.displays[0]?.previewUrl.startsWith('/api/recorder/displays/0/preview'), true);
  assert.equal(path.basename(await manager.preview(0)), 'display-0.png');
  await assert.rejects(manager.preview(1), /不存在/);
  await manager.close();
});

test('WindowsRecorderManager 使用真实路径校验重定向临时目录中的预览', async () => {
  const fixture = await recorderFixture();
  const previewTarget = path.join(fixture.root, 'preview-target');
  const previewAlias = path.join(fixture.root, 'preview-alias');
  await mkdir(previewTarget);
  await symlink(previewTarget, previewAlias, process.platform === 'win32' ? 'junction' : 'dir');
  const child = childProcess();
  let workerPreviewPath = '';
  const manager = new WindowsRecorderManager({
    executionRoot: fixture.executionRoot,
    pythonExecutable: fixture.pythonExecutable,
    previewRoot: previewAlias,
    spawnProcess: ((_command: string, args: readonly string[]) => {
      const previewIndex = args.indexOf('--preview-dir');
      const previewDir = String(args[previewIndex + 1]);
      const previewPath = path.join(previewDir, 'display-0.png');
      void writeFile(previewPath, 'png').then(async () => {
        workerPreviewPath = await realpath(previewPath);
        child.stdout.write(JSON.stringify({
          event: 'displays',
          displays: [{
            id: 'display-0', device_name: 'DISPLAY0', index: 0,
            left: 0, top: 0, width: 1920, height: 1080,
            scale_factor: 1, primary: true, preview_path: workerPreviewPath,
          }],
        }) + '\n');
        child.emit('close', 0, null);
      });
      return child;
    }) as any,
  });

  const result = await manager.refreshDisplays();
  assert.equal(result.displays.length, 1);
  assert.equal(await manager.preview(0), workerPreviewPath);
  await manager.close();
});

test('WindowsRecorderManager 停止超时后终止 Worker 并进入 failed', async () => {
  const fixture = await recorderFixture();
  const outputRoot = path.join(fixture.root, 'recordings');
  await mkdir(outputRoot);
  const child = childProcess();
  const manager = new WindowsRecorderManager({
    executionRoot: fixture.executionRoot,
    pythonExecutable: fixture.pythonExecutable,
    recordingsRoot: outputRoot,
    stopTimeoutMs: 5,
    spawnProcess: (() => {
      queueMicrotask(() => child.stdout.write(JSON.stringify({ event: 'armed', hotkey: 'Ctrl+Shift+F9' }) + '\n'));
      return child;
    }) as any,
  });

  await manager.start('display-0');
  await assert.rejects(manager.stop(), /停止超时/);
  assert.equal(child.killed, true);
  assert.equal(manager.status().phase, 'failed');
});

test('WindowsRecorderManager 可在 armed 阶段取消且不产生录制', async () => {
  const fixture = await recorderFixture();
  const outputRoot = path.join(fixture.root, 'recordings');
  await mkdir(outputRoot);
  const child = childProcess();
  const manager = new WindowsRecorderManager({
    executionRoot: fixture.executionRoot,
    pythonExecutable: fixture.pythonExecutable,
    recordingsRoot: outputRoot,
    spawnProcess: (() => {
      queueMicrotask(() => child.stdout.write(JSON.stringify({ event: 'armed', hotkey: 'Ctrl+Shift+F9' }) + '\n'));
      child.stdin.once('data', () => {
        child.stdout.write(JSON.stringify({ event: 'cancelled' }) + '\n');
        queueMicrotask(() => child.emit('close', 0, null));
      });
      return child;
    }) as any,
  });

  assert.equal((await manager.start('display-0')).phase, 'armed');
  assert.equal((await manager.stop()).phase, 'idle');
  await manager.close();
});
