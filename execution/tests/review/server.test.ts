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
  const staticRoot = path.join(root, 'static');
  await mkdir(staticRoot, { recursive: true });
  await writeFile(path.join(staticRoot, 'index.html'), '<!doctype html><title>review</title>', 'utf8');
  const started = await startReviewServer({ dataRoot: root, staticRoot });
  try {
    const base = new URL(started.url);
    assert.equal(base.hostname, '127.0.0.1');
    assert.notEqual(base.port, '');
    assert.equal(base.search, '');
    assert.equal((await fetch(base)).status, 200);
    const scenes = await fetch(new URL('/api/scenes', base));
    assert.equal(scenes.status, 200);
    assert.equal((await scenes.json() as any).scenes[0].scene, 'browser-demo');

    const task = await fetch(new URL('/api/tasks/browser-demo/air-tickets-demo', base));
    const view = await task.json() as any;
    const evidence = new URL('/api/tasks/browser-demo/air-tickets-demo/evidence', base);
    evidence.searchParams.set('path', view.steps[0].evidence.full);
    assert.equal((await fetch(evidence)).status, 200);
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
