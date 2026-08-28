import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  dispatchRuntimeBridgeRequest,
  runRuntimeBridgeWorker,
  type RuntimeBridgeHandlers,
} from '../../runtime-bridge/index.js';

const executionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function fakeHandlers(calls: string[]): RuntimeBridgeHandlers {
  return {
    catalog: async (payload) => {
      calls.push(`catalog:${payload.action}`);
      return { action: payload.action, scenes: [] };
    },
    execute: async (payload) => {
      calls.push(`execute:${payload.strategy}`);
      return { strategy: payload.strategy, status: 'succeeded', runDir: 'C:/runs/1' };
    },
    workbench: async (payload) => {
      calls.push(`workbench:${payload.mode}`);
      return { mode: payload.mode, url: 'http://127.0.0.1:47831/' };
    },
  };
}

test('Runtime bridge 校验版本、关联 request id 并 dispatch method', async () => {
  const calls: string[] = [];
  const response = await dispatchRuntimeBridgeRequest({
    schemaVersion: '1.0',
    requestId: 'request-1',
    method: 'catalog',
    payload: { action: 'list-scenes' },
  }, fakeHandlers(calls));

  assert.deepEqual(calls, ['catalog:list-scenes']);
  assert.equal(response.ok, true);
  assert.equal(response.requestId, 'request-1');
  if (response.ok) assert.deepEqual(response.result, { action: 'list-scenes', scenes: [] });

  const invalid = await dispatchRuntimeBridgeRequest({
    schemaVersion: '0.1', requestId: 'bad-1', method: 'catalog', payload: {},
  }, fakeHandlers(calls));
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.error.code, 'INVALID_REQUEST');
});

test('Runtime bridge 保留底层错误且不尝试其他 method', async () => {
  const calls: string[] = [];
  const handlers = fakeHandlers(calls);
  handlers.execute = async () => {
    calls.push('execute:failed');
    throw new Error('runner failed', { cause: new Error('desktop unavailable') });
  };

  const response = await dispatchRuntimeBridgeRequest({
    schemaVersion: '1.0',
    requestId: 'request-2',
    method: 'execute',
    payload: { strategy: 'freeform', goal: '打开 Chrome' },
  }, handlers);

  assert.deepEqual(calls, ['execute:failed']);
  assert.equal(response.ok, false);
  if (!response.ok) {
    assert.equal(response.error.code, 'RUNTIME_METHOD_FAILED');
    assert.match(response.error.message, /runner failed/);
  }
});

test('JSONL worker 在一个进程生命周期内顺序处理多个请求', async () => {
  const calls: string[] = [];
  const input = Readable.from([
    `${JSON.stringify({ schemaVersion: '1.0', requestId: '1', method: 'catalog', payload: { action: 'list-scenes' } })}\n`,
    `${JSON.stringify({ schemaVersion: '1.0', requestId: '2', method: 'workbench', payload: { mode: 'recording' } })}\n`,
  ]);
  let output = '';
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });

  await runRuntimeBridgeWorker(input, sink, fakeHandlers(calls));

  assert.deepEqual(calls, ['catalog:list-scenes', 'workbench:recording']);
  const frames = output.trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(frames.map((frame) => frame.requestId), ['1', '2']);
  assert.ok(frames.every((frame) => frame.ok === true));
});

test('npm 发布面包含 Runtime bridge 而 worker 源码隔离协议 stdout', async () => {
  const packageJson = JSON.parse(await readFile(path.join(executionRoot, 'package.json'), 'utf8'));
  assert.equal(packageJson.exports['./runtime-bridge'], './dist/runtime-bridge/index.js');
  assert.ok(packageJson.files.includes('runtime-bridge'));

  const workerSource = await readFile(path.join(executionRoot, 'runtime-bridge', 'worker.ts'), 'utf8');
  assert.match(workerSource, /console\.log = .*console\.error/);
  assert.doesNotMatch(workerSource, /process\.stdout\.write/);
});
