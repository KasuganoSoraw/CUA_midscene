import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PassThrough, Writable } from 'node:stream';
import Fastify from 'fastify';
import { ConversationRecordingService } from '../../review/service/conversation-recording.js';
import { registerRecordingRoutes } from '../../review/server/recording-routes.js';
import { reviewDataRootKey, reviewProtocolVersion, reviewServiceName } from '../../review/server/main.js';
import { cuaRecord } from '../../runtime-bridge/tools/record.js';
import { runRuntimeBridgeWorker } from '../../runtime-bridge/worker-service.js';
import type { RecorderCompletion, RecordingAssets, RecordingProgress } from '../../review/shared/recording.js';
import type { RecorderStatus } from '../../review/service/windows-recorder.js';

class FakeRecorder {
  phase: RecorderStatus['phase'] = 'idle';
  sessionId = '';
  aborts = 0;
  closes = 0;
  selected = '';
  private listeners = new Set<(status: RecorderStatus) => void>();
  private resolve!: (result: RecorderCompletion) => void;
  private done = new Promise<RecorderCompletion>((resolve) => { this.resolve = resolve; });
  status() { return { phase: this.phase }; }
  async primaryDisplay() { return 'primary-display'; }
  async refreshDisplays() { return { displays: [], revision: '1' }; }
  async preview() { return ''; }
  async close() { this.closes++; }
  async stop() { return this.status(); }
  async start(display: string, id = '') {
    if (this.phase !== 'idle') throw new Error('已有专业录制');
    this.selected = display;
    this.sessionId = id;
    this.phase = 'armed';
    for (const listener of this.listeners) listener(this.status());
    return this.status();
  }
  subscribe(listener: (status: RecorderStatus) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  async waitForResult(id: string) {
    assert.equal(id, this.sessionId);
    return this.done;
  }
  finish(result: RecorderCompletion) {
    this.phase = 'idle';
    this.resolve(result);
  }
  async abort(id: string) {
    if (id !== this.sessionId || this.phase === 'idle') return;
    this.aborts++;
    this.finish({ status: 'cancelled', reason: 'host_cancelled' });
  }
}

async function untilArmed(recorder: FakeRecorder) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (recorder.phase === 'armed') return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('等待录制悬浮条超时');
}

async function preparedAssets(): Promise<RecordingAssets> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-normal-recording-'));
  const screenshots = path.join(root, 'screenshots');
  await mkdir(screenshots);
  await writeFile(path.join(screenshots, '1.jpg'), 'image');
  const log = path.join(root, 'recording_processed_log_sc.json');
  await writeFile(log, JSON.stringify([{ screenshot_full: 'screenshots/1.jpg', screenshot_crop: 'screenshots/1.jpg' }]));
  return { recordingRoot: root, processedLogPath: log, screenshotsDir: screenshots,
    stepCount: 1, timingsMs: { log: 1, screenshots: 2, total: 3 } };
}

async function fixture(prepareFailure = false) {
  const assets = await preparedAssets();
  const recorder = new FakeRecorder();
  let prepares = 0;
  const service = new ConversationRecordingService(recorder, assets.recordingRoot,
    async (_root, _executionRoot, _signal, progress) => {
      prepares++;
      progress('processing');
      progress('extracting');
      if (prepareFailure) throw new Error('截图提取失败');
      return assets;
    });
  const app = Fastify();
  app.get('/api/review/identity', async () => ({ service: reviewServiceName,
    protocolVersion: reviewProtocolVersion, dataRootKey: reviewDataRootKey(assets.recordingRoot) }));
  registerRecordingRoutes(app, service, recorder);
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  const original = process.env.CUA_REVIEW_URL;
  process.env.CUA_REVIEW_URL = url + '/';
  return { assets, recorder, service, prepares: () => prepares,
    close: async () => {
      if (original === undefined) delete process.env.CUA_REVIEW_URL;
      else process.env.CUA_REVIEW_URL = original;
      await app.close();
    } };
}

