import assert from 'node:assert/strict';
import test from 'node:test';
import { api } from '../../review/web/src/api.js';

test('review web 只在存在 JSON 请求体时设置 content-type', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ input: string; init: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ input: String(input), init: init ?? {} });
    return new Response(JSON.stringify({ opened: true, recording: 'Recording_demo' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    await api.openRecordingFolder('Recording_demo');
    await api.createRecordingTask('Recording_demo', {
      scene: 'browser-demo',
      task: 'recording-demo',
      goal: '',
    });
    await api.deleteRecording('Recording demo/1');
    await api.refreshRecorderDisplays();
    await api.startRecorder({ displayId: 'display-0' });
    await api.stopRecorder();
    await api.executionStatus();
    await api.startExecution({
      scene: 'browser-demo', task: 'search-demo', mode: 'task',
      inputs: { query: 'hello=world' },
    });
    await api.stopExecution();
    await api.agentStatus();
    await api.invokeAgent({ task: '查询 NE001 当前告警' });
    await api.deleteTask('browser demo', 'search/demo');
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(new Headers(requests[0]?.init.headers).has('content-type'), false);
  assert.equal(new Headers(requests[1]?.init.headers).get('content-type'), 'application/json');
  assert.equal(requests[1]?.init.body, JSON.stringify({
    scene: 'browser-demo',
    task: 'recording-demo',
    goal: '',
  }));
  assert.equal(requests[2]?.input, '/api/recordings/Recording%20demo%2F1');
  assert.equal(requests[2]?.init.method, 'DELETE');
  assert.equal(new Headers(requests[2]?.init.headers).has('content-type'), false);
  assert.equal(new Headers(requests[3]?.init.headers).has('content-type'), false);
  assert.equal(requests[4]?.init.body, JSON.stringify({ displayId: 'display-0' }));
  assert.equal(new Headers(requests[5]?.init.headers).has('content-type'), false);
  assert.equal(new Headers(requests[6]?.init.headers).has('content-type'), false);
  assert.equal(new Headers(requests[7]?.init.headers).get('content-type'), 'application/json');
  assert.equal(requests[7]?.init.body, JSON.stringify({
    scene: 'browser-demo', task: 'search-demo', mode: 'task',
    inputs: { query: 'hello=world' },
  }));
  assert.equal(new Headers(requests[8]?.init.headers).has('content-type'), false);
  assert.equal(new Headers(requests[9]?.init.headers).has('content-type'), false);
  assert.equal(new Headers(requests[10]?.init.headers).get('content-type'), 'application/json');
  assert.equal(requests[10]?.init.body, JSON.stringify({ task: '查询 NE001 当前告警' }));
  assert.equal(requests[11]?.input, '/api/tasks/browser%20demo/search%2Fdemo');
  assert.equal(requests[11]?.init.method, 'DELETE');
  assert.equal(new Headers(requests[11]?.init.headers).has('content-type'), false);
});

test('review web 逐帧读取 Agent 事件并等待最终结果', async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  let releaseResult: () => void = () => {};
  const gate = new Promise<void>((resolve) => { releaseResult = resolve; });
  globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      const event = JSON.stringify({
        type: 'event', event: {
          schemaVersion: '1.0', invocationId: 'inv-1', type: 'assistant.delta',
          timestamp: '2026-08-28T00:00:00.000Z', data: { turn: 1, text: '查询中' },
        },
      });
      const bytes = encoder.encode(`${event}\n`);
      controller.enqueue(bytes.slice(0, 5));
      controller.enqueue(bytes.slice(5));
      void gate.then(() => {
        controller.enqueue(encoder.encode(`${JSON.stringify({
          type: 'result', result: {
            schemaVersion: '1.0', invocationId: 'inv-1', status: 'completed',
            reply: '查询完成', toolCalls: [], events: [],
          },
        })}\n`));
        controller.close();
      });
    },
  }), { headers: { 'content-type': 'application/x-ndjson' } });
  try {
    const events: string[] = [];
    let finished = false;
    const invocation = api.streamAgent({ task: '查询' }, (event) => {
      events.push(String(event.data?.text));
    }).then((result) => { finished = true; return result; });
    for (let attempt = 0; attempt < 100 && !events.length; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    assert.deepEqual(events, ['查询中']);
    assert.equal(finished, false);
    releaseResult();
    assert.equal((await invocation).reply, '查询完成');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
