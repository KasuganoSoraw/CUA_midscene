import type { FastifyInstance } from 'fastify';
import type { ConversationRecordingService } from '../service/conversation-recording.js';
import type { RecorderControl } from '../service/windows-recorder.js';

export function registerRecordingRoutes(
  app: FastifyInstance, recording: ConversationRecordingService, recorder: RecorderControl,
): void {
  app.post<{ Body: { goal: string; sessionId: string } }>('/api/recorder/record', {
    schema: { body: { type: 'object', required: ['goal', 'sessionId'],
      properties: { goal: { type: 'string', minLength: 1 },
        sessionId: { type: 'string', pattern: '^[a-f0-9-]{36}$' } }, additionalProperties: false } },
  }, async (request, reply) => {
    const origin = request.headers.origin;
    if (request.headers['sec-fetch-site'] === 'cross-site'
      || (origin !== undefined && origin !== `http://${request.headers.host}`)) {
      return reply.code(403).send({ error: '不允许从其他站点发起录制' });
    }
    const controller = new AbortController();
    reply.hijack();
    reply.raw.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' });
    const write = (frame: object) => {
      if (!reply.raw.destroyed) reply.raw.write(`${JSON.stringify(frame)}\n`);
    };
    const heartbeat = setInterval(() => write({ type: 'heartbeat' }), 15_000);
    heartbeat.unref();
    reply.raw.once('close', () => { if (!reply.raw.writableEnded) controller.abort(); });
    try {
      const result = await recording.run(request.body.goal, controller.signal,
        (event) => write({ type: 'event', event }), request.body.sessionId);
      write({ type: 'result', result });
    } catch (error) {
      write({ type: 'result', result: { status: 'failed', assets: null,
        message: '无法启动录制', error: error instanceof Error ? error.message : String(error) } });
    } finally {
      clearInterval(heartbeat);
      reply.raw.end();
    }
  });
  app.post<{ Body: { sessionId: string } }>('/api/recorder/abort', {
    schema: { body: { type: 'object', required: ['sessionId'],
      properties: { sessionId: { type: 'string', pattern: '^[a-f0-9-]{36}$' } }, additionalProperties: false } },
  }, async (request) => {
    if (request.headers['sec-fetch-site'] === 'cross-site' || request.headers.origin) {
      throw Object.assign(new Error('此录制控制接口仅供本地组件调用'), { statusCode: 403 });
    }
    if (!recorder.abort) throw new Error('录制服务不支持取消');
    await recorder.abort(request.body.sessionId);
    return { aborted: true };
  });
}