test('普通录制等待用户完成，使用共享服务及主屏幕并返回真实资产', async () => {
  const f = await fixture();
  try {
    const events: RecordingProgress[] = [];
    const pending = cuaRecord({ goal: '录制查询', dataRoot: f.assets.recordingRoot }, (event) => events.push(event));
    await untilArmed(f.recorder);
    assert.equal(f.recorder.selected, 'primary-display');
    assert.equal(f.prepares(), 0);
    const duplicate = await cuaRecord({ goal: '第二次录制', dataRoot: f.assets.recordingRoot });
    assert.equal(duplicate.status, 'failed');
    f.recorder.finish({ status: 'completed', recordingId: 'Recording_test', recordingPath: f.assets.recordingRoot });
    const result = await pending;
    assert.equal(result.status, 'completed');
    if (result.status === 'completed') assert.deepEqual(result.assets, f.assets);
    assert.equal(f.prepares(), 1);
    assert.deepEqual(events.map((event) => event.data.phase), ['armed', 'received', 'processing', 'extracting', 'completed']);
    assert.equal(f.recorder.closes, 0);
  } finally { await f.close(); }
});

test('悬浮条取消正常返回 cancelled，不处理资产或关闭 Keeper', async () => {
  const f = await fixture();
  try {
    const pending = cuaRecord({ goal: '录制查询', dataRoot: f.assets.recordingRoot });
    await untilArmed(f.recorder);
    f.recorder.finish({ status: 'cancelled', reason: 'user_aborted' });
    assert.equal((await pending).status, 'cancelled');
    assert.equal(f.prepares(), 0);
    assert.equal(f.recorder.closes, 0);
  } finally { await f.close(); }
});

test('Host 取消经断开及显式确认释放当前录制，不关闭服务', async () => {
  const f = await fixture();
  try {
    const controller = new AbortController();
    const pending = cuaRecord({ goal: '录制查询', dataRoot: f.assets.recordingRoot }, undefined, controller.signal);
    const rejected = assert.rejects(pending);
    await untilArmed(f.recorder);
    controller.abort();
    await rejected;
    assert.equal(f.recorder.aborts, 1);
    assert.equal(f.recorder.phase, 'idle');
    assert.equal(f.prepares(), 0);
    assert.equal(f.recorder.closes, 0);
  } finally { await f.close(); }
});

test('短生命周期 Worker 的 stdin 关闭传播到共享服务并等待录制释放', async () => {
  const f = await fixture();
  const input = new PassThrough();
  let output = '';
  const sink = new Writable({ write(chunk, _encoding, callback) {
    output += String(chunk);
    callback();
  } });
  try {
    const worker = runRuntimeBridgeWorker(input, sink);
    input.write(JSON.stringify({ schemaVersion: '1.0', requestId: 'record-1', method: 'record',
      payload: { goal: '录制查询', dataRoot: f.assets.recordingRoot } }) + '\n');
    await untilArmed(f.recorder);
    input.end();
    await worker;
    assert.equal(f.recorder.aborts, 1);
    assert.equal(f.recorder.closes, 0);
    assert.equal(f.recorder.phase, 'idle');
    const frames = output.trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(frames.filter((frame) => frame.ok !== undefined).length, 1);
    assert.equal(frames.at(-1).ok, false);
    assert.ok(frames.every((frame) => frame.requestId === 'record-1'));
  } finally { input.destroy(); await f.close(); }
});

test('录制 Worker 失败和已有专业录制不会触发 prepare 或抢占', async () => {
  const f = await fixture();
  try {
    f.recorder.phase = 'recording';
    const busy = await cuaRecord({ goal: '录制查询', dataRoot: f.assets.recordingRoot });
    assert.equal(busy.status, 'failed');
    assert.equal(f.recorder.aborts, 0);
    f.recorder.phase = 'idle';
    const pending = cuaRecord({ goal: '录制查询', dataRoot: f.assets.recordingRoot });
    await untilArmed(f.recorder);
    f.recorder.finish({ status: 'failed', error: 'encoder failed' });
    assert.equal((await pending).status, 'failed');
    assert.equal(f.prepares(), 0);
  } finally { await f.close(); }
});

test('prepare 失败保留真实错误并且不返回半成品资产', async () => {
  const f = await fixture(true);
  try {
    const pending = cuaRecord({ goal: '录制查询', dataRoot: f.assets.recordingRoot });
    await untilArmed(f.recorder);
    f.recorder.finish({ status: 'completed', recordingId: 'Recording_test', recordingPath: f.assets.recordingRoot });
    const result = await pending;
    assert.equal(result.status, 'failed');
    if (result.status === 'failed') {
      assert.equal(result.assets, null);
      assert.match(result.error, /截图提取失败/);
    }
    assert.equal(f.prepares(), 1);
  } finally { await f.close(); }
});
