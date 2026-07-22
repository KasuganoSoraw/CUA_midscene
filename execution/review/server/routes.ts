import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import type { JsonObject, RuntimeLayout } from '../../cua/contracts/types.js';
import { listScenes, listTasks, requireIdentifier } from '../../cua/task/tasks.js';
import type { ReviewMutation, ReviewTaskDraft, SaveReviewTaskRequest } from '../shared/types.js';
import { applyReviewMutation } from '../service/task-mutations.js';
import { loadReviewTask, resolveReviewTaskRoot } from '../service/review-task.js';
import { saveReviewTask, validateReviewDraft } from '../service/task-save.js';

interface ReviewRouteOptions {
  layout: RuntimeLayout;
}

interface SceneParams {
  scene: string;
}

interface TaskParams extends SceneParams {
  task: string;
}

interface EvidenceQuery {
  path?: string;
}

interface MutationBody {
  draft: ReviewTaskDraft;
  mutation: ReviewMutation;
}

const sceneParamsSchema = {
  type: 'object',
  required: ['scene'],
  properties: { scene: { type: 'string', minLength: 1 } },
} as const;

const taskParamsSchema = {
  type: 'object',
  required: ['scene', 'task'],
  properties: {
    scene: { type: 'string', minLength: 1 },
    task: { type: 'string', minLength: 1 },
  },
} as const;

const draftBodySchema = {
  type: 'object',
  required: ['manifest', 'document'],
  properties: {
    manifest: { type: 'object', additionalProperties: true },
    document: { type: 'object', additionalProperties: true },
  },
  additionalProperties: true,
} as const;

function requireObjectBody<T>(body: unknown): T {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('JSON 请求体必须是对象');
  }
  return body as T;
}

function contentType(sourcePath: string): string {
  return ({
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.json': 'application/json; charset=utf-8',
  } as Record<string, string>)[path.extname(sourcePath).toLowerCase()] ?? 'application/octet-stream';
}

function inside(parent: string, target: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function evidenceFile(
  scene: string,
  task: string,
  reference: string,
  layout: RuntimeLayout,
): Promise<{ body: Buffer; type: string }> {
  const resolved = await resolveReviewTaskRoot(scene, task, layout.catalog);
  const sourceRoot = path.join(resolved.taskRoot, 'source');
  const target = path.resolve(resolved.taskRoot, reference);
  if (!inside(sourceRoot, target)) {
    throw Object.assign(new Error('证据路径越出 source 目录'), { statusCode: 404 });
  }
  return { body: await readFile(target), type: contentType(target) };
}

export const registerReviewRoutes: FastifyPluginAsync<ReviewRouteOptions> = async (app, options) => {
  app.get('/api/scenes', async () => ({
    scenes: await listScenes(options.layout.catalog),
  }));

  app.get<{ Params: SceneParams }>('/api/scenes/:scene/tasks', {
    schema: { params: sceneParamsSchema },
  }, async (request) => {
    const scene = requireIdentifier(request.params.scene, 'scene');
    return { scene, tasks: await listTasks(scene, options.layout.catalog) };
  });

  app.get<{ Params: TaskParams }>('/api/tasks/:scene/:task', {
    schema: { params: taskParamsSchema },
  }, async (request) => {
    const scene = requireIdentifier(request.params.scene, 'scene');
    const task = requireIdentifier(request.params.task, 'task');
    return loadReviewTask(scene, task, options.layout.catalog);
  });

  app.get<{ Params: TaskParams; Querystring: EvidenceQuery }>(
    '/api/tasks/:scene/:task/evidence',
    {
      schema: {
        params: taskParamsSchema,
        querystring: {
          type: 'object',
          required: ['path'],
          properties: { path: { type: 'string', minLength: 1 } },
        },
      },
    },
    async (request, reply) => {
      const scene = requireIdentifier(request.params.scene, 'scene');
      const task = requireIdentifier(request.params.task, 'task');
      if (!request.query.path) throw new Error('缺少证据 path');
      const file = await evidenceFile(scene, task, request.query.path, options.layout);
      return reply.type(file.type).send(file.body);
    },
  );

  app.post<{ Params: TaskParams; Body: JsonObject }>(
    '/api/tasks/:scene/:task/mutate',
    {
      schema: {
        params: taskParamsSchema,
        body: {
          type: 'object',
          required: ['draft', 'mutation'],
          properties: {
            draft: draftBodySchema,
            mutation: { type: 'object', additionalProperties: true },
          },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      requireIdentifier(request.params.scene, 'scene');
      requireIdentifier(request.params.task, 'task');
      const body = requireObjectBody<MutationBody>(request.body);
      const result = applyReviewMutation(body.draft, body.mutation);
      await validateReviewDraft(result.draft);
      return result;
    },
  );

  app.post<{ Params: TaskParams; Body: JsonObject }>(
    '/api/tasks/:scene/:task/validate',
    { schema: { params: taskParamsSchema, body: draftBodySchema } },
    async (request) => {
      requireIdentifier(request.params.scene, 'scene');
      requireIdentifier(request.params.task, 'task');
      await validateReviewDraft(requireObjectBody<ReviewTaskDraft>(request.body));
      return { valid: true };
    },
  );

  app.put<{ Params: TaskParams; Body: JsonObject }>(
    '/api/tasks/:scene/:task',
    {
      schema: {
        params: taskParamsSchema,
        body: {
          ...draftBodySchema,
          required: ['expectedRevision', 'manifest', 'document'],
          properties: {
            ...draftBodySchema.properties,
            expectedRevision: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request) => {
      const scene = requireIdentifier(request.params.scene, 'scene');
      const task = requireIdentifier(request.params.task, 'task');
      const body = requireObjectBody<SaveReviewTaskRequest>(request.body);
      return saveReviewTask(scene, task, options.layout.catalog, body);
    },
  );
};
