import assert from 'node:assert/strict';
import test from 'node:test';
import { api } from '../../review/web/src/api.js';

test('review web 只在存在 JSON 请求体时设置 content-type', async () => {
  const originalFetch = globalThis.fetch;
  const requests: RequestInit[] = [];
  globalThis.fetch = async (_input, init) => {
    requests.push(init ?? {});
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
    await api.refreshRecorderDisplays();
    await api.startRecorder({ displayId: 'display-0' });
    await api.stopRecorder();
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(new Headers(requests[0]?.headers).has('content-type'), false);
  assert.equal(new Headers(requests[1]?.headers).get('content-type'), 'application/json');
  assert.equal(requests[1]?.body, JSON.stringify({
    scene: 'browser-demo',
    task: 'recording-demo',
    goal: '',
  }));
  assert.equal(new Headers(requests[2]?.headers).has('content-type'), false);
  assert.equal(requests[3]?.body, JSON.stringify({ displayId: 'display-0' }));
  assert.equal(new Headers(requests[4]?.headers).has('content-type'), false);
});
