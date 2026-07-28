import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runCliCommand } from '../../cli/main.js';
import { reviewBodyLimit } from '../../review/server/app.js';
import { startReviewServer } from '../../review/server/main.js';
import { createTaskFixture } from '../helpers/task-fixture.js';

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
  const started = await startReviewServer({
    dataRoot: root,
    recordingsRoot,
    staticRoot,
    dependencies: {
      openDirectory: async (recordingPath) => { openedPath = recordingPath; },
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
    assert.equal(base.search, '');
    assert.equal((await fetch(base)).status, 200);
    const scenes = await fetch(new URL('/api/scenes', base));
    assert.equal(scenes.status, 200);
    assert.equal((await scenes.json() as any).scenes[0].scene, 'browser-demo');

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
    const started = await startReviewServer({ dataRoot: root, staticRoot, executionRoot });
    try {
      const recordings = await fetch(new URL('/api/recordings', started.url));
      assert.deepEqual(await recordings.json(), {
        configured: false,
        envName: 'CUA_RECORDINGS_ROOT',
        recordings: [],
      });
      assert.equal((await fetch(new URL('/api/scenes', started.url))).status, 200);
    } finally {
      await started.close();
    }
  } finally {
    if (previous === undefined) delete process.env.CUA_RECORDINGS_ROOT;
    else process.env.CUA_RECORDINGS_ROOT = previous;
  }
});

test('顶层 CLI 保持旧命令并只增加 review 启动分发', async () => {
  const scenes = JSON.parse(await runCliCommand(['scene', 'list', '--json']));
  assert.equal(scenes.scenes[0].scene, 'browser-demo');
  let opened = '';
  const output = JSON.parse(await runCliCommand(['review', '--no-open', '--json'], {
    startReview: async () => ({
      server: {} as any,
      url: 'http://127.0.0.1:43127/',
      close: async () => undefined,
    }),
    openBrowser: (url) => { opened = url; },
  }));
  assert.equal(output.host, '127.0.0.1');
  assert.equal(opened, '');
});
