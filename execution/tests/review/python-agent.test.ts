import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import type { spawn } from 'node:child_process';
import { PythonAgentInvoker } from '../../review/service/python-agent.js';

test('Python Agent 子进程在退出前逐帧转发事件', async () => {
  const names = [
    'CUA_AGENT_MODEL_BASE_URL',
    'CUA_AGENT_MODEL_NAME',
    'CUA_AGENT_MODEL_API_KEY',
  ] as const;
  const previous = names.map((name) => process.env[name]);
  process.env.CUA_AGENT_MODEL_BASE_URL = 'https://example.test/v1';
  process.env.CUA_AGENT_MODEL_NAME = 'test-model';
  process.env.CUA_AGENT_MODEL_API_KEY = 'test-key';
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: () => { child.emit('close', 1, 'SIGTERM'); return true; },
  });
  let spawned = false;
  const invoker = new PythonAgentInvoker({
    executionRoot: path.resolve('.'),
    dataRoot: path.resolve('.'),
    agentRoot: path.resolve('../agent'),
    pythonExecutable: process.execPath,
    javascriptRuntimeExecutable: process.execPath,
    runtimeBridge: path.resolve('package.json'),
    spawnProcess: (() => { spawned = true; return child; }) as unknown as typeof spawn,
  });
  try {
    const received: string[] = [];
    let finished = false;
    const invocation = invoker.invokeStreaming({ task: '查询' }, (event) => {
      received.push(String(event.data?.text));
    }).then((result) => { finished = true; return result; });
    for (let attempt = 0; attempt < 100 && !spawned; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    assert.equal(spawned, true);
    const eventFrame = `${JSON.stringify({
      type: 'event', event: {
        schemaVersion: '1.0', invocationId: 'inv-1', type: 'assistant.delta',
        timestamp: '2026-08-28T00:00:00.000Z', data: { turn: 1, text: '查询中' },
      },
    })}\n`;
    const bytes = Buffer.from(eventFrame);
    child.stdout.write(bytes.subarray(0, 7));
    child.stdout.write(bytes.subarray(7));
    assert.deepEqual(received, ['查询中']);
    assert.equal(finished, false);
    child.stdout.write(`${JSON.stringify({
      type: 'result', result: {
        schemaVersion: '1.0', invocationId: 'inv-1', status: 'completed',
        reply: '查询完成', toolCalls: [],
      },
    })}\n`);
    child.emit('close', 0, null);
    const result = await invocation;
    assert.equal(result.reply, '查询完成');
    assert.equal(result.events[0]?.type, 'assistant.delta');
  } finally {
    await invoker.close();
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  }
});
