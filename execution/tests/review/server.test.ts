import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runCliCommand } from '../../cli/main.js';
import { reviewBodyLimit } from '../../review/server/app.js';
import type { RecorderControl, RecorderStatus } from '../../review/service/windows-recorder.js';
import type { TaskExecutionControl } from '../../review/service/task-execution.js';
import type { TaskExecutionStatus } from '../../review/shared/types.js';
import {
  defaultReviewPort,
  reviewDataRootKey,
  reviewProtocolVersion,
  reviewServiceName,
  startReviewServer,
} from '../../review/server/main.js';
import { createTaskFixture } from '../helpers/task-fixture.js';

async function unusedLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  if (!port) throw new Error('无法分配测试端口');
  return port;
}

test('review server 在 loopback 随机端口暴露 catalog，并安全提供静态资源与证据', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-review-server-'));
  await createTaskFixture(path.join(root, 'projects'));
  const recordingsRoot = path.join(root, 'recordings');
  const recordingInputs = path.join(recordingsRoot, 'Recording_demo', 'inputs');
  await mkdir(recordingInputs, { recursive: true });
  await Promise.all([
    writeFile(path.join(recordingInputs, 'capture.mp4'), 'video', 'utf8'),
    writeFile(path.join(recordingInputs, 'capture.txt'), '# Started: 2026-07-28 17:00:35.649\n', 'utf8'),
  ]);
  const staticRoot = path.join(root, 'static');
  await mkdir(staticRoot, { recursive: true });
  await writeFile(path.join(staticRoot, 'index.html'), '<!doctype html><title>review</title>', 'utf8');
  let openedPath = '';
  let createRequest: Record<string, unknown> | undefined;
  const recorderPreview = path.join(root, 'recorder-preview.png');
  await writeFile(recorderPreview, 'preview', 'utf8');
  let recorderStatus: RecorderStatus = { phase: 'idle', outputRoot: recordingsRoot };
  let recorderClosed = false;
  let executionClosed = false;
  let agentClosed = false;
  let agentTask = '';
  let executionStatus: TaskExecutionStatus = { phase: 'idle' };
  const recorder: RecorderControl = {
    status: () => ({ ...recorderStatus }),
    refreshDisplays: async () => ({
      revision: '1',
      displays: [{
        id: 'display-0', deviceName: 'DISPLAY0', index: 0,
        left: 0, top: 0, width: 1920, height: 1080,
        scaleFactor: 1, primary: true,
        previewUrl: '/api/recorder/displays/0/preview?revision=1',
      }],
    }),
    preview: async (index) => {
      if (index !== 0) throw Object.assign(new Error('显示器预览不存在'), { statusCode: 404 });
      return recorderPreview;
    },
    start: async (displayId) => {
      assert.equal(displayId, 'display-0');
      recorderStatus = {
        phase: 'recording', outputRoot: recordingsRoot,
        recordingId: 'Recording_live', startedAt: '2026-08-19T10:00:00.000',
      };
      return { ...recorderStatus };
    },
    stop: async () => {
      recorderStatus = { phase: 'idle', outputRoot: recorderStatus.outputRoot };
      return { ...recorderStatus };
    },
    close: async () => { recorderClosed = true; },
  };
  const execution: TaskExecutionControl = {
    status: () => ({ ...executionStatus }),
    start: async (request) => {
      executionStatus = {
        phase: 'preparing', scene: request.scene, task: request.task, mode: request.mode,
        preparedAt: '2026-08-24T10:00:00.000Z', startsAt: '2026-08-24T10:00:05.000Z',
      };
      return { ...executionStatus };
    },
    stop: async () => {
      executionStatus = { phase: 'idle' };
      return { ...executionStatus };
    },
    close: async () => { executionClosed = true; },
  };
  const started = await startReviewServer({
    dataRoot: root,
    port: 0,
    dev: true,
    recordingsRoot,
    staticRoot,
    dependencies: {
      openDirectory: async (recordingPath) => { openedPath = recordingPath; },
      recorder,
      execution,
      agent: {
        status: async () => ({
          available: true,
          name: 'Computer-Use',
          invocationMode: 'stateless-task',
          runtime: 'python',
          modelConfigured: true,
        }),
        invoke: async (request) => {
          agentTask = request.task;
          return {
            schemaVersion: '1.0',
            invocationId: 'inv-review',
            status: 'completed',
            reply: 'Agent 已完成查询。',
            toolCalls: [],
            events: [{
              schemaVersion: '1.0',
              invocationId: 'inv-review',
              type: 'agent.completed',
              timestamp: '2026-08-28T00:00:00.000Z',
              message: 'Agent 已完成查询。',
            }],
          };
        },
        close: async () => { agentClosed = true; },
      },
      createFromRecording: async (options) => {
        createRequest = options as unknown as Record<string, unknown>;
        return {
          created: true,
          valid: true,
          scene: options.scene,
          task: options.task,
          goal: options.goal?.trim() ?? '',
        } as any;
      },
    },
  });
  try {
    const base = new URL(started.url);
    assert.equal(base.hostname, '127.0.0.1');
    assert.notEqual(base.port, '');
    assert.equal(base.search, '?dev=1');
    assert.equal((await fetch(base)).status, 200);
    const scenes = await fetch(new URL('/api/scenes', base));
    assert.equal(scenes.status, 200);
    assert.equal((await scenes.json() as any).scenes[0].scene, 'browser-demo');
    assert.deepEqual(await (await fetch(new URL('/api/review/identity', base))).json(), {
      service: reviewServiceName,
      protocolVersion: reviewProtocolVersion,
      dataRootKey: reviewDataRootKey(root),
      devMode: true,
    });
    assert.deepEqual(await (await fetch(new URL('/api/agent/status', base))).json(), {
      available: true,
      name: 'Computer-Use',
      invocationMode: 'stateless-task',
      runtime: 'python',
      modelConfigured: true,
    });
    const invocation = await fetch(new URL('/api/agent/invocations', base), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task: '查询 NE001 当前告警' }),
    });
    assert.equal(invocation.status, 200);
    const invocationResult = await invocation.json() as any;
    assert.equal(invocationResult.schemaVersion, '1.0');
    assert.equal(invocationResult.reply, 'Agent 已完成查询。');
    assert.equal(invocationResult.events[0].type, 'agent.completed');
    assert.equal(agentTask, '查询 NE001 当前告警');

    assert.equal((await (await fetch(new URL('/api/recorder/status', base))).json() as any).phase, 'idle');
    const displays = await (await fetch(new URL('/api/recorder/displays/refresh', base), { method: 'POST' })).json() as any;
    assert.equal(displays.displays[0].id, 'display-0');
    const preview = await fetch(new URL(displays.displays[0].previewUrl, base));
    assert.equal(preview.headers.get('content-type'), 'image/png');
    assert.equal(await preview.text(), 'preview');
    const recordingStarted = await fetch(new URL('/api/recorder/start', base), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayId: 'display-0' }),
    });
    assert.equal((await recordingStarted.json() as any).phase, 'recording');
    assert.equal((await (await fetch(new URL('/api/recorder/stop', base), { method: 'POST' })).json() as any).phase, 'idle');

    assert.equal((await (await fetch(new URL('/api/execution/status', base))).json() as any).phase, 'idle');
    const executionStarted = await fetch(new URL('/api/execution/start', base), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scene: 'browser-demo', task: 'search-demo', mode: 'task',
        inputs: { 'step-001-input': 'Google Search' },
      }),
    });
    assert.equal(executionStarted.status, 200);
    assert.equal((await executionStarted.json() as any).phase, 'preparing');
    assert.equal((await (await fetch(new URL('/api/execution/stop', base), { method: 'POST' })).json() as any).phase, 'idle');

    const recordings = await fetch(new URL('/api/recordings', base));
    assert.equal(recordings.status, 200);
    const recordingCatalog = await recordings.json() as any;
    assert.equal(recordingCatalog.configured, true);
    assert.equal(recordingCatalog.recordings[0].id, 'Recording_demo');
    assert.equal(recordingCatalog.recordings[0].ready, true);
    assert.equal(Object.hasOwn(recordingCatalog.recordings[0], 'recordingPath'), false);

    const recordingDetail = await fetch(new URL('/api/recordings/Recording_demo', base));
    assert.equal((await recordingDetail.json() as any).video.name, 'capture.mp4');

    const opened = await fetch(new URL('/api/recordings/Recording_demo/open-folder', base), {
      method: 'POST',
    });
    assert.equal(opened.status, 200);
    assert.equal(openedPath, path.join(recordingsRoot, 'Recording_demo'));

    const created = await fetch(new URL('/api/recordings/Recording_demo/tasks', base), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scene: 'browser-demo', task: 'created-from-web', goal: '创建任务' }),
    });
    assert.equal(created.status, 200);
    assert.deepEqual(await created.json(), {
      created: true,
      valid: true,
      scene: 'browser-demo',
      task: 'created-from-web',
      goal: '创建任务',
    });
    assert.equal(createRequest?.recording, path.join(recordingsRoot, 'Recording_demo'));
    assert.equal(createRequest?.runsRoot, path.join(root, 'runs'));

    const escapedRecording = await fetch(new URL('/api/recordings/..%5Coutside/open-folder', base), {
      method: 'POST',
    });
    assert.equal(escapedRecording.status, 400);

    const task = await fetch(new URL('/api/tasks/browser-demo/air-tickets-demo', base));
    const view = await task.json() as any;
    const evidence = new URL('/api/tasks/browser-demo/air-tickets-demo/evidence', base);
    evidence.searchParams.set('path', view.steps[0].evidence.full);
    assert.equal((await fetch(evidence)).status, 200);
    evidence.searchParams.set('path', view.steps[11].referenceImages[0].url);
    const reference = await fetch(evidence);
    assert.equal(reference.status, 200);
    assert.equal(reference.headers.get('content-type'), 'image/png');
    evidence.searchParams.set('path', '../package.json');
    assert.equal((await fetch(evidence)).status, 404);

    const missingApi = await fetch(new URL('/api/missing', base));
    assert.equal(missingApi.status, 404);
    assert.deepEqual(await missingApi.json(), { error: '接口不存在' });

    const spaFallback = await fetch(new URL('/tasks/browser-demo/example', base));
    assert.equal(spaFallback.status, 200);
    assert.match(await spaFallback.text(), /<title>review<\/title>/);

    const readonly = await fetch(new URL('/api/tasks/browser-demo/air-tickets-demo', base), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expectedRevision: view.revision,
        manifest: view.manifest,
        document: view.document,
      }),
    });
    assert.equal(readonly.status, 403);
    assert.match(String((await readonly.json() as { error: string }).error), /内置任务不可修改/);

    const tooLarge = await fetch(new URL('/api/tasks/browser-demo/air-tickets-demo/validate', base), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'x'.repeat(reviewBodyLimit) }),
    });
    assert.equal(tooLarge.status, 413);
    assert.equal(typeof (await tooLarge.json() as { error: string }).error, 'string');
  } finally {
    await started.close();
    assert.equal(recorderClosed, true);
    assert.equal(executionClosed, true);
    assert.equal(agentClosed, true);
  }
});

