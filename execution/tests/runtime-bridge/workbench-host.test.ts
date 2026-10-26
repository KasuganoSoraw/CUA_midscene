import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { startReviewServer, type StartedReviewServer } from '../../review/server/main.js';
import {
  cuaWorkbench, dispatchRuntimeBridgeRequest, type RuntimeBridgeHandlers,
} from '../../runtime-bridge/index.js';

test('宿主无需模型即可通过 workbench 启动及复用网页服务', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cua-host-workbench-'));
  const staticRoot = path.join(root, 'web');
  await mkdir(staticRoot);
  await writeFile(path.join(staticRoot, 'index.html'), '<main>Workbench</main>');
  let port = 0;
  let owned: StartedReviewServer | undefined;
  const handlers: RuntimeBridgeHandlers = {
    catalog: async () => { throw new Error('宿主设置入口不调用 Catalog'); },
    execute: async () => { throw new Error('宿主设置入口不执行任务'); },
    workbench: (payload) => cuaWorkbench(payload, {
      startReviewServer: async (options) => {
        const server = await startReviewServer({ ...options, port, staticRoot });
        port = Number(new URL(server.url).port);
        if (!server.reused) owned = server;
        return server;
      },
    }),
  };
  try {
    const request = { schemaVersion: '1.0', requestId: 'host-1', method: 'workbench',
      payload: { mode: 'review', dataRoot: path.join(root, 'data') } };
    const first = await dispatchRuntimeBridgeRequest(request, handlers);
    const second = await dispatchRuntimeBridgeRequest({ ...request, requestId: 'host-2' }, handlers);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) throw new Error('宿主 Workbench 调用失败');
    assert.equal(first.result.reused, false);
    assert.equal(second.result.reused, true);
    assert.equal(first.result.url, second.result.url);
    const url = new URL(String(first.result.url));
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.searchParams.get('mode'), 'review');
    assert.match(await (await fetch(url)).text(), /Workbench/);
  } finally {
    await owned?.close();
    await rm(root, { recursive: true, force: true });
  }
});
