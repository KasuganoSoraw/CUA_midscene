import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { describeRecording, resolveRecordingDirectory } from '../../cua/recording/recording-catalog.js';
import { safeSkillFile } from '../../cua/skills/paths.js';
export function registerRecordingMedia(
  app: FastifyInstance,
  options: { recordingsRoot?: string; executionRoot?: string },
): void {
  app.get<{ Params: { id: string; kind: 'video' | 'log' } }>(
    '/api/recordings/:id/assets/:kind',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id', 'kind'],
          properties: {
            id: { type: 'string', minLength: 1 },
            kind: { enum: ['video', 'log'] },
          },
        },
      },
    },
    async (request, reply) => {
      const recording = await describeRecording(request.params.id, options);
      const name = request.params.kind === 'video' ? recording.video?.name : recording.eventLog?.name;
      if (!name) throw Object.assign(new Error('录制文件不存在'), { statusCode: 404 });
      const root = await resolveRecordingDirectory(request.params.id, options);
      const file = await safeSkillFile(root, path.join('inputs', name));
      reply.header('x-content-type-options', 'nosniff');
      if (request.params.kind === 'log') return logPreview(file);
      return video(file, request.headers.range, reply);
    },
  );
}
async function logPreview(file: string): Promise<{ text: string; truncated: boolean }> {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(2 * 1024 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return { text: buffer.subarray(0, bytesRead).toString('utf8'), truncated: (await handle.stat()).size > bytesRead };
  } finally {
    await handle.close();
  }
}
async function video(file: string, range: string | undefined, reply: FastifyReply): Promise<unknown> {
  const { size } = await stat(file);
  reply.type('video/mp4').header('accept-ranges', 'bytes');
  if (!range) return reply.header('content-length', size).send(createReadStream(file));
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  const start = match?.[1] ? Number(match[1]) : Math.max(0, size - Number(match?.[2]));
  const end = match?.[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (!match || !Number.isSafeInteger(start) || start > end || start >= size)
    return reply.code(416).header('content-range', `bytes */${size}`).send();
  return reply
    .code(206)
    .header('content-range', `bytes ${start}-${end}/${size}`)
    .header('content-length', end - start + 1)
    .send(createReadStream(file, { start, end }));
}