test('review server 未配置录制根时保持任务复核可用并返回环境变量提示', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-review-unconfigured-recordings-'));
  await createTaskFixture(path.join(root, 'projects'));
  const staticRoot = path.join(root, 'static');
  const executionRoot = path.join(root, 'execution');
  await Promise.all([
    mkdir(staticRoot, { recursive: true }),
    mkdir(executionRoot, { recursive: true }),
  ]);
  await writeFile(path.join(staticRoot, 'index.html'), '<!doctype html><title>review</title>', 'utf8');
  const previous = process.env.CUA_RECORDINGS_ROOT;
  try {
    delete process.env.CUA_RECORDINGS_ROOT;
    const started = await startReviewServer({
      dataRoot: root,
      port: 0,
      dev: true,
      staticRoot,
      executionRoot,
    });
    try {
      const recordings = await fetch(new URL('/api/recordings', started.url));
      assert.deepEqual(await recordings.json(), {
        configured: false,
        envName: 'CUA_RECORDINGS_ROOT',
        recordings: [],
      });
      assert.deepEqual(await (await fetch(new URL('/api/recorder/status', started.url))).json(), {
        phase: 'idle',
      });
      assert.equal((await fetch(new URL('/api/scenes', started.url))).status, 200);
      const agentStatus = await (await fetch(new URL('/api/agent/status', started.url))).json() as any;
      assert.equal(agentStatus.available, false);
      assert.equal(agentStatus.name, 'Computer-Use');
      assert.equal(agentStatus.invocationMode, 'stateless-task');
      assert.equal(agentStatus.runtime, 'python');
      assert.equal(typeof agentStatus.modelConfigured, 'boolean');
      assert.match(agentStatus.reason, /找不到 Python Agent/);
      const unavailable = await fetch(new URL('/api/agent/invocations', started.url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ task: '测试任务' }),
      });
      assert.equal(unavailable.status, 503);
      assert.match((await unavailable.json() as { error: string }).error, /找不到 Python Agent/);
    } finally {
      await started.close();
    }

    const configuredRoot = path.join(root, 'recordings-from-env');
    await mkdir(configuredRoot);
    await writeFile(
      path.join(root, '.env.local'),
      `CUA_RECORDINGS_ROOT=${configuredRoot}\n`,
      'utf8',
    );
    const configured = await startReviewServer({
      dataRoot: root,
      port: 0,
      staticRoot,
      executionRoot,
    });
    try {
      assert.equal((await fetch(new URL('/api/agent/status', configured.url))).status, 404);
      assert.equal((await fetch(new URL('/api/agent/invocations', configured.url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ task: '默认模式不开放' }),
      })).status, 404);
      assert.deepEqual(await (await fetch(new URL('/api/recorder/status', configured.url))).json(), {
        phase: 'idle',
        outputRoot: configuredRoot,
      });
      assert.equal((await (await fetch(new URL('/api/recordings', configured.url))).json() as any).configured, true);
    } finally {
      await configured.close();
    }
  } finally {
    if (previous === undefined) delete process.env.CUA_RECORDINGS_ROOT;
    else process.env.CUA_RECORDINGS_ROOT = previous;
  }
});

