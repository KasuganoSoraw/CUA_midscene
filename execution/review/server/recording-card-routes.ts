import type { FastifyInstance } from 'fastify';
import type { RecordingCardStore } from '../service/recording-cards.js';
import type { RecordingCardInput } from '../shared/recording-cards.js';
import type { RecorderControl } from '../service/windows-recorder.js';
import type { RecordingCatalog } from '../../cua/recording/recording-catalog.js';

const textFields = {
  name: { type: 'string', minLength: 1, maxLength: 120, pattern: '\\S' },
  description: { type: 'string', maxLength: 2000 },
};
const params = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1 } },
};
const body = {
  type: 'object',
  required: ['name', 'description'],
  properties: textFields,
  additionalProperties: false,
};

export function registerRecordingCardRoutes(
  app: FastifyInstance,
  store: RecordingCardStore,
  recorder: RecorderControl,
  recordings: () => Promise<RecordingCatalog>,
  busy: () => boolean = () => false,
): void {
  registerCardQueries(app, store, recordings);
  registerCardWrites(app, store);
  registerCardVisitsAndDeletion(app, store, recorder, busy);
  registerCardRecording(app, store, recorder, busy);
}

function registerCardWrites(
  app: FastifyInstance,
  store: RecordingCardStore,
): void {
  app.post<{ Body: RecordingCardInput }>(
    '/api/recording-cards',
    { schema: { body } },
    async (request, reply) => reply.code(201).send(store.create(request.body)),
  );
  app.patch<{
    Params: { id: string };
    Body: RecordingCardInput & { version: number };
  }>(
    '/api/recording-cards/:id',
    {
      schema: {
        params,
        body: {
          ...body,
          required: ['name', 'description', 'version'],
          properties: {
            ...textFields,
            version: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
    async (request) =>
      store.update(request.params.id, request.body, request.body.version),
  );
}

function registerCardVisitsAndDeletion(
  app: FastifyInstance,
  store: RecordingCardStore,
  recorder: RecorderControl,
  busy: () => boolean,
): void {
  app.delete<{ Params: { id: string } }>(
    '/api/recording-cards/:id',
    { schema: { params } },
    async (request) => {
      if (recorder.status().phase === 'failed') store.clearSession();
      if (busy()) throw new Error('任务正在处理，不能删除卡片');
      store.remove(request.params.id);
      return { deleted: true };
    },
  );
  app.post<{ Params: { id: string } }>(
    '/api/recording-cards/:id/visit',
    { schema: { params } },
    async (request) => {
      store.visit(request.params.id);
      return { visited: true };
    },
  );
}

function registerCardRecording(
  app: FastifyInstance,
  store: RecordingCardStore,
  recorder: RecorderControl,
  busy: () => boolean,
): void {
  let starting = false;
  app.post<{ Params: { id: string }; Body: { displayId: string } }>(
    '/api/recording-cards/:id/record',
    {
      schema: {
        params,
        body: {
          type: 'object',
          required: ['displayId'],
          additionalProperties: false,
          properties: { displayId: { type: 'string', minLength: 1 } },
        },
      },
    },
    async (request) => {
      if (busy() || starting || !['idle', 'failed'].includes(recorder.status().phase)) {
        throw Object.assign(new Error('已有录制正在进行'), { statusCode: 409 });
      }
      store.clearSession();
      store.beginRecording(request.params.id);
      starting = true;
      try {
        return await recorder.start(request.body.displayId);
      } catch (error) {
        store.clearSession();
        throw error;
      } finally {
        starting = false;
      }
    },
  );
}

function registerCardQueries(
  app: FastifyInstance,
  store: RecordingCardStore,
  recordings: () => Promise<RecordingCatalog>,
): void {
  app.get<{
    Querystring: { query?: string; page?: number; pageSize?: number };
  }>(
    '/api/recording-cards',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            query: { type: 'string', maxLength: 200 },
            page: { type: 'integer', minimum: 1 },
            pageSize: { type: 'integer', minimum: 1, maximum: 100 },
          },
        },
      },
    },
    async (request) => {
      return store.list(
        request.query.query ?? '',
        request.query.page ?? 1,
        request.query.pageSize ?? 16,
      );
    },
  );
  registerCardLookup(app, store, recordings);
}

function registerCardLookup(
  app: FastifyInstance,
  store: RecordingCardStore,
  recordings: () => Promise<RecordingCatalog>,
): void {
  app.post('/api/recording-cards/sync', async () => {
    store.importRecordings((await recordings()).recordings);
    return { synced: true };
  });
  app.get('/api/recording-cards/recent', async () => ({
    cards: store.recent(),
  }));
  app.get<{ Params: { id: string } }>(
    '/api/recording-cards/:id',
    { schema: { params } },
    async (request) => store.get(request.params.id),
  );
}
