import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import type { JsonObject, RuntimeLayout } from '../../cua/contracts/types.js';
import { createTaskFromRecording } from '../../cua/recording/create-task.js';
import {
  describeRecording,
  listRecordings,
  openRecordingDirectory,
  resolveRecordingsRoot,
  resolveRecordingDirectory,
} from '../../cua/recording/recording-catalog.js';
import { listScenes, listTasks, requireIdentifier } from '../../cua/task/tasks.js';
import type {
  ReviewMutation,
  ReviewTaskDraft,
  SaveReviewTaskRequest,
  StartTaskExecutionRequest,
} from '../shared/types.js';
import { applyReviewMutation } from '../service/task-mutations.js';
import { loadReviewTask, resolveReviewTaskRoot } from '../service/review-task.js';
import { saveReviewTask, validateReviewDraft } from '../service/task-save.js';
import {
  TaskExecutionManager,
  type TaskExecutionControl,
} from '../service/task-execution.js';
import {
  WindowsRecorderManager,
  type RecorderControl,
} from '../service/windows-recorder.js';

interface ReviewRouteOptions {
  layout: RuntimeLayout;
  recordingsRoot?: string;
  executionRoot?: string;
  dependencies?: ReviewRouteDependencies;
}

export interface ReviewRouteDependencies {
  createFromRecording?: typeof createTaskFromRecording;
  openDirectory?: typeof openRecordingDirectory;
  recorder?: RecorderControl;
  execution?: TaskExecutionControl;
}

interface SceneParams {
  scene: string;
}

interface TaskParams extends SceneParams {
  task: string;
}

interface RecordingParams {
  recording: string;
}

interface CreateRecordingTaskBody {
  scene: string;
  task: string;
  goal?: string;
}

interface EvidenceQuery {
  path?: string;
}

interface RecorderPreviewParams {
  index: string;
}

interface StartRecorderBody {
  displayId: string;
}

const startTaskExecutionBodySchema = {
  type: 'object',
  required: ['scene', 'task', 'mode', 'inputs'],
  properties: {
    scene: { type: 'string', minLength: 1 },
    task: { type: 'string', minLength: 1 },
    mode: { type: 'string', enum: ['task', 'act'] },
    inputs: {
      type: 'object',
      additionalProperties: { type: 'string' },
    },
  },
  additionalProperties: false,
} as const;

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

const recordingParamsSchema = {
  type: 'object',
  required: ['recording'],
  properties: { recording: { type: 'string', minLength: 1 } },
} as const;

const createRecordingTaskBodySchema = {
  type: 'object',
  required: ['scene', 'task'],
  properties: {
    scene: { type: 'string', minLength: 1 },
    task: { type: 'string', minLength: 1 },
    goal: { type: 'string' },
  },
  additionalProperties: false,
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
  const activeRecordingsRoot = await resolveRecordingsRoot(options.recordingsRoot, {
    executionRoot: options.executionRoot,
  });
  const recordingOptions = () => ({
    recordingsRoot: activeRecordingsRoot,
    executionRoot: options.executionRoot,
  });
  const recorder = options.dependencies?.recorder ?? new WindowsRecorderManager({
    executionRoot: path.resolve(options.executionRoot ?? process.cwd()),
    recordingsRoot: activeRecordingsRoot,
  });
  app.addHook('onClose', async () => recorder.close());

  if (!options.layout.data) throw new Error('任务运行页面需要配置 CUA_DATA_ROOT');
  const execution = options.dependencies?.execution ?? new TaskExecutionManager({
    catalog: options.layout.catalog,
    dataRoot: options.layout.data.root,
    executionRoot: path.resolve(options.executionRoot ?? process.cwd()),
  });
  app.addHook('onClose', async () => execution.close());

  app.get('/api/execution/status', async () => execution.status());

  app.post<{ Body: JsonObject }>('/api/execution/start', {
    schema: { body: startTaskExecutionBodySchema },
  }, async (request) => {
    const body = requireObjectBody<StartTaskExecutionRequest>(request.body);
    return execution.start({
      scene: requireIdentifier(body.scene, 'scene'),
      task: requireIdentifier(body.task, 'task'),
      mode: body.mode,
      inputs: body.inputs,
    });
  });

  app.post('/api/execution/stop', async () => execution.stop());

  app.get('/api/recorder/status', async () => recorder.status());

  app.post('/api/recorder/displays/refresh', async () => recorder.refreshDisplays());

  app.get<{ Params: RecorderPreviewParams }>('/api/recorder/displays/:index/preview', {
    schema: {
      params: {
        type: 'object',
        required: ['index'],
        properties: { index: { type: 'string', pattern: '^\\d+$' } },
      },
    },
  }, async (request, reply) => {
    const previewPath = await recorder.preview(Number(request.params.index));
    return reply.type('image/png').send(await readFile(previewPath));
  });

  app.post<{ Body: JsonObject }>('/api/recorder/start', {
    schema: {
      body: {
        type: 'object',
        required: ['displayId'],
        properties: {
          displayId: { type: 'string', minLength: 1 },
        },
        additionalProperties: false,
      },
    },
  }, async (request) => {
    const body = requireObjectBody<StartRecorderBody>(request.body);
    return recorder.start(body.displayId);
  });

  app.post('/api/recorder/stop', async () => recorder.stop());

  app.get('/api/scenes', async () => ({
    scenes: await listScenes(options.layout.catalog),
  }));

  app.get('/api/recordings', async () => listRecordings(recordingOptions()));

  app.get<{ Params: RecordingParams }>('/api/recordings/:recording', {
    schema: { params: recordingParamsSchema },
  }, async (request) => describeRecording(request.params.recording, recordingOptions()));

  app.post<{ Params: RecordingParams }>('/api/recordings/:recording/open-folder', {
    schema: { params: recordingParamsSchema },
  }, async (request) => {
    const recordingPath = await resolveRecordingDirectory(request.params.recording, recordingOptions());
    await (options.dependencies?.openDirectory ?? openRecordingDirectory)(recordingPath);
    return { opened: true, recording: request.params.recording };
  });

  app.post<{ Params: RecordingParams; Body: JsonObject }>(
    '/api/recordings/:recording/tasks',
    {
      schema: {
        params: recordingParamsSchema,
        body: createRecordingTaskBodySchema,
      },
    },
    async (request) => {
      if (!options.layout.data) throw new Error('从录制创建任务需要配置 CUA_DATA_ROOT');
      const body = requireObjectBody<CreateRecordingTaskBody>(request.body);
      const scene = requireIdentifier(body.scene, 'scene');
      const task = requireIdentifier(body.task, 'task');
      const entry = await describeRecording(request.params.recording, recordingOptions());
      if (!entry.ready) {
        throw new Error(`录制不可生成：${entry.id}\n${entry.errors.join('\n')}`);
      }
      const recordingPath = await resolveRecordingDirectory(request.params.recording, recordingOptions());
      const result = await (options.dependencies?.createFromRecording ?? createTaskFromRecording)({
        scene,
        task,
        goal: body.goal,
        recording: recordingPath,
        catalog: options.layout.catalog,
        runsRoot: options.layout.data.runsRoot,
        executionRoot: options.executionRoot,
        creationCommand: 'review web',
      });
      return {
        created: result.created,
        valid: result.valid,
        scene: result.scene,
        task: result.task,
        goal: result.goal,
      };
    },
  );

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