test('review server 在固定端口复用相同数据根并拒绝不同数据根', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-review-fixed-port-'));
  const otherRoot = await mkdtemp(path.join(os.tmpdir(), 'cua-review-fixed-port-other-'));
  const staticRoot = path.join(root, 'static');
  await Promise.all([
    createTaskFixture(path.join(root, 'projects')),
    mkdir(staticRoot, { recursive: true }),
  ]);
  await writeFile(path.join(staticRoot, 'index.html'), '<!doctype html><title>review</title>', 'utf8');
  const port = await unusedLoopbackPort();

  const first = await startReviewServer({ dataRoot: root, staticRoot, port });
  try {
    assert.equal(first.reused, false);
    assert.equal(first.url, `http://127.0.0.1:${port}/`);

    const second = await startReviewServer({ dataRoot: root, staticRoot, port });
    assert.equal(second.reused, true);
    assert.equal(second.url, first.url);
    assert.equal(second.server, undefined);
    await second.close();
    assert.equal((await fetch(first.url)).status, 200);

    await assert.rejects(
      startReviewServer({ dataRoot: otherRoot, staticRoot, port }),
      new RegExp(`${port}.*占用`),
    );
    await assert.rejects(
      startReviewServer({ dataRoot: root, staticRoot, port, dev: true }),
      new RegExp(`${port}.*占用`),
    );
  } finally {
    await first.close();
  }
});

test('顶层 CLI 保持旧命令并只增加 review 启动分发', async () => {
  const scenes = JSON.parse(await runCliCommand(['scene', 'list', '--json']));
  assert.equal(scenes.scenes[0].scene, 'browser-demo');
  let opened = '';
  let devOption: boolean | undefined;
  const output = JSON.parse(await runCliCommand(['review', '--dev', '--no-open', '--json'], {
    startReview: async (options) => {
      devOption = options?.dev;
      return ({
      server: {} as any,
      url: 'http://127.0.0.1:43127/?dev=1',
      reused: false,
      close: async () => undefined,
      });
    },
    openBrowser: (url) => { opened = url; },
  }));
  assert.equal(output.host, '127.0.0.1');
  assert.equal(output.reused, false);
  assert.equal(output.dev, true);
  assert.equal(devOption, true);
  assert.equal(opened, '');
});
